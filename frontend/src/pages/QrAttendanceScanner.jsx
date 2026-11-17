import React, { useState, useEffect, useRef } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Html5Qrcode } from 'html5-qrcode';
import api from '../services/api';
import { useOffline } from '../context/OfflineContext';
import { getAllQueueEvents } from '../services/db';
import {
  ScanLine,
  Camera,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Users,
  Clock,
  Sparkles,
  RefreshCw,
  Power,
  ChevronRight,
  Keyboard,
  Upload,
  Image as ImageIcon,
} from 'lucide-react';

/**
 * Pure duplicate checker for session attendance and pending offline queue.
 * Exported for comprehensive regression testing.
 */
export const checkAttendanceDuplicate = ({
  studentId,
  qrToken,
  classId,
  session,
  queueEvents = [],
  processedSet = null,
}) => {
  // 1. Check in-memory fast session set
  if (processedSet) {
    if (studentId && processedSet.has(studentId)) {
      return { isDuplicate: true, reason: 'ALREADY_PROCESSED_IN_MEMORY' };
    }
    if (qrToken && processedSet.has(qrToken)) {
      return { isDuplicate: true, reason: 'ALREADY_PROCESSED_IN_MEMORY' };
    }
  }

  // 2. Check current session's attendance records (online or cached session)
  const sessionRecords = session?.attendanceRecords || [];
  const foundInSession = sessionRecords.find(
    (r) =>
      (studentId && r.studentId === studentId) ||
      (qrToken && r.student?.qrToken === qrToken) ||
      (qrToken && r.qrToken === qrToken)
  );
  if (foundInSession) {
    return {
      isDuplicate: true,
      reason: 'ALREADY_RECORDED_IN_SESSION',
      existingRecord: foundInSession,
    };
  }

  // 3. Check pending IndexedDB sync queue (offline records queued for this class/session)
  if (Array.isArray(queueEvents)) {
    const foundInQueue = queueEvents.find((item) => {
      // Must not be a failed record requiring recovery
      if (item.queueStatus === 'FAILED' || item.status === 'FAILED') return false;

      // Check student match
      const studentMatch =
        (studentId && item.studentId === studentId) ||
        (qrToken && item.qrToken === qrToken);
      if (!studentMatch) return false;

      // Check session or class match
      if (session?.id && item.sessionId && item.sessionId === session.id) {
        return true;
      }
      if (classId && item.classId && item.classId === classId) {
        return true;
      }
      return false;
    });

    if (foundInQueue) {
      return {
        isDuplicate: true,
        reason: 'ALREADY_QUEUED_OFFLINE',
        existingRecord: foundInQueue,
      };
    }
  }

  return { isDuplicate: false };
};

export default function QrAttendanceScanner() {
  const [searchParams] = useSearchParams();
  const initialClassId = searchParams.get('classId') || '';
  const navigate = useNavigate();

  const [classes, setClasses] = useState([]);
  const [selectedClassId, setSelectedClassId] = useState(initialClassId);
  const [session, setSession] = useState(null);
  const [rosterStats, setRosterStats] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanStatus, setScanStatus] = useState('PRESENT'); // PRESENT or LATE
  const [feedback, setFeedback] = useState(null); // { type: 'success' | 'error' | 'warning', message, student }
  const [manualTokenInput, setManualTokenInput] = useState('');
  const [loading, setLoading] = useState(true);

  const { isOnline, recordOfflineAttendance, getOfflineRoster, queueItems } = useOffline();
  const html5QrCodeRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isProcessingFile, setIsProcessingFile] = useState(false);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const scannerContainerId = 'qr-reader-viewport';

  // In-flight locking and session duplicate tracking refs
  const isProcessingRef = useRef(false);
  const processedStudentsRef = useRef(new Set());
  const recentScanCooldownRef = useRef(new Map());

  // 1. Fetch Teacher's Assigned Classes
  useEffect(() => {
    const fetchAssignedClasses = async () => {
      try {
        setLoading(true);
        const res = await api.get('/classes');
        setClasses(res.data);
        if (!selectedClassId && res.data.length > 0) {
          setSelectedClassId(res.data[0].id);
        }
      } catch (err) {
        console.error('Failed to load classes:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAssignedClasses();
  }, []);

  // 2. Start or Fetch Session when Class is Selected
  const loadSession = async () => {
    if (!selectedClassId) return;

    try {
      const res = await api.post('/attendance/sessions/start', {
        classId: selectedClassId,
      });
      const sessionData = res.data;

      // Fetch session details and roster
      const detailsRes = await api.get(`/attendance/sessions/${sessionData.id}`);
      setRosterStats(detailsRes.data.stats);

      const fullSession = {
        ...sessionData,
        attendanceRecords: detailsRes.data.attendanceRecords || sessionData.attendanceRecords || [],
      };
      setSession(fullSession);

      // Hydrate processed set from active session records
      if (Array.isArray(fullSession.attendanceRecords)) {
        fullSession.attendanceRecords.forEach((r) => {
          if (r.studentId) processedStudentsRef.current.add(r.studentId);
          if (r.student?.qrToken) processedStudentsRef.current.add(r.student.qrToken);
          if (r.qrToken) processedStudentsRef.current.add(r.qrToken);
        });
      }
    } catch (err) {
      console.warn('Could not load live session, checking offline roster:', err.message);
      // Fallback to offline roster if offline
      const offlineRoster = await getOfflineRoster(selectedClassId);
      if (offlineRoster) {
        setSession({
          id: offlineRoster.sessionId || 'offline-session',
          classId: selectedClassId,
          className: offlineRoster.className,
          status: 'OPEN (OFFLINE)',
          attendanceRecords: [],
        });
        setRosterStats({
          totalStudents: offlineRoster.students.length,
          presentCount: 0,
          unmarkedCount: offlineRoster.students.length,
        });
      }
    }

    // Hydrate processed set from pending offline queue records for this class
    try {
      const queue = await getAllQueueEvents();
      queue.forEach((item) => {
        if (
          item.classId === selectedClassId &&
          item.queueStatus !== 'FAILED' &&
          item.status !== 'FAILED'
        ) {
          if (item.studentId) processedStudentsRef.current.add(item.studentId);
          if (item.qrToken) processedStudentsRef.current.add(item.qrToken);
        }
      });
    } catch (qErr) {
      console.warn('Could not read offline queue for duplicate seeding:', qErr);
    }
  };

  useEffect(() => {
    // Reset session processed set when class changes
    processedStudentsRef.current.clear();
    recentScanCooldownRef.current.clear();
    loadSession();
  }, [selectedClassId]);

  // Audio Beep Feedback
  const playBeep = (type = 'success') => {
    try {
      const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();

      osc.type = type === 'success' ? 'sine' : type === 'warning' ? 'triangle' : 'sawtooth';
      osc.frequency.setValueAtTime(
        type === 'success' ? 880 : type === 'warning' ? 520 : 300,
        audioCtx.currentTime
      );
      gain.gain.setValueAtTime(0.1, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.2);

      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.2);
    } catch (e) {
      // AudioContext may be restricted by browser policy before first interaction
    }
  };

  // 3. Process Scanned QR Token (Shared between Camera and Manual Token entry)
  const processQrToken = async (qrToken) => {
    if (!qrToken || !qrToken.trim()) return;
    const token = qrToken.trim();

    // 1. In-flight lock: drop frame if another scan is actively being processed
    if (isProcessingRef.current) {
      return;
    }

    // 2. Cooldown check: ignore repeated frame callbacks for the same token within 2.5s
    const now = Date.now();
    const lastScan = recentScanCooldownRef.current.get(token) || 0;
    if (now - lastScan < 2500) {
      return;
    }

    // 3. In-memory session check: if token is already marked in this session
    if (processedStudentsRef.current.has(token)) {
      recentScanCooldownRef.current.set(token, now);
      playBeep('warning');
      setFeedback({
        type: 'warning',
        message: 'This student is already marked for this session!',
      });
      return;
    }

    // Acquire in-flight lock
    isProcessingRef.current = true;
    recentScanCooldownRef.current.set(token, now);

    try {
      // Query latest offline queue state to prevent cross-call races
      let latestQueue = [];
      try {
        latestQueue = await getAllQueueEvents();
      } catch (e) {
        latestQueue = queueItems || [];
      }

      if (isOnline && session?.id && !session.id.startsWith('offline')) {
        // ONLINE FLOW:
        const dupCheck = checkAttendanceDuplicate({
          qrToken: token,
          classId: selectedClassId,
          session,
          queueEvents: latestQueue,
          processedSet: processedStudentsRef.current,
        });

        if (dupCheck.isDuplicate) {
          processedStudentsRef.current.add(token);
          playBeep('warning');
          setFeedback({
            type: 'warning',
            message: 'This student is already marked for this session!',
          });
          return;
        }

        // Send to online backend
        const res = await api.post('/attendance/scan', {
          sessionId: session.id,
          qrToken: token,
          status: scanStatus,
        });

        // Immediately prevent repeat scans of this student and token
        if (res.data?.student?.id) {
          processedStudentsRef.current.add(res.data.student.id);
        }
        processedStudentsRef.current.add(token);

        playBeep('success');
        setFeedback({
          type: 'success',
          message: `Marked ${res.data.student.name} as ${res.data.record.status}!`,
          student: res.data.student,
        });

        // Refresh stats
        await loadSession();
      } else {
        // OFFLINE FLOW: Resolve from local IndexedDB
        const offlineRoster = await getOfflineRoster(selectedClassId);
        if (!offlineRoster) {
          throw new Error('No offline roster found for this class. Please download it while online.');
        }

        const student = offlineRoster.students.find((s) => s.qrToken === token);
        if (!student) {
          throw new Error('QR Token not found in local offline roster for this class.');
        }

        // Check duplicate against student ID, token, session, and queue
        const dupCheck = checkAttendanceDuplicate({
          studentId: student.id,
          qrToken: token,
          classId: selectedClassId,
          session,
          queueEvents: latestQueue,
          processedSet: processedStudentsRef.current,
        });

        if (dupCheck.isDuplicate) {
          processedStudentsRef.current.add(student.id);
          processedStudentsRef.current.add(token);
          playBeep('warning');
          setFeedback({
            type: 'warning',
            message: `[ALREADY MARKED] ${student.name} is already recorded for this session!`,
            student,
          });
          return;
        }

        // Record offline attendance with guaranteed preservation of status
        await recordOfflineAttendance({
          sessionId: session?.id,
          classId: selectedClassId,
          studentId: student.id,
          qrToken: token,
          status: scanStatus,
        });

        // Immediately protect student and token from duplicate scanning
        processedStudentsRef.current.add(student.id);
        processedStudentsRef.current.add(token);

        // Optimistically update session stats
        setRosterStats((prev) => {
          if (!prev) return prev;
          const newPresent = (prev.presentCount || 0) + 1;
          const newUnmarked = Math.max(0, (prev.unmarkedCount || 0) - 1);
          const total = prev.totalStudents || (newPresent + newUnmarked);
          const rate = total > 0 ? Math.round((newPresent / total) * 100) : 0;
          return {
            ...prev,
            presentCount: newPresent,
            unmarkedCount: newUnmarked,
            attendanceRate: rate,
          };
        });

        playBeep('success');
        setFeedback({
          type: 'success',
          message: `[OFFLINE] Queued ${student.name} as ${scanStatus}!`,
          student,
        });
      }
    } catch (err) {
      playBeep('error');
      setFeedback({
        type: 'error',
        message: err.message || 'Scan rejected.',
      });
      // NOTICE: Do not add to processedStudentsRef on error, allowing immediate retry
    } finally {
      // Release in-flight lock
      isProcessingRef.current = false;
    }
  };

  // 4. Start Camera Scanner
  const startCamera = async () => {
    try {
      setFeedback(null);
      const html5QrCode = new Html5Qrcode(scannerContainerId);
      html5QrCodeRef.current = html5QrCode;

      const config = {
        fps: 10,
        qrbox: { width: 250, height: 250 },
        aspectRatio: 1.0,
      };

      await html5QrCode.start(
        { facingMode: 'environment' },
        config,
        (decodedText) => {
          // Synchronous fast guard to immediately drop camera frames while a scan is in-flight
          if (isProcessingRef.current) return;
          processQrToken(decodedText);
        },
        () => {
          // Frame scan pass-through, no qr detected in this frame
        }
      );

      setIsScanning(true);
    } catch (err) {
      alert(`Could not start camera: ${err.message}. You can also enter the QR token manually below.`);
    }
  };

  // 5. Stop Camera Scanner
  const stopCamera = async () => {
    if (html5QrCodeRef.current) {
      try {
        await html5QrCodeRef.current.stop();
        html5QrCodeRef.current.clear();
      } catch (err) {
        console.warn('Error stopping camera:', err);
      }
      setIsScanning(false);
    }
  };

  // 6. Image File QR Scan Handler
  const handleImageFile = async (file) => {
    if (!file) return;
    if (isScanning) {
      await stopCamera();
    }
    setIsProcessingFile(true);
    setFeedback(null);

    try {
      let scanner = html5QrCodeRef.current;
      let createdNew = false;
      if (!scanner) {
        scanner = new Html5Qrcode('qr-reader-file-drop');
        html5QrCodeRef.current = scanner;
        createdNew = true;
      }
      const decodedText = await scanner.scanFile(file, false);
      await processQrToken(decodedText);
    } catch (err) {
      console.error('QR file scan error:', err);
      playBeep('error');
      setFeedback({
        type: 'error',
        message: 'No valid student QR code detected in the uploaded image. Please ensure the code is clear and well-lit.',
      });
    } finally {
      setIsProcessingFile(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDraggingFile(false);
    if (e.dataTransfer?.files && e.dataTransfer.files[0]) {
      handleImageFile(e.dataTransfer.files[0]);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDraggingFile(true);
  };

  const handleDragLeave = () => {
    setIsDraggingFile(false);
  };

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (html5QrCodeRef.current) {
        try {
          html5QrCodeRef.current.stop().catch(() => {});
        } catch (e) {}
      }
    };
  }, []);

  const handleManualSubmit = (e) => {
    e.preventDefault();
    if (manualTokenInput.trim()) {
      processQrToken(manualTokenInput.trim());
      setManualTokenInput('');
    }
  };

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header and Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 rounded-2xl bg-white border border-slate-200/80 shadow-xs">
        <div>
          <h1 className="text-xl font-bold text-slate-900 tracking-tight flex items-center space-x-2">
            <ScanLine size={22} className="text-sky-600" />
            <span>Smart QR Attendance Scanner</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1">
            Real-time camera scanning with duplicate prevention and offline queue fallback
          </p>
        </div>

        {/* Class Selector & Scan Status Mode */}
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={selectedClassId}
            onChange={(e) => {
              if (isScanning) stopCamera();
              setSelectedClassId(e.target.value);
            }}
            className="px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}-{cls.section}
              </option>
            ))}
          </select>

          {/* Status Toggle: PRESENT or LATE */}
          <div className="flex rounded-xl bg-slate-100 p-1 border border-slate-200 text-xs font-bold">
            <button
              type="button"
              onClick={() => setScanStatus('PRESENT')}
              className={`px-3 py-1 rounded-lg transition ${
                scanStatus === 'PRESENT'
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              PRESENT
            </button>
            <button
              type="button"
              onClick={() => setScanStatus('LATE')}
              className={`px-3 py-1 rounded-lg transition ${
                scanStatus === 'LATE'
                  ? 'bg-amber-500 text-slate-950 shadow-xs'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              LATE
            </button>
          </div>
        </div>
      </div>

      {/* Main Scanner Section Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Viewfinder Camera View (2 Columns) */}
        <div className="lg:col-span-2 p-6 rounded-2xl bg-slate-900 text-white shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center space-x-2">
                <div
                  className={`w-3 h-3 rounded-full ${
                    isScanning ? 'bg-emerald-500 animate-ping' : 'bg-slate-600'
                  }`}
                />
                <span className="text-xs font-bold text-slate-300">
                  {isScanning ? 'Live Viewfinder Active' : 'Camera Standby'}
                </span>
              </div>
              <span className="text-xs font-mono text-sky-400">
                Marking Mode: {scanStatus}
              </span>
            </div>

            {/* Video Viewport Container / Drop Zone */}
            <div
              onDrop={handleDrop}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              className={`relative overflow-hidden rounded-2xl bg-black border-2 transition-all min-h-[300px] flex items-center justify-center ${
                isDraggingFile
                  ? 'border-sky-400 bg-sky-950/30'
                  : 'border-slate-800'
              }`}
            >
              {/* Hidden file reader DOM target */}
              <div id="qr-reader-file-drop" className="hidden" />
              <input
                type="file"
                ref={fileInputRef}
                accept="image/*"
                onChange={(e) => handleImageFile(e.target.files?.[0])}
                className="hidden"
              />

              <div id={scannerContainerId} className="w-full" />
              {!isScanning && (
                <div className="text-center p-6 space-y-3">
                  <div className="w-16 h-16 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center mx-auto shadow-inner">
                    {isProcessingFile ? (
                      <RefreshCw size={32} className="animate-spin text-sky-400" />
                    ) : isDraggingFile ? (
                      <Upload size={32} className="animate-bounce text-sky-400" />
                    ) : (
                      <Camera size={32} />
                    )}
                  </div>
                  <div>
                    <h3 className="font-bold text-sm text-slate-200">
                      {isProcessingFile
                        ? 'Decoding QR from image...'
                        : isDraggingFile
                        ? 'Drop QR image here to scan'
                        : 'Camera is in standby'}
                    </h3>
                    <p className="text-xs text-slate-400 mt-1 max-w-xs mx-auto">
                      Start your camera to scan live student badges, or upload/drop a badge image directly.
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Scan Feedback Banner */}
            {feedback && (
              <div
                className={`mt-4 p-4 rounded-xl text-xs font-bold flex items-center space-x-3 transition-all ${
                  feedback.type === 'success'
                    ? 'bg-emerald-950/80 border border-emerald-500 text-emerald-300'
                    : 'bg-rose-950/80 border border-rose-500 text-rose-300'
                }`}
              >
                {feedback.type === 'success' ? (
                  <CheckCircle2 size={20} className="text-emerald-400 shrink-0" />
                ) : (
                  <XCircle size={20} className="text-rose-400 shrink-0" />
                )}
                <div>
                  <span className="block text-sm font-extrabold">{feedback.message}</span>
                  {feedback.student && (
                    <span className="text-[11px] text-slate-300 font-normal">
                      Admission: {feedback.student.admissionNumber} &bull; Roll: {feedback.student.rollNumber || 'N/A'}
                    </span>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Scanner Start/Stop and File Upload Buttons */}
          <div className="mt-5 pt-4 border-t border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center space-x-2">
              {isScanning ? (
                <button
                  type="button"
                  onClick={stopCamera}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold text-xs shadow-md transition"
                >
                  <Power size={15} />
                  <span>Turn Off Camera</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={startCamera}
                  className="flex items-center space-x-2 px-5 py-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs shadow-lg transition"
                >
                  <Camera size={15} />
                  <span>Start Camera Scanner</span>
                </button>
              )}

              <button
                type="button"
                disabled={isProcessingFile}
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center space-x-2 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white font-bold text-xs border border-slate-700 shadow-sm transition disabled:opacity-50"
              >
                <Upload size={15} className={isProcessingFile ? 'animate-bounce' : ''} />
                <span>{isProcessingFile ? 'Decoding Image...' : 'Upload QR Image'}</span>
              </button>
            </div>

            <span className="text-[11px] text-slate-400">
              Camera live scan or upload clear QR badge file
            </span>
          </div>
        </div>

        {/* Right: Live Session Counter & Manual Token Fallback */}
        <div className="space-y-6">
          {/* Live Attendance Counter */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-4">
            <h2 className="text-base font-bold text-slate-900">Session Progress</h2>
            {rosterStats ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3 text-center">
                  <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-100">
                    <span className="text-[10px] uppercase font-bold text-emerald-700">Present</span>
                    <span className="text-2xl font-black text-emerald-700 block mt-0.5">
                      {rosterStats.presentCount}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl bg-amber-50 border border-amber-100">
                    <span className="text-[10px] uppercase font-bold text-amber-700">Unmarked</span>
                    <span className="text-2xl font-black text-amber-700 block mt-0.5">
                      {rosterStats.unmarkedCount}
                    </span>
                  </div>
                </div>

                <div className="pt-2">
                  <div className="flex justify-between text-xs font-bold text-slate-700 mb-1">
                    <span>Attendance Rate</span>
                    <span className="text-sky-600">{rosterStats.attendanceRate || 0}%</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-2.5 overflow-hidden">
                    <div
                      className="bg-emerald-500 h-2.5 rounded-full transition-all duration-300"
                      style={{ width: `${rosterStats.attendanceRate || 0}%` }}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Loading session counts...</p>
            )}

            <button
              onClick={() => navigate(`/attendance/manual?classId=${selectedClassId}`)}
              className="w-full flex items-center justify-center space-x-1 py-2 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 font-semibold text-xs transition"
            >
              <span>Review Full Roster in Manual Sheet</span>
              <ChevronRight size={14} />
            </button>
          </div>

          {/* Manual Token Entry Fallback */}
          <div className="p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs space-y-3">
            <h3 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center space-x-1.5">
              <Keyboard size={15} className="text-slate-500" />
              <span>Manual QR Token Input</span>
            </h3>
            <p className="text-xs text-slate-500">
              For testing or camera hardware failure, type or paste student QR token below:
            </p>

            <form onSubmit={handleManualSubmit} className="space-y-2">
              <input
                type="text"
                value={manualTokenInput}
                onChange={(e) => setManualTokenInput(e.target.value)}
                placeholder="ST-XXXX-XXXX-XXXX"
                className="w-full px-3.5 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono text-slate-900 focus:bg-white focus:outline-none focus:ring-2 focus:ring-sky-500 uppercase"
              />
              <button
                type="submit"
                disabled={!manualTokenInput.trim()}
                className="w-full py-2 px-3 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-semibold text-xs shadow-xs disabled:opacity-40 transition"
              >
                Mark Attendance
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

