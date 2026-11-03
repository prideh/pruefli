import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { cookieStoreState } = vi.hoisted(() => ({
  cookieStoreState: {
    inRequestScope: true,
    sessionToken: undefined as string | undefined,
  },
}));

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => {
    if (!cookieStoreState.inRequestScope) {
      throw new Error('cookies() called outside Next.js request context');
    }
    return {
      get: (name: string) =>
        name === 'grade_ai_session' && cookieStoreState.sessionToken !== undefined
          ? { name, value: cookieStoreState.sessionToken }
          : undefined,
      set: vi.fn((name: string, value: string) => {
        if (name === 'grade_ai_session') {
          cookieStoreState.sessionToken = value;
        }
      }),
      delete: vi.fn((name: string) => {
        if (name === 'grade_ai_session') {
          cookieStoreState.sessionToken = undefined;
        }
      }),
    };
  }),
}));

vi.mock('@/lib/class-archive', () => ({
  getArchivedClassIds: vi.fn().mockResolvedValue(new Set<string>()),
  getClassArchivedAt: vi.fn().mockResolvedValue(null),
  isClassArchived: vi.fn().mockResolvedValue(false),
  archiveClass: vi.fn().mockResolvedValue(new Date('2026-05-01T10:00:00.000Z')),
  unarchiveClass: vi.fn().mockResolvedValue(undefined),
  deleteClassArchive: vi.fn().mockResolvedValue(undefined),
  formatClassDeletionConsequences: vi.fn().mockReturnValue('Zusammenfassung'),
  formatClassDeletedCompletionMessage: vi.fn().mockReturnValue('Geloescht'),
  isClassDeleteConfirmationValid: vi.fn().mockReturnValue(true),
}));

vi.mock('@/lib/teacher-subjects', () => ({
  getTeacherSavedSubjects: vi.fn().mockResolvedValue(['Mathematik']),
  saveTeacherSubjects: vi.fn().mockResolvedValue(['Mathematik']),
  getMultipleClassesSavedSubjects: vi.fn().mockResolvedValue({}),
  getClassSavedSubjects: vi.fn().mockResolvedValue(['Mathematik']),
  saveClassSubjects: vi.fn().mockResolvedValue(['Mathematik']),
  deleteClassSubjects: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@/lib/document-validation', () => ({
  validateReferenceUpload: vi.fn().mockResolvedValue({ valid: true }),
  validateExamMaterialInput: vi.fn().mockResolvedValue({ valid: true }),
  validateStudentExamUpload: vi.fn().mockResolvedValue({ valid: true }),
  validateDocument: vi.fn().mockResolvedValue({ valid: true }),
}));

vi.mock('@/lib/storage-cleanup', () => ({
  deleteExamScanFiles: vi.fn().mockResolvedValue(undefined),
  deleteClassScanFiles: vi.fn().mockResolvedValue(undefined),
  deleteStudentScanFiles: vi.fn().mockResolvedValue(undefined),
  deleteSubmissionScanFiles: vi.fn().mockResolvedValue(undefined),
  StorageCleanupError: class StorageCleanupError extends Error {
    failedFiles: string[] = [];
  },
}));

vi.mock('@/lib/storage', () => ({
  normalizeStorageKey: (key: string) => key.replace(/^\/+/, ''),
  getStorageAdapter: () => ({
    read: vi.fn().mockResolvedValue({
      buffer: Buffer.from('%PDF-1.4 sample'),
      contentType: 'application/pdf',
    }),
    exists: vi.fn().mockResolvedValue(true),
    write: vi.fn().mockResolvedValue(undefined),
    delete: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock('@/lib/db', () => ({
  db: {
    $transaction: vi.fn(),
    teacher: {
      findUnique: vi.fn(),
    },
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
    examTask: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    submission: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    taskCorrection: {
      findFirst: vi.fn(),
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    stepCorrection: {
      create: vi.fn(),
      createMany: vi.fn(),
      updateMany: vi.fn(),
    },
    correctionLog: {
      count: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      aggregate: vi.fn(),
    },
  },
}));

import { db } from '@/lib/db';
import { serverCache } from '@/lib/cache';
import * as classArchiveModule from '@/lib/class-archive';
import {
  createSession,
  createSessionRecord,
  verifySessionToken,
  revokeSessionById,
  revokeAllTeacherSessions,
  resetSessionStoreForTests,
} from '@/lib/session';
import {
  signJWT,
  signMobileRelayToken,
  signEmailVerificationToken,
  signPasswordResetToken,
  signOAuthStateToken,
  signOAuthPendingLinkToken,
  signOAuthConfirmLinkEmailToken,
} from '@/lib/jwt';
import { resetVerificationMemoryState } from '@/lib/email-verification';
import { proxy } from '@/proxy';

// Route Handlers across all protected domains
import { GET as meGet } from '@/app/api/auth/me/route';
import {
  GET as oauthIdentitiesGet,
  DELETE as oauthIdentitiesDelete,
} from '@/app/api/auth/oauth/identities/route';
import { GET as classesGet, POST as classesPost } from '@/app/api/classes/route';
import {
  GET as classDetailGet,
  PUT as classDetailPut,
  PATCH as classDetailPatch,
  DELETE as classDetailDelete,
} from '@/app/api/classes/[id]/route';
import { GET as classExamsGet } from '@/app/api/classes/[id]/exams/route';
import {
  GET as classStudentsGet,
  POST as classStudentsPost,
} from '@/app/api/classes/[id]/students/route';
import {
  GET as studentDetailGet,
  PUT as studentDetailPut,
  DELETE as studentDetailDelete,
} from '@/app/api/students/[id]/route';
import { GET as examsGet, POST as examsPost } from '@/app/api/exams/route';
import {
  GET as examDetailGet,
  PUT as examDetailPut,
  DELETE as examDetailDelete,
} from '@/app/api/exams/[id]/route';
import { POST as examApprovePost } from '@/app/api/exams/[id]/approve/route';
import { POST as examDuplicatePost } from '@/app/api/exams/[id]/duplicate/route';
import { GET as examFeedbackSheetsGet } from '@/app/api/exams/[id]/feedback-sheets/route';
import { POST as examRegenerateTaskPost } from '@/app/api/exams/[id]/regenerate-task/route';
import { GET as examTaskAnalysisGet } from '@/app/api/exams/[id]/task-analysis/route';
import { POST as examGeneratePost } from '@/app/api/exams/generate/route';
import { POST as examParseRubricPost } from '@/app/api/exams/parse-rubric/route';
import { GET as submissionsGet } from '@/app/api/submissions/route';
import {
  GET as submissionDetailGet,
  POST as submissionDetailPost,
  PATCH as submissionDetailPatch,
  DELETE as submissionDetailDelete,
} from '@/app/api/submissions/[id]/route';
import { POST as submissionAddTaskPost } from '@/app/api/submissions/[id]/add-task/route';
import { POST as submissionReplacePost } from '@/app/api/submissions/[id]/replace/route';
import { POST as correctPost } from '@/app/api/correct/route';
import { GET as subjectsGet, PUT as subjectsPut } from '@/app/api/subjects/route';
import { GET as logsGet } from '@/app/api/logs/route';
import { GET as geminiHealthGet } from '@/app/api/health/gemini/route';
import { GET as mobileRelayGet, POST as mobileRelayPost } from '@/app/api/mobile-relay/route';
import { POST as mobileRelayUploadPost } from '@/app/api/mobile-relay/upload/route';
import { GET as uploadsGet, HEAD as uploadsHead } from '@/app/uploads/[...file]/route';

interface TenantFixture {
  teachers: Record<string, { id: string; name: string; email: string; createdAt: Date }>;
  classes: Record<string, { id: string; name: string; teacherId: string; createdAt: Date }>;
  students: Record<string, { id: string; name: string; classId: string; createdAt: Date }>;
  exams: Record<
    string,
    {
      id: string;
      title: string;
      subject: string;
      maxPoints: number;
      rubricText: string;
      examTemplateText: string | null;
      gradingNotes: string | null;
      gradingFormula: string;
      gradeRounding: string;
      classId: string;
      createdAt: Date;
    }
  >;
  submissions: Record<
    string,
    {
      id: string;
      examId: string;
      studentId: string;
      targetStudentId: string | null;
      suggestedStudentId: string | null;
      extractedStudentName: string;
      isStudentMatchUncertain: boolean;
      isExamMatchUncertain: boolean;
      status: string;
      earnedPoints: number;
      gradeRaw: number;
      gradeRounded: string;
      studentExamUrl: string;
      strengths: string[];
      weaknesses: string[];
      helpfulTip: string;
      exerciseRecommendation: string;
      errorMessage: string | null;
      createdAt: Date;
    }
  >;
}

function createTenantFixture(): TenantFixture {
  const createdAt = new Date('2026-01-15T08:00:00.000Z');
  return {
    teachers: {
      'teacher-a': {
        id: 'teacher-a',
        name: 'Anna Meier (Konto A)',
        email: 'anna.meier@schule-a.ch',
        createdAt,
      },
      'teacher-b': {
        id: 'teacher-b',
        name: 'Beatrice Keller (Konto B)',
        email: 'beatrice.keller@schule-b.ch',
        createdAt,
      },
    },
    classes: {
      'class-a': {
        id: 'class-a',
        name: 'Sek 2a (Konto A)',
        teacherId: 'teacher-a',
        createdAt,
      },
      'class-b': {
        id: 'class-b',
        name: 'Gym 3b (Konto B)',
        teacherId: 'teacher-b',
        createdAt,
      },
    },
    students: {
      'student-a': {
        id: 'student-a',
        name: 'Lukas Muster (Konto A)',
        classId: 'class-a',
        createdAt,
      },
      'student-b': {
        id: 'student-b',
        name: 'Noah Geheim (Konto B)',
        classId: 'class-b',
        createdAt,
      },
    },
    exams: {
      'exam-a': {
        id: 'exam-a',
        title: 'Algebra Pruefung A',
        subject: 'Mathematik',
        maxPoints: 20,
        rubricText: 'Musterloesung Konto A',
        examTemplateText: 'Vorlage Konto A',
        gradingNotes: null,
        gradingFormula: 'LINEAR_60',
        gradeRounding: '0.1',
        classId: 'class-a',
        createdAt,
      },
      'exam-b': {
        id: 'exam-b',
        title: 'Geheime Physik Pruefung B',
        subject: 'Physik',
        maxPoints: 20,
        rubricText: 'Vertrauliche Musterloesung Konto B',
        examTemplateText: 'Vertrauliche Vorlage Konto B',
        gradingNotes: null,
        gradingFormula: 'LINEAR_60',
        gradeRounding: '0.1',
        classId: 'class-b',
        createdAt,
      },
    },
    submissions: {
      'sub-a': {
        id: 'sub-a',
        examId: 'exam-a',
        studentId: 'student-a',
        targetStudentId: null,
        suggestedStudentId: 'student-a',
        extractedStudentName: 'Lukas Muster (Konto A)',
        isStudentMatchUncertain: false,
        isExamMatchUncertain: false,
        status: 'COMPLETED',
        earnedPoints: 18,
        gradeRaw: 5.5,
        gradeRounded: '5.5',
        studentExamUrl: 'scans/teacher-a/scan-a.pdf',
        strengths: ['Gute Gleichungsumformung'],
        weaknesses: [],
        helpfulTip: 'Weiter so',
        exerciseRecommendation: 'Kapitel 2',
        errorMessage: null,
        createdAt,
      },
      'sub-b': {
        id: 'sub-b',
        examId: 'exam-b',
        studentId: 'student-b',
        targetStudentId: null,
        suggestedStudentId: 'student-b',
        extractedStudentName: 'Noah Geheim (Konto B)',
        isStudentMatchUncertain: false,
        isExamMatchUncertain: false,
        status: 'COMPLETED',
        earnedPoints: 19,
        gradeRaw: 5.8,
        gradeRounded: '5.8',
        studentExamUrl: 'scans/teacher-b/scan-b.pdf',
        strengths: ['Vertrauliches Feedback Konto B'],
        weaknesses: [],
        helpfulTip: 'Geheimer Tipp B',
        exerciseRecommendation: 'Kapitel 9',
        errorMessage: null,
        createdAt,
      },
    },
  };
}

function wireDbMocks(fixture: TenantFixture) {
  vi.mocked(db.$transaction).mockImplementation((async (cb: (tx: typeof db) => Promise<unknown>) =>
    cb(db)) as unknown as typeof db.$transaction);

  vi.mocked(db.teacher.findUnique).mockImplementation((async (args: {
    where?: { id?: string };
  }) => {
    const id = args?.where?.id;
    return id && fixture.teachers[id] ? fixture.teachers[id] : null;
  }) as unknown as typeof db.teacher.findUnique);

  vi.mocked(db.class.findMany).mockImplementation((async (args?: {
    where?: { teacherId?: string };
  }) => {
    const teacherId = args?.where?.teacherId;
    return Object.values(fixture.classes)
      .filter((c) => !teacherId || c.teacherId === teacherId)
      .map((c) => ({
        ...c,
        _count: { students: 1, exams: 1 },
        exams: [],
      }));
  }) as unknown as typeof db.class.findMany);

  vi.mocked(db.class.findFirst).mockImplementation((async (args?: {
    where?: { id?: string; teacherId?: string; name?: string };
  }) => {
    const { id, teacherId, name } = args?.where || {};
    const found = Object.values(fixture.classes).find(
      (c) =>
        (!id || c.id === id) &&
        (!teacherId || c.teacherId === teacherId) &&
        (!name || c.name === name)
    );
    if (!found) return null;
    return {
      ...found,
      students: Object.values(fixture.students)
        .filter((s) => s.classId === found.id)
        .map((s) => ({ ...s, submissions: [] })),
      exams: Object.values(fixture.exams)
        .filter((e) => e.classId === found.id)
        .map((e) => ({ ...e, _count: { submissions: 1 }, submissions: [] })),
      _count: { students: 1, exams: 1 },
    };
  }) as unknown as typeof db.class.findFirst);

  vi.mocked(db.exam.findMany).mockImplementation((async (args?: {
    where?: { classId?: string; class?: { teacherId?: string } };
  }) => {
    const classId = args?.where?.classId;
    const teacherId = args?.where?.class?.teacherId;
    return Object.values(fixture.exams)
      .filter((e) => {
        const cls = fixture.classes[e.classId];
        if (classId && e.classId !== classId) return false;
        if (teacherId && cls?.teacherId !== teacherId) return false;
        return true;
      })
      .map((e) => ({
        ...e,
        class: fixture.classes[e.classId],
        tasks: [{ taskId: '1', title: 'Aufgabe 1', maxPoints: 10, orderIndex: 0 }],
        submissions: [],
        _count: { submissions: 1 },
      }));
  }) as unknown as typeof db.exam.findMany);

  vi.mocked(db.exam.findFirst).mockImplementation((async (args?: {
    where?: { id?: string; class?: { teacherId?: string } };
  }) => {
    const id = args?.where?.id;
    const teacherId = args?.where?.class?.teacherId;
    const exam = id ? fixture.exams[id] : undefined;
    if (!exam) return null;
    const cls = fixture.classes[exam.classId];
    if (teacherId && cls?.teacherId !== teacherId) return null;
    return {
      ...exam,
      class: cls,
      tasks: [{ taskId: '1', title: 'Aufgabe 1', maxPoints: 10, orderIndex: 0 }],
    };
  }) as unknown as typeof db.exam.findFirst);

  vi.mocked(db.exam.findUnique).mockImplementation((async (args?: { where?: { id?: string } }) => {
    const id = args?.where?.id;
    const exam = id ? fixture.exams[id] : undefined;
    if (!exam) return null;
    const cls = fixture.classes[exam.classId];
    return {
      ...exam,
      class: {
        ...cls,
        students: Object.values(fixture.students).filter((s) => s.classId === cls.id),
      },
      tasks: [{ taskId: '1', title: 'Aufgabe 1', maxPoints: 10, orderIndex: 0 }],
      submissions: Object.values(fixture.submissions)
        .filter((s) => s.examId === exam.id)
        .map((s) => ({
          ...s,
          student: fixture.students[s.studentId],
          tasks: [],
        })),
    };
  }) as unknown as typeof db.exam.findUnique);

  vi.mocked(db.student.findMany).mockImplementation((async (args?: {
    where?: { classId?: string; class?: { teacherId?: string } };
  }) => {
    const classId = args?.where?.classId;
    const teacherId = args?.where?.class?.teacherId;
    return Object.values(fixture.students).filter((s) => {
      const cls = fixture.classes[s.classId];
      if (classId && s.classId !== classId) return false;
      if (teacherId && cls?.teacherId !== teacherId) return false;
      return true;
    });
  }) as unknown as typeof db.student.findMany);

  vi.mocked(db.student.findUnique).mockImplementation((async (args?: {
    where?: { id?: string };
  }) => {
    const id = args?.where?.id;
    const student = id ? fixture.students[id] : undefined;
    if (!student) return null;
    return {
      ...student,
      class: fixture.classes[student.classId],
      submissions: Object.values(fixture.submissions)
        .filter((sub) => sub.studentId === student.id)
        .map((sub) => ({
          ...sub,
          exam: fixture.exams[sub.examId],
        })),
    };
  }) as unknown as typeof db.student.findUnique);

  vi.mocked(db.submission.count).mockImplementation((async (args?: {
    where?: { exam?: { class?: { teacherId?: string } } };
  }) => {
    const teacherId = args?.where?.exam?.class?.teacherId;
    return Object.values(fixture.submissions).filter((sub) => {
      const exam = fixture.exams[sub.examId];
      const cls = exam ? fixture.classes[exam.classId] : undefined;
      return !teacherId || cls?.teacherId === teacherId;
    }).length;
  }) as unknown as typeof db.submission.count);

  vi.mocked(db.submission.findMany).mockImplementation((async (args?: {
    where?: { examId?: string; exam?: { class?: { teacherId?: string } } };
  }) => {
    const examId = args?.where?.examId;
    const teacherId = args?.where?.exam?.class?.teacherId;
    return Object.values(fixture.submissions)
      .filter((sub) => {
        const exam = fixture.exams[sub.examId];
        const cls = exam ? fixture.classes[exam.classId] : undefined;
        if (examId && sub.examId !== examId) return false;
        if (teacherId && cls?.teacherId !== teacherId) return false;
        return true;
      })
      .map((sub) => {
        const exam = fixture.exams[sub.examId];
        const cls = fixture.classes[exam.classId];
        return {
          ...sub,
          student: fixture.students[sub.studentId],
          exam: { ...exam, class: cls },
          tasks: [],
        };
      });
  }) as unknown as typeof db.submission.findMany);

  vi.mocked(db.submission.findFirst).mockImplementation((async (args?: {
    where?: {
      OR?: Array<{ studentExamUrl?: { contains?: string } }>;
      examId?: string;
      studentId?: string;
    };
  }) => {
    if (args?.where?.OR) {
      const needle = args.where.OR[0]?.studentExamUrl?.contains || '';
      const sub = Object.values(fixture.submissions).find((s) => s.studentExamUrl.includes(needle));
      if (!sub) return null;
      const exam = fixture.exams[sub.examId];
      return {
        ...sub,
        exam: {
          ...exam,
          class: fixture.classes[exam.classId],
        },
      };
    }
    return null;
  }) as unknown as typeof db.submission.findFirst);

  vi.mocked(db.submission.findUnique).mockImplementation((async (args?: {
    where?: { id?: string };
  }) => {
    const id = args?.where?.id;
    const sub = id ? fixture.submissions[id] : undefined;
    if (!sub) return null;
    const exam = fixture.exams[sub.examId];
    return {
      ...sub,
      student: fixture.students[sub.studentId],
      exam: {
        ...exam,
        class: fixture.classes[exam.classId],
      },
      tasks: [],
    };
  }) as unknown as typeof db.submission.findUnique);

  vi.mocked(db.correctionLog.count).mockResolvedValue(0);
  vi.mocked(db.correctionLog.findMany).mockResolvedValue([]);
  vi.mocked(db.correctionLog.findFirst).mockResolvedValue(null);
  vi.mocked(db.correctionLog.aggregate).mockResolvedValue({
    _avg: { durationMs: 0 },
  } as unknown as Awaited<ReturnType<typeof db.correctionLog.aggregate>>);
}

function buildCookieHeader(token?: string): HeadersInit {
  return token ? { cookie: `grade_ai_session=${token}` } : {};
}

async function runWithSessionToken<T>(token: string | undefined, fn: () => Promise<T>): Promise<T> {
  const prev = cookieStoreState.sessionToken;
  cookieStoreState.sessionToken = token;
  try {
    return await fn();
  } finally {
    cookieStoreState.sessionToken = prev;
  }
}

describe.each(['test', 'production'] as const)(
  'Auth-, Negativ- und Zwei-Konten-Isolations-Matrix (Issue #103, NODE_ENV=%s)',
  (nodeEnv) => {
    let fixture: TenantFixture;

    beforeEach(async () => {
      vi.clearAllMocks();
      vi.stubEnv('NODE_ENV', nodeEnv);
      vi.stubEnv('JWT_SECRET', 'matrix-test-jwt-secret-key-at-least-32-chars');
      resetSessionStoreForTests();
      resetVerificationMemoryState();
      await serverCache.clear();

      cookieStoreState.inRequestScope = true;
      cookieStoreState.sessionToken = undefined;

      fixture = createTenantFixture();
      wireDbMocks(fixture);

      vi.mocked(classArchiveModule.getArchivedClassIds).mockResolvedValue(new Set<string>());
      vi.mocked(classArchiveModule.getClassArchivedAt).mockResolvedValue(null);
      vi.mocked(classArchiveModule.isClassArchived).mockResolvedValue(false);
    });

    afterEach(() => {
      vi.unstubAllEnvs();
    });

    describe('1. Anonyme Matrix: Jeder geschuetzte Endpunkt liefert ohne Credentials strikt 401 (keine Daten)', () => {
      it('blockiert auf Edge-Proxy-Ebene (proxy.ts) saemtliche geschuetzten API-Endpunkte ohne Session-Cookie mit 401', async () => {
        const protectedCalls: Array<{ path: string; method: string }> = [
          { path: '/api/auth/me', method: 'GET' },
          { path: '/api/auth/oauth/identities', method: 'GET' },
          { path: '/api/auth/oauth/identities', method: 'DELETE' },
          { path: '/api/classes', method: 'GET' },
          { path: '/api/classes', method: 'POST' },
          { path: '/api/classes/class-b', method: 'GET' },
          { path: '/api/classes/class-b', method: 'PUT' },
          { path: '/api/classes/class-b', method: 'PATCH' },
          { path: '/api/classes/class-b', method: 'DELETE' },
          { path: '/api/classes/class-b/exams', method: 'GET' },
          { path: '/api/classes/class-b/students', method: 'GET' },
          { path: '/api/classes/class-b/students', method: 'POST' },
          { path: '/api/students/student-b', method: 'GET' },
          { path: '/api/students/student-b', method: 'PUT' },
          { path: '/api/students/student-b', method: 'DELETE' },
          { path: '/api/exams', method: 'GET' },
          { path: '/api/exams', method: 'POST' },
          { path: '/api/exams/exam-b', method: 'GET' },
          { path: '/api/exams/exam-b', method: 'PUT' },
          { path: '/api/exams/exam-b', method: 'DELETE' },
          { path: '/api/exams/exam-b/approve', method: 'POST' },
          { path: '/api/exams/exam-b/duplicate', method: 'POST' },
          { path: '/api/exams/exam-b/feedback-sheets', method: 'GET' },
          { path: '/api/exams/exam-b/regenerate-task', method: 'POST' },
          { path: '/api/exams/exam-b/task-analysis', method: 'GET' },
          { path: '/api/exams/generate', method: 'POST' },
          { path: '/api/exams/parse-rubric', method: 'POST' },
          { path: '/api/submissions', method: 'GET' },
          { path: '/api/submissions/sub-b', method: 'GET' },
          { path: '/api/submissions/sub-b', method: 'POST' },
          { path: '/api/submissions/sub-b', method: 'PATCH' },
          { path: '/api/submissions/sub-b', method: 'DELETE' },
          { path: '/api/submissions/sub-b/add-task', method: 'POST' },
          { path: '/api/submissions/sub-b/replace', method: 'POST' },
          { path: '/api/correct', method: 'POST' },
          { path: '/api/subjects', method: 'GET' },
          { path: '/api/subjects', method: 'PUT' },
          { path: '/api/logs', method: 'GET' },
          { path: '/api/health/gemini', method: 'GET' },
          { path: '/api/mobile-relay', method: 'POST' },
        ];

        for (const { path, method } of protectedCalls) {
          const req = new NextRequest(`http://localhost:3000${path}`, { method });
          const res = await proxy(req);
          expect(res.status, `Proxy muss ${method} ${path} ohne Auth mit 401 abweisen`).toBe(401);
          const body = await res.json();
          expect(body.authenticated).toBe(false);
        }
      });

      it('weist direkte Route-Handler-Aufrufe ohne Cookie ueber alle geschuetzten Endpunkte strikt mit 401 ab – selbst nach vorherigem Login im selben Prozess', async () => {
        // Vorheriger Login von Konto B im selben Prozess befuellt im Test-Modus das Fallback-Jar
        await createSession('teacher-b');
        // Fuer die nachfolgende anonyme Anfrage enthaelt der Request-Kontext jedoch kein Cookie
        cookieStoreState.sessionToken = undefined;

        const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
        const fileParams = (file: string[]) => ({ params: Promise.resolve({ file }) });

        const responses: Array<{ label: string; res: Response }> = [
          {
            label: 'GET /api/auth/me',
            res: await meGet(new Request('http://localhost/api/auth/me')),
          },
          {
            label: 'GET /api/auth/oauth/identities',
            res: await oauthIdentitiesGet(),
          },
          {
            label: 'DELETE /api/auth/oauth/identities',
            res: await oauthIdentitiesDelete(
              new Request('http://localhost/api/auth/oauth/identities', {
                method: 'DELETE',
                body: JSON.stringify({ provider: 'google' }),
              })
            ),
          },
          {
            label: 'GET /api/classes',
            res: await classesGet(new Request('http://localhost/api/classes')),
          },
          {
            label: 'POST /api/classes',
            res: await classesPost(
              new Request('http://localhost/api/classes', {
                method: 'POST',
                body: JSON.stringify({ name: 'Unbefugte Klasse' }),
              })
            ),
          },
          {
            label: 'GET /api/classes/[id]',
            res: await classDetailGet(
              new Request('http://localhost/api/classes/class-b'),
              idParams('class-b')
            ),
          },
          {
            label: 'PUT /api/classes/[id]',
            res: await classDetailPut(
              new Request('http://localhost/api/classes/class-b', {
                method: 'PUT',
                body: JSON.stringify({ name: 'Manipuliert' }),
              }),
              idParams('class-b')
            ),
          },
          {
            label: 'PATCH /api/classes/[id]',
            res: await classDetailPatch(
              new Request('http://localhost/api/classes/class-b', {
                method: 'PATCH',
                body: JSON.stringify({ archived: true }),
              }),
              idParams('class-b')
            ),
          },
          {
            label: 'DELETE /api/classes/[id]',
            res: await classDetailDelete(
              new Request('http://localhost/api/classes/class-b', { method: 'DELETE' }),
              idParams('class-b')
            ),
          },
          {
            label: 'GET /api/classes/[id]/exams',
            res: await classExamsGet(
              new Request('http://localhost/api/classes/class-b/exams'),
              idParams('class-b')
            ),
          },
          {
            label: 'GET /api/classes/[id]/students',
            res: await classStudentsGet(
              new Request('http://localhost/api/classes/class-b/students'),
              idParams('class-b')
            ),
          },
          {
            label: 'POST /api/classes/[id]/students',
            res: await classStudentsPost(
              new Request('http://localhost/api/classes/class-b/students', {
                method: 'POST',
                body: JSON.stringify({ name: 'Unbefugter Schueler' }),
              }),
              idParams('class-b')
            ),
          },
          {
            label: 'GET /api/students/[id]',
            res: await studentDetailGet(
              new Request('http://localhost/api/students/student-b'),
              idParams('student-b')
            ),
          },
          {
            label: 'PUT /api/students/[id]',
            res: await studentDetailPut(
              new Request('http://localhost/api/students/student-b', {
                method: 'PUT',
                body: JSON.stringify({ name: 'Manipuliert' }),
              }),
              idParams('student-b')
            ),
          },
          {
            label: 'DELETE /api/students/[id]',
            res: await studentDetailDelete(
              new Request('http://localhost/api/students/student-b', { method: 'DELETE' }),
              idParams('student-b')
            ),
          },
          {
            label: 'GET /api/exams',
            res: await examsGet(new Request('http://localhost/api/exams')),
          },
          {
            label: 'POST /api/exams',
            res: await examsPost(
              new Request('http://localhost/api/exams', {
                method: 'POST',
                body: JSON.stringify({
                  title: 'Test',
                  subject: 'Mathematik',
                  classId: 'class-b',
                  maxPoints: 10,
                }),
              })
            ),
          },
          {
            label: 'GET /api/exams/[id]',
            res: await examDetailGet(
              new Request('http://localhost/api/exams/exam-b'),
              idParams('exam-b')
            ),
          },
          {
            label: 'PUT /api/exams/[id]',
            res: await examDetailPut(
              new Request('http://localhost/api/exams/exam-b', {
                method: 'PUT',
                body: JSON.stringify({ title: 'Manipuliert' }),
              }),
              idParams('exam-b')
            ),
          },
          {
            label: 'DELETE /api/exams/[id]',
            res: await examDetailDelete(
              new Request('http://localhost/api/exams/exam-b', { method: 'DELETE' }),
              idParams('exam-b')
            ),
          },
          {
            label: 'POST /api/exams/[id]/approve',
            res: await examApprovePost(
              new Request('http://localhost/api/exams/exam-b/approve', { method: 'POST' }),
              idParams('exam-b')
            ),
          },
          {
            label: 'POST /api/exams/[id]/duplicate',
            res: await examDuplicatePost(
              new Request('http://localhost/api/exams/exam-b/duplicate', { method: 'POST' }),
              idParams('exam-b')
            ),
          },
          {
            label: 'GET /api/exams/[id]/feedback-sheets',
            res: await examFeedbackSheetsGet(
              new Request('http://localhost/api/exams/exam-b/feedback-sheets'),
              idParams('exam-b')
            ),
          },
          {
            label: 'POST /api/exams/[id]/regenerate-task',
            res: await examRegenerateTaskPost(
              new Request('http://localhost/api/exams/exam-b/regenerate-task', {
                method: 'POST',
                body: JSON.stringify({ taskId: '1' }),
              }),
              idParams('exam-b')
            ),
          },
          {
            label: 'GET /api/exams/[id]/task-analysis',
            res: await examTaskAnalysisGet(
              new Request('http://localhost/api/exams/exam-b/task-analysis'),
              idParams('exam-b')
            ),
          },
          {
            label: 'POST /api/exams/generate',
            res: await examGeneratePost(
              new Request('http://localhost/api/exams/generate', {
                method: 'POST',
                body: JSON.stringify({ material: 'Stoff', classId: 'class-b' }),
              })
            ),
          },
          {
            label: 'POST /api/exams/parse-rubric',
            res: await examParseRubricPost(
              new Request('http://localhost/api/exams/parse-rubric', {
                method: 'POST',
                body: JSON.stringify({ rubricText: 'Aufgabe 1 (4P)' }),
              })
            ),
          },
          {
            label: 'GET /api/submissions',
            res: await submissionsGet(new Request('http://localhost/api/submissions')),
          },
          {
            label: 'GET /api/submissions/[id]',
            res: await submissionDetailGet(
              new Request('http://localhost/api/submissions/sub-b'),
              idParams('sub-b')
            ),
          },
          {
            label: 'POST /api/submissions/[id]',
            res: await submissionDetailPost(
              new Request('http://localhost/api/submissions/sub-b', {
                method: 'POST',
                body: JSON.stringify({ aufgaben: [] }),
              }),
              idParams('sub-b')
            ),
          },
          {
            label: 'PATCH /api/submissions/[id]',
            res: await submissionDetailPatch(
              new Request('http://localhost/api/submissions/sub-b', {
                method: 'PATCH',
                body: JSON.stringify({ studentId: 'student-b' }),
              }),
              idParams('sub-b')
            ),
          },
          {
            label: 'DELETE /api/submissions/[id]',
            res: await submissionDetailDelete(
              new Request('http://localhost/api/submissions/sub-b', { method: 'DELETE' }),
              idParams('sub-b')
            ),
          },
          {
            label: 'POST /api/submissions/[id]/add-task',
            res: await submissionAddTaskPost(
              new Request('http://localhost/api/submissions/sub-b/add-task', {
                method: 'POST',
                body: JSON.stringify({ taskId: '2', title: 'Neu', maxPoints: 4 }),
              }),
              idParams('sub-b')
            ),
          },
          {
            label: 'POST /api/submissions/[id]/replace',
            res: await submissionReplacePost(
              new Request('http://localhost/api/submissions/sub-b/replace', { method: 'POST' }),
              idParams('sub-b')
            ),
          },
          {
            label: 'POST /api/correct',
            res: await correctPost(
              new Request('http://localhost/api/correct', {
                method: 'POST',
                body: new FormData(),
              })
            ),
          },
          {
            label: 'GET /api/subjects',
            res: await subjectsGet(new Request('http://localhost/api/subjects')),
          },
          {
            label: 'PUT /api/subjects',
            res: await subjectsPut(
              new Request('http://localhost/api/subjects', {
                method: 'PUT',
                body: JSON.stringify({ subjects: ['Mathematik'] }),
              })
            ),
          },
          {
            label: 'GET /api/logs',
            res: await logsGet(new Request('http://localhost/api/logs')),
          },
          {
            label: 'GET /api/health/gemini',
            res: await geminiHealthGet(new Request('http://localhost/api/health/gemini')),
          },
          {
            label: 'POST /api/mobile-relay',
            res: await mobileRelayPost(
              new Request('http://localhost/api/mobile-relay', {
                method: 'POST',
                body: JSON.stringify({ targetMode: 'SUBMISSION' }),
              })
            ),
          },
          {
            label: 'GET /api/mobile-relay (ohne Token)',
            res: await mobileRelayGet(new Request('http://localhost/api/mobile-relay')),
          },
          {
            label: 'POST /api/mobile-relay/upload (ohne Token)',
            res: await mobileRelayUploadPost(
              new Request('http://localhost/api/mobile-relay/upload', {
                method: 'POST',
                body: new FormData(),
              })
            ),
          },
          {
            label: 'GET /uploads/[...file]',
            res: await uploadsGet(
              new Request('http://localhost/uploads/scans/teacher-b/scan-b.pdf'),
              fileParams(['scans', 'teacher-b', 'scan-b.pdf'])
            ),
          },
          {
            label: 'HEAD /uploads/[...file]',
            res: await uploadsHead(
              new Request('http://localhost/uploads/scans/teacher-b/scan-b.pdf', {
                method: 'HEAD',
              }),
              fileParams(['scans', 'teacher-b', 'scan-b.pdf'])
            ),
          },
        ];

        for (const { label, res } of responses) {
          expect(res.status, `Anonyme Anfrage an ${label} muss 401 liefern`).toBe(401);
        }
      });
    });

    describe('2. Zwei-Konten-Isolation: Konto A kann Daten von Konto B weder lesen noch veraendern', () => {
      it('isoliert Klassen (Listen-, Detail- und Schreib-Endpunkte) strikt zwischen Konto A und Konto B', async () => {
        const sessionA = await createSessionRecord('teacher-a');
        const idParamsB = { params: Promise.resolve({ id: 'class-b' }) };

        await runWithSessionToken(sessionA.token, async () => {
          // 1. Listen-Endpunkt: Konto A sieht ausschliesslich class-a, niemals class-b
          const listRes = await classesGet(
            new Request('http://localhost/api/classes', {
              headers: buildCookieHeader(sessionA.token),
            })
          );
          expect(listRes.status).toBe(200);
          const listJson = await listRes.json();
          expect(listJson.classes.map((c: { id: string }) => c.id)).toEqual(['class-a']);
          expect(JSON.stringify(listJson)).not.toContain('Gym 3b');
          expect(JSON.stringify(listJson)).not.toContain('class-b');

          // 2. Detail-Endpunkte fuer fremde Klasse (class-b) liefern 404 ohne Daten von Konto B
          const detailRes = await classDetailGet(
            new Request('http://localhost/api/classes/class-b', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsB
          );
          expect(detailRes.status).toBe(404);
          expect(JSON.stringify(await detailRes.json())).not.toContain('Gym 3b');

          const classExamsRes = await classExamsGet(
            new Request('http://localhost/api/classes/class-b/exams', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsB
          );
          expect(classExamsRes.status).toBe(404);

          const classStudentsRes = await classStudentsGet(
            new Request('http://localhost/api/classes/class-b/students', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsB
          );
          expect(classStudentsRes.status).toBe(404);

          // 3. Schreib-Endpunkte auf fremde Klasse (Umbenennen, Archivieren, Loeschen, Schueler einschreiben)
          const renameRes = await classDetailPut(
            new Request('http://localhost/api/classes/class-b', {
              method: 'PUT',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ name: 'Uebernommen von A' }),
            }),
            idParamsB
          );
          expect(renameRes.status).toBe(404);
          expect(db.class.update).not.toHaveBeenCalled();

          const archiveRes = await classDetailPatch(
            new Request('http://localhost/api/classes/class-b', {
              method: 'PATCH',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ archived: true }),
            }),
            idParamsB
          );
          expect(archiveRes.status).toBe(404);
          expect(classArchiveModule.archiveClass).not.toHaveBeenCalled();

          const deleteRes = await classDetailDelete(
            new Request('http://localhost/api/classes/class-b', {
              method: 'DELETE',
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsB
          );
          expect(deleteRes.status).toBe(404);
          expect(db.class.delete).not.toHaveBeenCalled();

          const addStudentRes = await classStudentsPost(
            new Request('http://localhost/api/classes/class-b/students', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ name: 'Eingeschleuster Schueler' }),
            }),
            idParamsB
          );
          expect(addStudentRes.status).toBe(404);
          expect(db.student.create).not.toHaveBeenCalled();
        });
      });

      it('isoliert Pruefungen (Listen-, Detail- und Schreib-Endpunkte inkl. Cross-Tenant-Duplizierung) strikt zwischen Konto A und Konto B', async () => {
        const sessionA = await createSessionRecord('teacher-a');
        const idParamsExamB = { params: Promise.resolve({ id: 'exam-b' }) };
        const idParamsExamA = { params: Promise.resolve({ id: 'exam-a' }) };

        await runWithSessionToken(sessionA.token, async () => {
          // 1. Listen-Endpunkt: Konto A sieht ausschliesslich exam-a, niemals exam-b
          const listRes = await examsGet(
            new Request('http://localhost/api/exams', {
              headers: buildCookieHeader(sessionA.token),
            })
          );
          expect(listRes.status).toBe(200);
          const listJson = await listRes.json();
          expect(listJson.exams.map((e: { id: string }) => e.id)).toEqual(['exam-a']);
          expect(JSON.stringify(listJson)).not.toContain('Geheime Physik Pruefung B');

          // 2. Detail-Endpunkte fuer exam-b (Details, Feedback-Bogen, Aufgabenanalyse) -> 403
          const detailRes = await examDetailGet(
            new Request('http://localhost/api/exams/exam-b', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsExamB
          );
          expect(detailRes.status).toBe(403);
          expect(JSON.stringify(await detailRes.json())).not.toContain(
            'Vertrauliche Musterloesung Konto B'
          );

          const sheetsRes = await examFeedbackSheetsGet(
            new Request('http://localhost/api/exams/exam-b/feedback-sheets', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsExamB
          );
          expect(sheetsRes.status).toBe(403);

          const analysisRes = await examTaskAnalysisGet(
            new Request('http://localhost/api/exams/exam-b/task-analysis', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsExamB
          );
          expect(analysisRes.status).toBe(403);

          // 3. Schreib-Endpunkte: Pruefung in fremder Klasse anlegen oder generieren -> 404
          const createInForeignClassRes = await examsPost(
            new Request('http://localhost/api/exams', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({
                title: 'Fremde Pruefung',
                subject: 'Mathematik',
                classId: 'class-b',
                maxPoints: 20,
              }),
            })
          );
          expect(createInForeignClassRes.status).toBe(404);
          expect(db.exam.create).not.toHaveBeenCalled();

          const generateInForeignClassRes = await examGeneratePost(
            new Request('http://localhost/api/exams/generate', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({
                material: 'Unterrichtsstoff fuer Gleichungen',
                classId: 'class-b',
                subject: 'Mathematik',
              }),
            })
          );
          expect(generateInForeignClassRes.status).toBe(404);
          expect(db.exam.create).not.toHaveBeenCalled();

          // 4. Fremde Pruefung bearbeiten, loeschen, freigeben, duplizieren oder Aufgabe neu generieren -> 403
          const updateForeignRes = await examDetailPut(
            new Request('http://localhost/api/exams/exam-b', {
              method: 'PUT',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ title: 'Manipulierter Titel', maxPoints: 10 }),
            }),
            idParamsExamB
          );
          expect(updateForeignRes.status).toBe(403);
          expect(db.exam.update).not.toHaveBeenCalled();

          const deleteForeignRes = await examDetailDelete(
            new Request('http://localhost/api/exams/exam-b', {
              method: 'DELETE',
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsExamB
          );
          expect(deleteForeignRes.status).toBe(403);
          expect(db.exam.delete).not.toHaveBeenCalled();

          const approveForeignRes = await examApprovePost(
            new Request('http://localhost/api/exams/exam-b/approve', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsExamB
          );
          expect(approveForeignRes.status).toBe(403);
          expect(db.exam.update).not.toHaveBeenCalled();

          const duplicateForeignRes = await examDuplicatePost(
            new Request('http://localhost/api/exams/exam-b/duplicate', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({}),
            }),
            idParamsExamB
          );
          expect(duplicateForeignRes.status).toBe(403);
          expect(db.exam.create).not.toHaveBeenCalled();

          // Cross-Tenant-Duplizierung: eigene Pruefung (exam-a) in fremde Zielklasse (class-b) duplizieren -> 404
          const duplicateIntoForeignClassRes = await examDuplicatePost(
            new Request('http://localhost/api/exams/exam-a/duplicate', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ targetClassId: 'class-b' }),
            }),
            idParamsExamA
          );
          expect(duplicateIntoForeignClassRes.status).toBe(404);
          expect(db.exam.create).not.toHaveBeenCalled();

          const regenForeignRes = await examRegenerateTaskPost(
            new Request('http://localhost/api/exams/exam-b/regenerate-task', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ taskId: '1' }),
            }),
            idParamsExamB
          );
          expect(regenForeignRes.status).toBe(403);
          expect(db.exam.update).not.toHaveBeenCalled();
        });
      });

      it('isoliert Schueler/innen (Detail- und Schreib-Endpunkte inkl. Klassenwechsel in fremde Klasse) strikt zwischen Konto A und Konto B', async () => {
        const sessionA = await createSessionRecord('teacher-a');
        const idParamsStudentB = { params: Promise.resolve({ id: 'student-b' }) };
        const idParamsStudentA = { params: Promise.resolve({ id: 'student-a' }) };

        await runWithSessionToken(sessionA.token, async () => {
          // 1. Detail-Abruf von student-b durch Konto A -> 403
          const getForeignStudentRes = await studentDetailGet(
            new Request('http://localhost/api/students/student-b', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsStudentB
          );
          expect(getForeignStudentRes.status).toBe(403);
          expect(JSON.stringify(await getForeignStudentRes.json())).not.toContain('Noah Geheim');

          // 2. Umbenennen von student-b durch Konto A -> 403
          const updateForeignStudentRes = await studentDetailPut(
            new Request('http://localhost/api/students/student-b', {
              method: 'PUT',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ name: 'Manipulierter Name' }),
            }),
            idParamsStudentB
          );
          expect(updateForeignStudentRes.status).toBe(403);
          expect(db.student.update).not.toHaveBeenCalled();

          // 3. Eigenen Schueler (student-a) in fremde Klasse (class-b) verschieben -> 404
          const transferToForeignClassRes = await studentDetailPut(
            new Request('http://localhost/api/students/student-a', {
              method: 'PUT',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ classId: 'class-b' }),
            }),
            idParamsStudentA
          );
          expect(transferToForeignClassRes.status).toBe(404);
          expect(db.student.update).not.toHaveBeenCalled();

          // 4. Loeschen von student-b durch Konto A -> 403
          const deleteForeignStudentRes = await studentDetailDelete(
            new Request('http://localhost/api/students/student-b', {
              method: 'DELETE',
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsStudentB
          );
          expect(deleteForeignStudentRes.status).toBe(403);
          expect(db.student.delete).not.toHaveBeenCalled();
        });
      });

      it('isoliert Einsendungen, Korrekturen und Scans (Listen-, Detail- und Schreib-Endpunkte) strikt zwischen Konto A und Konto B', async () => {
        const sessionA = await createSessionRecord('teacher-a');
        const idParamsSubB = { params: Promise.resolve({ id: 'sub-b' }) };
        const idParamsSubA = { params: Promise.resolve({ id: 'sub-a' }) };

        await runWithSessionToken(sessionA.token, async () => {
          // 1. Listen-Endpunkt: Konto A sieht ausschliesslich sub-a, niemals sub-b
          const listRes = await submissionsGet(
            new Request('http://localhost/api/submissions', {
              headers: buildCookieHeader(sessionA.token),
            })
          );
          expect(listRes.status).toBe(200);
          const listJson = await listRes.json();
          expect(listJson.submissions.map((s: { id: string }) => s.id)).toEqual(['sub-a']);
          expect(JSON.stringify(listJson)).not.toContain('Noah Geheim');
          expect(JSON.stringify(listJson)).not.toContain('sub-b');

          // 2. Detail-Endpunkt fuer fremde Korrektur (sub-b) -> 403
          const detailRes = await submissionDetailGet(
            new Request('http://localhost/api/submissions/sub-b', {
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsSubB
          );
          expect(detailRes.status).toBe(403);
          expect(JSON.stringify(await detailRes.json())).not.toContain(
            'Vertrauliches Feedback Konto B'
          );

          // 3. Scan-Download fuer fremde Einsendung (scan-b.pdf) -> 403
          const uploadGetRes = await uploadsGet(
            new Request('http://localhost/uploads/scans/teacher-b/scan-b.pdf', {
              headers: buildCookieHeader(sessionA.token),
            }),
            { params: Promise.resolve({ file: ['scans', 'teacher-b', 'scan-b.pdf'] }) }
          );
          expect(uploadGetRes.status).toBe(403);

          const uploadHeadRes = await uploadsHead(
            new Request('http://localhost/uploads/scans/teacher-b/scan-b.pdf', {
              method: 'HEAD',
              headers: buildCookieHeader(sessionA.token),
            }),
            { params: Promise.resolve({ file: ['scans', 'teacher-b', 'scan-b.pdf'] }) }
          );
          expect(uploadHeadRes.status).toBe(403);

          // 4. Punkte/Bewertung fremder Korrektur (sub-b) ueberschreiben -> 403
          const saveForeignSubRes = await submissionDetailPost(
            new Request('http://localhost/api/submissions/sub-b', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({
                aufgaben: [{ aufgabeId: '1', erzieltePunkte: 0, schritte: [] }],
              }),
            }),
            idParamsSubB
          );
          expect(saveForeignSubRes.status).toBe(403);
          expect(db.submission.update).not.toHaveBeenCalled();

          // 5. Fremde Einsendung (sub-b) neu zuordnen -> 403
          const patchForeignSubRes = await submissionDetailPatch(
            new Request('http://localhost/api/submissions/sub-b', {
              method: 'PATCH',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ studentId: 'student-a' }),
            }),
            idParamsSubB
          );
          expect(patchForeignSubRes.status).toBe(403);
          expect(db.submission.update).not.toHaveBeenCalled();

          // 6. Eigene Einsendung (sub-a) einer fremden Pruefung (exam-b) oder fremdem Schueler (student-b) zuordnen -> 404 / 400
          const patchOwnSubToForeignExamRes = await submissionDetailPatch(
            new Request('http://localhost/api/submissions/sub-a', {
              method: 'PATCH',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ studentId: 'student-a', examId: 'exam-b' }),
            }),
            idParamsSubA
          );
          expect(patchOwnSubToForeignExamRes.status).toBe(404);
          expect(db.submission.update).not.toHaveBeenCalled();

          const patchOwnSubToForeignStudentRes = await submissionDetailPatch(
            new Request('http://localhost/api/submissions/sub-a', {
              method: 'PATCH',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ studentId: 'student-b' }),
            }),
            idParamsSubA
          );
          expect(patchOwnSubToForeignStudentRes.status).toBe(400);
          expect(db.submission.update).not.toHaveBeenCalled();

          // 7. Fremde Korrektur loeschen, Aufgabe hinzufuegen oder neu starten -> 403
          const deleteForeignSubRes = await submissionDetailDelete(
            new Request('http://localhost/api/submissions/sub-b', {
              method: 'DELETE',
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsSubB
          );
          expect(deleteForeignSubRes.status).toBe(403);
          expect(db.submission.delete).not.toHaveBeenCalled();

          const addTaskForeignSubRes = await submissionAddTaskPost(
            new Request('http://localhost/api/submissions/sub-b/add-task', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ taskId: '2', title: 'Zusatz', maxPoints: 5 }),
            }),
            idParamsSubB
          );
          expect(addTaskForeignSubRes.status).toBe(403);
          expect(db.taskCorrection.create).not.toHaveBeenCalled();

          const replaceForeignSubRes = await submissionReplacePost(
            new Request('http://localhost/api/submissions/sub-b/replace', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
            }),
            idParamsSubB
          );
          expect(replaceForeignSubRes.status).toBe(403);
          expect(db.submission.update).not.toHaveBeenCalled();

          // 8. Mobile-Relay-Sitzung fuer fremde Pruefung (exam-b) anfordern -> 404
          const relayForeignExamRes = await mobileRelayPost(
            new Request('http://localhost/api/mobile-relay', {
              method: 'POST',
              headers: buildCookieHeader(sessionA.token),
              body: JSON.stringify({ examId: 'exam-b', targetMode: 'SUBMISSION' }),
            })
          );
          expect(relayForeignExamRes.status).toBe(404);
        });
      });
    });

    describe('3. Negativtests je Auth-Pfad: abgelaufene, widerrufene, ueberholte und zweckfremde Credentials werden abgelehnt', () => {
      it('lehnt abgelaufene Session-Tokens sowohl in proxy.ts als auch in den API-Endpunkten strikt mit 401 ab', async () => {
        const past = new Date(Date.now() - 10 * 24 * 3600 * 1000);
        const { token: expiredToken } = await createSessionRecord('teacher-a', { now: past });

        const proxyReq = new NextRequest('http://localhost:3000/api/exams', {
          headers: buildCookieHeader(expiredToken),
        });
        const proxyRes = await proxy(proxyReq);
        expect(proxyRes.status).toBe(401);

        await runWithSessionToken(expiredToken, async () => {
          const [resExams, resClasses, resSubs, resMe] = await Promise.all([
            examsGet(
              new Request('http://localhost/api/exams', {
                headers: buildCookieHeader(expiredToken),
              })
            ),
            classesGet(
              new Request('http://localhost/api/classes', {
                headers: buildCookieHeader(expiredToken),
              })
            ),
            submissionsGet(
              new Request('http://localhost/api/submissions', {
                headers: buildCookieHeader(expiredToken),
              })
            ),
            meGet(
              new Request('http://localhost/api/auth/me', {
                headers: buildCookieHeader(expiredToken),
              })
            ),
          ]);

          expect(resExams.status).toBe(401);
          expect(resClasses.status).toBe(401);
          expect(resSubs.status).toBe(401);
          expect(resMe.status).toBe(401);
        });
      });

      it('lehnt serverseitig widerrufene Sessions (Logout & Passwort-Reset) trotz kryptografisch gueltiger Restlaufzeit sofort mit 401 ab', async () => {
        const { session, token: revokedToken } = await createSessionRecord('teacher-a');
        await revokeSessionById(session.id);

        const proxyReq = new NextRequest('http://localhost:3000/api/classes', {
          headers: buildCookieHeader(revokedToken),
        });
        expect((await proxy(proxyReq)).status).toBe(401);

        await runWithSessionToken(revokedToken, async () => {
          const res = await classesGet(
            new Request('http://localhost/api/classes', {
              headers: buildCookieHeader(revokedToken),
            })
          );
          expect(res.status).toBe(401);
        });

        // Ebenso bei globalem Widerruf aller Sessions einer Lehrperson (z. B. nach Passwort-Reset)
        const { token: pwResetToken } = await createSessionRecord('teacher-a');
        await revokeAllTeacherSessions('teacher-a');

        await runWithSessionToken(pwResetToken, async () => {
          const res = await examsGet(
            new Request('http://localhost/api/exams', {
              headers: buildCookieHeader(pwResetToken),
            })
          );
          expect(res.status).toBe(401);
        });
      });

      it('lehnt durch Sliding Renewal ueberholte Token-Versionen (Replay-Angriff mit altem Token) strikt mit 401 ab', async () => {
        const t0 = new Date(Date.now() - 26 * 3600 * 1000);
        const { token: v1Token } = await createSessionRecord('teacher-a', { now: t0 });

        // Sliding Renewal rotiert die Session auf tokenVersion 2
        const renewed = await verifySessionToken(v1Token, { now: new Date() });
        expect(renewed?.renewed).toBe(true);
        expect(renewed?.tokenVersion).toBe(2);

        // Das alte v1Token darf anschliessend keinen Zugriff mehr gewaehren
        await runWithSessionToken(v1Token, async () => {
          const res = await examsGet(
            new Request('http://localhost/api/exams', {
              headers: buildCookieHeader(v1Token),
            })
          );
          expect(res.status).toBe(401);
        });
      });

      it('lehnt manipulierte Signaturen sowie Sessions geloeschter Benutzerkonten strikt mit 401 ab', async () => {
        const { token: validToken } = await createSessionRecord('teacher-a');
        const tamperedToken = `${validToken.slice(0, -6)}XXXXXX`;

        await runWithSessionToken(tamperedToken, async () => {
          const res = await examsGet(
            new Request('http://localhost/api/exams', {
              headers: buildCookieHeader(tamperedToken),
            })
          );
          expect(res.status).toBe(401);
        });

        // Existiert das Benutzerkonto nicht mehr in der Datenbank, wird auch ein gueltiges Session-Token abgewiesen
        const { token: ghostToken } = await createSessionRecord('teacher-deleted-account');
        await runWithSessionToken(ghostToken, async () => {
          const [resMe, resExams, resClasses, resSubs, resSubjects] = await Promise.all([
            meGet(
              new Request('http://localhost/api/auth/me', {
                headers: buildCookieHeader(ghostToken),
              })
            ),
            examsGet(
              new Request('http://localhost/api/exams', {
                headers: buildCookieHeader(ghostToken),
              })
            ),
            classesGet(
              new Request('http://localhost/api/classes', {
                headers: buildCookieHeader(ghostToken),
              })
            ),
            submissionsGet(
              new Request('http://localhost/api/submissions', {
                headers: buildCookieHeader(ghostToken),
              })
            ),
            subjectsGet(
              new Request('http://localhost/api/subjects', {
                headers: buildCookieHeader(ghostToken),
              })
            ),
          ]);

          expect(resMe.status).toBe(401);
          expect(resExams.status).toBe(401);
          expect(resClasses.status).toBe(401);
          expect(resSubs.status).toBe(401);
          expect(resSubjects.status).toBe(401);
        });
      });

      it('lehnt zweckfremde Kurzzeit-Tokens (Relay, E-Mail-Verifikation, Passwort-Reset, OAuth) als Session-Cookie sowie Session-Tokens als Relay-Token strikt mit 401 ab', async () => {
        const foreignPurposeTokens = [
          await signMobileRelayToken({ teacherId: 'teacher-b', sessionId: 'relay-1' }),
          await signEmailVerificationToken({
            teacherId: 'teacher-b',
            email: 'beatrice.keller@schule-b.ch',
          }),
          await signPasswordResetToken({
            teacherId: 'teacher-b',
            email: 'beatrice.keller@schule-b.ch',
            pwdHashPrefix: '12345678',
          }),
          await signOAuthStateToken({
            provider: 'google',
            action: 'login',
            nonce: 'nonce-1',
          }),
          await signOAuthPendingLinkToken({
            provider: 'google',
            providerAccountId: 'g-1',
            providerEmail: 'beatrice.keller@schule-b.ch',
            existingTeacherId: 'teacher-b',
            existingTeacherEmail: 'beatrice.keller@schule-b.ch',
          }),
          await signOAuthConfirmLinkEmailToken({
            provider: 'google',
            providerAccountId: 'g-1',
            providerEmail: 'beatrice.keller@schule-b.ch',
            teacherId: 'teacher-b',
          }),
          // Nicht-existierende Session-ID im JWT
          await signJWT({
            userId: 'teacher-b',
            sessionId: 'sess_forged_nonexistent',
            tokenVersion: 1,
            purpose: 'session',
          }),
        ];

        for (const token of foreignPurposeTokens) {
          const proxyReq = new NextRequest('http://localhost:3000/api/exams', {
            headers: buildCookieHeader(token),
          });
          expect((await proxy(proxyReq)).status).toBe(401);

          await runWithSessionToken(token, async () => {
            const res = await examsGet(
              new Request('http://localhost/api/exams', {
                headers: buildCookieHeader(token),
              })
            );
            expect(res.status).toBe(401);
          });
        }

        // Umgekehrt darf ein regulaeres Session-Token niemals als Mobile-Relay-Token akzeptiert werden
        const { token: sessionToken } = await createSessionRecord('teacher-a');
        const relayGetWithSessionToken = await mobileRelayGet(
          new Request(`http://localhost/api/mobile-relay?token=${encodeURIComponent(sessionToken)}`)
        );
        expect(relayGetWithSessionToken.status).toBe(401);

        const uploadForm = new FormData();
        uploadForm.set('token', sessionToken);
        const relayUploadWithSessionToken = await mobileRelayUploadPost(
          new Request('http://localhost/api/mobile-relay/upload', {
            method: 'POST',
            body: uploadForm,
          })
        );
        expect(relayUploadWithSessionToken.status).toBe(401);
      });
    });
  }
);
