import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import 'fake-indexeddb/auto';
import {
  ShikshaTrackRecordMappingAdapter,
  mapBackendResponseToBatchResponse,
  createShikshaSyncClient,
  ATTENDANCE_STATUSES,
} from '../shikshatrackSyncAdapter.js';
import {
  openDB,
  saveOfflineRoster,
  getOfflineRoster,
  listOfflineRosters,
  saveConflictRecord,
} from '../db.js';
import {
  MemoryStorageAdapter,
  InMemoryLockManager,
  IndexedDBStorageAdapter,
} from 'offline-sync-kit';

describe('ShikshaTrack Integration Test Suite (Phase 3B)', () => {
  let dbName;

  beforeEach(async () => {
    dbName = `ShikshaTrackTestDB_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  });

  afterEach(async () => {
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase(dbName);
    }
  });

  describe('1. Legacy Schema & Attendance Status Preservation', () => {
    it('preserves PRESENT, ABSENT, LATE, and EXCUSED without converting to queue states', () => {
      for (const status of ['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']) {
        const legacyRecord = {
          eventId: `ev-${status}`,
          operationId: `op-${status}`,
          classId: 'cls_1',
          studentId: 'std_1',
          status: status, // Attendance status
          synced: false,
          timestamp: '2026-11-17T10:00:00.000Z',
        };

        const op = ShikshaTrackRecordMappingAdapter.fromStorage(legacyRecord);
        expect(op.payload.attendanceStatus).toBe(status);
        expect(op.payload.status).toBe(status);
        expect(op.metadata.status).toBe('PENDING'); // Queue state

        const stored = ShikshaTrackRecordMappingAdapter.toStorage(op);
        expect(stored.status).toBe(status); // Storage status remains attendance status
        expect(stored.queueStatus).toBe('PENDING'); // Dedicated queue state
        expect(stored.synced).toBe(false);
      }
    });

    it('recovers existing legacy records with synced: false and synced: true correctly', () => {
      const unsyncedRecord = {
        eventId: 'legacy-unsynced-1',
        operationId: 'legacy-unsynced-1',
        classId: 'cls_10A',
        studentId: 'std_1',
        status: 'LATE',
        synced: false,
        timestamp: '2026-11-15T08:00:00.000Z',
      };

      const syncedRecord = {
        eventId: 'legacy-synced-2',
        operationId: 'legacy-synced-2',
        classId: 'cls_10A',
        studentId: 'std_2',
        status: 'PRESENT',
        synced: true,
        timestamp: '2026-11-15T08:05:00.000Z',
      };

      const opUnsynced = ShikshaTrackRecordMappingAdapter.fromStorage(unsyncedRecord);
      expect(opUnsynced.metadata.status).toBe('PENDING');
      expect(opUnsynced.payload.attendanceStatus).toBe('LATE');

      const opSynced = ShikshaTrackRecordMappingAdapter.fromStorage(syncedRecord);
      expect(opSynced.metadata.status).toBe('SYNCED');
      expect(opSynced.payload.attendanceStatus).toBe('PRESENT');
    });
  });

  describe('2. Corrupted Record Quarantine & Defense in Depth', () => {
    it('quarantines records with missing or invalid attendance status in FAILED state', () => {
      const corruptedStatuses = ['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT', '', null, undefined];

      for (const invalid of corruptedStatuses) {
        const record = {
          eventId: `corrupt-${String(invalid)}`,
          operationId: `corrupt-${String(invalid)}`,
          classId: 'cls_1',
          studentId: 'std_1',
          status: invalid,
          synced: false,
          timestamp: '2026-11-17T09:00:00.000Z',
        };

        const op = ShikshaTrackRecordMappingAdapter.fromStorage(record);
        expect(op.payload.attendanceStatus).toBeUndefined();
        expect(op.payload.requiresManualResolution).toBe(true);
        expect(op.metadata.status).toBe('FAILED');
        expect(op.metadata.lastErrorCode).toBe('CORRUPTED_ATTENDANCE_STATUS');

        const stored = ShikshaTrackRecordMappingAdapter.toStorage(op);
        expect(stored.status).not.toBe('PRESENT');
        expect(stored.queueStatus).toBe('FAILED');
        expect(stored.requiresManualResolution).toBe(true);
      }
    });

    it('blocks corrupted records from successful batch response mapping', () => {
      const batch = [
        {
          metadata: { id: 'corrupt-op', idempotencyKey: 'idem-corrupt' },
          payload: { attendanceStatus: undefined, requiresManualResolution: true },
        },
      ];

      const res = mapBackendResponseToBatchResponse(batch, { success: true, results: [] });
      expect(res.results[0].status).toBe('PERMANENT_ERROR');
      expect(res.results[0].errorCode).toBe('CORRUPTED_ATTENDANCE_STATUS');
    });
  });

  describe('3. Offline Enqueue & Online Synchronization', () => {
    it('enqueues attendance offline and synchronizes to backend successfully', async () => {
      const storage = new MemoryStorageAdapter();
      const lockManager = new InMemoryLockManager();

      let transmittedBatch = null;

      const client = createShikshaSyncClient({
        storageAdapter: storage,
        lockManager,
        onSync: async (batch) => {
          transmittedBatch = batch;
          return {
            success: true,
            results: batch.map((op) => ({
              idempotencyKey: op.metadata.idempotencyKey,
              status: 'SUCCESS',
            })),
          };
        },
      });

      const enqueued = await client.enqueue(
        'ATTENDANCE_SCAN',
        {
          classId: 'cls_10A',
          studentId: 'std_42',
          attendanceStatus: 'PRESENT',
        },
        { id: 'scan-001', idempotencyKey: 'idem-scan-001' }
      );

      expect(enqueued.metadata.id).toBe('scan-001');

      // Verify record in storage before sync
      const rawBefore = await storage.get('scan-001');
      expect(rawBefore.eventId).toBe('scan-001');
      expect(rawBefore.status).toBe('PRESENT');
      expect(rawBefore.queueStatus).toBe('PENDING');

      // Execute syncNow
      const summary = await client.syncNow();
      expect(summary.syncedCount).toBe(1);
      expect(transmittedBatch.length).toBe(1);

      await client.destroy();
    });
  });

  describe('4. Multi-Tab Synchronization Locking', () => {
    it('prevents concurrent dispatch across clients sharing the same lock manager', async () => {
      const storage = new MemoryStorageAdapter();
      const lockManager = new InMemoryLockManager();

      let activeExecutions = 0;
      let maxConcurrent = 0;

      const createClient = () =>
        createShikshaSyncClient({
          storageAdapter: storage,
          lockManager,
          onSync: async (batch) => {
            activeExecutions++;
            maxConcurrent = Math.max(maxConcurrent, activeExecutions);
            await new Promise((r) => setTimeout(r, 50));
            activeExecutions--;
            return {
              success: true,
              results: batch.map((op) => ({ idempotencyKey: op.metadata.idempotencyKey, status: 'SUCCESS' })),
            };
          },
        });

      const clientA = createClient();
      const clientB = createClient();

      await clientA.enqueue('ATTENDANCE_SCAN', { attendanceStatus: 'PRESENT' }, { id: 'op-a' });
      await clientB.enqueue('ATTENDANCE_SCAN', { attendanceStatus: 'LATE' }, { id: 'op-b' });

      // Run sync concurrently
      await Promise.all([clientA.syncNow(), clientB.syncNow()]);

      expect(maxConcurrent).toBe(1);

      await clientA.destroy();
      await clientB.destroy();
    });
  });

  describe('5. Authentication Expiry & Recovery', () => {
    it('pauses queue on HTTP 401 and resumes upon resumeSync()', async () => {
      const storage = new MemoryStorageAdapter();
      const lockManager = new InMemoryLockManager();

      let simulate401 = true;

      const client = createShikshaSyncClient({
        storageAdapter: storage,
        lockManager,
        onSync: async (batch) => {
          if (simulate401) {
            const err = new Error('Unauthorized');
            err.response = { status: 401 };
            throw err;
          }
          return {
            success: true,
            results: batch.map((op) => ({ idempotencyKey: op.metadata.idempotencyKey, status: 'SUCCESS' })),
          };
        },
      });

      await client.enqueue('ATTENDANCE_SCAN', { attendanceStatus: 'PRESENT' }, { id: 'auth-op-1' });

      const summary1 = await client.syncNow();
      expect(summary1.authBlocked).toBe(true);

      const opBlocked = await client.getById('auth-op-1');
      expect(opBlocked.metadata.status).toBe('AUTH_BLOCKED');

      // Re-authenticate and resume
      simulate401 = false;
      const resumedCount = await client.resumeSync();
      expect(resumedCount).toBe(1);

      await client.destroy();
    });
  });

  describe('6. Permission Denied (HTTP 403) Handling', () => {
    it('marks operation permanently FAILED on 403 without pausing the queue', () => {
      const batch = [
        { metadata: { id: 'op-403', idempotencyKey: 'idem-403' }, payload: { attendanceStatus: 'LATE' } },
        { metadata: { id: 'op-ok', idempotencyKey: 'idem-ok' }, payload: { attendanceStatus: 'PRESENT' } },
      ];

      const mockResponse = {
        success: false,
        data: {
          results: [
            { operationId: 'idem-403', success: false, statusCode: 403, errorCode: 'PERMISSION_DENIED', error: 'No access to class' },
            { operationId: 'idem-ok', success: true, status: 'PRESENT' },
          ],
        },
      };

      const res = mapBackendResponseToBatchResponse(batch, mockResponse);

      const res403 = res.results.find((r) => r.idempotencyKey === 'idem-403');
      expect(res403.status).toBe('PERMANENT_ERROR');
      expect(res403.errorCode).toBe('PERMISSION_DENIED');

      const resOk = res.results.find((r) => r.idempotencyKey === 'idem-ok');
      expect(resOk.status).toBe('SUCCESS');
    });
  });

  describe('7. Partial Batch Response Safety', () => {
    it('keeps omitted batch items retryable and does not mark them as succeeded', () => {
      const batch = [
        { metadata: { id: 'item-1', idempotencyKey: 'idem-1' }, payload: { attendanceStatus: 'PRESENT' } },
        { metadata: { id: 'item-2', idempotencyKey: 'idem-2' }, payload: { attendanceStatus: 'ABSENT' } },
      ];

      // Server returns only item-1 result
      const mockResponse = {
        success: true,
        data: {
          results: [{ operationId: 'idem-1', success: true }],
        },
      };

      const res = mapBackendResponseToBatchResponse(batch, mockResponse);
      expect(res.results.find((r) => r.idempotencyKey === 'idem-1').status).toBe('SUCCESS');

      const omitted = res.results.find((r) => r.idempotencyKey === 'idem-2');
      expect(omitted.status).toBe('RETRYABLE_ERROR');
      expect(omitted.errorCode).toBe('PARTIAL_BATCH_OMISSION');
    });
  });

  describe('8. Conflict Handling & Local Store Preservation', () => {
    it('correctly maps conflict response and preserves details', () => {
      const batch = [
        { metadata: { id: 'conf-op', idempotencyKey: 'idem-conf' }, payload: { attendanceStatus: 'ABSENT' } },
      ];

      const mockResponse = {
        success: true,
        data: {
          results: [
            {
              operationId: 'idem-conf',
              success: true,
              isDuplicate: true,
              hasConflict: true,
              conflictId: 'conf-123',
              currentStatus: 'PRESENT',
              studentName: 'Aarav',
            },
          ],
        },
      };

      const res = mapBackendResponseToBatchResponse(batch, mockResponse);
      const confItem = res.results[0];
      expect(confItem.status).toBe('CONFLICT');
      expect(confItem.conflictDetails.conflictId).toBe('conf-123');
      expect(confItem.conflictDetails.currentStatus).toBe('PRESENT');
      expect(confItem.conflictDetails.studentName).toBe('Aarav');
    });
  });

  describe('9. React StrictMode Lifecycle Regression', () => {
    it('handles StrictMode setup -> cleanup -> setup sequence without destroying the client', async () => {
      const storage = new MemoryStorageAdapter();
      const lockManager = new InMemoryLockManager();

      const client = createShikshaSyncClient({
        storageAdapter: storage,
        lockManager,
        onSync: async (batch) => ({
          success: true,
          results: batch.map((op) => ({ idempotencyKey: op.metadata.idempotencyKey, status: 'SUCCESS' })),
        }),
      });

      // --- FIRST MOUNT (React StrictMode effect setup 1) ---
      client.retain();
      expect(client.isDestroyed()).toBe(false);
      const unsub1 = client.on('sync:start', () => {});

      // --- FIRST CLEANUP (React StrictMode simulated unmount) ---
      unsub1();
      client.release(50); // schedules deferred destroy in 50ms
      // Immediate state check: client must NOT be destroyed yet!
      expect(client.isDestroyed()).toBe(false);

      // --- SECOND MOUNT (React StrictMode immediate re-mount) ---
      client.retain(); // cancels pending destruction timer
      expect(client.isDestroyed()).toBe(false);

      // Subscribing must succeed without throwing "OfflineSyncClient instance has been destroyed"
      let syncStartFired = false;
      const unsub2 = client.on('sync:start', () => {
        syncStartFired = true;
      });

      // Verify client operations work normally
      await client.enqueue('ATTENDANCE_SCAN', { attendanceStatus: 'PRESENT' }, { id: 'strict-mode-op' });
      const summary = await client.syncNow();
      expect(summary.syncedCount).toBe(1);
      expect(syncStartFired).toBe(true);

      // --- FINAL UNMOUNT (Real component teardown) ---
      unsub2();
      client.release(20);

      // Wait for release timer to expire
      await new Promise((r) => setTimeout(r, 60));
      expect(client.isDestroyed()).toBe(true);

      // Calling on() on the destroyed client now properly throws
      expect(() => client.on('sync:start', () => {})).toThrowError(/destroyed/);
    });
  });
});
