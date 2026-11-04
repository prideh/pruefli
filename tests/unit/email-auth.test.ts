import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  sendTransactionalEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  renderVerificationEmail,
  renderPasswordResetEmail,
  renderOAuthLinkConfirmationEmail,
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
  markEmailVerificationPending,
  isEmailVerified,
  isEmailVerificationFlagEnabled,
  isEmailVerificationEnforcementEnabled,
  getEmailVerificationCutoffDate,
  isTeacherGrandfathered,
  getEmailVerificationStatus,
  requireVerifiedEmailForApi,
  requireVerifiedEmailForPaidAi,
  EMAIL_VERIFICATION_REQUIRED_CODE,
  ENFORCE_EMAIL_VERIFICATION_COOKIE,
  resetVerificationMemoryState,
} from '@/lib/email-verification';
import { getAuthRateLimitConfig } from '@/lib/rate-limit';
import fs from 'fs';
import path from 'path';

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

    it('zeigt im HTML-Footer aller drei Transaktions-Vorlagen nur "prüefli" ohne "Bildungsinformatik Schweiz" (Issue #108)', () => {
      const verification = renderVerificationEmail(
        'Sabine Grossmann',
        'https://pruefli.ch/verify-email?token=xyz'
      );
      const passwordReset = renderPasswordResetEmail(
        'Urs Schweizer',
        'https://pruefli.ch/reset-password?token=abc'
      );
      const oauthLink = renderOAuthLinkConfirmationEmail(
        'Frau Meier',
        'Google',
        'https://pruefli.ch/link-confirm?token=def'
      );

      for (const tpl of [verification, passwordReset, oauthLink]) {
        expect(tpl.htmlContent).toContain(
          '<p style="margin: 0 0 6px 0; font-weight: 600; color: #475569;">prüefli</p>'
        );
        expect(tpl.htmlContent).not.toContain('Bildungsinformatik Schweiz');
      }
    });

    it('enthaelt im HTML-Template der Verifizierungs-E-Mail kein falsches Freischalt-Versprechen (Issue #109)', () => {
      const { htmlContent, textContent } = renderVerificationEmail(
        'Sabine Grossmann',
        'https://pruefli.ch/verify-email?token=xyz'
      );

      expect(htmlContent).toContain(
        'Vielen Dank für deine Registrierung bei <strong>prüefli</strong>. Bitte bestätige deine E-Mail-Adresse mit folgendem Link:'
      );
      expect(htmlContent).not.toContain('um dein Konto zu aktivieren');
      expect(htmlContent).not.toContain('vollen Zugriff auf alle Korrektur-Funktionen');
      expect(textContent).toContain(
        'Bitte bestätige deine E-Mail-Adresse, indem du folgenden Link aufrufst:'
      );
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
      const testTeacherId = `teacher-new-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      expect(await isEmailVerified(testTeacherId)).toBe(false);

      await markEmailVerified(testTeacherId, 'neu@schule.ch');

      expect(await isEmailVerified(testTeacherId)).toBe(true);
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

  describe('Serverseitige Durchsetzung der E-Mail-Verifizierung & Rollout-Schutz (Issue #98)', () => {
    it('verhindert Lockout bei aktivem EMAIL_VERIFICATION_ENFORCED, solange Brevo Live-Sending inaktiv ist', async () => {
      expect(isEmailVerificationFlagEnabled()).toBe(false);
      expect(await isEmailVerificationEnforcementEnabled()).toBe(false);

      // Flag aktiviert, aber Brevo noch hinter dem Review-Gate -> Enforcement bleibt aus!
      process.env.EMAIL_VERIFICATION_ENFORCED = 'true';
      expect(isEmailVerificationFlagEnabled()).toBe(true);
      expect(isLiveSendingEnabled()).toBe(false);
      expect(await isEmailVerificationEnforcementEnabled()).toBe(false);

      // Sobald Brevo Live-Sending aktiv ist (BREVO_LIVE_SENDING=true + BREVO_API_KEY), greift Enforcement
      process.env.BREVO_LIVE_SENDING = 'true';
      process.env.BREVO_API_KEY = 'xkeysib-live-key';
      expect(isLiveSendingEnabled()).toBe(true);
      expect(await isEmailVerificationEnforcementEnabled()).toBe(true);
    });

    it('erlaubt explizite Aktivierung im Mock-Modus via EMAIL_VERIFICATION_ALLOW_MOCK oder E2E-Cookie', async () => {
      process.env.EMAIL_VERIFICATION_ENFORCED = 'true';
      process.env.EMAIL_VERIFICATION_ALLOW_MOCK = 'true';
      expect(await isEmailVerificationEnforcementEnabled()).toBe(true);

      delete process.env.EMAIL_VERIFICATION_ENFORCED;
      delete process.env.EMAIL_VERIFICATION_ALLOW_MOCK;

      const reqWithCookie = new Request('http://localhost/api/classes', {
        headers: {
          cookie: `${ENFORCE_EMAIL_VERIFICATION_COOKIE}=true`,
        },
      });
      expect(await isEmailVerificationEnforcementEnabled({ request: reqWithCookie })).toBe(true);

      // Explizites Deaktivieren via EMAIL_VERIFICATION_ENFORCED=false ueberstimmt auch das Cookie
      process.env.EMAIL_VERIFICATION_ENFORCED = 'false';
      expect(await isEmailVerificationEnforcementEnabled({ request: reqWithCookie })).toBe(false);
    });

    it('schuetzt Bestandskonten (Grandfathering vor Stichtag) vor Aussperrung und sperrt Neuregistrierungen bis zur Verifizierung', async () => {
      process.env.EMAIL_VERIFICATION_ENFORCED = 'true';
      process.env.BREVO_LIVE_SENDING = 'true';
      process.env.BREVO_API_KEY = 'xkeysib-live-key';
      process.env.EMAIL_VERIFICATION_CUTOFF_DATE = '2026-04-01T00:00:00.000Z';

      expect(getEmailVerificationCutoffDate().toISOString()).toBe('2026-04-01T00:00:00.000Z');

      // 1. Bestandskonto vor dem Stichtag registriert -> grandfathered, kein Zwang
      const legacyStatus = await getEmailVerificationStatus('teacher-legacy', {
        email: 'altbestand@schule.ch',
        createdAt: new Date('2026-01-15T10:00:00.000Z'),
      });
      expect(legacyStatus.isEmailVerified).toBe(false);
      expect(legacyStatus.isGrandfathered).toBe(true);
      expect(legacyStatus.enforcementEnabled).toBe(true);
      expect(legacyStatus.emailVerificationRequired).toBe(false);
      expect(
        await isTeacherGrandfathered({
          teacherId: 'teacher-legacy',
          createdAt: '2026-01-15T10:00:00.000Z',
        })
      ).toBe(true);

      // 2. Neuregistrierung nach dem Stichtag -> muss verifizieren (HTTP 403 auf geschuetzten APIs)
      const newTeacherId = `teacher-new-unverified-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newStatus = await getEmailVerificationStatus(newTeacherId, {
        email: 'neu@schule.ch',
        createdAt: new Date('2026-04-02T12:00:00.000Z'),
      });
      expect(newStatus.isEmailVerified).toBe(false);
      expect(newStatus.isGrandfathered).toBe(false);
      expect(newStatus.enforcementEnabled).toBe(true);
      expect(newStatus.emailVerificationRequired).toBe(true);

      const blockedRes = await requireVerifiedEmailForApi(newTeacherId);
      expect(blockedRes).not.toBeNull();
      expect(blockedRes?.status).toBe(403);
      const blockedBody = await blockedRes!.json();
      expect(blockedBody.code).toBe(EMAIL_VERIFICATION_REQUIRED_CODE);
      expect(blockedBody.emailVerificationRequired).toBe(true);
      expect(blockedBody.error).toContain('E-Mail-Adresse');

      // 3. Nach Bestaetigung der E-Mail -> voller Zugriff (kein 403 mehr)
      await markEmailVerified(newTeacherId, 'neu@schule.ch');
      const verifiedStatus = await getEmailVerificationStatus(newTeacherId, {
        email: 'neu@schule.ch',
        createdAt: new Date('2026-04-02T12:00:00.000Z'),
      });
      expect(verifiedStatus.isEmailVerified).toBe(true);
      expect(verifiedStatus.emailVerificationRequired).toBe(false);
      expect(await requireVerifiedEmailForApi(newTeacherId)).toBeNull();
    });

    it('stellt sicher, dass alle geaenderten Verifizierungs-Dateien ausschliesslich "ss" statt Eszett verwenden', () => {
      const files = [
        '../../lib/email-verification.ts',
        '../../components/DashboardLayout.tsx',
        '../../components/EmailVerificationAiBanner.tsx',
        '../../components/QrScannerDialog.tsx',
        '../../app/verify-email/page.tsx',
        '../../app/dashboard/page.tsx',
        '../../app/exams/page.tsx',
        '../../app/exams/[id]/page.tsx',
        '../../app/correct/[id]/page.tsx',
        '../../app/api/auth/me/route.ts',
        '../../app/api/auth/login/route.ts',
        '../../app/api/auth/register/route.ts',
        '../../app/api/correct/route.ts',
        '../../app/api/exams/generate/route.ts',
        '../../app/api/exams/[id]/regenerate-task/route.ts',
        '../../app/api/exams/parse-rubric/route.ts',
        '../../app/api/submissions/[id]/replace/route.ts',
        '../../app/api/mobile-relay/upload/route.ts',
      ];
      for (const rel of files) {
        const content = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toMatch(/\u00df/);
      }
    });
  });

  describe('Gezieltes Gating bezahlter KI-Aufrufe an bestaetigte E-Mail (Issue #110)', () => {
    it('laesst das pauschale Gate (#98) standardmaessig deaktiviert, sperrt aber bezahlte KI-Aufrufe ohne Bestandsgarantie fuer unbestaetigte Konten mit 403 EMAIL_VERIFICATION_REQUIRED', async () => {
      // Standardzustand: EMAIL_VERIFICATION_ENFORCED ist NICHT gesetzt -> pauschales Gate bleibt aus
      delete process.env.EMAIL_VERIFICATION_ENFORCED;
      expect(isEmailVerificationFlagEnabled()).toBe(false);
      expect(await isEmailVerificationEnforcementEnabled()).toBe(false);

      const unverifiedTeacherId = `teacher-unverified-110-${Date.now()}`;
      await markEmailVerificationPending(unverifiedTeacherId, 'unverified110@schule.ch');

      // Selbst mit altem createdAt vor dem Cutoff gibt es fuer bezahlte KI-Aufrufe KEINE automatische Bestandsgarantie
      const status = await getEmailVerificationStatus(unverifiedTeacherId, {
        email: 'unverified110@schule.ch',
        createdAt: new Date('2025-01-01T00:00:00.000Z'),
      });
      expect(status.isEmailVerified).toBe(false);
      expect(status.emailVerificationRequired).toBe(false); // Pauschales #98-Gate bleibt aus
      expect(status.paidAiVerificationRequired).toBe(true); // Gezieltes #110-KI-Gate ist aktiv

      // Normale Nicht-LLM-Endpunkte bleiben frei zugaenglich
      expect(await requireVerifiedEmailForApi(unverifiedTeacherId)).toBeNull();

      // Bezahlte KI-Endpunkte liefern HTTP 403 mit EMAIL_VERIFICATION_REQUIRED
      const blockedAiRes = await requireVerifiedEmailForPaidAi(unverifiedTeacherId);
      expect(blockedAiRes).not.toBeNull();
      expect(blockedAiRes?.status).toBe(403);
      const blockedBody = await blockedAiRes!.json();
      expect(blockedBody.code).toBe(EMAIL_VERIFICATION_REQUIRED_CODE);
      expect(blockedBody.emailVerificationRequired).toBe(true);
      expect(blockedBody.error).toContain('E-Mail-Adresse');

      // Nach E-Mail-Bestaetigung (oder OAuth-Verknuepfung) sind bezahlte KI-Aufrufe sofort freigeschaltet
      await markEmailVerified(unverifiedTeacherId, 'unverified110@schule.ch');
      const verifiedStatus = await getEmailVerificationStatus(unverifiedTeacherId, {
        email: 'unverified110@schule.ch',
      });
      expect(verifiedStatus.isEmailVerified).toBe(true);
      expect(verifiedStatus.paidAiVerificationRequired).toBe(false);
      expect(await requireVerifiedEmailForPaidAi(unverifiedTeacherId)).toBeNull();
    });

    it('bindet EmailVerificationAiBanner und deaktivierte Trigger-Buttons an allen Einstiegspunkten bezahlter KI-Funktionen ein', () => {
      const bannerSource = fs.readFileSync(
        path.resolve(__dirname, '../../components/EmailVerificationAiBanner.tsx'),
        'utf-8'
      );
      expect(bannerSource).toContain('paid-ai-verification-banner');
      expect(bannerSource).toContain('Bestätigungs-E-Mail erneut senden');
      expect(bannerSource).toContain('/api/auth/resend-verification');

      const uiEntryPoints = [
        '../../app/dashboard/page.tsx',
        '../../app/exams/page.tsx',
        '../../app/exams/[id]/page.tsx',
        '../../app/correct/[id]/page.tsx',
        '../../components/QrScannerDialog.tsx',
      ];
      for (const rel of uiEntryPoints) {
        const content = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');
        expect(content, `${rel} muss EmailVerificationAiBanner einbinden`).toContain(
          'EmailVerificationAiBanner'
        );
        expect(content, `${rel} muss useTeacherSession fuer isUnverified nutzen`).toContain(
          'isUnverified'
        );
      }
    });
  });
});
