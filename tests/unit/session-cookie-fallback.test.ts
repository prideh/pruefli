import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  createSession,
  getSession,
  verifySessionToken,
  resetSessionStoreForTests,
} from '@/lib/session';

/**
 * Regression: ein Request OHNE Session-Cookie darf in Production niemals ueber das
 * prozessglobale Fallback-Cookie-Jar als zuletzt aktive Session authentifiziert werden.
 * Das Jar existiert ausschliesslich als Test-Transport (cookies() wirft ausserhalb
 * eines Next.js-Request-Kontexts).
 */
describe('Session-Cookie-Fallback: niemals in Production', () => {
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
});
