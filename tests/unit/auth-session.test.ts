import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GET as meGet } from '@/app/api/auth/me/route';
import { GET as examsGet } from '@/app/api/exams/route';
import { GET as classesGet } from '@/app/api/classes/route';
import { GET as subjectsGet } from '@/app/api/subjects/route';
import { GET as submissionsGet } from '@/app/api/submissions/route';
import { GET as providersGet } from '@/app/api/auth/oauth/providers/route';
import { IS_PUBLIC_CATALOG_ENDPOINT } from '@/lib/oauth';
import * as sessionModule from '@/lib/session';
import * as classArchiveModule from '@/lib/class-archive';
import * as teacherSubjectsModule from '@/lib/teacher-subjects';
import * as cacheModule from '@/lib/cache';
import { db } from '@/lib/db';
import {
  getCachedTeacher,
  setCachedTeacher,
  clearSessionCache,
  getHasCheckedAuth,
} from '@/lib/sessionCache';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  serverCache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    invalidateTags: vi.fn(),
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
  invalidateClassCache: vi.fn(),
  invalidateExamCache: vi.fn(),
}));

vi.mock('@/lib/class-archive', () => ({
  getArchivedClassIds: vi.fn(),
  getClassArchivedAt: vi.fn(),
  isClassArchived: vi.fn(),
  formatClassDeletionConsequences: vi.fn(),
}));

vi.mock('@/lib/teacher-subjects', () => ({
  getTeacherSavedSubjects: vi.fn(),
  saveTeacherSubjects: vi.fn(),
  getMultipleClassesSavedSubjects: vi.fn(),
  saveClassSubjects: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    teacher: {
      findUnique: vi.fn(),
    },
    exam: {
      findMany: vi.fn(),
    },
    class: {
      findMany: vi.fn(),
    },
    submission: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    student: {
      findMany: vi.fn(),
    },
  },
}));

describe('Auth Session & /api/auth/me Reliability', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSessionCache();
    vi.mocked(cacheModule.serverCache.get).mockResolvedValue(null);
    vi.mocked(cacheModule.serverCache.set).mockResolvedValue(undefined);
    vi.mocked(classArchiveModule.getArchivedClassIds).mockResolvedValue(new Set<string>());
    vi.mocked(classArchiveModule.getClassArchivedAt).mockResolvedValue(null);
    vi.mocked(classArchiveModule.isClassArchived).mockResolvedValue(false);
    vi.mocked(classArchiveModule.formatClassDeletionConsequences).mockReturnValue('');
    vi.mocked(teacherSubjectsModule.getTeacherSavedSubjects).mockResolvedValue([
      'Mathematik',
      'Deutsch',
    ]);
    vi.mocked(teacherSubjectsModule.getMultipleClassesSavedSubjects).mockResolvedValue({});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('GET /api/auth/me', () => {
    it('returns 401 when no session is present without deleting cookies', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue(null);

      const res = await meGet(new Request('http://localhost/api/auth/me'));
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.authenticated).toBe(false);

      // Crucial: Must NOT send a Set-Cookie header deleting the cookie,
      // avoiding race conditions with concurrent login/register POST requests
      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeNull();
    });

    it('returns 401 when teacher is not found in database without deleting cookies', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-deleted' });
      vi.mocked(db.teacher.findUnique).mockResolvedValue(null);

      const res = await meGet(new Request('http://localhost/api/auth/me'));
      expect(res.status).toBe(401);

      const json = await res.json();
      expect(json.authenticated).toBe(false);
      expect(json.error).toBe('Benutzer existiert nicht mehr.');

      const setCookie = res.headers.get('set-cookie');
      expect(setCookie).toBeNull();
    });

    it('returns 200 with teacher data when session is valid and teacher exists', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-1' });
      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 'teacher-1',
        name: 'Frau Meier',
        email: 'meier@schule.ch',
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);

      const res = await meGet(new Request('http://localhost/api/auth/me'));
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.authenticated).toBe(true);
      expect(json.teacher).toEqual({
        id: 'teacher-1',
        name: 'Frau Meier',
        email: 'meier@schule.ch',
      });
    });

    it('returns 500 with error message on unexpected database errors', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-err' });
      vi.mocked(db.teacher.findUnique).mockRejectedValue(new Error('DB disconnect'));

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const res = await meGet(new Request('http://localhost/api/auth/me'));
      expect(res.status).toBe(500);

      const json = await res.json();
      expect(json.authenticated).toBe(false);
      expect(json.error).toBe('Interner Serverfehler.');
      consoleSpy.mockRestore();
    });
  });

  describe('Mandantengebundene API-Endpunkte Fail-Closed ohne Session (Issue #101)', () => {
    it('GET /api/exams antwortet ohne Session mit 401 statt 200 {"exams":[]}', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue(null);

      const res = await examsGet(new Request('http://localhost/api/exams'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('Nicht autorisiert.');
      expect(body.exams).toBeUndefined();
      expect(db.exam.findMany).not.toHaveBeenCalled();
    });

    it('GET /api/classes antwortet ohne Session mit 401 statt 200 {"classes":[]}', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue(null);

      const res = await classesGet(new Request('http://localhost/api/classes'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('Nicht autorisiert.');
      expect(body.classes).toBeUndefined();
      expect(db.class.findMany).not.toHaveBeenCalled();
    });

    it('GET /api/subjects antwortet ohne Session mit 401 statt 200 mit Katalogdaten', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue(null);

      const res = await subjectsGet(new Request('http://localhost/api/subjects'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('Nicht autorisiert.');
      expect(body.mySubjects).toBeUndefined();
      expect(db.exam.findMany).not.toHaveBeenCalled();
    });

    it('GET /api/submissions antwortet ohne Session mit 401 statt 200 mit leerer Struktur und Pagination', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue(null);

      const res = await submissionsGet(new Request('http://localhost/api/submissions'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.authenticated).toBe(false);
      expect(body.error).toBe('Nicht autorisiert.');
      expect(body.submissions).toBeUndefined();
      expect(body.pagination).toBeUndefined();
      expect(db.submission.findMany).not.toHaveBeenCalled();
    });

    it('antwortet auf /api/exams, /api/classes, /api/subjects und /api/submissions auch bei nicht mehr existierendem Lehrer-Konto einheitlich mit 401', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-deleted-ghost' });
      vi.mocked(db.teacher.findUnique).mockResolvedValue(null);

      const [resExams, resClasses, resSubjects, resSubmissions] = await Promise.all([
        examsGet(new Request('http://localhost/api/exams')),
        classesGet(new Request('http://localhost/api/classes')),
        subjectsGet(new Request('http://localhost/api/subjects')),
        submissionsGet(new Request('http://localhost/api/submissions')),
      ]);

      for (const res of [resExams, resClasses, resSubjects, resSubmissions]) {
        expect(res.status).toBe(401);
        const body = await res.json();
        expect(body.authenticated).toBe(false);
        expect(body.error).toBe('Nicht autorisiert.');
      }
    });

    it('liefert mit gueltiger Session unveraendert 200 und ausschliesslich eigene Mandantendaten', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-valid-101' });
      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 'teacher-valid-101',
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);

      vi.mocked(db.exam.findMany).mockResolvedValue([
        {
          id: 'exam-101',
          title: 'Bruchrechnen',
          subject: 'Mathematik',
          maxPoints: 20,
          rubricText: 'Muster',
          examTemplateText: null,
          gradingNotes: null,
          gradingFormula: 'LINEAR_60',
          gradeRounding: '0.1',
          classId: 'class-101',
          class: { id: 'class-101', name: 'Sek 2a', teacherId: 'teacher-valid-101' },
          createdAt: new Date('2026-05-01T10:00:00.000Z'),
          tasks: [],
          submissions: [],
          _count: { submissions: 0 },
        },
      ] as unknown as Awaited<ReturnType<typeof db.exam.findMany>>);

      vi.mocked(db.class.findMany).mockResolvedValue([
        {
          id: 'class-101',
          name: 'Sek 2a',
          teacherId: 'teacher-valid-101',
          createdAt: new Date('2026-05-01T10:00:00.000Z'),
          _count: { students: 12, exams: 1 },
          exams: [],
        },
      ] as unknown as Awaited<ReturnType<typeof db.class.findMany>>);

      vi.mocked(db.submission.count).mockResolvedValue(1);
      vi.mocked(db.submission.findMany).mockResolvedValue([
        {
          id: 'sub-101',
          studentId: 'student-101',
          targetStudentId: 'student-101',
          extractedStudentName: 'Lena Muster',
          suggestedStudentId: null,
          isStudentMatchUncertain: false,
          isExamMatchUncertain: false,
          examId: 'exam-101',
          earnedPoints: 18,
          gradeRaw: 5.5,
          gradeRounded: '5.5',
          status: 'COMPLETED',
          createdAt: new Date('2026-05-01T10:00:00.000Z'),
          errorMessage: null,
          student: { id: 'student-101', name: 'Lena Muster', classId: 'class-101' },
          exam: {
            id: 'exam-101',
            title: 'Bruchrechnen',
            subject: 'Mathematik',
            maxPoints: 20,
            classId: 'class-101',
            class: { id: 'class-101', name: 'Sek 2a', teacherId: 'teacher-valid-101' },
          },
          tasks: [],
        },
      ] as unknown as Awaited<ReturnType<typeof db.submission.findMany>>);
      vi.mocked(db.student.findMany).mockResolvedValue([
        { id: 'student-101', name: 'Lena Muster', classId: 'class-101' },
      ] as unknown as Awaited<ReturnType<typeof db.student.findMany>>);

      const resExams = await examsGet(new Request('http://localhost/api/exams'));
      expect(resExams.status).toBe(200);
      const examsBody = await resExams.json();
      expect(examsBody.exams).toHaveLength(1);
      expect(examsBody.exams[0].id).toBe('exam-101');
      expect(db.exam.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { class: { teacherId: 'teacher-valid-101' } },
        })
      );

      const resClasses = await classesGet(new Request('http://localhost/api/classes'));
      expect(resClasses.status).toBe(200);
      const classesBody = await resClasses.json();
      expect(classesBody.classes).toHaveLength(1);
      expect(classesBody.classes[0].teacherId).toBe('teacher-valid-101');
      expect(db.class.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { teacherId: 'teacher-valid-101' },
        })
      );

      const resSubjects = await subjectsGet(new Request('http://localhost/api/subjects'));
      expect(resSubjects.status).toBe(200);
      const subjectsBody = await resSubjects.json();
      expect(subjectsBody.savedSubjects).toEqual(['Mathematik', 'Deutsch']);

      const resSubmissions = await submissionsGet(new Request('http://localhost/api/submissions'));
      expect(resSubmissions.status).toBe(200);
      const submissionsBody = await resSubmissions.json();
      expect(submissionsBody.submissions).toHaveLength(1);
      expect(submissionsBody.submissions[0].id).toBe('sub-101');
      expect(db.submission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            exam: expect.objectContaining({
              class: { teacherId: 'teacher-valid-101' },
            }),
          }),
        })
      );
    });

    it('kennzeichnet bewusst oeffentliche Konfigurations-/Katalogdaten explizit als oeffentlich', async () => {
      expect(IS_PUBLIC_CATALOG_ENDPOINT).toBe(true);
      const res = await providersGet();
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.publicEndpoint).toBe(true);
    });
  });

  describe('Session Cache (lib/sessionCache.ts)', () => {
    it('handles cache correctly in environment', () => {
      // In Node environment without window, helpers guard gracefully
      expect(getCachedTeacher()).toBeNull();
      expect(getHasCheckedAuth()).toBe(false);

      // Simulate browser window environment
      const fakeWindow = {} as unknown as Window & typeof globalThis;
      const originalWindow = global.window;
      global.window = fakeWindow;

      try {
        expect(getCachedTeacher()).toBeNull();
        expect(getHasCheckedAuth()).toBe(false);

        const sampleTeacher = {
          id: 't-123',
          name: 'Herr Schweizer',
          email: 'schweizer@schule.ch',
        };

        setCachedTeacher(sampleTeacher);
        expect(getCachedTeacher()).toEqual(sampleTeacher);
        expect(getHasCheckedAuth()).toBe(true);

        clearSessionCache();
        expect(getCachedTeacher()).toBeNull();
        expect(getHasCheckedAuth()).toBe(false);
      } finally {
        global.window = originalWindow;
      }
    });
  });

  describe('Schweizer Rechtschreibung (kein Eszett)', () => {
    it('enthaelt kein Eszett in allen veraenderten Dateien', () => {
      const filesToCheck = [
        '../../app/api/auth/me/route.ts',
        '../../app/api/exams/route.ts',
        '../../app/api/classes/route.ts',
        '../../app/api/subjects/route.ts',
        '../../app/api/submissions/route.ts',
        '../../app/login/page.tsx',
        '../../app/register/page.tsx',
        '../../components/DashboardLayout.tsx',
        '../../proxy.ts',
      ];

      for (const rel of filesToCheck) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
