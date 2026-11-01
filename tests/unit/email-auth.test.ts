import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendTransactionalEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  renderVerificationEmail,
  renderPasswordResetEmail,
  getMockSentEmails,
  clearMockSentEmails,
  isLiveSendingEnabled,
  redactEmail,
  DEFAULT_SENDER,
} from '@/lib/email';
import {
  signEmailVerificationToken,
  verifyEmailVerificationToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  verifyJWT,
  signJWT,
} from '@/lib/jwt';
import {
  markEmailVerified,
  isEmailVerified,
  resetVerificationMemoryState,
} from '@/lib/email-verification';
import { getAuthRateLimitConfig } from '@/lib/rate-limit';

describe('Transaktions-E-Mails via Brevo & Auth Workflows (Issue #59)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.BREVO_API_KEY;
    delete process.env.BREVO_LIVE_SENDING;
    clearMockSentEmails();
    resetVerificationMemoryState();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('Review-Gate & Mock-Transport Verhalten', () => {
    it('verwendet standardmaessig Mock-Transport ohne externen Netzwerkaufruf', async () => {
      expect(isLiveSendingEnabled()).toBe(false);

      const result = await sendVerificationEmail({
        toEmail: 'lehrerin@schule-zuerich.ch',
        toName: 'Frau Meier',
        verificationToken: 'test-token-12345',
      });

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(result.messageId).toContain('mock-');

      const mockHistory = getMockSentEmails();
      expect(mockHistory.length).toBe(1);
      expect(mockHistory[0].to.email).toBe('lehrerin@schule-zuerich.ch');
      expect(mockHistory[0].from.email).toBe(DEFAULT_SENDER.email);
      expect(mockHistory[0].from.name).toBe(DEFAULT_SENDER.name);
      expect(mockHistory[0].subject).toContain('Bestätige deine E-Mail-Adresse für prüefli');
    });

    it('bleibt im Mock-Modus selbst wenn BREVO_API_KEY existiert, solange BREVO_LIVE_SENDING nicht aktiv ist', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-mock-secret-key-123';
      process.env.BREVO_LIVE_SENDING = 'false';

      expect(isLiveSendingEnabled()).toBe(false);

      const result = await sendPasswordResetEmail({
        toEmail: 'rektor@gymnasium-bern.ch',
        toName: 'Herr Keller',
        resetToken: 'reset-token-67890',
      });

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(true);
      expect(getMockSentEmails().length).toBe(1);
    });

    it('sendet ueber die Brevo HTTP API wenn BREVO_LIVE_SENDING=true und Key konfiguriert ist', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-live-key';
      process.env.BREVO_LIVE_SENDING = 'true';

      expect(isLiveSendingEnabled()).toBe(true);

      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ messageId: '<brevo-msg-id-123@smtp-relay.mailin.fr>' }), {
          status: 201,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await sendPasswordResetEmail({
        toEmail: 'lehrer@kantonsschule.ch',
        toName: 'Beat Wyss',
        resetToken: 'jwt-reset-token',
      });

      expect(result.success).toBe(true);
      expect(result.simulated).toBe(false);
      expect(result.messageId).toBe('<brevo-msg-id-123@smtp-relay.mailin.fr>');

      expect(fetchSpy).toHaveBeenCalledWith(
        'https://api.brevo.com/v3/smtp/email',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            'api-key': 'xkeysib-live-key',
            'content-type': 'application/json',
          }),
        })
      );

      // Verify request payload details
      const callArgs = fetchSpy.mock.calls[0];
      const requestBody = JSON.parse(callArgs[1]?.body as string);
      expect(requestBody.sender.email).toBe('no-reply@pruefli.ch');
      expect(requestBody.sender.name).toBe('prüefli');
      expect(requestBody.to[0].email).toBe('lehrer@kantonsschule.ch');
      expect(requestBody.replyTo.email).toBe('support@pruefli.ch');
    });

    it('behandelt API-Fehler von Brevo sauber ohne Abbruch', async () => {
      process.env.BREVO_API_KEY = 'xkeysib-invalid-key';
      process.env.BREVO_LIVE_SENDING = 'true';

      vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ code: 'unauthorized', message: 'Key not found' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      );

      const result = await sendTransactionalEmail({
        to: { email: 'test@schule.ch' },
        subject: 'Test',
        textContent: 'Test',
        htmlContent: '<p>Test</p>',
        template: 'general',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Key not found');
    });

    it('verhindert PII-Exfiltration durch korrekte E-Mail-Reduktion', () => {
      expect(redactEmail('beat.schneider@schule-basel.ch')).toBe('be***@schule-basel.ch');
      expect(redactEmail('a@b.ch')).toBe('a***@b.ch');
      expect(redactEmail('ungueltig')).toBe('***@***');
    });
  });

  describe('Schweizer Hochdeutsch Sprachkonventionen (Striktes "ss", kein Eszett)', () => {
    it('enthaelt in der Verifizierungs-Vorlage ausnahmslos "ss" statt Eszett', () => {
      const { subject, textContent, htmlContent } = renderVerificationEmail(
        'Sabine Grossmann',
        'https://pruefli.ch/verify-email?token=xyz'
      );

      expect(subject).not.toMatch(/\u00df/);
      expect(textContent).not.toMatch(/\u00df/);
      expect(htmlContent).not.toMatch(/\u00df/);

      // Schweizer Grussformel
      expect(textContent).toContain('Grüezi Sabine Grossmann');
      expect(textContent).toContain('Freundliche Grüsse');
      expect(textContent).toContain('Bestätigungslink');
      expect(textContent).toContain('https://pruefli.ch');
      expect(htmlContent).toContain('E-Mail-Adresse bestätigen');
    });

    it('enthaelt in der Passwort-Reset-Vorlage ausnahmslos "ss" statt Eszett', () => {
      const { subject, textContent, htmlContent } = renderPasswordResetEmail(
        'Urs Schweizer',
        'https://pruefli.ch/reset-password?token=abc'
      );

      expect(subject).not.toMatch(/\u00df/);
      expect(textContent).not.toMatch(/\u00df/);
      expect(htmlContent).not.toMatch(/\u00df/);

      expect(textContent).toContain('Grüezi Urs Schweizer');
      expect(textContent).toContain('Freundliche Grüsse');
      expect(textContent).toContain('Zurücksetzen deines Passworts');
      expect(textContent).toContain('1 Stunde gültig');
      expect(textContent).toContain('unverändert gültig');
    });
  });

  describe('Kryptographische Token-Sicherheit (JWT & Jose)', () => {
    it('erzeugt und verifiziert gueltige E-Mail-Verifizierungs-Tokens', async () => {
      const token = await signEmailVerificationToken({
        teacherId: 'teacher-uuid-1',
        email: 'lehrerin@schule.ch',
      });

      const payload = await verifyEmailVerificationToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.teacherId).toBe('teacher-uuid-1');
      expect(payload?.email).toBe('lehrerin@schule.ch');
      expect(payload?.purpose).toBe('email_verification');
    });

    it('erzeugt und verifiziert gueltige Passwort-Reset-Tokens mit Hash-Prefix', async () => {
      const token = await signPasswordResetToken({
        teacherId: 'teacher-uuid-2',
        email: 'lehrer@schule.ch',
        pwdHashPrefix: 'a1b2c3d4e5f60718',
      });

      const payload = await verifyPasswordResetToken(token);
      expect(payload).not.toBeNull();
      expect(payload?.teacherId).toBe('teacher-uuid-2');
      expect(payload?.email).toBe('lehrer@schule.ch');
      expect(payload?.pwdHashPrefix).toBe('a1b2c3d4e5f60718');
      expect(payload?.purpose).toBe('password_reset');
    });

    it('verhindert Token-Verwechslungs-Angriffe (Cross-Purpose-Protection)', async () => {
      const verificationToken = await signEmailVerificationToken({
        teacherId: 'teacher-1',
        email: 'lehrer@schule.ch',
      });

      // Verifizierungs-Token darf nicht als Passwort-Reset-Token durchgehen
      const resetAttempt = await verifyPasswordResetToken(verificationToken);
      expect(resetAttempt).toBeNull();

      // Verifizierungs-Token darf nicht als Session-Cookie durchgehen
      const sessionAttempt = await verifyJWT(verificationToken);
      expect(sessionAttempt).toBeNull();

      const resetToken = await signPasswordResetToken({
        teacherId: 'teacher-1',
        email: 'lehrer@schule.ch',
        pwdHashPrefix: '1234567890abcdef',
      });

      // Reset-Token darf nicht als Verifizierungs-Token durchgehen
      const verifyAttempt = await verifyEmailVerificationToken(resetToken);
      expect(verifyAttempt).toBeNull();

      // Reset-Token darf nicht als Session-Cookie durchgehen
      const resetSessionAttempt = await verifyJWT(resetToken);
      expect(resetSessionAttempt).toBeNull();

      // Normales Session-Token darf nicht als Verifizierungs-Token oder Reset-Token durchgehen
      const normalSessionToken = await signJWT({ userId: 'teacher-1' });
      expect(await verifyEmailVerificationToken(normalSessionToken)).toBeNull();
      expect(await verifyPasswordResetToken(normalSessionToken)).toBeNull();
    });
  });

  describe('Verifizierungs-Status-Verwaltung', () => {
    it('markiert und erkennt verifizierte Konten korrekt', async () => {
      expect(await isEmailVerified('teacher-new')).toBe(false);

      await markEmailVerified('teacher-new', 'neu@schule.ch');

      expect(await isEmailVerified('teacher-new')).toBe(true);
    });
  });

  describe('Ratenlimit-Konfiguration fuer Auth- und E-Mail-Aktionen', () => {
    it('definiert Schutzgrenzen fuer Passwort-Reset und erneuten Versand', () => {
      const forgotConfig = getAuthRateLimitConfig('forgot-password');
      expect(forgotConfig.maxRequests).toBe(5);
      expect(forgotConfig.windowSeconds).toBe(60);

      const resetConfig = getAuthRateLimitConfig('reset-password');
      expect(resetConfig.maxRequests).toBe(5);

      const resendConfig = getAuthRateLimitConfig('resend-verification');
      expect(resendConfig.maxRequests).toBe(3);
    });
  });
});
