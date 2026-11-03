import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createSession,
  getSession,
  verifySessionToken,
  resetSessionStoreForTests,
} from '@/lib/session';
import { GET as examsGet } from '@/app/api/exams/route';
import { GET as classesGet } from '@/app/api/classes/route';
import { GET as subjectsGet } from '@/app/api/subjects/route';
import { GET as submissionsGet } from '@/app/api/submissions/route';

/**
 * Regression: ein Request OHNE Session-Cookie darf in Production oder bei explizitem
 * Request-Objekt niemals ueber das prozessglobale Fallback-Cookie-Jar als zuletzt
 * aktive Session authentifiziert werden.
 * Das Jar existiert ausschliesslich als Test-Transport fuer direkte getSession()-Aufrufe
 * ohne Request-Objekt (cookies() wirft ausserhalb eines Next.js-Request-Kontexts).
 */
describe('Session-Cookie-Fallback: niemals in Production & niemals fuer explizite Requests ohne Cookie', () => {
  beforeEach(() => {
    resetSessionStoreForTests();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('nutzt das Fallback-Jar als Test-Transport ausserhalb von Production', async () => {
    await createSession('teacher-test-transport');
    const session = await getSession();
    expect(session).not.toBeNull();
    expect(session?.userId).toBe('teacher-test-transport');
  });

  it('authentifiziert in Production ohne Request-Cookie niemals ueber das vorbefuellte Jar', async () => {
    // Konsistentes Secret, damit Signatur und Verifikation ueber den Env-Wechsel
    // hinweg denselben Schluessel nutzen.
    vi.stubEnv('JWT_SECRET', 'test-only-production-secret');

    // Ein frueherer Login im selben Prozess hat das Jar befuellt (Test-Modus).
    await createSession('teacher-victim');

    // Production-Verhalten: Request ohne Cookie muss "keine Session" bedeuten.
    vi.stubEnv('NODE_ENV', 'production');
    const session = await getSession();
    expect(session).toBeNull();

    // Kontrolle: das Jar war korrekt befuellt und das Token gueltig - einzig der
    // Production-Modus unterscheidet das Ergebnis (NODE_ENV zurueck auf test,
    // JWT_SECRET bleibt fuer konsistente Signatur gestubbt).
    vi.stubEnv('NODE_ENV', 'test');
    const control = await getSession();
    expect(control?.userId).toBe('teacher-victim');
  });

  it('schreibt das Fallback-Jar in Production beim Session-Setzen gar nicht erst', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('JWT_SECRET', 'test-only-production-secret');
    await createSession('teacher-no-jar-write');

    // Zurueck im Test-Modus: das Jar darf keine Production-Session enthalten.
    vi.unstubAllEnvs();
    const session = await getSession();
    expect(session).toBeNull();
  });

  it('laesst die Verifikation eines gueltigen Session-Tokens in Production unveraendert zu', async () => {
    // Der echte Request-Pfad (Cookie vorhanden -> Token-Verifikation) bleibt funktionsfaehig.
    vi.stubEnv('JWT_SECRET', 'test-only-production-secret');
    const { token } = await createSession('teacher-with-cookie');
    vi.stubEnv('NODE_ENV', 'production');

    const verified = await verifySessionToken(token);
    expect(verified).not.toBeNull();
    expect(verified?.userId).toBe('teacher-with-cookie');
  });

  it('weist explizite Request-Aufrufe ohne Session-Cookie an /api/exams, /api/classes, /api/subjects und /api/submissions selbst bei befuelltem Fallback-Jar strikt mit 401 ab (Issue #101)', async () => {
    // Selbst wenn im selben Prozess zuvor eine Session im Fallback-Jar angelegt wurde,
    // darf ein expliziter HTTP-Request ohne Cookie niemals diese fremde Session erben.
    await createSession('teacher-previous-in-process');

    const [resExams, resClasses, resSubjects, resSubmissions] = await Promise.all([
      examsGet(new Request('http://localhost/api/exams')),
      classesGet(new Request('http://localhost/api/classes')),
      subjectsGet(new Request('http://localhost/api/subjects')),
      submissionsGet(new Request('http://localhost/api/submissions')),
    ]);

    expect(resExams.status).toBe(401);
    expect(resClasses.status).toBe(401);
    expect(resSubjects.status).toBe(401);
    expect(resSubmissions.status).toBe(401);
  });
});
