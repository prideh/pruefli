import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import {
  checkAiRateLimit,
  createRateLimitResponse,
  getRateLimitConfig,
  getQuotaConfig,
  resetRateLimits,
  InMemoryRateLimitStore,
  type RateLimitStore,
} from '@/lib/rate-limit';
import * as sessionModule from '@/lib/session';
import * as jwtModule from '@/lib/jwt';
import { markEmailVerified } from '@/lib/email-verification';
import { POST as correctPost } from '@/app/api/correct/route';
import { POST as generatePost } from '@/app/api/exams/generate/route';
import { POST as regenerateTaskPost } from '@/app/api/exams/[id]/regenerate-task/route';
import { POST as uploadPost } from '@/app/api/mobile-relay/upload/route';
import { POST as parseRubricPost } from '@/app/api/exams/parse-rubric/route';
import { POST as replacePost } from '@/app/api/submissions/[id]/replace/route';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/jwt', () => ({
  verifyMobileRelayToken: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    submission: {
      findUnique: vi.fn(),
    },
    exam: {
      findUnique: vi.fn(),
    },
  },
}));

describe('AI Rate Limiting (lib/rate-limit.ts)', () => {
  const originalEnv = { ...process.env };

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.AI_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_LIMIT;
    delete process.env.AI_RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.AI_RATE_LIMIT_WINDOW_MS;
    delete process.env.AI_RATE_LIMIT_RELAY_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_RELAY_MAX;
    delete process.env.AI_RATE_LIMIT_RELAY_WINDOW_SECONDS;
    delete process.env.AI_RATE_LIMIT_CORRECT_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_GENERATE_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_REGENERATE_TASK_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_MOBILE_RELAY_UPLOAD_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_PARSE_RUBRIC_MAX_REQUESTS;
    delete process.env.AI_RATE_LIMIT_REPLACE_MAX_REQUESTS;
    delete process.env.AI_QUOTA_MAX_REQUESTS;
    delete process.env.AI_QUOTA_LIMIT;
    delete process.env.AI_QUOTA_WINDOW_SECONDS;
    delete process.env.AI_QUOTA_WINDOW_DAYS;
    delete process.env.AI_QUOTA_WINDOW_HOURS;
    delete process.env.AI_QUOTA_PERIOD;
    delete process.env.AI_QUOTA_RELAY_MAX_REQUESTS;
    delete process.env.AI_QUOTA_RELAY_LIMIT;
    delete process.env.AI_QUOTA_PARSE_RUBRIC_MAX_REQUESTS;
    delete process.env.AI_QUOTA_REPLACE_MAX_REQUESTS;
    resetRateLimits();
    for (const id of [
      'teacher-1',
      'lehrer-1',
      'lehrer-2',
      'lehrer-correct-test',
      'lehrer-generate-test',
      'lehrer-regen-test',
      'teacher-relay-test',
      'lehrer-parse-test',
      'lehrer-replace-test',
    ]) {
      await markEmailVerified(id, `${id}@schule.ch`);
    }
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetRateLimits();
    vi.restoreAllMocks();
  });

  describe('Sliding Window & Limits', () => {
    it('erlaubt Anfragen unterhalb des Limits und dekrementiert das Kontingent', async () => {
      const teacherId = 'teacher-1';
      const store = new InMemoryRateLimitStore();

      const res1 = await checkAiRateLimit({
        identifier: teacherId,
        scope: 'teacher',
        limit: 3,
        windowMs: 60000,
        store,
      });

      expect(res1.allowed).toBe(true);
      expect(res1.remaining).toBe(2);
      expect(res1.limit).toBe(3);

      const res2 = await checkAiRateLimit({
        identifier: teacherId,
        scope: 'teacher',
        limit: 3,
        windowMs: 60000,
        store,
      });

      expect(res2.allowed).toBe(true);
      expect(res2.remaining).toBe(1);

      const res3 = await checkAiRateLimit({
        identifier: teacherId,
        scope: 'teacher',
        limit: 3,
        windowMs: 60000,
        store,
      });

      expect(res3.allowed).toBe(true);
      expect(res3.remaining).toBe(0);
    });

    it('lehnt Anfragen ab (allowed: false), sobald das Limit ueberschritten ist', async () => {
      const teacherId = 'teacher-overflow';
      const store = new InMemoryRateLimitStore();

      for (let i = 0; i < 2; i++) {
        const res = await checkAiRateLimit({
          identifier: teacherId,
          scope: 'teacher',
          limit: 2,
          windowMs: 60000,
          store,
        });
        expect(res.allowed).toBe(true);
      }

      // Dritte Anfrage ueberschreitet das Limit
      const blocked = await checkAiRateLimit({
        identifier: teacherId,
        scope: 'teacher',
        limit: 2,
        windowMs: 60000,
        store,
      });

      expect(blocked.allowed).toBe(false);
      expect(blocked.remaining).toBe(0);
      expect(blocked.retryAfterSeconds).toBeGreaterThanOrEqual(1);
    });

    it('setzt Kontingent nach Ablauf des Zeitfensters zurueck', async () => {
      const teacherId = 'teacher-window-reset';
      const store = new InMemoryRateLimitStore();
      const shortWindowMs = 20;

      // Verbrauche Limit (1 Anfrage)
      const res1 = await checkAiRateLimit({
        identifier: teacherId,
        limit: 1,
        windowMs: shortWindowMs,
        store,
      });
      expect(res1.allowed).toBe(true);

      // Sofort blockiert
      const blocked = await checkAiRateLimit({
        identifier: teacherId,
        limit: 1,
        windowMs: shortWindowMs,
        store,
      });
      expect(blocked.allowed).toBe(false);

      // Warten bis Zeitfenster abgelaufen ist
      await new Promise((resolve) => setTimeout(resolve, 35));

      const afterExpiry = await checkAiRateLimit({
        identifier: teacherId,
        limit: 1,
        windowMs: shortWindowMs,
        store,
      });
      expect(afterExpiry.allowed).toBe(true);
    });
  });

  describe('Mandanten-Isolation (Tenant Separation)', () => {
    it('trennt Zaehler strikt pro Lehrperson', async () => {
      const store = new InMemoryRateLimitStore();

      // Lehrer A erschoepft Kontingent
      for (let i = 0; i < 2; i++) {
        await checkAiRateLimit({
          identifier: 'lehrer-A',
          scope: 'teacher',
          limit: 2,
          windowMs: 60000,
          store,
        });
      }

      const blockedA = await checkAiRateLimit({
        identifier: 'lehrer-A',
        scope: 'teacher',
        limit: 2,
        windowMs: 60000,
        store,
      });
      expect(blockedA.allowed).toBe(false);

      // Lehrer B hat volles Kontingent und ist unbeeintraechtigt
      const resB = await checkAiRateLimit({
        identifier: 'lehrer-B',
        scope: 'teacher',
        limit: 2,
        windowMs: 60000,
        store,
      });
      expect(resB.allowed).toBe(true);
      expect(resB.remaining).toBe(1);
    });

    it('trennt Zaehler zwischen Lehrer-Session und Relay-Token', async () => {
      const store = new InMemoryRateLimitStore();
      const id = 'user-shared-id';

      // Relay verbraucht Limit
      await checkAiRateLimit({
        identifier: id,
        scope: 'relay',
        limit: 1,
        windowMs: 60000,
        store,
      });

      const relayBlocked = await checkAiRateLimit({
        identifier: id,
        scope: 'relay',
        limit: 1,
        windowMs: 60000,
        store,
      });
      expect(relayBlocked.allowed).toBe(false);

      // Teacher-Scope fuer dieselbe ID ist unabhaengig
      const teacherAllowed = await checkAiRateLimit({
        identifier: id,
        scope: 'teacher',
        limit: 1,
        windowMs: 60000,
        store,
      });
      expect(teacherAllowed.allowed).toBe(true);
    });
  });

  describe('Konfigurierbare Kontingente ueber Umgebungsvariablen', () => {
    it('verwendet Standard-Defaults von 60 Anfragen pro 60 Sekunden', () => {
      const config = getRateLimitConfig();
      expect(config.maxRequests).toBe(60);
      expect(config.windowMs).toBe(60000);
    });

    it('uebernimmt globale Grenzwerte ueber AI_RATE_LIMIT_MAX_REQUESTS und AI_RATE_LIMIT_WINDOW_SECONDS', () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '15';
      process.env.AI_RATE_LIMIT_WINDOW_SECONDS = '30';

      const config = getRateLimitConfig();
      expect(config.maxRequests).toBe(15);
      expect(config.windowMs).toBe(30000);
    });

    it('unterstuetzt spezifisches Kontingent fuer Relay-Token ueber AI_RATE_LIMIT_RELAY_MAX_REQUESTS', () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '50';
      process.env.AI_RATE_LIMIT_RELAY_MAX_REQUESTS = '10';
      process.env.AI_RATE_LIMIT_RELAY_WINDOW_SECONDS = '120';

      const teacherConfig = getRateLimitConfig({ scope: 'teacher' });
      expect(teacherConfig.maxRequests).toBe(50);

      const relayConfig = getRateLimitConfig({ scope: 'relay' });
      expect(relayConfig.maxRequests).toBe(10);
      expect(relayConfig.windowMs).toBe(120000);
    });

    it('unterstuetzt Endpunkt-spezifische Grenzwerte', () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '40';
      process.env.AI_RATE_LIMIT_CORRECT_MAX_REQUESTS = '5';

      const correctConfig = getRateLimitConfig({ endpoint: 'correct' });
      expect(correctConfig.maxRequests).toBe(5);

      const generateConfig = getRateLimitConfig({ endpoint: 'generate' });
      expect(generateConfig.maxRequests).toBe(40);
    });
  });

  describe('Definiertes Fehlverhalten bei Speicherausfall (Fail-Open)', () => {
    it('blockiert bei Speicherfehler den Korrekturfluss nicht unbemerkt und loggt den Fehler', async () => {
      const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const brokenStore: RateLimitStore = {
        consume: vi.fn().mockImplementation(() => {
          throw new Error('Postgres / Memory store crashed unexpectedly');
        }),
        reset: vi.fn(),
      };

      const result = await checkAiRateLimit({
        identifier: 'lehrer-failopen',
        store: brokenStore,
      });

      // Fluss laeuft weiter (Fail-Open)
      expect(result.allowed).toBe(true);
      expect(result.failedOpen).toBe(true);

      // Ausfall wurde nachvollziehbar geloggt
      expect(consoleErrorSpy).toHaveBeenCalled();
      const loggedMsg = consoleErrorSpy.mock.calls[0].join(' ');
      expect(loggedMsg).toContain('[RateLimit]');
      expect(loggedMsg).toContain('Fail-Open');
    });
  });

  describe('HTTP 429 Antwort-Erstellung (createRateLimitResponse)', () => {
    it('erzeugt korrekte HTTP 429 Antwort mit Standard-Headern', async () => {
      const res = createRateLimitResponse({
        allowed: false,
        limit: 10,
        remaining: 0,
        retryAfterSeconds: 45,
        resetMs: 45000,
      });

      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBe('45');
      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('0');
      expect(res.headers.get('X-RateLimit-Reset')).toBe('45');

      const body = await res.json();
      expect(body.retryAfter).toBe(45);
      expect(body.error).toContain('Ratenlimit');
    });
  });

  describe('Endpunkt-Integration: app/api/correct/route.ts', () => {
    it('lehnt Anfragen mit 429 ab, wenn Kontingent erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-correct-test' });

      // Erste Anfrage verbraucht Kontingent
      await checkAiRateLimit({
        identifier: 'lehrer-correct-test',
        scope: 'teacher',
        endpoint: 'correct',
      });

      // Route-Aufruf via POST
      const req = new Request('http://localhost:3000/api/correct', {
        method: 'POST',
      });

      const res = await correctPost(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      const data = await res.json();
      expect(data.error).toContain('Ratenlimit');
    });

    it('beeintraechtigt andere Lehrer nicht (Tenant-Trennung)', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';

      // Lehrer 1 erschoepft Kontingent
      await checkAiRateLimit({
        identifier: 'lehrer-1',
        scope: 'teacher',
        endpoint: 'correct',
      });

      // Lehrer 2 fuehrt Anfrage aus -> wird nicht blockiert durch Rate-Limit (sondern scheitert ggf. an fehlenden Formulardaten)
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-2' });

      const formData = new FormData();
      const req = new Request('http://localhost:3000/api/correct', {
        method: 'POST',
        body: formData,
      });

      const res = await correctPost(req);
      // Status ist nicht 429
      expect(res.status).not.toBe(429);
    });
  });

  describe('Endpunkt-Integration: app/api/exams/generate/route.ts', () => {
    it('lehnt Anfragen mit 429 ab, wenn Kontingent erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-generate-test' });

      await checkAiRateLimit({
        identifier: 'lehrer-generate-test',
        scope: 'teacher',
        endpoint: 'generate',
      });

      const req = new Request('http://localhost:3000/api/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ material: 'test' }),
      });

      const res = await generatePost(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
    });

    it('beeintraechtigt andere Lehrer nicht (Tenant-Trennung)', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';

      // Lehrer 1 erschoepft Kontingent
      await checkAiRateLimit({
        identifier: 'lehrer-1',
        scope: 'teacher',
        endpoint: 'generate',
      });

      // Lehrer 2 stellt Anfrage
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-2' });

      const req = new Request('http://localhost:3000/api/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await generatePost(req);
      expect(res.status).not.toBe(429);
    });
  });

  describe('Endpunkt-Integration: app/api/exams/[id]/regenerate-task/route.ts', () => {
    it('lehnt Anfragen mit 429 ab, wenn Kontingent erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-regen-test' });

      await checkAiRateLimit({
        identifier: 'lehrer-regen-test',
        scope: 'teacher',
        endpoint: 'regenerate-task',
      });

      const req = new Request('http://localhost:3000/api/exams/ex-1/regenerate-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ taskId: '1' }),
      });

      const res = await regenerateTaskPost(req, { params: Promise.resolve({ id: 'ex-1' }) });
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
    });

    it('beeintraechtigt andere Lehrer nicht (Tenant-Trennung)', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';

      await checkAiRateLimit({
        identifier: 'lehrer-1',
        scope: 'teacher',
        endpoint: 'regenerate-task',
      });

      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-2' });

      const req = new Request('http://localhost:3000/api/exams/ex-1/regenerate-task', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await regenerateTaskPost(req, { params: Promise.resolve({ id: 'ex-1' }) });
      expect(res.status).not.toBe(429);
    });
  });

  describe('Endpunkt-Integration: app/api/mobile-relay/upload/route.ts', () => {
    it('lehnt Anfragen mit 429 ab, wenn Kontingent erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_RELAY_MAX_REQUESTS = '1';

      vi.mocked(jwtModule.verifyMobileRelayToken).mockResolvedValue({
        purpose: 'mobile_relay',
        teacherId: 'teacher-relay-test',
        sessionId: 'sess-relay-1',
      });

      // Erstes Token verbraucht Kontingent
      await checkAiRateLimit({
        identifier: 'sess-relay-1',
        scope: 'relay',
        endpoint: 'mobile-relay-upload',
      });

      const formData = new FormData();
      formData.append('token', 'mock-token');

      const req = new Request('http://localhost:3000/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await uploadPost(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
    });

    it('beeintraechtigt andere Relay-Tokens nicht (Tenant-Trennung)', async () => {
      process.env.AI_RATE_LIMIT_RELAY_MAX_REQUESTS = '1';

      // Relay 1 erschoepft Kontingent
      await checkAiRateLimit({
        identifier: 'sess-relay-1',
        scope: 'relay',
        endpoint: 'mobile-relay-upload',
      });

      // Relay 2 sendet Anfrage
      vi.mocked(jwtModule.verifyMobileRelayToken).mockResolvedValue({
        purpose: 'mobile_relay',
        teacherId: 'teacher-relay-test',
        sessionId: 'sess-relay-2',
      });

      const formData = new FormData();
      formData.append('token', 'mock-token-2');

      const req = new Request('http://localhost:3000/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });

      const res = await uploadPost(req);
      expect(res.status).not.toBe(429);
    });
  });

  describe('Kumulatives Kontingent (getQuotaConfig & checkAiRateLimit)', () => {
    it('ist standardmaessig deaktiviert, wenn keine Env gesetzt ist (reines Burst-Limit)', () => {
      const config = getQuotaConfig();
      expect(config.enabled).toBe(false);
      expect(config.maxRequests).toBe(0);
      expect(config.windowMs).toBe(0);
    });

    it('konfiguriert Kontingent via AI_QUOTA_MAX_REQUESTS mit Standard-24h-Fenster', () => {
      process.env.AI_QUOTA_MAX_REQUESTS = '500';
      const config = getQuotaConfig();
      expect(config.enabled).toBe(true);
      expect(config.maxRequests).toBe(500);
      expect(config.windowMs).toBe(86400 * 1000); // 24h
    });

    it('unterstuetzt flexible Zeitfenster (Sekunden, Tage, Stunden, Periode)', () => {
      process.env.AI_QUOTA_MAX_REQUESTS = '100';

      // Sekunden
      process.env.AI_QUOTA_WINDOW_SECONDS = '3600';
      expect(getQuotaConfig().windowMs).toBe(3600 * 1000);
      delete process.env.AI_QUOTA_WINDOW_SECONDS;

      // Tage
      process.env.AI_QUOTA_WINDOW_DAYS = '7';
      expect(getQuotaConfig().windowMs).toBe(7 * 86400 * 1000);
      delete process.env.AI_QUOTA_WINDOW_DAYS;

      // Stunden
      process.env.AI_QUOTA_WINDOW_HOURS = '12';
      expect(getQuotaConfig().windowMs).toBe(12 * 3600 * 1000);
      delete process.env.AI_QUOTA_WINDOW_HOURS;

      // Monat
      process.env.AI_QUOTA_PERIOD = 'month';
      expect(getQuotaConfig().windowMs).toBe(30 * 86400 * 1000);
    });

    it('erlaubt Anfragen solange das kumulative Kontingent nicht erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '100'; // Hohes Burst-Limit
      process.env.AI_QUOTA_MAX_REQUESTS = '3';
      const store = new InMemoryRateLimitStore();

      const res1 = await checkAiRateLimit({
        identifier: 'quota-user-1',
        scope: 'teacher',
        store,
      });
      expect(res1.allowed).toBe(true);
      expect(res1.quota?.remaining).toBe(2);

      const res2 = await checkAiRateLimit({
        identifier: 'quota-user-1',
        scope: 'teacher',
        store,
      });
      expect(res2.allowed).toBe(true);
      expect(res2.quota?.remaining).toBe(1);

      const res3 = await checkAiRateLimit({
        identifier: 'quota-user-1',
        scope: 'teacher',
        store,
      });
      expect(res3.allowed).toBe(true);
      expect(res3.quota?.remaining).toBe(0);

      // 4. Anfrage ueberschreitet das kumulative Kontingent
      const res4 = await checkAiRateLimit({
        identifier: 'quota-user-1',
        scope: 'teacher',
        store,
      });
      expect(res4.allowed).toBe(false);
      expect(res4.quotaExceeded).toBe(true);
      expect(res4.quotaType).toBe('cumulative');
    });

    it('erzeugt passenden 429-Header und Fehlermeldung bei Kontingentsueberschreitung', () => {
      const quotaResult = {
        allowed: false,
        limit: 100,
        remaining: 0,
        retryAfterSeconds: 3600,
        resetMs: 3600000,
        quotaExceeded: true,
        quotaType: 'cumulative' as const,
      };

      const response = createRateLimitResponse(quotaResult);
      expect(response.status).toBe(429);
      expect(response.headers.get('X-RateLimit-Type')).toBe('cumulative-quota');
      expect(response.headers.get('Retry-After')).toBe('3600');
    });
  });

  describe('Endpunkt-Integration: app/api/exams/parse-rubric/route.ts', () => {
    it('lehnt Anfragen mit 429 ab, wenn Ratenlimit oder Kontingent erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-parse-test' });

      // Kontingent verbrauchen
      await checkAiRateLimit({
        identifier: 'lehrer-parse-test',
        scope: 'teacher',
        endpoint: 'parse-rubric',
      });

      const req = new Request('http://localhost:3000/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rubricText: 'Aufgabe 1: 5 Punkte' }),
      });

      const res = await parseRubricPost(req);
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      const body = await res.json();
      expect(body.error).toContain('Ratenlimit');
    });

    it('beeintraechtigt andere Lehrer nicht (Tenant-Trennung)', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';

      await checkAiRateLimit({
        identifier: 'lehrer-1',
        scope: 'teacher',
        endpoint: 'parse-rubric',
      });

      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-2' });

      const req = new Request('http://localhost:3000/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      const res = await parseRubricPost(req);
      expect(res.status).not.toBe(429);
    });
  });

  describe('Endpunkt-Integration: app/api/submissions/[id]/replace/route.ts', () => {
    it('lehnt Anfragen mit 429 ab, wenn Ratenlimit oder Kontingent erschoepft ist', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';
      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-replace-test' });

      await checkAiRateLimit({
        identifier: 'lehrer-replace-test',
        scope: 'teacher',
        endpoint: 'replace',
      });

      const req = new Request('http://localhost:3000/api/submissions/sub-1/replace', {
        method: 'POST',
      });

      const res = await replacePost(req, { params: Promise.resolve({ id: 'sub-1' }) });
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeTruthy();
      const body = await res.json();
      expect(body.error).toContain('Ratenlimit');
    });

    it('beeintraechtigt andere Lehrer nicht (Tenant-Trennung)', async () => {
      process.env.AI_RATE_LIMIT_MAX_REQUESTS = '1';

      await checkAiRateLimit({
        identifier: 'lehrer-1',
        scope: 'teacher',
        endpoint: 'replace',
      });

      vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-2' });

      const req = new Request('http://localhost:3000/api/submissions/sub-1/replace', {
        method: 'POST',
      });

      const res = await replacePost(req, { params: Promise.resolve({ id: 'sub-1' }) });
      expect(res.status).not.toBe(429);
    });
  });

  describe('Schweizer Rechtschreibung (kein Eszett)', () => {
    it('enthaelt kein Eszett in allen betroffenen Quellcode- und Testdateien', async () => {
      const eszett = String.fromCharCode(0xdf);
      const filesToCheck = [
        path.resolve(__dirname, '../../lib/rate-limit.ts'),
        path.resolve(__dirname, '../../app/api/correct/route.ts'),
        path.resolve(__dirname, '../../app/api/exams/generate/route.ts'),
        path.resolve(__dirname, '../../app/api/exams/[id]/regenerate-task/route.ts'),
        path.resolve(__dirname, '../../app/api/mobile-relay/upload/route.ts'),
        path.resolve(__dirname, '../../app/api/exams/parse-rubric/route.ts'),
        path.resolve(__dirname, '../../app/api/submissions/[id]/replace/route.ts'),
        path.resolve(__dirname, './rate-limit.test.ts'),
      ];

      for (const f of filesToCheck) {
        const content = await fs.readFile(f, 'utf-8');
        expect(content).not.toContain(eszett);
      }
    });
  });
});
