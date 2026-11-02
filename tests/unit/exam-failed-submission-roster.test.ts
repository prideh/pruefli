import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';

const { findUniqueExamMock, getSessionMock } = vi.hoisted(() => ({
  findUniqueExamMock: vi.fn(),
  getSessionMock: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    exam: {
      findUnique: findUniqueExamMock,
    },
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: getSessionMock,
}));

vi.mock('@/lib/cache', () => ({
  serverCache: {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  },
  CacheTags: {
    teacher: (id: string) => `t:${id}`,
    exams: (id: string) => `e:${id}`,
    exam: (id: string, eid: string) => `e:${id}:${eid}`,
    class: (id: string, cid: string) => `c:${id}:${cid}`,
  },
  invalidateExamCache: vi.fn(),
  invalidateLogsCache: vi.fn(),
}));

vi.mock('@/lib/class-archive', () => ({
  isClassArchived: vi.fn().mockResolvedValue(false),
}));

import { GET } from '@/app/api/exams/[id]/route';

describe('Issue #92: Schueler mit ausschliesslich fehlgeschlagenen Korrekturen in der Klassenliste', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ userId: 'teacher-1' });
  });

  it('ordnet fehlgeschlagene Arbeiten ueber targetStudentId sowie bei 1-Schueler-Klassen dem Roster-Eintrag mit Status FAILED und Fehlergrund zu', async () => {
    findUniqueExamMock.mockResolvedValue({
      id: 'exam-92',
      title: 'Physik Kinematik',
      subject: 'Physik',
      maxPoints: 20,
      rubricText: 'Musterloesung',
      examTemplateText: 'Aufgabenblatt',
      gradingNotes: '',
      gradingFormula: 'LINEAR_60',
      gradeRounding: '0.1',
      classId: 'class-1',
      createdAt: new Date('2026-11-02T10:00:00Z'),
      class: {
        id: 'class-1',
        name: '3a',
        teacherId: 'teacher-1',
        students: [{ id: 'student-1', name: 'Sophie Meier' }],
      },
      tasks: [],
      submissions: [
        {
          id: 'sub-fail-1',
          studentId: null,
          targetStudentId: 'student-1',
          suggestedStudentId: null,
          status: 'FAILED',
          errorMessage: 'Die KI-Antwort hat das Zeitlimit von 90s ueberschritten.',
          gradeRaw: 1,
          gradeRounded: '1.0',
          earnedPoints: 0,
          createdAt: new Date('2026-11-02T11:00:00Z'),
          tasks: [],
        },
        {
          id: 'sub-fail-2',
          studentId: null,
          targetStudentId: null,
          suggestedStudentId: null,
          status: 'FAILED',
          errorMessage: 'Zeitlimit erneut ueberschritten (Versuch 2).',
          gradeRaw: 1,
          gradeRounded: '1.0',
          earnedPoints: 0,
          createdAt: new Date('2026-11-02T11:05:00Z'),
          tasks: [],
        },
      ],
    });

    const req = new Request('http://localhost/api/exams/exam-92');
    const res = await GET(req, { params: Promise.resolve({ id: 'exam-92' }) });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.roster).toHaveLength(1);
    expect(body.roster[0]).toMatchObject({
      studentId: 'student-1',
      studentName: 'Sophie Meier',
      status: 'FAILED',
      submissionId: 'sub-fail-1',
      errorMessage: 'Die KI-Antwort hat das Zeitlimit von 90s ueberschritten.',
      failedAttemptsCount: 1,
      earnedPoints: 'N/A',
      grade: 'N/A',
    });
    expect(body.failedSubmissions).toHaveLength(2);
  });

  it('ordnet unzugeordnete fehlgeschlagene Arbeiten in einer 1-Schueler-Klasse direkt der Schuelerin zu', async () => {
    findUniqueExamMock.mockResolvedValue({
      id: 'exam-92b',
      title: 'Physik Kinematik',
      subject: 'Physik',
      maxPoints: 20,
      rubricText: 'Musterloesung',
      examTemplateText: 'Aufgabenblatt',
      gradingNotes: '',
      gradingFormula: 'LINEAR_60',
      gradeRounding: '0.1',
      classId: 'class-1',
      createdAt: new Date('2026-11-02T10:00:00Z'),
      class: {
        id: 'class-1',
        name: '3a',
        teacherId: 'teacher-1',
        students: [{ id: 'student-1', name: 'Sophie Meier' }],
      },
      tasks: [],
      submissions: [
        {
          id: 'sub-unassigned-1',
          studentId: null,
          targetStudentId: null,
          suggestedStudentId: null,
          status: 'FAILED',
          errorMessage: 'KI-Timeout nach 90s (Versuch 1).',
          gradeRaw: 1,
          gradeRounded: '1.0',
          earnedPoints: 0,
          createdAt: new Date('2026-11-02T11:00:00Z'),
          tasks: [],
        },
        {
          id: 'sub-unassigned-2',
          studentId: null,
          targetStudentId: null,
          suggestedStudentId: null,
          status: 'FAILED',
          errorMessage: 'KI-Timeout nach 90s (Versuch 2).',
          gradeRaw: 1,
          gradeRounded: '1.0',
          earnedPoints: 0,
          createdAt: new Date('2026-11-02T11:05:00Z'),
          tasks: [],
        },
      ],
    });

    const req = new Request('http://localhost/api/exams/exam-92b');
    const res = await GET(req, { params: Promise.resolve({ id: 'exam-92b' }) });
    const body = await res.json();

    expect(body.roster[0]).toMatchObject({
      studentId: 'student-1',
      studentName: 'Sophie Meier',
      status: 'FAILED',
      submissionId: 'sub-unassigned-2',
      errorMessage: 'KI-Timeout nach 90s (Versuch 2).',
      failedAttemptsCount: 2,
    });
  });

  it('rendert auf der Pruefungsseite den Status "Fehlgeschlagen – erneut versuchen", Fehlergrund und direkten Retry-Button', () => {
    const pageSource = fs.readFileSync(
      path.join(process.cwd(), 'app/exams/[id]/page.tsx'),
      'utf-8'
    );
    expect(pageSource).toContain('Fehlgeschlagen – erneut versuchen');
    expect(pageSource).toContain('Fehlergrund: {student.errorMessage}');
    expect(pageSource).toContain('Erneut versuchen');
    expect(pageSource).toContain('handleRetryFailedSubmission');
    expect(pageSource).toContain('/api/submissions/${submissionId}/replace');
  });
});
