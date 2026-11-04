import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { POST as loginPost } from '@/app/api/auth/login/route';
import { POST as registerPost } from '@/app/api/auth/register/route';
import {
  checkAuthRateLimit,
  createAuthRateLimitResponse,
  getAuthRateLimitConfig,
  extractClientIp,
  resetRateLimits,
  InMemoryRateLimitStore,
  type RateLimitStore,
} from '@/lib/rate-limit';
import * as authModule from '@/lib/auth';
import { db } from '@/lib/db';
import fs from 'fs';
import path from 'path';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
  createSession: vi.fn(),
  deleteSession: vi.fn(),
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
  },
}));

describe('Schutz: Anmelde- und Registrierungs-Endpunkte gegen Brute-Force absichern', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.AUTH_RATE_LIMIT_LOGIN_MAX_REQUESTS;
    delete process.env.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS;
    delete process.env.AUTH_RATE_LIMIT_REGISTER_MAX_REQUESTS;
    delete process.env.AUTH_RATE_LIMIT_REGISTER_WINDOW_SECONDS;
    delete process.env.AUTH_RATE_LIMIT_MAX_REQUESTS;
    delete process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS;
    resetRateLimits();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    resetRateLimits();
  });

  describe('extractClientIp Helper', () => {
    it('extrahiert IP praezise aus X-Forwarded-For und X-Real-IP', () => {
      const reqForwarded = new Request('http://localhost/api/auth/login', {
        headers: { 'x-forwarded-for': '198.51.100.42, 10.0.0.1' },
      });
      expect(extractClientIp(reqForwarded)).toBe('198.51.100.42');

      const reqRealIp = new Request('http://localhost/api/auth/login', {
        headers: { 'x-real-ip': '203.0.113.19' },
      });
      expect(extractClientIp(reqRealIp)).toBe('203.0.113.19');

      const reqFallback = new Request('http://localhost/api/auth/login');
      expect(extractClientIp(reqFallback)).toBe('127.0.0.1');
    });
  });

  describe('getAuthRateLimitConfig & checkAuthRateLimit', () => {
    it('verwendet sichere Standardwerte (5 Versuche / 60 Sekunden)', () => {
      const config = getAuthRateLimitConfig('login');
      expect(config.maxRequests).toBe(5);
      expect(config.windowSeconds).toBe(60);
      expect(config.windowMs).toBe(60000);
    });

    it('erlaubt Konfiguration via Umgebungsvariablen', () => {
      process.env.AUTH_RATE_LIMIT_LOGIN_MAX_REQUESTS = '3';
      process.env.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS = '120';
      const loginConfig = getAuthRateLimitConfig('login');
      expect(loginConfig.maxRequests).toBe(3);
      expect(loginConfig.windowSeconds).toBe(120);

      process.env.AUTH_RATE_LIMIT_REGISTER_MAX_REQUESTS = '2';
      process.env.AUTH_RATE_LIMIT_REGISTER_WINDOW_SECONDS = '300';
      const registerConfig = getAuthRateLimitConfig('register');
      expect(registerConfig.maxRequests).toBe(2);
      expect(registerConfig.windowSeconds).toBe(300);
    });

    it('blockiert IP-Adresse bei zu vielen Fehlversuchen', async () => {
      const store = new InMemoryRateLimitStore();

      for (let i = 0; i < 5; i++) {
        const res = await checkAuthRateLimit({
          action: 'login',
          ip: '192.168.1.10',
          email: `attacker-${i}@school.ch`,
          store,
        });
        expect(res.allowed).toBe(true);
      }

      // 6. Versuch von der gleichen IP wird blockiert
      const blockedRes = await checkAuthRateLimit({
        action: 'login',
        ip: '192.168.1.10',
        email: 'attacker-target@school.ch',
        store,
      });
      expect(blockedRes.allowed).toBe(false);

      // Andere IP ist nicht blockiert (IP-Trennung)
      const allowedRes = await checkAuthRateLimit({
        action: 'login',
        ip: '192.168.1.99',
        email: 'legit-user@school.ch',
        store,
      });
      expect(allowedRes.allowed).toBe(true);
    });

    it('blockiert gezielte Angriffe auf eine E-Mail-Adresse auch ueber wechselnde IPs', async () => {
      const store = new InMemoryRateLimitStore();
      const targetEmail = 'victim-teacher@school.ch';

      for (let i = 0; i < 5; i++) {
        const res = await checkAuthRateLimit({
          action: 'login',
          ip: `10.0.0.${i + 1}`, // Unterschiedliche IPs (Botnet/Proxy)
          email: targetEmail,
          store,
        });
        expect(res.allowed).toBe(true);
      }

      // 6. Versuch auf dieselbe E-Mail wird abgewiesen, obwohl die IP neu ist
      const blockedRes = await checkAuthRateLimit({
        action: 'login',
        ip: '10.0.0.99',
        email: targetEmail,
        store,
      });
      expect(blockedRes.allowed).toBe(false);
    });

    it('erzwingt Fail-Closed Verhalten: Speicherfehler blockiert Versuche sicher', async () => {
      const brokenStore: RateLimitStore = {
        consume: () => {
          throw new Error('Redis connection failure');
        },
        reset: () => {},
      };

      const res = await checkAuthRateLimit({
        action: 'login',
        ip: '127.0.0.1',
        email: 'user@school.ch',
        store: brokenStore,
      });

      // Kritischer Sicherheitscheck: Bei Speicherfehler wird KEIN freier Durchgang gewaehrt
      expect(res.allowed).toBe(false);
      expect(res.failedClosed).toBe(true);
      expect(res.retryAfterSeconds).toBeGreaterThan(0);

      const errResponse = createAuthRateLimitResponse(res, 'login');
      expect(errResponse.status).toBe(429);
      const json = await errResponse.json();
      expect(json.error).toContain('vorübergehend');
    });
  });

  describe('Endpunkt-Integration: POST /api/auth/login', () => {
    it('lehnt Anfragen mit 429 ab, sobald das Login-Ratenlimit erreicht ist', async () => {
      process.env.AUTH_RATE_LIMIT_LOGIN_MAX_REQUESTS = '2';

      vi.mocked(db.teacher.findUnique).mockResolvedValue({
        id: 't-1',
        name: 'Herr Keller',
        email: 'keller@schule.ch',
        passwordHash: 'hash',
      } as unknown as Awaited<ReturnType<typeof db.teacher.findUnique>>);
      vi.mocked(authModule.verifyPassword).mockResolvedValue(false); // Falsches Passwort

      const makeRequest = () =>
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '198.51.100.5',
          },
          body: JSON.stringify({ email: 'keller@schule.ch', password: 'wrong-pass' }),
        });

      // Versuch 1: 401
      const res1 = await loginPost(makeRequest());
      expect(res1.status).toBe(401);

      // Versuch 2: 401
      const res2 = await loginPost(makeRequest());
      expect(res2.status).toBe(401);

      // Versuch 3: 429 Ratenlimit ueberschritten
      const res3 = await loginPost(makeRequest());
      expect(res3.status).toBe(429);
      expect(res3.headers.get('Retry-After')).toBeTruthy();
      expect(res3.headers.get('X-RateLimit-Type')).toBe('auth');

      const body3 = await res3.json();
      expect(body3.error).toBe(
        'Zu viele Anmeldeversuche. Bitte warten Sie einen Moment, bevor Sie es erneut versuchen.'
      );
    });
  });

  describe('Endpunkt-Integration: POST /api/auth/register', () => {
    it('lehnt Anfragen mit 429 ab, sobald das Register-Ratenlimit erreicht ist', async () => {
      process.env.AUTH_RATE_LIMIT_REGISTER_MAX_REQUESTS = '2';

      vi.mocked(db.teacher.findUnique).mockResolvedValue(null);
      vi.mocked(authModule.hashPassword).mockResolvedValue('hashed_pw');
      vi.mocked(db.teacher.create).mockResolvedValue({
        id: 'new-id',
        name: 'Neu',
        email: 'neu@schule.ch',
        passwordHash: 'hashed_pw',
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const makeRequest = (i: number) =>
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-forwarded-for': '203.0.113.88',
          },
          body: JSON.stringify({
            name: `User ${i}`,
            email: `user${i}@schule.ch`,
            password: 'validPassword123',
            confirmPassword: 'validPassword123',
          }),
        });

      const res1 = await registerPost(makeRequest(1));
      expect(res1.status).toBe(200);

      const res2 = await registerPost(makeRequest(2));
      expect(res2.status).toBe(200);

      // 3. Versuch: 429 Ratenlimit
      const res3 = await registerPost(makeRequest(3));
      expect(res3.status).toBe(429);
      expect(res3.headers.get('Retry-After')).toBeTruthy();

      const body3 = await res3.json();
      expect(body3.error).toBe(
        'Zu viele Registrierungsversuche. Bitte warten Sie einen Moment, bevor Sie es erneut versuchen.'
      );
    });
  });

  describe('Schweizer Rechtschreibung (kein Eszett)', () => {
    it('enthaelt kein Eszett in allen betroffenen Dateien', () => {
      const filesToCheck = [
        '../../lib/rate-limit.ts',
        '../../app/api/auth/login/route.ts',
        '../../app/api/auth/register/route.ts',
      ];

      for (const rel of filesToCheck) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
