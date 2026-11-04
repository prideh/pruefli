import { describe, it, expect, vi, beforeEach } from 'vitest';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as registerPost } from '@/app/api/auth/register/route';
import { POST as correctPost } from '@/app/api/correct/route';
import { POST as mobileRelayUploadPost } from '@/app/api/mobile-relay/upload/route';
import { POST as generatePost } from '@/app/api/exams/generate/route';
import { POST as regenerateTaskPost } from '@/app/api/exams/[id]/regenerate-task/route';
import * as sessionModule from '@/lib/session';
import * as jwtModule from '@/lib/jwt';
import * as authModule from '@/lib/auth';
import * as rateLimitModule from '@/lib/rate-limit';
import { markEmailVerified } from '@/lib/email-verification';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
}));

vi.mock('@/lib/jwt', () => ({
  verifyMobileRelayToken: vi.fn(),
  signMobileRelayToken: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  verifyPassword: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    teacher: {
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    class: {
      findFirst: vi.fn(),
    },
    exam: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    submission: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    correctionLog: {
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock('@/lib/rate-limit', () => ({
  checkAiRateLimit: vi.fn(),
  createRateLimitResponse: vi.fn(),
  checkAuthRateLimit: vi.fn(),
  createAuthRateLimitResponse: vi.fn(),
  extractClientIp: vi.fn(),
}));

vi.mock('@/lib/cache', () => ({
  serverCache: {
    get: vi.fn(),
    set: vi.fn(),
    delete: vi.fn(),
    invalidateTags: vi.fn(),
  },
  CacheTags: {
    teacher: vi.fn(),
    class: vi.fn(),
    exam: vi.fn(),
    submission: vi.fn(),
    logs: vi.fn(),
  },
  invalidateSubmissionCache: vi.fn(),
  invalidateLogsCache: vi.fn(),
  invalidateExamCache: vi.fn(),
  invalidateClassCache: vi.fn(),
  invalidateStudentCache: vi.fn(),
}));

describe('Haertung: Interne Fehlermeldungen nicht an API-Clients zurueckgeben', () => {
  beforeEach(async () => {
    vi.restoreAllMocks();
    await markEmailVerified('t-1', 't1@schule.ch');
    await markEmailVerified('teacher-1', 'teacher1@schule.ch');
    await markEmailVerified('teacher-123', 'teacher123@schule.ch');
    vi.mocked(rateLimitModule.checkAiRateLimit).mockResolvedValue({
      allowed: true,
      limit: 60,
      remaining: 59,
      retryAfterSeconds: 0,
      resetMs: 0,
    });
    vi.mocked(rateLimitModule.checkAuthRateLimit).mockResolvedValue({
      allowed: true,
      limit: 5,
      remaining: 4,
      retryAfterSeconds: 0,
      resetMs: 0,
    });
    vi.mocked(rateLimitModule.extractClientIp).mockReturnValue('127.0.0.1');
    vi.mocked(authModule.verifyPassword).mockResolvedValue(false);
  });

  describe('POST /api/auth/login', () => {
    it('gibt bei internem Datenbankfehler nur eine generische Meldung zurueck', async () => {
      const internalDbError = new Error(
        'FATAL: password authentication failed for user "postgres_internal"'
      );
      vi.mocked(db.teacher.findUnique).mockRejectedValueOnce(internalDbError);

      const req = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'teacher@school.ch', password: 'SecretPassword123!' }),
      });

      const res = await loginPost(req);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Anmeldung fehlgeschlagen. Bitte versuchen Sie es später erneut.');
      expect(body.error).not.toContain('postgres_internal');
      expect(body.error).not.toContain('FATAL');
    });

    it('behaelt fachliche 400- und 401-Fehlerantworten bei', async () => {
      // 400 fehlende Felder
      const reqEmpty = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: '' }),
      });
      const resEmpty = await loginPost(reqEmpty);
      expect(resEmpty.status).toBe(400);

      // 401 ungueltige Zugangsdaten
      vi.mocked(db.teacher.findUnique).mockResolvedValueOnce(null);
      const reqInvalid = new Request('http://localhost/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unknown@school.ch', password: 'wrong' }),
      });
      const resInvalid = await loginPost(reqInvalid);
      expect(resInvalid.status).toBe(401);
      const dataInvalid = await resInvalid.json();
      expect(dataInvalid.error).toBe('Ungültige E-Mail-Adresse oder Passwort.');
    });
  });

  describe('POST /api/auth/register', () => {
    it('gibt bei internem Serverfehler eine generische Meldung zurueck', async () => {
      const internalError = new Error(
        'PrismaClientKnownRequestError: connection pool exhausted at 10.0.4.15'
      );
      vi.mocked(db.teacher.findUnique).mockRejectedValueOnce(internalError);

      const req = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'Frau Meier',
          email: 'meier@schule.ch',
          password: 'securePassword123',
        }),
      });

      const res = await registerPost(req);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe(
        'Registrierung fehlgeschlagen. Bitte versuchen Sie es später erneut.'
      );
      expect(body.error).not.toContain('10.0.4.15');
      expect(body.error).not.toContain('pool exhausted');
    });

    it('behaelt fachliche Validierungsfehler (400) bei', async () => {
      const reqShort = new Request('http://localhost/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'A', email: 'a@b.ch', password: '123' }),
      });
      const resShort = await registerPost(reqShort);
      expect(resShort.status).toBe(400);
      const body = await resShort.json();
      expect(body.error).toContain('mindestens 6 Zeichen');
    });
  });

  describe('POST /api/correct', () => {
    it('gibt bei internem Ausfall eine generische 500-Meldung ohne Stack-Details zurueck', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce({ userId: 'teacher-123' });
      // Simuliere internen Fehler beim Lesen von formData
      const brokenReq = {
        formData: () =>
          Promise.reject(
            new Error('ENOENT: no such file or directory /var/data/uploads/tmp_99182')
          ),
      } as unknown as Request;

      const res = await correctPost(brokenReq);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe('Upload fehlgeschlagen. Bitte versuchen Sie es später erneut.');
      expect(body.error).not.toContain('/var/data/uploads');
      expect(body.error).not.toContain('ENOENT');
    });
  });

  describe('POST /api/mobile-relay/upload', () => {
    it('gibt bei internem Fehler eine generische 500-Meldung ohne interne Pfade zurueck', async () => {
      vi.mocked(jwtModule.verifyMobileRelayToken).mockRejectedValueOnce(
        new Error(
          'crypto error at NodeCryptoProvider.verify (/app/node_modules/jose/dist/node/esm/runtime/sign.js:14)'
        )
      );

      const req = new Request('http://localhost/api/mobile-relay/upload', {
        method: 'POST',
      });

      const res = await mobileRelayUploadPost(req);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe(
        'Smartphone-Upload fehlgeschlagen. Bitte versuchen Sie es später erneut.'
      );
      expect(body.error).not.toContain('node_modules');
      expect(body.error).not.toContain('NodeCryptoProvider');
    });
  });

  describe('POST /api/exams/generate & /api/exams/[id]/regenerate-task', () => {
    it('gibt bei Ausfall von generateContent generische 500-Meldung zurueck', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce({ userId: 'teacher-1' });

      // Simuliere internen Fehler
      const brokenReq = {
        json: () =>
          Promise.reject(
            new Error(
              'GoogleGenerativeAIError: Quota exceeded for model gemini-3.8-flash (429 Resource Exhausted)'
            )
          ),
      } as unknown as Request;

      const res = await generatePost(brokenReq);
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe(
        'Fehler bei der Generierung der Prüfung aus Unterrichtsmaterial. Bitte versuchen Sie es später erneut.'
      );
      expect(body.error).not.toContain('GoogleGenerativeAIError');
      expect(body.error).not.toContain('Resource Exhausted');
    });

    it('gibt bei regenerate-task generische 500-Meldung zurueck', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce({ userId: 'teacher-1' });

      const brokenReq = {
        json: () => Promise.reject(new Error('Internal S3 storage error on task prompt embed')),
      } as unknown as Request;

      const res = await regenerateTaskPost(brokenReq, {
        params: Promise.resolve({ id: 'exam-1' }),
      });
      expect(res.status).toBe(500);

      const body = await res.json();
      expect(body.error).toBe(
        'Fehler bei der Neu-Generierung der Aufgabe. Bitte versuchen Sie es später erneut.'
      );
      expect(body.error).not.toContain('Internal S3 storage error');
    });
  });

  describe('Schweizer Rechtschreibung (kein Eszett)', () => {
    it('enthaelt kein Eszett in allen gehaerteten Routen und Testdateien', () => {
      const filesToCheck = [
        '../../app/api/auth/login/route.ts',
        '../../app/api/auth/register/route.ts',
        '../../app/api/correct/route.ts',
        '../../app/api/mobile-relay/upload/route.ts',
        '../../app/api/exams/generate/route.ts',
        '../../app/api/exams/[id]/regenerate-task/route.ts',
      ];

      for (const rel of filesToCheck) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
