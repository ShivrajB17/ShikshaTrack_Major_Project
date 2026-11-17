import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import api from '../services/api';
import {
  saveOfflineRoster,
  getOfflineRoster,
  listOfflineRosters,
  getAllQueueEvents,
  saveConflictRecord,
} from '../services/db';
import {
  createShikshaSyncClient,
  ATTENDANCE_STATUSES,
} from '../services/shikshatrackSyncAdapter';

const OfflineContext = createContext(null);

export const OfflineProvider = ({ client: propClient, children }) => {
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [pendingCount, setPendingCount] = useState(0);
  const [failedCount, setFailedCount] = useState(0);
  const [conflictCount, setConflictCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ current: 0, total: 0 });
  const [lastSyncResult, setLastSyncResult] = useState(null);
  const [lastSyncTimestamp, setLastSyncTimestamp] = useState(() => {
    return localStorage.getItem('shiksha_last_sync') || null;
  });
  const [savedRosters, setSavedRosters] = useState([]);
  const [queueItems, setQueueItems] = useState([]);

  // Stable client ownership across React StrictMode cycles (setup -> cleanup -> setup)
  const internalClientRef = useRef(null);
  if (!internalClientRef.current || (internalClientRef.current.isDestroyed && internalClientRef.current.isDestroyed())) {
    internalClientRef.current = createShikshaSyncClient();
  }
  const syncClient = propClient || internalClientRef.current;

  // Refresh status from IndexedDB
  const refreshStatus = useCallback(async () => {
    try {
      const allQueue = await getAllQueueEvents();

      // Normalize items for UI display: separate attendance status from queue state
      const formattedItems = allQueue.map((item) => {
        const isAtt = typeof item.status === 'string' && ATTENDANCE_STATUSES.has(item.status.toUpperCase());
        const attStatus = isAtt
          ? item.status.toUpperCase()
          : (item.attendanceStatus || (item.requiresManualResolution ? 'UNVERIFIED' : item.status));
        const qStatus = item.queueStatus || (item.synced ? 'SYNCED' : (item.status === 'FAILED' ? 'FAILED' : (item.status === 'CONFLICT' ? 'CONFLICT' : 'PENDING')));

        return {
          ...item,
          attendanceStatus: attStatus,
          queueStatus: qStatus,
          // Column 3 in OfflineSync table renders 'status'; ensure it displays attendance status
          status: attStatus,
        };
      });

      setQueueItems(formattedItems);

      const unsynced = formattedItems.filter(
        (item) => item.queueStatus === 'PENDING' && !item.synced && !item.requiresManualResolution
      );
      const failed = formattedItems.filter(
        (item) => item.queueStatus === 'FAILED' || item.requiresManualResolution
      );
      const conflicts = formattedItems.filter((item) => item.queueStatus === 'CONFLICT');

      setPendingCount(unsynced.length);
      setFailedCount(failed.length);
      setConflictCount(conflicts.length);

      const rosters = await listOfflineRosters();
      setSavedRosters(rosters);
    } catch (err) {
      console.error('Failed to load offline status:', err);
    }
  }, []);

  // Synchronize queue via offline-sync-kit
  const syncPendingQueue = useCallback(
    async (isManualRetry = false) => {
      if (isSyncing || !navigator.onLine) return;

      try {
        setIsSyncing(true);

        const summary = isManualRetry
          ? await syncClient.retryFailed()
          : await syncClient.syncNow();

        if (summary) {
          const nowIso = new Date().toISOString();
          setLastSyncTimestamp(nowIso);
          localStorage.setItem('shiksha_last_sync', nowIso);

          setLastSyncResult({
            timestamp: new Date().toLocaleTimeString(),
            syncedCount: summary.syncedCount,
            duplicatesCount: summary.duplicatesCount,
            conflictsCount: summary.conflictsCount,
            conflictsResolvedCount: 0,
            failedCount: summary.failedCount,
          });
        }
      } catch (err) {
        console.error('Offline synchronization failed:', err);
      } finally {
        setIsSyncing(false);
        setSyncProgress({ current: 0, total: 0 });
        await refreshStatus();
      }
    },
    [isSyncing, syncClient, refreshStatus]
  );

  // Wire offline-sync-kit events with StrictMode-safe lifecycle
  useEffect(() => {
    let mounted = true;

    // Never subscribe to a destroyed client
    if (syncClient.isDestroyed && syncClient.isDestroyed()) {
      return;
    }

    // Retain lease for active mount
    if (syncClient.retain) {
      syncClient.retain();
    }

    const unsubStart = syncClient.on('sync:start', (data) => {
      if (mounted) {
        setIsSyncing(true);
        setSyncProgress({ current: 0, total: data.count });
      }
    });

    const unsubProgress = syncClient.on('sync:progress', (data) => {
      if (mounted) {
        setSyncProgress({ current: data.current, total: data.total });
      }
    });

    const unsubSuccess = syncClient.on('sync:success', () => {
      if (mounted) {
        setIsSyncing(false);
        refreshStatus();
      }
    });

    const unsubError = syncClient.on('sync:error', () => {
      if (mounted) {
        setIsSyncing(false);
        refreshStatus();
      }
    });

    const unsubQueue = syncClient.on('queue:change', () => {
      if (mounted) {
        refreshStatus();
      }
    });

    const unsubConflict = syncClient.on('operation:conflict', async ({ operation, conflictDetails }) => {
      if (mounted && conflictDetails) {
        const details = conflictDetails;
        await saveConflictRecord({
          id: details.conflictId || String(operation.metadata.id),
          eventId: String(operation.metadata.id),
          studentName: details.studentName || 'Student',
          currentStatus: details.currentStatus || 'PRESENT',
          requestedStatus: operation.payload?.attendanceStatus || 'PRESENT',
          timestamp: new Date().toISOString(),
        });
        refreshStatus();
      }
    });

    const unsubNetwork = syncClient.on('network:change', ({ isOnline: online }) => {
      if (mounted) {
        setIsOnline(online);
      }
    });

    refreshStatus();

    return () => {
      mounted = false;
      unsubStart();
      unsubProgress();
      unsubSuccess();
      unsubError();
      unsubQueue();
      unsubConflict();
      unsubNetwork();

      // Release lease; defers destruction so React StrictMode remount remains valid
      if (!propClient && syncClient.release) {
        syncClient.release();
      }
    };
  }, [syncClient, propClient, refreshStatus]);

  // Download class roster into IndexedDB
  const downloadClassRoster = async (classId) => {
    const res = await api.get(`/sync/roster/${classId}`);
    await saveOfflineRoster(res.data);
    await refreshStatus();
    return res.data;
  };

  // Record attendance offline with guaranteed attendanceStatus preservation
  const recordOfflineAttendance = async (attendanceEvent) => {
    const eventId = `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    const attStatus = attendanceEvent.status && ATTENDANCE_STATUSES.has(attendanceEvent.status.toUpperCase())
      ? attendanceEvent.status.toUpperCase()
      : 'PRESENT';

    await syncClient.enqueue(
      'ATTENDANCE_SCAN',
      {
        ...attendanceEvent,
        attendanceStatus: attStatus,
        status: attStatus,
      },
      {
        id: eventId,
        idempotencyKey: eventId,
        createdAt: new Date().toISOString(),
      }
    );

    await refreshStatus();
    return {
      eventId,
      operationId: eventId,
      ...attendanceEvent,
      status: attStatus,
      attendanceStatus: attStatus,
      queueStatus: 'PENDING',
      synced: false,
    };
  };

  // Retry failed queue items manually
  const retryFailedQueue = async () => {
    return await syncPendingQueue(true);
  };

  return (
    <OfflineContext.Provider
      value={{
        isOnline,
        pendingCount,
        failedCount,
        conflictCount,
        isSyncing,
        syncProgress,
        lastSyncResult,
        lastSyncTimestamp,
        savedRosters,
        queueItems,
        syncPendingQueue,
        retryFailedQueue,
        downloadClassRoster,
        recordOfflineAttendance,
        getOfflineRoster,
        refreshStatus,
      }}
    >
      {children}
    </OfflineContext.Provider>
  );
};

export const useOffline = () => {
  const context = useContext(OfflineContext);
  if (!context) {
    throw new Error('useOffline must be used within an OfflineProvider');
  }
  return context;
};
