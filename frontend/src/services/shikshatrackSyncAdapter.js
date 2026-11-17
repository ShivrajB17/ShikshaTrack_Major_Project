/**
 * ShikshaTrack Adapter for offline-sync-kit
 *
 * Implements offline-sync-kit RecordMappingAdapter contract with strict safety guarantees:
 * 1. Zero silent default to PRESENT for corrupted or missing records.
 * 2. Unverified or corrupted records are quarantined into FAILED state and blocked from dispatch.
 * 3. Preserves ShikshaTrackOfflineDB version 2, its object stores, key paths, and indexes without upgrade.
 * 4. Strict separation of canonical attendance status ('PRESENT'|'ABSENT'|'LATE'|'EXCUSED') from queueStatus.
 * 5. Handles backend /api/v1/sync/batch response mapping: SUCCESS, DUPLICATE_IDEMPOTENT, CONFLICT, PERMANENT_ERROR, RETRYABLE_ERROR.
 * 6. Protects against partial batch omissions and reserved metadata collisions.
 */

import { OfflineSyncClient, IndexedDBStorageAdapter } from 'offline-sync-kit';
import api from './api.js';

export const ATTENDANCE_STATUSES = new Set(['PRESENT', 'ABSENT', 'LATE', 'EXCUSED']);
export const QUEUE_STATUSES = new Set(['PENDING', 'SYNCING', 'SYNCED', 'FAILED', 'CONFLICT', 'AUTH_BLOCKED']);

export const RESERVED_METADATA_KEYS = new Set([
  'eventId',
  'operationId',
  'status',
  'queueStatus',
  'synced',
  'timestamp',
  'retryCount',
  'lastError',
  'lastErrorCode',
  'syncStartedAt',
  'leaseExpiresAt',
  'conflictData',
  'requiresManualResolution',
]);

export const WHITELISTED_BUSINESS_KEYS = new Set([
  'classId',
  'sessionId',
  'studentId',
  'qrToken',
  'remarks',
  'overwrite',
  'resolveConflict',
]);

/**
 * RecordMappingAdapter for ShikshaTrack
 */
export const ShikshaTrackRecordMappingAdapter = {
  keyPath: 'eventId',

  getKey(op) {
    return String(op.metadata.id);
  },

  toStorage(op) {
    const payload = op.payload || {};
    const metadata = op.metadata || {};

    // 1. Determine canonical attendance status (NEVER a queue state, NEVER silent fallback to PRESENT)
    let attendanceStatus = undefined;
    if (typeof payload.attendanceStatus === 'string' && ATTENDANCE_STATUSES.has(payload.attendanceStatus.toUpperCase())) {
      attendanceStatus = payload.attendanceStatus.toUpperCase();
    } else if (typeof payload.status === 'string' && ATTENDANCE_STATUSES.has(payload.status.toUpperCase())) {
      attendanceStatus = payload.status.toUpperCase();
    }

    // Check if record is corrupted or missing attendance status
    const isCorrupted = !attendanceStatus || payload.requiresManualResolution === true;

    // 2. Extract unrecognized legacy fields, strictly rejecting reserved collisions
    const safeUnrecognized = {};
    if (metadata.unrecognizedFields && typeof metadata.unrecognizedFields === 'object') {
      for (const [key, val] of Object.entries(metadata.unrecognizedFields)) {
        if (!RESERVED_METADATA_KEYS.has(key) && !WHITELISTED_BUSINESS_KEYS.has(key)) {
          safeUnrecognized[key] = val;
        }
      }
    }

    // 3. Construct storage record strictly separating attendance status from queueStatus
    const record = {
      // Preserved unrecognized legacy fields
      ...safeUnrecognized,

      // Whitelisted attendance business fields
      classId: payload.classId,
      sessionId: payload.sessionId,
      studentId: payload.studentId,
      qrToken: payload.qrToken,
      remarks: payload.remarks,
      overwrite: Boolean(payload.overwrite),
      resolveConflict: Boolean(payload.resolveConflict),

      // Reserved primary key and deduplication idempotency identifiers
      eventId: String(metadata.id),
      operationId: metadata.idempotencyKey || String(metadata.id),

      // Canonical Attendance Status:
      // If corrupted, preserves original status string or flags INVALID; NEVER defaults to PRESENT!
      status: attendanceStatus || metadata.unrecognizedFields?.status || 'INVALID_ATTENDANCE_STATUS',

      // Dedicated Queue State & Legacy Synced Flag
      // Corrupted records are quarantined in FAILED state to prevent auto-sync
      queueStatus: isCorrupted ? 'FAILED' : (metadata.status || 'PENDING'),
      synced: isCorrupted ? false : (metadata.status === 'SYNCED'),

      // Operational flags & timestamps
      requiresManualResolution: isCorrupted,
      timestamp: metadata.createdAt || new Date().toISOString(),
      retryCount: metadata.retryCount ?? 0,
      lastError: isCorrupted
        ? (metadata.lastError || 'Corrupted record: Missing or invalid attendance status. Requires manual resolution.')
        : (metadata.lastError || null),
      lastErrorCode: isCorrupted
        ? 'CORRUPTED_ATTENDANCE_STATUS'
        : (metadata.lastErrorCode || null),
      syncStartedAt: metadata.syncStartedAt,
      leaseExpiresAt: metadata.leaseExpiresAt,
      conflictData: metadata.conflictData,
    };

    return record;
  },

  fromStorage(record) {
    if (!record || typeof record !== 'object') {
      throw new Error('Cannot deserialize null or non-object record');
    }

    // 1. Determine canonical attendance status without silent fallback
    let attendanceStatus = undefined;
    if (typeof record.attendanceStatus === 'string' && ATTENDANCE_STATUSES.has(record.attendanceStatus.toUpperCase())) {
      attendanceStatus = record.attendanceStatus.toUpperCase();
    } else if (typeof record.status === 'string' && ATTENDANCE_STATUSES.has(record.status.toUpperCase())) {
      attendanceStatus = record.status.toUpperCase();
    }

    const isCorrupted = !attendanceStatus || record.requiresManualResolution === true;

    // 2. Determine package queue state
    let queueState = 'PENDING';
    if (isCorrupted) {
      // Corrupted records are quarantined in FAILED state
      queueState = 'FAILED';
    } else if (typeof record.queueStatus === 'string' && QUEUE_STATUSES.has(record.queueStatus)) {
      queueState = record.queueStatus;
    } else if (typeof record.synced === 'boolean') {
      if (record.synced === true) {
        queueState = 'SYNCED';
      } else {
        if (record.status === 'CONFLICT') {
          queueState = 'CONFLICT';
        } else if (record.status === 'FAILED') {
          queueState = 'FAILED';
        } else {
          queueState = 'PENDING';
        }
      }
    }

    // 3. Extract unrecognized fields for non-destructive round-trips
    const unrecognizedFields = {};
    const knownKeys = new Set([
      ...RESERVED_METADATA_KEYS,
      ...WHITELISTED_BUSINESS_KEYS,
      'attendanceStatus',
    ]);
    for (const [key, val] of Object.entries(record)) {
      if (!knownKeys.has(key)) {
        unrecognizedFields[key] = val;
      }
    }

    // 4. Return standard SyncOperation
    return {
      metadata: {
        id: record.eventId,
        idempotencyKey: record.operationId || record.eventId,
        type: 'ATTENDANCE_SCAN',
        createdAt: record.timestamp || new Date().toISOString(),
        status: queueState,
        retryCount: record.retryCount ?? 0,
        maxRetries: 5,
        lastError: isCorrupted
          ? (record.lastError || 'Corrupted record: Missing or invalid attendance status. Requires manual resolution.')
          : (record.lastError || undefined),
        lastErrorCode: isCorrupted ? 'CORRUPTED_ATTENDANCE_STATUS' : (record.lastErrorCode || undefined),
        syncStartedAt: record.syncStartedAt,
        leaseExpiresAt: record.leaseExpiresAt,
        conflictData: record.conflictData,
        unrecognizedFields,
      },
      payload: {
        classId: record.classId,
        sessionId: record.sessionId,
        studentId: record.studentId,
        qrToken: record.qrToken,
        remarks: record.remarks,
        overwrite: Boolean(record.overwrite),
        resolveConflict: Boolean(record.resolveConflict),
        attendanceStatus, // Undefined if corrupted; NEVER silently 'PRESENT'
        status: attendanceStatus,
        requiresManualResolution: isCorrupted,
      },
    };
  },
};

/**
 * Backend Response Mapper
 *
 * Converts ShikshaTrack's backend /api/v1/sync/batch response
 * to offline-sync-kit's ServerBatchResponse contract with structured error handling.
 */
export function mapBackendResponseToBatchResponse(batch, backendResponse) {
  const data = backendResponse?.data || backendResponse || {};
  const serverResults = Array.isArray(data.results) ? data.results : [];

  return {
    success: Boolean(backendResponse.success !== false && data.success !== false),
    results: batch.map((op) => {
      const opId = op.metadata.idempotencyKey;
      const eventId = String(op.metadata.id);

      // Guard: If operation is corrupted or requires manual resolution, block it from successful sync
      if (op.payload?.requiresManualResolution || !op.payload?.attendanceStatus) {
        return {
          idempotencyKey: opId,
          status: 'PERMANENT_ERROR',
          error: 'Cannot synchronize record: missing or invalid attendance status. Requires manual recovery.',
          errorCode: 'CORRUPTED_ATTENDANCE_STATUS',
        };
      }

      // Match item strictly by idempotencyKey or eventId
      const r = serverResults.find(
        (item) => item.operationId === opId || item.eventId === eventId || item.operationId === eventId
      );

      // Handle omitted operation (Partial Batch Response)
      if (!r) {
        return {
          idempotencyKey: opId,
          status: 'RETRYABLE_ERROR',
          error: 'Operation was omitted from server batch response (partial batch)',
          errorCode: 'PARTIAL_BATCH_OMISSION',
        };
      }

      // Successful outcome
      if (r.success) {
        if (r.hasConflict && !r.conflictResolved) {
          return {
            idempotencyKey: opId,
            status: 'CONFLICT',
            conflictDetails: {
              conflictId: r.conflictId,
              recordId: r.recordId,
              studentName: r.studentName,
              currentStatus: r.currentStatus,
              message: r.message,
            },
          };
        }

        if (r.isDuplicate) {
          return {
            idempotencyKey: opId,
            status: 'DUPLICATE_IDEMPOTENT',
          };
        }

        return {
          idempotencyKey: opId,
          status: 'SUCCESS',
        };
      }

      // Failure outcome: Distinguish structured codes
      const statusCode = r.statusCode || r.status;
      const errorCode = r.errorCode;
      const errorMsg = r.error || 'Server rejected synchronization event.';

      // HTTP 403: Forbidden / Permission Denied -> Permanent failure for this operation only
      if (statusCode === 403 || errorCode === 'PERMISSION_DENIED') {
        return {
          idempotencyKey: opId,
          status: 'PERMANENT_ERROR',
          error: errorMsg,
          errorCode: 'PERMISSION_DENIED',
        };
      }

      // HTTP 401: Authentication Expired
      if (statusCode === 401 || errorCode === 'AUTH_EXPIRED') {
        return {
          idempotencyKey: opId,
          status: 'RETRYABLE_ERROR',
          error: errorMsg,
          errorCode: 'AUTH_EXPIRED',
        };
      }

      // HTTP 400/422 or domain validation error -> Permanent client failure
      const isClientValidation =
        statusCode === 400 ||
        statusCode === 422 ||
        errorCode === 'CLIENT_VALIDATION' ||
        errorMsg.includes('Student not found') ||
        errorMsg.includes('Invalid attendance status') ||
        errorMsg.includes('Class not found');

      if (isClientValidation) {
        return {
          idempotencyKey: opId,
          status: 'PERMANENT_ERROR',
          error: errorMsg,
          errorCode: 'CLIENT_VALIDATION',
        };
      }

      // Default transient server error: RETRYABLE_ERROR
      return {
        idempotencyKey: opId,
        status: 'RETRYABLE_ERROR',
        error: errorMsg,
        errorCode: errorCode || 'TRANSIENT_SERVER_ERROR',
      };
    }),
  };
}

/**
 * Factory to instantiate a fully configured OfflineSyncClient for ShikshaTrack
 */
export function createShikshaSyncClient(customConfig = {}) {
  const storage =
    customConfig.storageAdapter ||
    new IndexedDBStorageAdapter({
      dbName: 'ShikshaTrackOfflineDB',
      storeName: 'syncQueue',
      version: 2,
      keyPath: 'eventId',
    });

  return new OfflineSyncClient({
    storage: {
      customAdapter: storage,
      mapping: ShikshaTrackRecordMappingAdapter,
    },
    cleanupStrategy: 'delete', // Matches legacy markEventsSynced behavior
    batchSize: 25,
    retry: {
      maxRetries: 5,
      initialDelayMs: 1000,
      maxDelayMs: 30000,
      backoffFactor: 2,
      jitter: true,
    },
    lease: {
      leaseDurationMs: 60000,
    },
    onSync: async (batch, abortSignal) => {
      // 1. Segregate corrupted/unverified records from valid records
      const validOps = batch.filter(
        (op) => op.payload?.attendanceStatus && !op.payload?.requiresManualResolution
      );

      let serverResponse = { success: true, results: [] };

      // 2. Only dispatch valid operations to the backend endpoint
      if (validOps.length > 0) {
        const events = validOps.map((op) => ({
          operationId: op.metadata.idempotencyKey,
          eventId: op.metadata.id,
          classId: op.payload.classId,
          sessionId: op.payload.sessionId,
          studentId: op.payload.studentId,
          qrToken: op.payload.qrToken,
          status: op.payload.attendanceStatus,
          timestamp: op.metadata.createdAt,
          remarks: op.payload.remarks,
          retryCount: op.metadata.retryCount || 0,
          resolveConflict: Boolean(op.payload.resolveConflict),
        }));

        const res = await api.post('/sync/batch', { events }, { signal: abortSignal });
        serverResponse = res?.data || res;
      }

      return mapBackendResponseToBatchResponse(batch, serverResponse);
    },
    ...customConfig,
  });
}
