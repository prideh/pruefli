import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DELETE as deleteExam } from '@/app/api/exams/[id]/route';
import { DELETE as deleteClass } from '@/app/api/classes/[id]/route';
import { DELETE as deleteStudent } from '@/app/api/students/[id]/route';
import { DELETE as deleteSubmission } from '@/app/api/submissions/[id]/route';
import * as sessionModule from '@/lib/session';
import { db } from '@/lib/db';
import { deleteSubmissionScanFiles, StorageCleanupError } from '@/lib/storage-cleanup';
import fs from 'fs';
import path from 'path';

const mockStorageDelete = vi.fn();

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/storage', () => ({
  getStorageAdapter: () => ({
    delete: mockStorageDelete,
    write: vi.fn(),
    read: vi.fn(),
    exists: vi.fn(),
    getUrl: vi.fn(),
  }),
}));

vi.mock('@/lib/cache', () => ({
  serverCache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    invalidateTags: vi.fn(),
  },
  CacheTags: {
    exam: vi.fn(),
    class: vi.fn(),
    student: vi.fn(),
    submission: vi.fn(),
    teacher: vi.fn(),
    exams: vi.fn(),
    classes: vi.fn(),
    students: vi.fn(),
    submissions: vi.fn(),
    logs: vi.fn(),
  },
  invalidateExamCache: vi.fn(),
  invalidateClassCache: vi.fn(),
  invalidateStudentCache: vi.fn(),
  invalidateSubmissionCache: vi.fn(),
  invalidateLogsCache: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    exam: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    class: {
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
    student: {
      findUnique: vi.fn(),
      delete: vi.fn(),
    },
    submission: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      delete: vi.fn(),
      update: vi.fn(),
    },
    correctionLog: {
      updateMany: vi.fn(),
    },
  },
}));

describe('Datenschutz: Scan-Dateien bei Kaskadenloeschung bereinigen', () => {
  const mockTeacherId = 'teacher-100';

  beforeEach(() => {
    vi.restoreAllMocks();
    mockStorageDelete.mockReset();
    vi.mocked(sessionModule.getSession).mockResolvedValue({
      userId: mockTeacherId,
    });
  });

  describe('DELETE /api/exams/[id]', () => {
    const mockExamId = 'exam-42';
    const mockClassId = 'class-10';

    it('entfernt bei Pruefungsloeschung zugehoerige Scan-Dateien aus dem Storage und loescht die Pruefung', async () => {
      vi.mocked(db.exam.findUnique).mockResolvedValueOnce({
        id: mockExamId,
        title: 'Mathe Pruefung',
        classId: mockClassId,
        class: { teacherId: mockTeacherId },
      } as unknown as Awaited<ReturnType<typeof db.exam.findUnique>>);

      // 2 Submissions mit Scan-Dateien (eine einzeln, eine mehrseitig)
      vi.mocked(db.submission.findMany).mockResolvedValueOnce([
        { id: 'sub-1', studentExamUrl: '/uploads/exams/scan1.pdf' },
        {
          id: 'sub-2',
          studentExamUrl: JSON.stringify([
            '/uploads/exams/scan2_p1.jpg',
            '/uploads/exams/scan2_p2.jpg',
          ]),
        },
        { id: 'sub-3', studentExamUrl: null },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      mockStorageDelete.mockResolvedValue(true);
      vi.mocked(db.exam.delete).mockResolvedValueOnce({ id: mockExamId } as unknown as Awaited<
        ReturnType<typeof db.exam.delete>
      >);

      const req = new Request(`http://localhost/api/exams/${mockExamId}`, { method: 'DELETE' });
      const res = await deleteExam(req, { params: Promise.resolve({ id: mockExamId }) });

      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.success).toBe(true);

      // Verifiziere: Alle 3 Scan-Dateien wurden aus dem Storage geloescht
      expect(mockStorageDelete).toHaveBeenCalledTimes(3);
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/exams/scan1.pdf');
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/exams/scan2_p1.jpg');
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/exams/scan2_p2.jpg');

      // Verifiziere: Erst nach erfolgreicher Storage-Loeschung wird die Pruefung aus der DB geloescht
      expect(db.exam.delete).toHaveBeenCalledWith({ where: { id: mockExamId } });
    });

    it('definiert den Storage-Fehlerfall: Pruefung wird nicht geloescht und Dateien bleiben nachholbar', async () => {
      vi.mocked(db.exam.findUnique).mockResolvedValue({
        id: mockExamId,
        title: 'Mathe Pruefung',
        classId: mockClassId,
        class: { teacherId: mockTeacherId },
      } as unknown as Awaited<ReturnType<typeof db.exam.findUnique>>);

      vi.mocked(db.submission.findMany).mockResolvedValue([
        { id: 'sub-1', studentExamUrl: '/uploads/exams/scan1.pdf' },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      // Storage-Fehler simulieren
      mockStorageDelete.mockRejectedValue(new Error('S3 Connection Timeout'));

      const req = new Request(`http://localhost/api/exams/${mockExamId}`, { method: 'DELETE' });
      const res = await deleteExam(req, { params: Promise.resolve({ id: mockExamId }) });

      // Verifiziere: Status 500 mit Fehlermeldung
      expect(res.status).toBe(500);
      const json = await res.json();
      expect(json.error).toContain('Löschen der zugehörigen Scan-Dateien fehlgeschlagen');
      expect(json.failedFiles).toHaveLength(1);
      expect(json.failedFiles[0].url).toBe('/uploads/exams/scan1.pdf');

      // Kritischer Datenschutz-Check: DB-Loeschung wurde ABGEBROCHEN
      // Pruefung und Submission bleiben in DB erhalten -> Datei bleibt auffindbar und zugeordnet
      expect(db.exam.delete).not.toHaveBeenCalled();

      // Nachholen / Retry: Storage ist wieder verfuegbar
      mockStorageDelete.mockReset();
      mockStorageDelete.mockResolvedValue(true);
      vi.mocked(db.exam.delete).mockResolvedValueOnce({ id: mockExamId } as unknown as Awaited<
        ReturnType<typeof db.exam.delete>
      >);

      const retryRes = await deleteExam(req, { params: Promise.resolve({ id: mockExamId }) });
      expect(retryRes.status).toBe(200);
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/exams/scan1.pdf');
      expect(db.exam.delete).toHaveBeenCalledWith({ where: { id: mockExamId } });
    });
  });

  describe('DELETE /api/classes/[id]', () => {
    const mockClassId = 'class-9b';

    it('entfernt bei Klassenloeschung alle Scan-Dateien der betroffenen Pruefungen und Schueler', async () => {
      vi.mocked(db.class.findFirst).mockResolvedValueOnce({
        id: mockClassId,
        name: 'Klasse 9b',
        teacherId: mockTeacherId,
        archivedAt: new Date('2026-06-01T00:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof db.class.findFirst>>);

      vi.mocked(db.submission.findMany).mockResolvedValueOnce([
        { id: 'sub-10', studentExamUrl: '/uploads/classes/scanA.pdf' },
        { id: 'sub-11', studentExamUrl: '/uploads/classes/scanB.pdf' },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      mockStorageDelete.mockResolvedValue(true);
      vi.mocked(db.class.delete).mockResolvedValueOnce({ id: mockClassId } as unknown as Awaited<
        ReturnType<typeof db.class.delete>
      >);

      const req = new Request(`http://localhost/api/classes/${mockClassId}`, { method: 'DELETE' });
      const res = await deleteClass(req, { params: Promise.resolve({ id: mockClassId }) });

      expect(res.status).toBe(200);
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/classes/scanA.pdf');
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/classes/scanB.pdf');
      expect(db.class.delete).toHaveBeenCalledWith({ where: { id: mockClassId } });
    });

    it('bricht Klassenloeschung bei Storage-Fehler ab', async () => {
      vi.mocked(db.class.findFirst).mockResolvedValueOnce({
        id: mockClassId,
        name: 'Klasse 9b',
        teacherId: mockTeacherId,
        archivedAt: new Date('2026-06-01T00:00:00Z'),
      } as unknown as Awaited<ReturnType<typeof db.class.findFirst>>);

      vi.mocked(db.submission.findMany).mockResolvedValueOnce([
        { id: 'sub-10', studentExamUrl: '/uploads/classes/scanA.pdf' },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      mockStorageDelete.mockRejectedValue(new Error('Disk I/O error'));

      const req = new Request(`http://localhost/api/classes/${mockClassId}`, { method: 'DELETE' });
      const res = await deleteClass(req, { params: Promise.resolve({ id: mockClassId }) });

      expect(res.status).toBe(500);
      expect(db.class.delete).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/students/[id]', () => {
    const mockStudentId = 'student-7';

    it('entfernt bei Schuelerloeschung zugehoerige Scan-Dateien', async () => {
      vi.mocked(db.student.findUnique).mockResolvedValueOnce({
        id: mockStudentId,
        name: 'Anna Keller',
        classId: 'class-9b',
        class: { teacherId: mockTeacherId },
      } as unknown as Awaited<ReturnType<typeof db.student.findUnique>>);

      vi.mocked(db.submission.findMany).mockResolvedValueOnce([
        { id: 'sub-anna-1', studentExamUrl: '/uploads/students/anna.pdf' },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      mockStorageDelete.mockResolvedValue(true);
      vi.mocked(db.student.delete).mockResolvedValueOnce({
        id: mockStudentId,
      } as unknown as Awaited<ReturnType<typeof db.student.delete>>);

      const req = new Request(`http://localhost/api/students/${mockStudentId}`, {
        method: 'DELETE',
      });
      const res = await deleteStudent(req, { params: Promise.resolve({ id: mockStudentId }) });

      expect(res.status).toBe(200);
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/students/anna.pdf');
      expect(db.student.delete).toHaveBeenCalledWith({ where: { id: mockStudentId } });
    });

    it('bricht Schuelerloeschung bei Storage-Fehler ab', async () => {
      vi.mocked(db.student.findUnique).mockResolvedValueOnce({
        id: mockStudentId,
        name: 'Anna Keller',
        classId: 'class-9b',
        class: { teacherId: mockTeacherId },
      } as unknown as Awaited<ReturnType<typeof db.student.findUnique>>);

      vi.mocked(db.submission.findMany).mockResolvedValueOnce([
        { id: 'sub-anna-1', studentExamUrl: '/uploads/students/anna.pdf' },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);

      mockStorageDelete.mockRejectedValue(new Error('S3 error'));

      const req = new Request(`http://localhost/api/students/${mockStudentId}`, {
        method: 'DELETE',
      });
      const res = await deleteStudent(req, { params: Promise.resolve({ id: mockStudentId }) });

      expect(res.status).toBe(500);
      expect(db.student.delete).not.toHaveBeenCalled();
    });
  });

  describe('DELETE /api/submissions/[id]', () => {
    const mockSubmissionId = 'sub-single';

    it('entfernt Scan-Dateien vor DB-Loeschung und loescht Submission fehlersicher', async () => {
      vi.mocked(db.submission.findUnique).mockResolvedValueOnce({
        id: mockSubmissionId,
        studentExamUrl: '/uploads/sub-single.pdf',
        status: 'COMPLETED',
        createdAt: new Date(),
        examId: 'exam-1',
        studentId: 'student-1',
        exam: {
          classId: 'class-1',
          class: { teacherId: mockTeacherId },
        },
      } as unknown as Awaited<ReturnType<typeof db.submission.findUnique>>);

      mockStorageDelete.mockResolvedValue(true);
      vi.mocked(db.submission.delete).mockResolvedValueOnce({
        id: mockSubmissionId,
      } as unknown as Awaited<ReturnType<typeof db.submission.delete>>);

      const req = new Request(`http://localhost/api/submissions/${mockSubmissionId}`, {
        method: 'DELETE',
      });
      const res = await deleteSubmission(req, {
        params: Promise.resolve({ id: mockSubmissionId }),
      });

      expect(res.status).toBe(200);
      expect(mockStorageDelete).toHaveBeenCalledWith('/uploads/sub-single.pdf');
      expect(db.submission.delete).toHaveBeenCalledWith({ where: { id: mockSubmissionId } });
    });

    it('bricht Submission-Loeschung bei Storage-Fehler vor DB-Loeschung ab', async () => {
      vi.mocked(db.submission.findUnique).mockResolvedValueOnce({
        id: mockSubmissionId,
        studentExamUrl: '/uploads/sub-single.pdf',
        status: 'COMPLETED',
        createdAt: new Date(),
        examId: 'exam-1',
        studentId: 'student-1',
        exam: {
          classId: 'class-1',
          class: { teacherId: mockTeacherId },
        },
      } as unknown as Awaited<ReturnType<typeof db.submission.findUnique>>);

      mockStorageDelete.mockRejectedValue(new Error('Access Denied'));

      const req = new Request(`http://localhost/api/submissions/${mockSubmissionId}`, {
        method: 'DELETE',
      });
      const res = await deleteSubmission(req, {
        params: Promise.resolve({ id: mockSubmissionId }),
      });

      expect(res.status).toBe(500);
      expect(db.submission.delete).not.toHaveBeenCalled();
    });
  });

  describe('deleteSubmissionScanFiles Helper Verhalten', () => {
    it('aktualisiert die DB-Referenz fuer verbleibende Dateien, wenn eine von mehreren Seiten fehlschlaegt', async () => {
      const sub = {
        id: 'sub-multi',
        studentExamUrl: JSON.stringify(['/uploads/page1.jpg', '/uploads/page2.jpg']),
      };

      // page1 loeschen klappt, page2 schlaegt fehl
      mockStorageDelete
        .mockResolvedValueOnce(true)
        .mockRejectedValue(new Error('Network drop on page 2'));

      vi.mocked(db.submission.update).mockResolvedValue({ id: 'sub-multi' } as unknown as Awaited<
        ReturnType<typeof db.submission.update>
      >);

      await expect(deleteSubmissionScanFiles([sub])).rejects.toThrow(StorageCleanupError);

      // Verifiziere: In der DB wurde vermerkt, dass nur noch page2.jpg verbleibt
      expect(db.submission.update).toHaveBeenCalledWith({
        where: { id: 'sub-multi' },
        data: { studentExamUrl: '/uploads/page2.jpg' },
      });
    });

    it('ignoriert Submissions ohne Scan-URLs ohne Fehler', async () => {
      const result = await deleteSubmissionScanFiles([
        { id: 'sub-none-1', studentExamUrl: null },
        { id: 'sub-none-2', studentExamUrl: '' },
      ]);
      expect(result.deletedCount).toBe(0);
      expect(mockStorageDelete).not.toHaveBeenCalled();
    });
  });

  describe('Schweizer Rechtschreibung & Code Integrity (Kein Eszett)', () => {
    it('enthaelt kein Eszett in allen neu erstellten und modifizierten Dateien', () => {
      const filesToCheck = [
        '../../lib/storage-cleanup.ts',
        '../../app/api/exams/[id]/route.ts',
        '../../app/api/classes/[id]/route.ts',
        '../../app/api/students/[id]/route.ts',
        '../../app/api/submissions/[id]/route.ts',
      ];

      for (const rel of filesToCheck) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
