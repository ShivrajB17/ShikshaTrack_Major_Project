import { describe, it, expect, beforeEach, vi } from 'vitest';
import { checkAttendanceDuplicate } from '../../pages/QrAttendanceScanner.jsx';

describe('QR Attendance Scanner - Duplicate Prevention & Concurrency Regression Suite', () => {
  const mockSession = {
    id: 'sess-today-101',
    classId: 'class-10a',
    sessionDate: '2026-11-17T09:00:00.000Z',
    attendanceRecords: [
      {
        id: 'rec-1',
        sessionId: 'sess-today-101',
        studentId: 'std_already_marked',
        status: 'PRESENT',
        student: {
          id: 'std_already_marked',
          name: 'Priya Verma',
          qrToken: 'QR-PRIYA-001',
        },
      },
    ],
  };

  const mockQueueEvents = [
    {
      eventId: 'offline-ev-1',
      operationId: 'offline-ev-1',
      classId: 'class-10a',
      sessionId: 'sess-today-101',
      studentId: 'std_queued_offline',
      qrToken: 'QR-QUEUED-002',
      status: 'PRESENT',
      attendanceStatus: 'PRESENT',
      queueStatus: 'PENDING',
      synced: false,
    },
    {
      eventId: 'offline-ev-failed',
      operationId: 'offline-ev-failed',
      classId: 'class-10a',
      sessionId: 'sess-today-101',
      studentId: 'std_failed_retryable',
      qrToken: 'QR-FAILED-003',
      status: 'FAILED',
      queueStatus: 'FAILED',
      synced: false,
    },
  ];

  describe('1. checkAttendanceDuplicate Core Logic', () => {
    it('allows a new student who has not scanned yet', () => {
      const result = checkAttendanceDuplicate({
        studentId: 'std_kritika',
        qrToken: 'QR-KRITIKA-96',
        classId: 'class-10a',
        session: mockSession,
        queueEvents: mockQueueEvents,
        processedSet: new Set(),
      });

      expect(result.isDuplicate).toBe(false);
    });

    it('detects duplicate when student ID is in in-memory processedSet', () => {
      const processedSet = new Set(['std_kritika']);
      const result = checkAttendanceDuplicate({
        studentId: 'std_kritika',
        qrToken: 'QR-KRITIKA-96',
        classId: 'class-10a',
        session: mockSession,
        queueEvents: [],
        processedSet,
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe('ALREADY_PROCESSED_IN_MEMORY');
    });

    it('detects duplicate when QR token is in in-memory processedSet', () => {
      const processedSet = new Set(['QR-KRITIKA-96']);
      const result = checkAttendanceDuplicate({
        studentId: 'std_kritika',
        qrToken: 'QR-KRITIKA-96',
        classId: 'class-10a',
        session: mockSession,
        queueEvents: [],
        processedSet,
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe('ALREADY_PROCESSED_IN_MEMORY');
    });

    it('detects duplicate when student is already in session attendanceRecords', () => {
      const result = checkAttendanceDuplicate({
        studentId: 'std_already_marked',
        qrToken: 'QR-PRIYA-001',
        classId: 'class-10a',
        session: mockSession,
        queueEvents: [],
        processedSet: new Set(),
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe('ALREADY_RECORDED_IN_SESSION');
      expect(result.existingRecord.student.name).toBe('Priya Verma');
    });

    it('detects duplicate when student is already in offline syncQueue', () => {
      const result = checkAttendanceDuplicate({
        studentId: 'std_queued_offline',
        qrToken: 'QR-QUEUED-002',
        classId: 'class-10a',
        session: mockSession,
        queueEvents: mockQueueEvents,
        processedSet: new Set(),
      });

      expect(result.isDuplicate).toBe(true);
      expect(result.reason).toBe('ALREADY_QUEUED_OFFLINE');
      expect(result.existingRecord.eventId).toBe('offline-ev-1');
    });

    it('ignores failed queue records, allowing failed students to retry', () => {
      const result = checkAttendanceDuplicate({
        studentId: 'std_failed_retryable',
        qrToken: 'QR-FAILED-003',
        classId: 'class-10a',
        session: mockSession,
        queueEvents: mockQueueEvents,
        processedSet: new Set(),
      });

      expect(result.isDuplicate).toBe(false);
    });

    it('allows students from a different class to scan independently', () => {
      const result = checkAttendanceDuplicate({
        studentId: 'std_queued_offline',
        qrToken: 'QR-QUEUED-002',
        classId: 'class-10b', // Different class
        session: { id: 'sess-diff-class', classId: 'class-10b', attendanceRecords: [] },
        queueEvents: mockQueueEvents, // items belong to class-10a
        processedSet: new Set(),
      });

      expect(result.isDuplicate).toBe(false);
    });
  });

  describe('2. Repeated Camera Callbacks & Concurrency Simulation', () => {
    it('simulates 10 fps camera callbacks: exactly 1 scan processed, 49 dropped/prevented', async () => {
      const processedStudents = new Set();
      const recentScanCooldown = new Map();
      let isProcessing = false;
      const queuedRecords = [];

      // Mock offline roster
      const offlineRoster = {
        sessionId: 'sess-today-101',
        className: 'Class 10-A',
        students: [
          {
            id: 'std_kritika',
            name: 'Kritika Pandey',
            admissionNumber: 'ADM-2026-069',
            rollNumber: '96',
            qrToken: 'QR-KRITIKA-069',
          },
        ],
      };

      const recordOfflineAttendance = vi.fn(async (event) => {
        // Simulate async IndexedDB write latency
        await new Promise((r) => setTimeout(r, 20));
        queuedRecords.push(event);
        return { eventId: `ev-${queuedRecords.length}`, ...event };
      });

      // Simulated scanner processor matching QrAttendanceScanner logic
      const simulateProcessQrToken = async (qrToken, scanStatus = 'PRESENT') => {
        if (!qrToken || !qrToken.trim()) return;
        const token = qrToken.trim();

        if (isProcessing) return; // In-flight lock
        const now = Date.now();
        const lastScan = recentScanCooldown.get(token) || 0;
        if (now - lastScan < 2500) return; // Cooldown
        if (processedStudents.has(token)) return; // In-memory session duplicate

        isProcessing = true;
        recentScanCooldown.set(token, now);

        try {
          const student = offlineRoster.students.find((s) => s.qrToken === token);
          if (!student) throw new Error('Student not found');

          const dupCheck = checkAttendanceDuplicate({
            studentId: student.id,
            qrToken: token,
            classId: 'class-10a',
            session: { id: 'sess-today-101', attendanceRecords: [] },
            queueEvents: queuedRecords,
            processedSet: processedStudents,
          });

          if (dupCheck.isDuplicate) {
            processedStudents.add(student.id);
            processedStudents.add(token);
            return;
          }

          await recordOfflineAttendance({
            sessionId: 'sess-today-101',
            classId: 'class-10a',
            studentId: student.id,
            qrToken: token,
            status: scanStatus,
          });

          processedStudents.add(student.id);
          processedStudents.add(token);
        } finally {
          isProcessing = false;
        }
      };

      // Simulate 50 camera callbacks in rapid succession (e.g. 5 seconds at 10 fps)
      const callbackPromises = [];
      for (let i = 0; i < 50; i++) {
        callbackPromises.push(simulateProcessQrToken('QR-KRITIKA-069'));
      }
      await Promise.all(callbackPromises);

      // VERIFY: Exactly 1 record enqueued, NEVER 50 or 142!
      expect(recordOfflineAttendance).toHaveBeenCalledTimes(1);
      expect(queuedRecords).toHaveLength(1);
      expect(queuedRecords[0].studentId).toBe('std_kritika');
      expect(queuedRecords[0].status).toBe('PRESENT');
      expect(processedStudents.has('std_kritika')).toBe(true);
      expect(processedStudents.has('QR-KRITIKA-069')).toBe(true);
    });

    it('allows sequential scanning of different students without blocking', async () => {
      const processedStudents = new Set();
      const recentScanCooldown = new Map();
      let isProcessing = false;
      const queuedRecords = [];

      const offlineRoster = {
        sessionId: 'sess-today-101',
        students: [
          { id: 'std_kritika', name: 'Kritika Pandey', qrToken: 'QR-KRITIKA-069' },
          { id: 'std_aarav', name: 'Aarav Sharma', qrToken: 'QR-AARAV-042' },
          { id: 'std_rohit', name: 'Rohit Gupta', qrToken: 'QR-ROHIT-015' },
        ],
      };

      const recordOfflineAttendance = vi.fn(async (event) => {
        queuedRecords.push(event);
      });

      const simulateProcessQrToken = async (qrToken, scanStatus = 'PRESENT') => {
        const token = qrToken.trim();
        if (isProcessing) return;
        const now = Date.now();
        const lastScan = recentScanCooldown.get(token) || 0;
        if (now - lastScan < 2500) return;
        if (processedStudents.has(token)) return;

        isProcessing = true;
        recentScanCooldown.set(token, now);

        try {
          const student = offlineRoster.students.find((s) => s.qrToken === token);
          if (!student) throw new Error('Student not found');

          const dupCheck = checkAttendanceDuplicate({
            studentId: student.id,
            qrToken: token,
            classId: 'class-10a',
            session: { id: 'sess-today-101', attendanceRecords: [] },
            queueEvents: queuedRecords,
            processedSet: processedStudents,
          });

          if (dupCheck.isDuplicate) return;

          await recordOfflineAttendance({
            sessionId: 'sess-today-101',
            classId: 'class-10a',
            studentId: student.id,
            qrToken: token,
            status: scanStatus,
          });

          processedStudents.add(student.id);
          processedStudents.add(token);
        } finally {
          isProcessing = false;
        }
      };

      // 1. Scan Student 1 (Kritika)
      await simulateProcessQrToken('QR-KRITIKA-069', 'PRESENT');
      expect(queuedRecords).toHaveLength(1);
      expect(queuedRecords[0].studentId).toBe('std_kritika');
      expect(queuedRecords[0].status).toBe('PRESENT');

      // 2. Scan Student 1 again (should be ignored as duplicate)
      await simulateProcessQrToken('QR-KRITIKA-069', 'PRESENT');
      expect(queuedRecords).toHaveLength(1); // Still 1

      // 3. Scan Student 2 (Aarav) with LATE status
      await simulateProcessQrToken('QR-AARAV-042', 'LATE');
      expect(queuedRecords).toHaveLength(2);
      expect(queuedRecords[1].studentId).toBe('std_aarav');
      expect(queuedRecords[1].status).toBe('LATE');

      // 4. Scan Student 3 (Rohit)
      await simulateProcessQrToken('QR-ROHIT-015', 'PRESENT');
      expect(queuedRecords).toHaveLength(3);
      expect(queuedRecords[2].studentId).toBe('std_rohit');
    });

    it('does not permanently block a student if the scan fails, allowing retry', async () => {
      const processedStudents = new Set();
      const recentScanCooldown = new Map();
      let isProcessing = false;
      const queuedRecords = [];
      let networkAvailable = false;

      const recordOfflineAttendance = vi.fn(async (event) => {
        if (!networkAvailable) {
          throw new Error('Database transaction timeout or hardware lock failure');
        }
        queuedRecords.push(event);
      });

      const simulateProcessQrToken = async (qrToken) => {
        const token = qrToken.trim();
        if (isProcessing) return;
        const now = Date.now();
        const lastScan = recentScanCooldown.get(token) || 0;
        if (now - lastScan < 2500) return;
        if (processedStudents.has(token)) return;

        isProcessing = true;
        recentScanCooldown.set(token, now);

        try {
          await recordOfflineAttendance({
            sessionId: 'sess-today-101',
            classId: 'class-10a',
            studentId: 'std_kritika',
            qrToken: token,
            status: 'PRESENT',
          });

          processedStudents.add('std_kritika');
          processedStudents.add(token);
        } catch (err) {
          // On error, student is NOT added to processedStudents
          // reset cooldown so user can immediately retry
          recentScanCooldown.delete(token);
        } finally {
          isProcessing = false;
        }
      };

      // Attempt 1: Fails
      await simulateProcessQrToken('QR-KRITIKA-069');
      expect(queuedRecords).toHaveLength(0);
      expect(processedStudents.has('std_kritika')).toBe(false); // Not blocked!
      expect(isProcessing).toBe(false); // Lock released!

      // Attempt 2: Condition recovered
      networkAvailable = true;
      await simulateProcessQrToken('QR-KRITIKA-069');
      expect(queuedRecords).toHaveLength(1);
      expect(processedStudents.has('std_kritika')).toBe(true); // Now marked!
      expect(isProcessing).toBe(false);
    });
  });
});
