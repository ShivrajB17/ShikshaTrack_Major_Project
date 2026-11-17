import React, { useState, useEffect } from 'react';
import api from '../services/api';
import { useOffline } from '../context/OfflineContext';
import {
  CloudOff,
  Cloud,
  RefreshCw,
  Download,
  Trash2,
  CheckCircle2,
  HardDrive,
  ShieldAlert,
  RotateCw,
} from 'lucide-react';
import { clearOfflineDatabase } from '../services/db';

export default function OfflineSync() {
  const {
    isOnline,
    pendingCount,
    failedCount,
    conflictCount,
    isSyncing,
    lastSyncTimestamp,
    savedRosters,
    queueItems,
    syncPendingQueue,
    retryFailedQueue,
    downloadClassRoster,
    refreshStatus,
  } = useOffline();

  const [activeTab, setActiveTab] = useState('queue');
  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [successMsg, setSuccessMsg] = useState('');
  const [serverConflicts, setServerConflicts] = useState([]);
  const [conflictsLoading, setConflictsLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState(null);

  useEffect(() => {
    const fetchClasses = async () => {
      try {
        const res = await api.get('/classes');
        const list = res.data?.classes || res.data || [];
        setClasses(list);
        if (list.length > 0) setSelectedClassId(list[0].id);
      } catch (err) {}
    };
    if (isOnline) fetchClasses();
  }, [isOnline]);

  const fetchConflicts = async () => {
    if (!isOnline) return;
    try {
      setConflictsLoading(true);
      const res = await api.get('/sync/conflicts');
      setServerConflicts(res.data?.conflicts || []);
    } catch (err) {
      console.error('Failed to load conflicts:', err);
    } finally {
      setConflictsLoading(false);
    }
  };

  useEffect(() => {
    if (activeTab === 'conflicts') fetchConflicts();
  }, [activeTab, isOnline]);

  const handleDownloadRoster = async () => {
    if (!selectedClassId) return;
    try {
      setDownloading(true);
      const data = await downloadClassRoster(selectedClassId);
      setSuccessMsg(`Class ${data.class.name}-${data.class.section} (${data.students.length} students) cached in IndexedDB.`);
      setTimeout(() => setSuccessMsg(''), 4000);
      refreshStatus();
    } catch (err) {
      alert(`Download failed: ${err.message}`);
    } finally {
      setDownloading(false);
    }
  };

  const handleResolveConflict = async (conflictId, strategy) => {
    try {
      setResolvingId(conflictId);
      await api.post(`/sync/conflicts/${conflictId}/resolve`, { strategy });
      setSuccessMsg(strategy === 'ACCEPT_OFFLINE' ? 'Accepted offline attendance status.' : 'Retained server database status.');
      setTimeout(() => setSuccessMsg(''), 3000);
      fetchConflicts();
      refreshStatus();
    } catch (err) {
      alert(err.response?.data?.error || 'Failed to resolve conflict.');
    } finally {
      setResolvingId(null);
    }
  };

  const handleClearDatabase = async () => {
    if (!window.confirm('Clear all local offline rosters and sync queue?')) return;
    await clearOfflineDatabase();
    setSuccessMsg('IndexedDB offline storage cleared.');
    setTimeout(() => setSuccessMsg(''), 3000);
    refreshStatus();
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <CloudOff size={22} className="text-amber-500" />
            <span>Offline Attendance Sync Reliability & Recovery</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Persistent queue, automated exponential backoff, conflict arbitration, and crash recovery.
          </p>
        </div>

        <div className="flex items-center space-x-2.5">
          <div className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-xl text-xs font-bold border ${isOnline ? 'bg-emerald-50 text-emerald-800 border-emerald-200' : 'bg-amber-50 text-amber-800 border-amber-300'}`}>
            {isOnline ? <><Cloud size={14} className="text-emerald-600" /><span>Online</span></> : <><CloudOff size={14} className="text-amber-600" /><span>Offline</span></>}
          </div>

          <button
            onClick={() => syncPendingQueue(false)}
            disabled={!isOnline || isSyncing || pendingCount === 0}
            className="flex items-center space-x-1.5 px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-xs disabled:opacity-50 transition"
          >
            <RefreshCw size={14} className={isSyncing ? 'animate-spin' : ''} />
            <span>{isSyncing ? 'Synchronizing...' : `Sync Queue (${pendingCount})`}</span>
          </button>
        </div>
      </div>

      {successMsg && (
        <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center space-x-2">
          <CheckCircle2 size={16} className="text-emerald-600 shrink-0" />
          <span>{successMsg}</span>
        </div>
      )}

      {/* KPI Overview Metrics */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-slate-500 block">Pending Operations</span>
          <span className="text-xl font-bold text-slate-900 mt-0.5 block">{pendingCount}</span>
          <span className="text-[10px] text-slate-400">Waiting for transmission</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-slate-500 block">Failed (Exhausted)</span>
          <div className="flex items-baseline space-x-2 mt-0.5">
            <span className="text-xl font-bold text-rose-600">{failedCount}</span>
            {failedCount > 0 && isOnline && (
              <button onClick={retryFailedQueue} className="text-[10px] font-bold text-sky-600 hover:underline">Retry</button>
            )}
          </div>
          <span className="text-[10px] text-slate-400">Max retries exceeded</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-slate-500 block">Sync Conflicts</span>
          <span className="text-xl font-bold text-amber-600 mt-0.5 block">{conflictCount}</span>
          <span className="text-[10px] text-slate-400">Requires review</span>
        </div>

        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-xs">
          <span className="text-xs font-medium text-slate-500 block">Last Successful Sync</span>
          <span className="text-xs font-bold text-slate-800 mt-1.5 block truncate">
            {lastSyncTimestamp ? new Date(lastSyncTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Never synced'}
          </span>
          <span className="text-[10px] text-slate-400 truncate block">
            {lastSyncTimestamp ? new Date(lastSyncTimestamp).toLocaleDateString() : 'Awaiting sync'}
          </span>
        </div>
      </div>

      {/* Tabs Switcher */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-2">
        <div className="flex items-center space-x-1 bg-slate-100 p-1 rounded-xl">
          <button onClick={() => setActiveTab('queue')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'queue' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
            Queue Operations ({queueItems.length})
          </button>
          <button onClick={() => setActiveTab('conflicts')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'conflicts' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
            Conflict Arbitration Station ({conflictCount})
          </button>
          <button onClick={() => setActiveTab('rosters')} className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition ${activeTab === 'rosters' ? 'bg-white text-slate-900 shadow-xs' : 'text-slate-600 hover:text-slate-900'}`}>
            Offline Cached Rosters ({savedRosters.length})
          </button>
        </div>

        {failedCount > 0 && isOnline && (
          <button onClick={retryFailedQueue} disabled={isSyncing} className="flex items-center space-x-1.5 px-3 py-1.5 text-xs font-bold bg-sky-600 text-white rounded-lg hover:bg-sky-700 disabled:opacity-50 transition">
            <RotateCw size={13} className={isSyncing ? 'animate-spin' : ''} />
            <span>Retry Failed</span>
          </button>
        )}
      </div>

      {/* TAB 1: QUEUE INSPECTOR */}
      {activeTab === 'queue' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs overflow-hidden">
          <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/70">
            <div>
              <h2 className="text-sm font-bold text-slate-900">Persistent Device Queue Operations</h2>
              <p className="text-xs text-slate-500 mt-0.5">IndexedDB stored operations with idempotency tracking</p>
            </div>
            {queueItems.length > 0 && <span className="text-[11px] font-mono text-slate-400">Total: {queueItems.length}</span>}
          </div>

          {queueItems.length === 0 ? (
            <div className="p-12 text-center text-slate-400 text-xs">No offline operations in queue. All attendance records are in sync.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead className="bg-slate-50 text-slate-500 uppercase text-[10px] font-semibold border-b border-slate-200">
                  <tr>
                    <th className="py-2.5 px-4">Operation ID</th>
                    <th className="py-2.5 px-4">Target Student / Token</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4">Time</th>
                    <th className="py-2.5 px-4">Retries</th>
                    <th className="py-2.5 px-4 text-right">State</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium text-slate-700">
                  {queueItems.map((e) => (
                    <tr key={e.eventId} className="hover:bg-slate-50">
                      <td className="py-3 px-4 font-mono text-[10px] text-slate-500 truncate max-w-[140px]">{e.operationId || e.eventId}</td>
                      <td className="py-3 px-4 font-mono font-bold text-sky-800">{e.qrToken || e.studentId || 'Scan'}</td>
                      <td className="py-3 px-4"><span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-800">{e.status}</span></td>
                      <td className="py-3 px-4 text-slate-500 text-[11px]">{new Date(e.timestamp).toLocaleTimeString()}</td>
                      <td className="py-3 px-4 text-slate-500">{e.retryCount || 0} / 5</td>
                      <td className="py-3 px-4 text-right">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${(e.queueStatus || e.status) === 'SYNCED' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : (e.queueStatus || e.status) === 'FAILED' ? 'bg-rose-50 text-rose-700 border border-rose-200' : (e.queueStatus || e.status) === 'CONFLICT' ? 'bg-amber-50 text-amber-700 border border-amber-200' : 'bg-sky-50 text-sky-700 border border-sky-200'}`}>
                          {e.queueStatus || e.status || 'PENDING'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: CONFLICT ARBITRATION */}
      {activeTab === 'conflicts' && (
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100">
            <div>
              <h2 className="text-sm font-bold text-slate-900 flex items-center space-x-2">
                <ShieldAlert size={18} className="text-amber-500" />
                <span>Attendance Conflict Arbitration Station</span>
              </h2>
              <p className="text-xs text-slate-500 mt-0.5">Review differences between server records and offline scanned attendance payloads.</p>
            </div>
            <button onClick={fetchConflicts} disabled={conflictsLoading} className="text-xs font-semibold text-sky-600 hover:text-sky-800 flex items-center space-x-1">
              <RefreshCw size={12} className={conflictsLoading ? 'animate-spin' : ''} />
              <span>Refresh</span>
            </button>
          </div>

          {conflictsLoading ? (
            <div className="py-12 text-center text-slate-400 text-xs">Loading conflict operations...</div>
          ) : serverConflicts.length > 0 ? (
            <div className="space-y-3">
              {serverConflicts.map((c) => {
                const srv = c.conflictData?.serverRecord;
                const off = c.conflictData?.offlineEvent;
                const isResolving = resolvingId === c.id;

                return (
                  <div key={c.id} className="p-4 rounded-xl border border-amber-200 bg-amber-50/20 text-xs space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <span className="font-bold text-slate-900 text-sm">{c.student?.name || 'Student'}</span>
                        <span className="text-[11px] text-slate-500 ml-2">Adm: {c.student?.admissionNumber} &bull; Class: {c.student?.className}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-100 text-amber-800">CONFLICT</span>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 bg-white p-3 rounded-lg border border-slate-200">
                      <div>
                        <span className="font-semibold text-slate-500 text-[11px] block">Current Server Record:</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-slate-100 text-slate-800">{srv?.status || 'Unknown'}</span>
                          <span className="text-[10px] text-slate-400">Via {srv?.method} at {srv?.markedAt ? new Date(srv.markedAt).toLocaleTimeString() : 'N/A'}</span>
                        </div>
                      </div>

                      <div>
                        <span className="font-semibold text-slate-500 text-[11px] block">Offline Staged Event:</span>
                        <div className="flex items-center space-x-2 mt-1">
                          <span className="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-100 text-indigo-800">{off?.status || 'Unknown'}</span>
                          <span className="text-[10px] text-slate-400">Offline at {off?.timestamp ? new Date(off.timestamp).toLocaleTimeString() : 'N/A'}</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center justify-end space-x-2 pt-1">
                      <button onClick={() => handleResolveConflict(c.id, 'KEEP_SERVER')} disabled={isResolving} className="px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 font-semibold hover:bg-slate-100 disabled:opacity-50 transition">
                        Keep Server Status ({srv?.status})
                      </button>
                      <button onClick={() => handleResolveConflict(c.id, 'ACCEPT_OFFLINE')} disabled={isResolving} className="px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50 transition">
                        Accept Offline Status ({off?.status})
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="py-12 text-center text-slate-400 text-xs">No outstanding attendance conflicts. All offline and server records are synchronized.</div>
          )}
        </div>
      )}

      {/* TAB 3: CACHED ROSTERS */}
      {activeTab === 'rosters' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
            <div className="flex items-center space-x-2">
              <HardDrive size={18} className="text-sky-600" />
              <h2 className="text-sm font-bold text-slate-900">Download Class Roster for Offline Scanning</h2>
            </div>
            <p className="text-xs text-slate-500">Pre-load student QR credentials into IndexedDB before entering disconnected areas.</p>

            <div className="flex gap-2">
              <select
                value={selectedClassId}
                onChange={(e) => setSelectedClassId(e.target.value)}
                disabled={!isOnline || classes.length === 0}
                className="flex-1 px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500 disabled:opacity-50"
              >
                {classes.map((cls) => (
                  <option key={cls.id} value={cls.id}>{cls.name}-{cls.section} ({cls._count?.students || 0} students)</option>
                ))}
              </select>

              <button onClick={handleDownloadRoster} disabled={!isOnline || downloading} className="flex items-center space-x-1.5 px-4 py-2 bg-sky-600 hover:bg-sky-700 text-white text-xs font-semibold rounded-xl shadow-xs disabled:opacity-50 transition">
                <Download size={14} />
                <span>{downloading ? 'Downloading...' : 'Save Offline'}</span>
              </button>
            </div>
          </div>

          <div className="p-6 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4 flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-bold text-slate-900">Cached Rosters in Local Storage</h2>
                <span className="text-[10px] font-mono text-slate-400">{savedRosters.length} rosters stored</span>
              </div>

              {savedRosters.length === 0 ? (
                <p className="text-xs text-slate-400 py-6 text-center">No class rosters downloaded yet.</p>
              ) : (
                <div className="space-y-2">
                  {savedRosters.map((r) => (
                    <div key={r.classId} className="p-3 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                      <div>
                        <strong className="text-slate-900 block">{r.className}</strong>
                        <span className="text-[10px] text-slate-500">{r.students?.length || 0} students &bull; Cached {new Date(r.downloadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                      </div>
                      <span className="px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 text-[10px] font-bold">Available Offline</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100 flex justify-end">
              <button onClick={handleClearDatabase} className="flex items-center space-x-1 text-[11px] text-red-600 hover:text-red-700 font-semibold">
                <Trash2 size={13} />
                <span>Reset Offline Database</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
