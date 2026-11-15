const DB_NAME = 'ShikshaTrackOfflineDB';
const DB_VERSION = 2;

export const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;

      // Store 1: Class rosters for offline scanning
      if (!db.objectStoreNames.contains('rosters')) {
        db.createObjectStore('rosters', { keyPath: 'classId' });
      }

      // Store 2: Offline attendance event queue
      if (!db.objectStoreNames.contains('syncQueue')) {
        const queueStore = db.createObjectStore('syncQueue', { keyPath: 'eventId' });
        queueStore.createIndex('synced', 'synced', { unique: false });
        queueStore.createIndex('status', 'status', { unique: false });
        queueStore.createIndex('classId', 'classId', { unique: false });
      }

      // Store 3: General offline key-value cache
      if (!db.objectStoreNames.contains('offlineCache')) {
        db.createObjectStore('offlineCache', { keyPath: 'key' });
      }

      // Store 4: Conflict store for offline review
      if (!db.objectStoreNames.contains('conflicts')) {
        db.createObjectStore('conflicts', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => resolve(event.target.result);
    request.onerror = () => reject(request.error);
  });
};

/**
 * Save offline class roster
 */
export const saveOfflineRoster = async (rosterData) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rosters', 'readwrite');
    const store = tx.objectStore('rosters');
    store.put({
      classId: rosterData.class.id,
      className: `${rosterData.class.name}-${rosterData.class.section}`,
      sessionId: rosterData.sessionId,
      sessionDate: rosterData.sessionDate,
      students: rosterData.students,
      downloadedAt: new Date().toISOString(),
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Get offline roster for class
 */
export const getOfflineRoster = async (classId) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rosters', 'readonly');
    const store = tx.objectStore('rosters');
    const req = store.get(classId);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
};

/**
 * List all downloaded rosters
 */
export const listOfflineRosters = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('rosters', 'readonly');
    const store = tx.objectStore('rosters');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
};

/**
 * Enqueue an attendance event while offline with unique operation tracking
 */
export const enqueueOfflineEvent = async (eventData) => {
  const db = await openDB();
  const eventId = `offline-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;

  const item = {
    eventId,
    operationId: eventId,
    ...eventData,
    timestamp: new Date().toISOString(),
    synced: false,
    status: 'PENDING',
    retryCount: 0,
    lastError: null,
  };

  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    store.add(item);
    tx.oncomplete = () => resolve(item);
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Get all unsynced events in the queue
 */
export const getUnsyncedEvents = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readonly');
    const store = tx.objectStore('syncQueue');
    const req = store.getAll();
    req.onsuccess = () => {
      const all = req.result || [];
      resolve(all.filter((item) => !item.synced && item.status !== 'SYNCED'));
    };
    req.onerror = () => reject(req.error);
  });
};

/**
 * Get all events in the queue with status
 */
export const getAllQueueEvents = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readonly');
    const store = tx.objectStore('syncQueue');
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
};

/**
 * Update offline event status in queue
 */
export const updateOfflineEventStatus = async (eventId, updates = {}) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    const getReq = store.get(eventId);

    getReq.onsuccess = () => {
      const current = getReq.result;
      if (!current) {
        resolve(null);
        return;
      }
      const updated = { ...current, ...updates };
      store.put(updated);
      tx.oncomplete = () => resolve(updated);
    };
    getReq.onerror = () => reject(getReq.error);
  });
};

/**
 * Mark events as synced or remove them from local queue
 */
export const markEventsSynced = async (eventIds) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('syncQueue', 'readwrite');
    const store = tx.objectStore('syncQueue');
    eventIds.forEach((id) => {
      store.delete(id);
    });
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Save conflict details into local store
 */
export const saveConflictRecord = async (conflict) => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('conflicts', 'readwrite');
    const store = tx.objectStore('conflicts');
    store.put(conflict);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};

/**
 * Clear all offline data (reset)
 */
export const clearOfflineDatabase = async () => {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['rosters', 'syncQueue', 'offlineCache'], 'readwrite');
    tx.objectStore('rosters').clear();
    tx.objectStore('syncQueue').clear();
    tx.objectStore('offlineCache').clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
};
