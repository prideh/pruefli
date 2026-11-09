import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET as getSubmissions } from '@/app/api/submissions/route';
import { GET as getLogs } from '@/app/api/logs/route';
import * as sessionModule from '@/lib/session';
import { db } from '@/lib/db';
import { serverCache } from '@/lib/cache';
import fs from 'fs';
import path from 'path';

type SubmissionList = Awaited<ReturnType<typeof db.submission.findMany>>;
type CorrectionLogList = Awaited<ReturnType<typeof db.correctionLog.findMany>>;
type CorrectionLogAggregate = Awaited<ReturnType<typeof db.correctionLog.aggregate>>;

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    submission: {
      count: vi.fn(),
      findMany: vi.fn(),
    },
    correctionLog: {
      count: vi.fn(),
      findMany: vi.fn(),
      aggregate: vi.fn(),
    },
    student: {
      findMany: vi.fn(),
    },
    exam: {
      findMany: vi.fn(),
    },
  },
}));

describe('Pagination & Filter Kombination (/api/submissions & /api/logs)', () => {
  const mockTeacherId = 'teacher-abc-123';

  beforeEach(async () => {
    vi.restoreAllMocks();
    await serverCache.clear();
    vi.mocked(sessionModule.getSession).mockResolvedValue({
      userId: mockTeacherId,
    });
  });

  describe('GET /api/submissions Pagination & Filter', () => {
    const mockStudent = { id: 'stud-1', name: 'Anna Meier', classId: 'class-1' };
    const mockExam = {
      id: 'exam-1',
      title: 'Mathe Test 1',
      subject: 'Mathematik',
      classId: 'class-1',
      class: { name: 'Sek 1a' },
      maxPoints: 30,
    };

    beforeEach(() => {
      vi.mocked(db.student.findMany).mockResolvedValue([mockStudent] as unknown as Awaited<
        ReturnType<typeof db.student.findMany>
      >);
      vi.mocked(db.exam.findMany).mockResolvedValue([mockExam] as unknown as Awaited<
        ReturnType<typeof db.exam.findMany>
      >);
    });

    it('liefert 401 bei nicht vorhandener Session', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce(null);
      const res = await getSubmissions(new Request('http://localhost/api/submissions'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Nicht autorisiert.');
    });

    it('verwendet standardmaessig Seite 1 mit Default-Limit (25) bei unpaginiertem Aufruf', async () => {
      const dummy5 = Array.from({ length: 5 }, (_, i) => ({
        id: `sub-${i + 1}`,
        studentId: 'stud-1',
        student: mockStudent,
        targetStudentId: null,
        extractedStudentName: null,
        suggestedStudentId: null,
        isStudentMatchUncertain: false,
        isExamMatchUncertain: false,
        examId: 'exam-1',
        exam: mockExam,
        status: 'COMPLETED',
        gradeRounded: '5.0',
        earnedPoints: 20,
        createdAt: new Date('2026-05-01T10:00:00Z'),
        errorMessage: null,
        tasks: [],
      }));

      vi.mocked(db.submission.count).mockResolvedValueOnce(5);
      vi.mocked(db.submission.findMany).mockResolvedValueOnce(dummy5 as unknown as SubmissionList);

      const res = await getSubmissions(new Request('http://localhost/api/submissions'));
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(vi.mocked(db.submission.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 25,
          skip: 0,
        })
      );
      expect(body.pagination).toEqual({
        page: 1,
        pageSize: 25,
        total: 5,
        totalPages: 1,
        hasMore: false,
        nextCursor: null,
      });
    });

    it('handhabt mehr Datensaetze als eine Seite (z.B. 35 Eintraege, Seite 1 und 2)', async () => {
      const totalCount = 35;

      // Seite 1 Anfrage
      const dummyPage1 = Array.from({ length: 10 }, (_, i) => ({
        id: `sub-${i + 1}`,
        studentId: 'stud-1',
        student: mockStudent,
        targetStudentId: null,
        extractedStudentName: null,
        suggestedStudentId: null,
        isStudentMatchUncertain: false,
        isExamMatchUncertain: false,
        examId: 'exam-1',
        exam: mockExam,
        status: 'COMPLETED',
        gradeRounded: '5.5',
        earnedPoints: 26,
        createdAt: new Date('2026-05-01T10:00:00Z'),
        errorMessage: null,
        tasks: [],
      }));

      vi.mocked(db.submission.count).mockResolvedValueOnce(totalCount);
      vi.mocked(db.submission.findMany).mockResolvedValueOnce(
        dummyPage1 as unknown as SubmissionList
      );

      const reqPage1 = new Request('http://localhost/api/submissions?page=1&pageSize=10');
      const resPage1 = await getSubmissions(reqPage1);
      const bodyPage1 = await resPage1.json();

      expect(vi.mocked(db.submission.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 0,
        })
      );
      expect(bodyPage1.submissions).toHaveLength(10);
      expect(bodyPage1.pagination).toEqual({
        page: 1,
        pageSize: 10,
        total: 35,
        totalPages: 4,
        hasMore: true,
        nextCursor: 'sub-10',
      });

      // Seite 4 (letzte Seite, 5 Eintraege)
      await serverCache.clear();
      const dummyPage4 = Array.from({ length: 5 }, (_, i) => ({
        id: `sub-${i + 31}`,
        studentId: 'stud-1',
        student: mockStudent,
        targetStudentId: null,
        extractedStudentName: null,
        suggestedStudentId: null,
        isStudentMatchUncertain: false,
        isExamMatchUncertain: false,
        examId: 'exam-1',
        exam: mockExam,
        status: 'COMPLETED',
        gradeRounded: '4.0',
        earnedPoints: 18,
        createdAt: new Date('2026-05-01T09:00:00Z'),
        errorMessage: null,
        tasks: [],
      }));

      vi.mocked(db.submission.count).mockResolvedValueOnce(totalCount);
      vi.mocked(db.submission.findMany).mockResolvedValueOnce(
        dummyPage4 as unknown as SubmissionList
      );

      const reqPage4 = new Request('http://localhost/api/submissions?page=4&pageSize=10');
      const resPage4 = await getSubmissions(reqPage4);
      const bodyPage4 = await resPage4.json();

      expect(vi.mocked(db.submission.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 30,
        })
      );
      expect(bodyPage4.submissions).toHaveLength(5);
      expect(bodyPage4.pagination).toEqual({
        page: 4,
        pageSize: 10,
        total: 35,
        totalPages: 4,
        hasMore: false,
        nextCursor: null,
      });
    });

    it('unterstuetzt cursor-basierte Pagination', async () => {
      const dummyList = Array.from({ length: 5 }, (_, i) => ({
        id: `sub-${i + 11}`,
        studentId: 'stud-1',
        student: mockStudent,
        targetStudentId: null,
        extractedStudentName: null,
        suggestedStudentId: null,
        isStudentMatchUncertain: false,
        isExamMatchUncertain: false,
        examId: 'exam-1',
        exam: mockExam,
        status: 'COMPLETED',
        gradeRounded: '5.0',
        earnedPoints: 24,
        createdAt: new Date('2026-05-01T10:00:00Z'),
        errorMessage: null,
        tasks: [],
      }));

      vi.mocked(db.submission.count).mockResolvedValueOnce(25);
      vi.mocked(db.submission.findMany).mockResolvedValueOnce(
        dummyList as unknown as SubmissionList
      );

      const req = new Request('http://localhost/api/submissions?cursor=sub-10&pageSize=5');
      const res = await getSubmissions(req);
      const body = await res.json();

      expect(vi.mocked(db.submission.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'sub-10' },
          skip: 1,
          take: 5,
        })
      );
      expect(body.pagination.nextCursor).toBe('sub-15');
      expect(body.pagination.hasMore).toBe(true);
    });

    it('kombiniert Filter (Klasse, Pruefung, Status, Suche) mit Pagination im DB-Query', async () => {
      vi.mocked(db.submission.count).mockResolvedValueOnce(3);
      vi.mocked(db.submission.findMany).mockResolvedValueOnce([]);

      const req = new Request(
        'http://localhost/api/submissions?classId=class-1&examId=exam-1&status=COMPLETED&search=Anna&page=2&pageSize=10'
      );
      const res = await getSubmissions(req);
      expect(res.status).toBe(200);

      expect(vi.mocked(db.submission.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 10,
          where: {
            exam: {
              classId: 'class-1',
              class: {
                teacherId: mockTeacherId,
              },
            },
            examId: 'exam-1',
            status: 'COMPLETED',
            OR: [
              { student: { name: { contains: 'Anna', mode: 'insensitive' } } },
              { extractedStudentName: { contains: 'Anna', mode: 'insensitive' } },
              { exam: { title: { contains: 'Anna', mode: 'insensitive' } } },
            ],
          },
        })
      );
    });
  });

  describe('GET /api/logs Pagination & Filter', () => {
    it('liefert 401 bei nicht vorhandener Session', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce(null);
      const res = await getLogs(new Request('http://localhost/api/logs'));
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Nicht autorisiert.');
    });

    it('paginiert Korrektur-Logs korrekt ueber mehrere Seiten und liefert globale Statistiken', async () => {
      const totalLogs = 50;

      const dummyLogsPage1 = Array.from({ length: 20 }, (_, i) => ({
        id: `log-${i + 1}`,
        createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
        submissionId: `sub-${i + 1}`,
        teacherId: mockTeacherId,
        className: 'Sek 1a',
        examTitle: 'Mathematik Probe',
        studentName: `Schueler ${i + 1}`,
        modelUsed: 'gemini-3.8-flash',
        durationMs: 4500,
        status: 'COMPLETED',
        actionType: 'ERSTELLT',
        errorMessage: null,
      }));

      vi.mocked(db.correctionLog.count)
        .mockResolvedValueOnce(totalLogs) // Count for filtered query
        .mockResolvedValueOnce(50) // allTeacherLogsCount
        .mockResolvedValueOnce(45) // completedCount
        .mockResolvedValueOnce(5); // failedCount

      vi.mocked(db.correctionLog.findMany).mockResolvedValueOnce(
        dummyLogsPage1 as unknown as CorrectionLogList
      );
      vi.mocked(db.correctionLog.aggregate).mockResolvedValueOnce({
        _avg: { durationMs: 4200 },
      } as unknown as CorrectionLogAggregate);

      const req = new Request('http://localhost/api/logs?page=1&pageSize=20');
      const res = await getLogs(req);
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(vi.mocked(db.correctionLog.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 20,
          skip: 0,
        })
      );

      expect(body.logs).toHaveLength(20);
      expect(body.pagination).toEqual({
        page: 1,
        pageSize: 20,
        total: 50,
        totalPages: 3,
        hasMore: true,
        nextCursor: 'log-20',
      });

      expect(body.stats).toEqual({
        total: 50,
        completed: 45,
        failed: 5,
        averageDurationSeconds: 4.2,
        successRate: 90,
      });
    });

    it('unterstuetzt cursor-basierte Pagination fuer Logs', async () => {
      const dummyLogs = Array.from({ length: 10 }, (_, i) => ({
        id: `log-${i + 21}`,
        createdAt: new Date('2026-05-01T10:00:00Z').toISOString(),
        submissionId: `sub-${i + 21}`,
        teacherId: mockTeacherId,
        className: 'Sek 1a',
        examTitle: 'Mathematik Probe',
        studentName: `Schueler ${i + 21}`,
        modelUsed: 'gemini-3.8-flash',
        durationMs: 4000,
        status: 'COMPLETED',
        actionType: 'ERSTELLT',
        errorMessage: null,
      }));

      vi.mocked(db.correctionLog.count)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(30)
        .mockResolvedValueOnce(28)
        .mockResolvedValueOnce(2);

      vi.mocked(db.correctionLog.findMany).mockResolvedValueOnce(
        dummyLogs as unknown as CorrectionLogList
      );
      vi.mocked(db.correctionLog.aggregate).mockResolvedValueOnce({
        _avg: { durationMs: 4000 },
      } as unknown as CorrectionLogAggregate);

      const req = new Request('http://localhost/api/logs?cursor=log-20&pageSize=10');
      const res = await getLogs(req);
      const body = await res.json();

      expect(vi.mocked(db.correctionLog.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          cursor: { id: 'log-20' },
          skip: 1,
          take: 10,
        })
      );
      expect(body.pagination.nextCursor).toBe('log-30');
      expect(body.pagination.hasMore).toBe(true);
    });

    it('kombiniert Filter (Status, Aktionstyp, Suche) mit Pagination', async () => {
      vi.mocked(db.correctionLog.count)
        .mockResolvedValueOnce(2)
        .mockResolvedValueOnce(100)
        .mockResolvedValueOnce(80)
        .mockResolvedValueOnce(20);

      vi.mocked(db.correctionLog.findMany).mockResolvedValueOnce([]);
      vi.mocked(db.correctionLog.aggregate).mockResolvedValueOnce({
        _avg: { durationMs: 5000 },
      } as unknown as CorrectionLogAggregate);

      const req = new Request(
        'http://localhost/api/logs?status=FAILED&actionType=ERSETZT&search=Muster&page=1&pageSize=10'
      );
      const res = await getLogs(req);
      expect(res.status).toBe(200);

      expect(vi.mocked(db.correctionLog.findMany)).toHaveBeenCalledWith(
        expect.objectContaining({
          take: 10,
          skip: 0,
          where: {
            teacherId: mockTeacherId,
            status: 'FAILED',
            actionType: 'ERSETZT',
            OR: [
              { className: { contains: 'Muster', mode: 'insensitive' } },
              { examTitle: { contains: 'Muster', mode: 'insensitive' } },
              { studentName: { contains: 'Muster', mode: 'insensitive' } },
            ],
          },
        })
      );
    });
  });

  describe('Schweizer Rechtschreibung & Code Integrity (Kein Eszett)', () => {
    it('enthaelt kein Eszett in allen neu erstellten und modifizierten Dateien', () => {
      const filesToCheck = [
        '../../app/api/submissions/route.ts',
        '../../app/api/logs/route.ts',
        '../../app/submissions/page.tsx',
        '../../app/logs/page.tsx',
      ];

      for (const rel of filesToCheck) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
