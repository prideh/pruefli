import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  archiveClass,
  unarchiveClass,
  isClassArchived,
  getClassArchivedAt,
  getArchivedClassIds,
  deleteClassArchive,
  resetClassArchiveMemoryState,
  formatClassDeletionConsequences,
  isClassDeleteConfirmationValid,
  formatClassDeletedCompletionMessage,
} from '@/lib/class-archive';
import fs from 'fs';
import path from 'path';
import { GET as getClasses } from '@/app/api/classes/route';
import {
  GET as getClassDetails,
  PUT as updateClassPut,
  DELETE as deleteClass,
} from '@/app/api/classes/[id]/route';
import { POST as addStudentPost } from '@/app/api/classes/[id]/students/route';
import {
  GET as getStudentDetails,
  PUT as updateStudentPut,
  DELETE as deleteStudent,
} from '@/app/api/students/[id]/route';
import { GET as getExams, POST as createExamPost } from '@/app/api/exams/route';
import {
  GET as getExamDetails,
  PUT as updateExamPut,
  DELETE as deleteExam,
} from '@/app/api/exams/[id]/route';
import { GET as getSubmissions } from '@/app/api/submissions/route';
import {
  GET as getSubmissionDetails,
  POST as updateSubmissionPost,
} from '@/app/api/submissions/[id]/route';
import * as sessionModule from '@/lib/session';
import { db } from '@/lib/db';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  serverCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
    invalidateTags: vi.fn().mockResolvedValue(undefined),
  },
  CacheTags: {
    teacher: vi.fn((id: string) => `teacher:${id}`),
    class: vi.fn((id: string) => `class:${id}`),
    classes: vi.fn((id: string) => `classes:${id}`),
    exam: vi.fn((id: string) => `exam:${id}`),
    exams: vi.fn((id: string) => `exams:${id}`),
    student: vi.fn((id: string) => `student:${id}`),
    students: vi.fn((id: string) => `students:${id}`),
    submission: vi.fn((t: string, id: string) => `submission:${t}:${id}`),
    submissions: vi.fn((id: string) => `submissions:${id}`),
    logs: vi.fn((id: string) => `logs:${id}`),
  },
  invalidateClassCache: vi.fn().mockResolvedValue(undefined),
  invalidateExamCache: vi.fn().mockResolvedValue(undefined),
  invalidateStudentCache: vi.fn().mockResolvedValue(undefined),
  invalidateSubmissionCache: vi.fn().mockResolvedValue(undefined),
  invalidateLogsCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/storage-cleanup', () => ({
  deleteClassScanFiles: vi.fn().mockResolvedValue(undefined),
  deleteStudentScanFiles: vi.fn().mockResolvedValue(undefined),
  deleteExamScanFiles: vi.fn().mockResolvedValue(undefined),
  StorageCleanupError: class StorageCleanupError extends Error {},
}));

vi.mock('@/lib/db', () => ({
  db: {
    class: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    student: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    exam: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    submission: {
      count: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    correctionLog: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Klassen archivieren (#82): Nicht-destruktives Ablegen für den Schuljahreswechsel', () => {
  const mockTeacherId = 'teacher-archive-1';
  const activeClassId = 'class-active-1';
  const archivedClassId = 'class-archived-2';

  beforeEach(() => {
    vi.clearAllMocks();
    resetClassArchiveMemoryState();
    vi.mocked(sessionModule.getSession).mockResolvedValue({
      userId: mockTeacherId,
    });
  });

  describe('1. Persistenz-Hilfsfunktionen (lib/class-archive.ts)', () => {
    it('archiviert, prüft und stellt Klassen sauber wieder her', async () => {
      expect(await isClassArchived(archivedClassId)).toBe(false);
      expect(await getClassArchivedAt(archivedClassId)).toBeNull();

      const archivedDate = await archiveClass(archivedClassId);
      expect(archivedDate).toBeInstanceOf(Date);
      expect(await isClassArchived(archivedClassId)).toBe(true);
      expect(await getClassArchivedAt(archivedClassId)).toEqual(archivedDate);

      const archivedSet = await getArchivedClassIds([activeClassId, archivedClassId]);
      expect(archivedSet.has(archivedClassId)).toBe(true);
      expect(archivedSet.has(activeClassId)).toBe(false);

      await unarchiveClass(archivedClassId);
      expect(await isClassArchived(archivedClassId)).toBe(false);
      expect(await getClassArchivedAt(archivedClassId)).toBeNull();
    });

    it('bereinigt den Archiv-Eintrag beim endgültigen Löschen einer Klasse', async () => {
      await archiveClass(archivedClassId);
      expect(await isClassArchived(archivedClassId)).toBe(true);

      await deleteClassArchive(archivedClassId);
      expect(await isClassArchived(archivedClassId)).toBe(false);
    });
  });

  describe('2. GET /api/classes Filterung (Aktiv vs. Archiviert)', () => {
    const sampleClasses = [
      {
        id: activeClassId,
        name: '2a Sek (Aktiv)',
        teacherId: mockTeacherId,
        createdAt: new Date('2026-08-15T08:00:00Z'),
        _count: { students: 20, exams: 2 },
        exams: [
          {
            maxPoints: 20,
            gradingFormula: 'LINEAR_60',
            gradeRounding: '0.1',
            submissions: [{ status: 'COMPLETED', totalPoints: 18, grade: '5.5' }],
          },
        ],
      },
      {
        id: archivedClassId,
        name: '3b Sek (Schuljahr 2025/26)',
        teacherId: mockTeacherId,
        createdAt: new Date('2025-08-15T08:00:00Z'),
        _count: { students: 22, exams: 5 },
        exams: [
          {
            maxPoints: 20,
            gradingFormula: 'LINEAR_60',
            gradeRounding: '0.1',
            submissions: [{ status: 'COMPLETED', totalPoints: 15, grade: '4.8' }],
          },
        ],
      },
    ];

    it('liefert standardmässig nur aktive Klassen und blendet archivierte aus', async () => {
      await archiveClass(archivedClassId);
      vi.mocked(db.class.findMany).mockResolvedValue(
        sampleClasses as unknown as Awaited<ReturnType<typeof db.class.findMany>>
      );

      const resDefault = await getClasses(new Request('http://localhost/api/classes'));
      expect(resDefault.status).toBe(200);
      const dataDefault = await resDefault.json();
      expect(dataDefault.classes).toHaveLength(1);
      expect(dataDefault.classes[0].id).toBe(activeClassId);
      expect(dataDefault.classes[0].isArchived).toBe(false);
    });

    it('liefert mit ?status=archived gezielt die archivierten Klassen und mit ?includeArchived=true alle', async () => {
      await archiveClass(archivedClassId);
      vi.mocked(db.class.findMany).mockResolvedValue(
        sampleClasses as unknown as Awaited<ReturnType<typeof db.class.findMany>>
      );

      const resArchived = await getClasses(
        new Request('http://localhost/api/classes?status=archived')
      );
      expect(resArchived.status).toBe(200);
      const dataArchived = await resArchived.json();
      expect(dataArchived.classes).toHaveLength(1);
      expect(dataArchived.classes[0].id).toBe(archivedClassId);
      expect(dataArchived.classes[0].isArchived).toBe(true);
      expect(dataArchived.classes[0].archivedAt).toBeTruthy();

      const resAll = await getClasses(
        new Request('http://localhost/api/classes?includeArchived=true')
      );
      expect(resAll.status).toBe(200);
      const dataAll = await resAll.json();
      expect(dataAll.classes).toHaveLength(2);
    });
  });

  describe('3. Archivieren, Schreibschutz, Wiederherstellen und Löschen auf /api/classes/[id]', () => {
    const mockClassRecord = {
      id: archivedClassId,
      name: '3b Sek',
      teacherId: mockTeacherId,
      createdAt: new Date('2025-08-15T08:00:00Z'),
      updatedAt: new Date('2025-08-15T08:00:00Z'),
    };

    it('archiviert eine Klasse via PUT { archived: true }, blockiert Bearbeitungen im Archiv und erlaubt Wiederherstellung via { archived: false }', async () => {
      vi.mocked(db.class.findFirst).mockResolvedValue(
        mockClassRecord as unknown as Awaited<ReturnType<typeof db.class.findFirst>>
      );

      // 1. Archivieren
      const archiveReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: true }),
      });
      const archiveRes = await updateClassPut(archiveReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(archiveRes.status).toBe(200);
      const archiveData = await archiveRes.json();
      expect(archiveData.class.isArchived).toBe(true);
      expect(await isClassArchived(archivedClassId)).toBe(true);

      // 2. Umbenennen im archivierten Zustand wird mit HTTP 400 abgelehnt
      const editReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Neuer Name' }),
      });
      const editRes = await updateClassPut(editReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(editRes.status).toBe(400);
      const editData = await editRes.json();
      expect(editData.error).toContain('Archivierte Klassen sind schreibgeschützt');
      expect(db.class.update).not.toHaveBeenCalled();

      // 3. Wiederherstellen via { archived: false }
      const restoreReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });
      const restoreRes = await updateClassPut(restoreReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(restoreRes.status).toBe(200);
      const restoreData = await restoreRes.json();
      expect(restoreData.class.isArchived).toBe(false);
      expect(await isClassArchived(archivedClassId)).toBe(false);

      // 4. Nach Wiederherstellung ist Umbenennen wieder möglich
      vi.mocked(db.class.update).mockResolvedValueOnce({
        ...mockClassRecord,
        name: '3b Sek (Reaktiviert)',
      } as unknown as Awaited<ReturnType<typeof db.class.update>>);

      const editAfterRestoreReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: '3b Sek (Reaktiviert)' }),
      });
      const editAfterRestoreRes = await updateClassPut(editAfterRestoreReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(editAfterRestoreRes.status).toBe(200);
    });

    it('erlaubt weiterhin das endgültige Löschen einer archivierten Klasse via DELETE', async () => {
      await archiveClass(archivedClassId);
      vi.mocked(db.class.findFirst).mockResolvedValueOnce(
        mockClassRecord as unknown as Awaited<ReturnType<typeof db.class.findFirst>>
      );
      vi.mocked(db.class.delete).mockResolvedValueOnce(
        mockClassRecord as unknown as Awaited<ReturnType<typeof db.class.delete>>
      );

      const delReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'DELETE',
      });
      const delRes = await deleteClass(delReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(delRes.status).toBe(200);
      expect(await isClassArchived(archivedClassId)).toBe(false);
    });

    it('erlaubt das Lesen der Klassendetails (Schüler, Prüfungen, Noten) im archivierten Zustand', async () => {
      await archiveClass(archivedClassId);
      vi.mocked(db.class.findFirst).mockResolvedValueOnce({
        id: archivedClassId,
        name: '3b Sek',
        teacherId: mockTeacherId,
        createdAt: new Date('2025-08-15T08:00:00Z'),
        students: [
          {
            id: 'student-1',
            name: 'Lena Muster',
            submissions: [
              {
                status: 'COMPLETED',
                totalPoints: 18,
                gradeRaw: 5.5,
                grade: '5.5',
                exam: { maxPoints: 20, gradingFormula: 'LINEAR_60', gradeRounding: '0.1' },
              },
            ],
          },
        ],
        exams: [
          {
            id: 'exam-1',
            title: 'Bruchrechnen',
            subject: 'Mathematik',
            maxPoints: 20,
            gradingFormula: 'LINEAR_60',
            gradeRounding: '0.1',
            createdAt: new Date('2025-10-01T08:00:00Z'),
            submissions: [{ status: 'COMPLETED', totalPoints: 18, gradeRaw: 5.5, grade: '5.5' }],
          },
        ],
      } as unknown as Awaited<ReturnType<typeof db.class.findFirst>>);

      const res = await getClassDetails(
        new Request(`http://localhost/api/classes/${archivedClassId}`),
        {
          params: Promise.resolve({ id: archivedClassId }),
        }
      );
      expect(res.status).toBe(200);
      const data = await res.json();
      expect(data.class.isArchived).toBe(true);
      expect(data.students).toHaveLength(1);
      expect(data.exams).toHaveLength(1);
      expect(data.stats.averageGrade).toBe('5.50');
    });
  });

  describe('4. Schreibschutz und Lesbarkeit von Schülern, Prüfungen und Korrekturen', () => {
    it('blockiert das Hinzufügen, Ändern und Löschen von Schülern in archivierten Klassen, erlaubt aber Profil-Lesen', async () => {
      await archiveClass(archivedClassId);
      vi.mocked(db.class.findFirst).mockResolvedValue({
        id: archivedClassId,
        name: '3b Sek',
        teacherId: mockTeacherId,
      } as unknown as Awaited<ReturnType<typeof db.class.findFirst>>);

      // POST /api/classes/[id]/students -> 400
      const addRes = await addStudentPost(
        new Request(`http://localhost/api/classes/${archivedClassId}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Neuer Schüler' }),
        }),
        { params: Promise.resolve({ id: archivedClassId }) }
      );
      expect(addRes.status).toBe(400);

      const mockStudentRecord = {
        id: 'student-1',
        name: 'Lena Muster',
        classId: archivedClassId,
        createdAt: new Date('2025-08-15T08:00:00Z'),
        class: {
          id: archivedClassId,
          name: '3b Sek',
          teacherId: mockTeacherId,
          exams: [],
        },
        submissions: [],
      };
      vi.mocked(db.student.findFirst).mockResolvedValue(
        mockStudentRecord as unknown as Awaited<ReturnType<typeof db.student.findFirst>>
      );
      vi.mocked(db.student.findUnique).mockResolvedValue(
        mockStudentRecord as unknown as Awaited<ReturnType<typeof db.student.findUnique>>
      );
      vi.mocked(db.submission.findMany).mockResolvedValue([]);

      // GET /api/students/[id] -> 200 (Lesemodus)
      const getRes = await getStudentDetails(
        new Request('http://localhost/api/students/student-1'),
        {
          params: Promise.resolve({ id: 'student-1' }),
        }
      );
      expect(getRes.status).toBe(200);
      const getJson = await getRes.json();
      expect(getJson.student.isClassArchived).toBe(true);

      // PUT /api/students/[id] -> 400
      const putRes = await updateStudentPut(
        new Request('http://localhost/api/students/student-1', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Lena Neu' }),
        }),
        { params: Promise.resolve({ id: 'student-1' }) }
      );
      expect(putRes.status).toBe(400);

      // DELETE /api/students/[id] -> 400
      const delRes = await deleteStudent(
        new Request('http://localhost/api/students/student-1', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'student-1' }) }
      );
      expect(delRes.status).toBe(400);
    });

    it('blendet Prüfungen archivierter Klassen in GET /api/exams aus und schützt Prüfungen/Korrekturen vor Änderungen', async () => {
      await archiveClass(archivedClassId);

      vi.mocked(db.exam.findMany).mockResolvedValue([
        {
          id: 'exam-active',
          title: 'Algebra Aktiv',
          subject: 'Mathematik',
          maxPoints: 20,
          gradingFormula: 'LINEAR_60',
          gradeRounding: '0.1',
          createdAt: new Date('2026-09-01T08:00:00Z'),
          classId: activeClassId,
          class: { id: activeClassId, name: '2a Sek', _count: { students: 15 } },
          _count: { submissions: 0 },
          tasks: [],
          submissions: [],
        },
        {
          id: 'exam-archived',
          title: 'Geometrie Archiv',
          subject: 'Mathematik',
          maxPoints: 20,
          gradingFormula: 'LINEAR_60',
          gradeRounding: '0.1',
          createdAt: new Date('2025-09-01T08:00:00Z'),
          classId: archivedClassId,
          class: { id: archivedClassId, name: '3b Sek', _count: { students: 20 } },
          _count: { submissions: 0 },
          tasks: [],
          submissions: [],
        },
      ] as unknown as Awaited<ReturnType<typeof db.exam.findMany>>);

      const examsRes = await getExams(new Request('http://localhost/api/exams'));
      expect(examsRes.status).toBe(200);
      const examsData = await examsRes.json();
      expect(examsData.exams).toHaveLength(1);
      expect(examsData.exams[0].id).toBe('exam-active');

      // POST /api/exams in archivierte Klasse -> 400
      vi.mocked(db.class.findFirst).mockResolvedValueOnce({
        id: archivedClassId,
        name: '3b Sek',
        teacherId: mockTeacherId,
      } as unknown as Awaited<ReturnType<typeof db.class.findFirst>>);

      const createExamRes = await createExamPost(
        new Request('http://localhost/api/exams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: 'Neue Prüfung',
            subject: 'Mathematik',
            maxPoints: 20,
            classId: archivedClassId,
          }),
        })
      );
      expect(createExamRes.status).toBe(400);

      // GET /api/exams/[id] bleibt lesbar, PUT & DELETE werden mit 400 blockiert
      const mockArchivedExamRecord = {
        id: 'exam-archived',
        title: 'Geometrie Archiv',
        subject: 'Mathematik',
        maxPoints: 20,
        gradingFormula: 'LINEAR_60',
        gradeRounding: '0.1',
        createdAt: new Date('2025-09-01T08:00:00Z'),
        classId: archivedClassId,
        teacherId: mockTeacherId,
        class: {
          id: archivedClassId,
          name: '3b Sek',
          teacherId: mockTeacherId,
          students: [],
        },
        tasks: [],
        submissions: [],
      };
      vi.mocked(db.exam.findFirst).mockResolvedValue(
        mockArchivedExamRecord as unknown as Awaited<ReturnType<typeof db.exam.findFirst>>
      );
      vi.mocked(db.exam.findUnique).mockResolvedValue(
        mockArchivedExamRecord as unknown as Awaited<ReturnType<typeof db.exam.findUnique>>
      );

      const examDetailRes = await getExamDetails(
        new Request('http://localhost/api/exams/exam-archived'),
        { params: Promise.resolve({ id: 'exam-archived' }) }
      );
      expect(examDetailRes.status).toBe(200);
      const examDetailData = await examDetailRes.json();
      expect(examDetailData.exam.isClassArchived).toBe(true);

      const updateExamRes = await updateExamPut(
        new Request('http://localhost/api/exams/exam-archived', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: 'Geändert' }),
        }),
        { params: Promise.resolve({ id: 'exam-archived' }) }
      );
      expect(updateExamRes.status).toBe(400);

      const deleteExamRes = await deleteExam(
        new Request('http://localhost/api/exams/exam-archived', { method: 'DELETE' }),
        { params: Promise.resolve({ id: 'exam-archived' }) }
      );
      expect(deleteExamRes.status).toBe(400);
    });

    it('schliesst archivierte Klassen aus laufenden Dashboard-Statistiken (/api/submissions) aus und bezieht sie nach Wiederherstellung wieder ein', async () => {
      await archiveClass(archivedClassId);

      const mockSubmissions = [
        {
          id: 'sub-active',
          studentName: 'Anna Aktiv',
          status: 'COMPLETED',
          earnedPoints: 18,
          gradeRaw: 5.5,
          gradeRounded: 5.5,
          totalPoints: 18,
          grade: '5.5',
          createdAt: new Date('2026-09-10T10:00:00Z'),
          examId: 'exam-active',
          studentId: 'stu-active',
          student: { id: 'stu-active', name: 'Anna Aktiv' },
          exam: {
            id: 'exam-active',
            title: 'Algebra',
            subject: 'Mathematik',
            maxPoints: 20,
            gradingFormula: 'LINEAR_60',
            gradeRounding: '0.1',
            classId: activeClassId,
            class: { name: '2a Sek' },
          },
          tasks: [],
          results: [],
          feedback: null,
        },
        {
          id: 'sub-archived',
          studentName: 'Lukas Archiv',
          status: 'COMPLETED',
          earnedPoints: 12,
          gradeRaw: 4.0,
          gradeRounded: 4.0,
          totalPoints: 12,
          grade: '4.0',
          createdAt: new Date('2025-09-10T10:00:00Z'),
          examId: 'exam-archived',
          studentId: 'stu-archived',
          student: { id: 'stu-archived', name: 'Lukas Archiv' },
          exam: {
            id: 'exam-archived',
            title: 'Geometrie',
            subject: 'Mathematik',
            maxPoints: 20,
            gradingFormula: 'LINEAR_60',
            gradeRounding: '0.1',
            classId: archivedClassId,
            class: { name: '3b Sek' },
          },
          tasks: [],
          results: [],
          feedback: null,
        },
      ];

      vi.mocked(db.submission.count).mockResolvedValue(2);
      vi.mocked(db.submission.findMany).mockResolvedValue(
        mockSubmissions as unknown as Awaited<ReturnType<typeof db.submission.findMany>>
      );
      vi.mocked(db.student.findMany).mockResolvedValue([
        { id: 'stu-active', name: 'Anna Aktiv', classId: activeClassId },
        { id: 'stu-archived', name: 'Lukas Archiv', classId: archivedClassId },
      ] as unknown as Awaited<ReturnType<typeof db.student.findMany>>);
      vi.mocked(db.exam.findMany).mockResolvedValue([
        {
          id: 'exam-active',
          title: 'Algebra',
          subject: 'Mathematik',
          maxPoints: 20,
          classId: activeClassId,
          class: { name: '2a Sek' },
        },
        {
          id: 'exam-archived',
          title: 'Geometrie',
          subject: 'Mathematik',
          maxPoints: 20,
          classId: archivedClassId,
          class: { name: '3b Sek' },
        },
      ] as unknown as Awaited<ReturnType<typeof db.exam.findMany>>);

      // Im archivierten Zustand zählt nur die aktive Klasse
      const resWhileArchived = await getSubmissions(
        new Request('http://localhost/api/submissions')
      );
      expect(resWhileArchived.status).toBe(200);
      const dataWhileArchived = await resWhileArchived.json();
      expect(dataWhileArchived.submissions).toHaveLength(1);
      expect(dataWhileArchived.submissions[0].id).toBe('sub-active');
      expect(dataWhileArchived.allExams).toHaveLength(1);
      expect(dataWhileArchived.studentsByClass[archivedClassId]).toBeUndefined();

      // Nach Wiederherstellung zählt die Klasse wieder regulär mit
      await unarchiveClass(archivedClassId);
      const resAfterRestore = await getSubmissions(new Request('http://localhost/api/submissions'));
      expect(resAfterRestore.status).toBe(200);
      const dataAfterRestore = await resAfterRestore.json();
      expect(dataAfterRestore.submissions).toHaveLength(2);
      expect(dataAfterRestore.allExams).toHaveLength(2);
      expect(dataAfterRestore.studentsByClass[archivedClassId]).toHaveLength(1);
    });

    it('erlaubt das Lesen einer Korrektur (/api/submissions/[id]) im Archiv, blockiert aber Änderungen mit 400', async () => {
      await archiveClass(archivedClassId);

      vi.mocked(db.submission.findUnique).mockResolvedValue({
        id: 'sub-archived',
        examId: 'exam-archived',
        studentName: 'Lukas Archiv',
        status: 'COMPLETED',
        earnedPoints: 15,
        gradeRaw: 4.8,
        gradeRounded: 4.8,
        totalPoints: 15,
        grade: '4.8',
        studentExamUrl: null,
        errorMessage: null,
        studentId: 'stu-archived',
        student: { id: 'stu-archived', name: 'Lukas Archiv' },
        createdAt: new Date('2025-09-10T10:00:00Z'),
        exam: {
          id: 'exam-archived',
          title: 'Geometrie',
          subject: 'Mathematik',
          maxPoints: 20,
          gradingFormula: 'LINEAR_60',
          gradeRounding: '0.1',
          teacherId: mockTeacherId,
          classId: archivedClassId,
          class: { name: '3b Sek', teacherId: mockTeacherId },
        },
        tasks: [],
        strengths: [],
        weaknesses: [],
        helpfulTip: '',
        exerciseRecommendation: '',
        results: [],
        feedback: null,
      } as unknown as Awaited<ReturnType<typeof db.submission.findUnique>>);
      vi.mocked(db.submission.findMany).mockResolvedValue([]);
      vi.mocked(db.correctionLog.findFirst).mockResolvedValue(null);

      const getRes = await getSubmissionDetails(
        new Request('http://localhost/api/submissions/sub-archived'),
        { params: Promise.resolve({ id: 'sub-archived' }) }
      );
      expect(getRes.status).toBe(200);
      const getData = await getRes.json();
      expect(getData.isClassArchived).toBe(true);

      const postRes = await updateSubmissionPost(
        new Request('http://localhost/api/submissions/sub-archived', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ aufgaben: [] }),
        }),
        { params: Promise.resolve({ id: 'sub-archived' }) }
      );
      expect(postRes.status).toBe(400);
    });
  });

  describe('5. Endgültiges Löschen im Archiv absichern (#84): Konsequenzen-Dialog & Tipp-Bestätigung', () => {
    it('formatiert die Lösch-Konsequenzen exakt mit den aktuellen DB-Zahlen', () => {
      expect(
        formatClassDeletionConsequences({
          studentsCount: 3,
          examsCount: 5,
          submissionsCount: 41,
        })
      ).toBe('3 Schüler/innen, 5 Prüfungen, 41 Korrekturen inkl. aller gespeicherten Scans');

      expect(
        formatClassDeletionConsequences({
          studentsCount: 1,
          examsCount: 1,
          submissionsCount: 1,
        })
      ).toBe('1 Schüler/innen, 1 Prüfung, 1 Korrektur inkl. aller gespeicherten Scans');

      expect(
        formatClassDeletionConsequences({
          studentsCount: 0,
          examsCount: 0,
          submissionsCount: 0,
        })
      ).toBe('0 Schüler/innen, 0 Prüfungen, 0 Korrekturen inkl. aller gespeicherten Scans');
    });

    it('prüft die Tipp-Bestätigung des Klassennamens strikt', () => {
      expect(isClassDeleteConfirmationValid('3b Sek', '3b Sek')).toBe(true);
      expect(isClassDeleteConfirmationValid('3b Sek', '  3b Sek  ')).toBe(true);
      expect(isClassDeleteConfirmationValid('3b Sek', '3b sek')).toBe(false);
      expect(isClassDeleteConfirmationValid('3b Sek', '3b')).toBe(false);
      expect(isClassDeleteConfirmationValid('3b Sek', '')).toBe(false);
      expect(isClassDeleteConfirmationValid('', '')).toBe(false);
    });

    it('blockiert direktes Löschen einer aktiven (nicht archivierten) Klasse mit HTTP 400', async () => {
      vi.mocked(db.class.findFirst).mockResolvedValueOnce({
        id: activeClassId,
        name: '2a Sek (Aktiv)',
        teacherId: mockTeacherId,
        _count: { students: 3, exams: 5 },
        exams: [{ _count: { submissions: 41 } }],
      } as unknown as Awaited<ReturnType<typeof db.class.findFirst>>);

      const delActiveReq = new Request(`http://localhost/api/classes/${activeClassId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: '2a Sek (Aktiv)' }),
      });
      const delActiveRes = await deleteClass(delActiveReq, {
        params: Promise.resolve({ id: activeClassId }),
      });

      expect(delActiveRes.status).toBe(400);
      const errJson = await delActiveRes.json();
      expect(errJson.error).toContain('Aktive Klassen können nicht direkt gelöscht werden');
      expect(db.class.delete).not.toHaveBeenCalled();
    });

    it('lehnt das Löschen einer archivierten Klasse ab, wenn die Tipp-Bestätigung falsch ist, und führt es bei exakter Bestätigung mit Abschlussmeldung aus', async () => {
      await archiveClass(archivedClassId);
      const mockArchivedWithCounts = {
        id: archivedClassId,
        name: '3b Sek (Schuljahr 2025/26)',
        teacherId: mockTeacherId,
        _count: { students: 3, exams: 5 },
        exams: [{ _count: { submissions: 20 } }, { _count: { submissions: 21 } }],
      };

      // 1. Falsche Tipp-Bestätigung -> HTTP 400
      vi.mocked(db.class.findFirst).mockResolvedValueOnce(
        mockArchivedWithCounts as unknown as Awaited<ReturnType<typeof db.class.findFirst>>
      );
      const wrongReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: 'Falscher Name' }),
      });
      const wrongRes = await deleteClass(wrongReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(wrongRes.status).toBe(400);
      const wrongData = await wrongRes.json();
      expect(wrongData.error).toContain('Zur Bestätigung muss der exakte Klassenname');
      expect(db.class.delete).not.toHaveBeenCalled();

      // 2. Exakte Tipp-Bestätigung -> HTTP 200 + klare Abschlussmeldung + Bestandszahlen
      vi.mocked(db.class.findFirst).mockResolvedValueOnce(
        mockArchivedWithCounts as unknown as Awaited<ReturnType<typeof db.class.findFirst>>
      );
      vi.mocked(db.class.delete).mockResolvedValueOnce(
        mockArchivedWithCounts as unknown as Awaited<ReturnType<typeof db.class.delete>>
      );

      const validReq = new Request(`http://localhost/api/classes/${archivedClassId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: '3b Sek (Schuljahr 2025/26)' }),
      });
      const validRes = await deleteClass(validReq, {
        params: Promise.resolve({ id: archivedClassId }),
      });
      expect(validRes.status).toBe(200);
      const validData = await validRes.json();
      expect(validData.success).toBe(true);
      expect(validData.deletedImpact).toEqual({
        studentsCount: 3,
        examsCount: 5,
        submissionsCount: 41,
        summaryText: '3 Schüler/innen, 5 Prüfungen, 41 Korrekturen inkl. aller gespeicherten Scans',
      });
      expect(validData.message).toBe(
        formatClassDeletedCompletionMessage('3b Sek (Schuljahr 2025/26)', {
          studentsCount: 3,
          examsCount: 5,
          submissionsCount: 41,
        })
      );
      expect(db.class.delete).toHaveBeenCalledWith({ where: { id: archivedClassId } });
    });

    it('enthaelt kein Eszett in den geaenderten Dateien', () => {
      const filesToCheck = [
        '../../lib/class-archive.ts',
        '../../lib/grading.ts',
        '../../app/api/classes/route.ts',
        '../../app/api/classes/[id]/route.ts',
        '../../app/classes/page.tsx',
        '../../app/classes/[id]/page.tsx',
      ];
      for (const rel of filesToCheck) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthält Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
