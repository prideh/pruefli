import { getAppUrl } from '@/lib/app-url';

export interface EmailRecipient {
  email: string;
  name?: string;
}

export interface EmailSender {
  email: string;
  name: string;
}

export interface SendEmailOptions {
  to: EmailRecipient;
  subject: string;
  textContent: string;
  htmlContent: string;
  template: 'verification' | 'password_reset' | 'oauth_link' | 'general';
}

export interface SendEmailResult {
  success: boolean;
  sent?: boolean;
  liveSendingEnabled?: boolean;
  messageId?: string;
  simulated?: boolean;
  error?: string;
}

export const EMAIL_TRANSPORT_INACTIVE_MESSAGE =
  'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine E-Mail versendet.';

export interface MockSentEmail {
  id: string;
  timestamp: string;
  to: EmailRecipient;
  from: EmailSender;
  subject: string;
  textContent: string;
  htmlContent: string;
  template: string;
}

export const DEFAULT_SENDER: EmailSender = {
  name: 'prüefli',
  email: 'no-reply@pruefli.ch',
};

export const SUPPORT_EMAIL = 'support@pruefli.ch';

// In-memory mock transport history for tests and review-gate logging
const mockSentEmails: MockSentEmail[] = [];

/**
 * Returns a copy of all mock-sent emails (used in unit/integration tests).
 */
export function getMockSentEmails(): MockSentEmail[] {
  return [...mockSentEmails];
}

/**
 * Clears the mock-sent email history.
 */
export function clearMockSentEmails(): void {
  mockSentEmails.length = 0;
}

/**
 * Anonymizes an email address for safe logging without exfiltrating PII.
 * Example: "lehrer@schule.ch" -> "le***@schule.ch"
 */
export function redactEmail(email: string): string {
  if (!email || !email.includes('@')) return '***@***';
  const [localPart, domain] = email.split('@');
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  return `${visible}***@${domain}`;
}

/**
 * Checks whether live sending via Brevo is explicitly enabled.
 * Default is FALSE (Mock-Transport) as per the Instinct Review-Gate specification.
 */
export function isLiveSendingEnabled(): boolean {
  return (
    process.env.BREVO_LIVE_SENDING === 'true' &&
    typeof process.env.BREVO_API_KEY === 'string' &&
    process.env.BREVO_API_KEY.trim().length > 0
  );
}

/**
 * Renders the de-CH Swiss German verification email text & HTML templates.
 * Strict Swiss German: uses "ss" exclusively, never Eszett.
 */
export function renderVerificationEmail(
  name: string,
  verificationUrl: string
): {
  subject: string;
  textContent: string;
  htmlContent: string;
} {
  const safeName = name?.trim() || 'Lehrperson';
  const subject = 'Bestätige deine E-Mail-Adresse für prüefli';

  const textContent = `Grüezi ${safeName}

Vielen Dank für deine Registrierung bei prüefli.

Bitte bestätige deine E-Mail-Adresse, indem du folgenden Link aufrufst:
${verificationUrl}

Dieser Bestätigungslink ist 24 Stunden gültig. Falls du dieses Konto nicht erstellt hast, kannst du diese Nachricht ignorieren.

Freundliche Grüsse
Dein prüefli-Team
https://pruefli.ch`;

  const htmlContent = `<!DOCTYPE html>
<html lang="de-CH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);" cellspacing="0" cellpadding="0">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
              <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">prüefli</span>
              <span style="display: block; font-size: 13px; color: #94a3b8; margin-top: 4px; font-weight: 500;">KI-gestützte Prüfungskorrektur für Schweizer Schulen</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h1 style="font-size: 20px; font-weight: 750; color: #0f172a; margin-top: 0; margin-bottom: 16px;">Grüezi ${safeName}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
                Vielen Dank für deine Registrierung bei <strong>prüefli</strong>. Bitte bestätige deine E-Mail-Adresse, um dein Konto zu aktivieren und vollen Zugriff auf alle Korrektur-Funktionen zu erhalten.
              </p>
              <!-- Action Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="left" style="border-radius: 8px; background-color: #1b77d1;">
                    <a href="${verificationUrl}" target="_blank" style="display: inline-block; padding: 13px 26px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 8px;">
                      E-Mail-Adresse bestätigen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px;">
                Dieser Bestätigungslink ist <strong>24 Stunden gültig</strong>. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
              </p>
              <p style="font-size: 12px; line-height: 1.4; color: #1b77d1; word-break: break-all; margin-top: 6px;">
                <a href="${verificationUrl}" style="color: #1b77d1; text-decoration: underline;">${verificationUrl}</a>
              </p>
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px; margin-bottom: 0;">
                Falls du dieses Konto nicht angefordert hast, kannst du diese Nachricht einfach ignorieren.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; font-size: 12px; color: #64748b; text-align: left;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #475569;">prüefli</p>
              <p style="margin: 0; color: #94a3b8;">
                Diese E-Mail wurde automatisch von <a href="https://pruefli.ch" style="color: #64748b; text-decoration: underline;">pruefli.ch</a> versendet.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, textContent, htmlContent };
}

/**
 * Renders the de-CH Swiss German password reset email text & HTML templates.
 * Strict Swiss German: uses "ss" exclusively, never Eszett.
 */
export function renderPasswordResetEmail(
  name: string,
  resetUrl: string
): {
  subject: string;
  textContent: string;
  htmlContent: string;
} {
  const safeName = name?.trim() || 'Lehrperson';
  const subject = 'Passwort zurücksetzen für prüefli';

  const textContent = `Grüezi ${safeName}

Wir haben eine Anfrage zum Zurücksetzen deines Passworts bei prüefli erhalten.

Klicke auf folgenden Link, um dein neues Passwort festzulegen:
${resetUrl}

Dieser Link ist 1 Stunde gültig. Falls du kein neues Passwort angefordert hast, kannst du diese Nachricht ignorieren. Dein bisheriges Passwort bleibt unverändert gültig.

Freundliche Grüsse
Dein prüefli-Team
https://pruefli.ch`;

  const htmlContent = `<!DOCTYPE html>
<html lang="de-CH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);" cellspacing="0" cellpadding="0">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
              <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">prüefli</span>
              <span style="display: block; font-size: 13px; color: #94a3b8; margin-top: 4px; font-weight: 500;">Sicherer Passwort-Reset</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h1 style="font-size: 20px; font-weight: 750; color: #0f172a; margin-top: 0; margin-bottom: 16px;">Grüezi ${safeName}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
                Wir haben eine Anfrage zum Zurücksetzen deines Passworts bei <strong>prüefli</strong> erhalten. Über den folgenden Button kannst du ein neues Passwort wählen:
              </p>
              <!-- Action Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="left" style="border-radius: 8px; background-color: #1b77d1;">
                    <a href="${resetUrl}" target="_blank" style="display: inline-block; padding: 13px 26px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 8px;">
                      Passwort jetzt zurücksetzen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px;">
                Dieser Link ist aus Sicherheitsgründen <strong>1 Stunde gültig</strong>. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
              </p>
              <p style="font-size: 12px; line-height: 1.4; color: #1b77d1; word-break: break-all; margin-top: 6px;">
                <a href="${resetUrl}" style="color: #1b77d1; text-decoration: underline;">${resetUrl}</a>
              </p>
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px; margin-bottom: 0;">
                Falls du diese Anfrage nicht veranlasst hast, kannst du diese Nachricht ignorieren. Dein bisheriges Passwort bleibt unverändert sicher.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; font-size: 12px; color: #64748b; text-align: left;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #475569;">prüefli</p>
              <p style="margin: 0; color: #94a3b8;">
                Diese E-Mail wurde automatisch von <a href="https://pruefli.ch" style="color: #64748b; text-decoration: underline;">pruefli.ch</a> versendet.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, textContent, htmlContent };
}

/**
 * Core send routine dispatching via Brevo HTTP API or simulated Mock-Transport.
 */
export async function sendTransactionalEmail(options: SendEmailOptions): Promise<SendEmailResult> {
  const { to, subject, textContent, htmlContent, template } = options;

  if (!to.email || !to.email.includes('@')) {
    return { success: false, error: 'Ungültige Empfänger-E-Mail-Adresse.' };
  }

  // 1. Mock-Transport check (Review-Gate requirement)
  if (!isLiveSendingEnabled()) {
    const mockId = `mock-${crypto.randomUUID()}`;
    const logEntry: MockSentEmail = {
      id: mockId,
      timestamp: new Date().toISOString(),
      to,
      from: DEFAULT_SENDER,
      subject,
      textContent,
      htmlContent,
      template,
    };
    mockSentEmails.push(logEntry);
    if (mockSentEmails.length > 200) {
      mockSentEmails.shift();
    }

    // Safe, non-PII log output
    const isKeyConfigured = Boolean(process.env.BREVO_API_KEY && process.env.BREVO_API_KEY.trim());
    const reason = !isKeyConfigured
      ? 'BREVO_API_KEY nicht gesetzt'
      : 'BREVO_LIVE_SENDING nicht aktiv (Review-Gate)';
    console.info(
      `[EMAIL_MOCK] Vorlage "${template}" an ${redactEmail(to.email)} simuliert (${reason}, id: ${mockId})`
    );

    return {
      success: true,
      sent: false,
      liveSendingEnabled: false,
      messageId: mockId,
      simulated: true,
    };
  }

  // 2. Live HTTP API sending via Brevo endpoint (POST https://api.brevo.com/v3/smtp/email)
  const apiKey = process.env.BREVO_API_KEY!.trim();

  try {
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'api-key': apiKey,
      },
      body: JSON.stringify({
        sender: DEFAULT_SENDER,
        to: [
          {
            email: to.email.toLowerCase(),
            name: to.name || undefined,
          },
        ],
        replyTo: {
          email: SUPPORT_EMAIL,
          name: 'prüefli Support',
        },
        subject,
        htmlContent,
        textContent,
      }),
    });

    if (!res.ok) {
      let errorDetail = `HTTP ${res.status}`;
      try {
        const errorJson = await res.json();
        errorDetail = errorJson.message || errorJson.code || errorDetail;
      } catch {
        // Fallback for non-JSON response
      }
      console.error(
        `[BREVO_ERROR] Transaktions-Mail an ${redactEmail(to.email)} fehlgeschlagen: ${errorDetail}`
      );
      return {
        success: false,
        sent: false,
        liveSendingEnabled: true,
        simulated: false,
        error: `E-Mail-Versand fehlgeschlagen: ${errorDetail}`,
      };
    }

    const data = await res.json();
    return {
      success: true,
      sent: true,
      liveSendingEnabled: true,
      messageId: data.messageId,
      simulated: false,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Netzwerkfehler';
    console.error(
      `[BREVO_EXCEPTION] Transaktions-Mail an ${redactEmail(to.email)} fehlgeschlagen: ${errorMsg}`
    );
    return {
      success: false,
      sent: false,
      liveSendingEnabled: true,
      simulated: false,
      error: `E-Mail-Versand nicht möglich: ${errorMsg}`,
    };
  }
}

/**
 * Sends an email verification link to a registered teacher.
 */
export async function sendVerificationEmail(params: {
  toEmail: string;
  toName: string;
  verificationToken: string;
}): Promise<SendEmailResult> {
  const { toEmail, toName, verificationToken } = params;
  const baseUrl = getAppUrl();
  const verificationUrl = `${baseUrl}/verify-email?token=${encodeURIComponent(verificationToken)}`;

  const { subject, textContent, htmlContent } = renderVerificationEmail(toName, verificationUrl);

  return sendTransactionalEmail({
    to: { email: toEmail, name: toName },
    subject,
    textContent,
    htmlContent,
    template: 'verification',
  });
}

/**
 * Sends a password reset link to a teacher.
 */
export async function sendPasswordResetEmail(params: {
  toEmail: string;
  toName: string;
  resetToken: string;
}): Promise<SendEmailResult> {
  const { toEmail, toName, resetToken } = params;
  const baseUrl = getAppUrl();
  const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(resetToken)}`;

  const { subject, textContent, htmlContent } = renderPasswordResetEmail(toName, resetUrl);

  return sendTransactionalEmail({
    to: { email: toEmail, name: toName },
    subject,
    textContent,
    htmlContent,
    template: 'password_reset',
  });
}

/**
 * Renders the de-CH Swiss German OAuth link confirmation email templates.
 * Strict Swiss German: uses "ss" exclusively, never Eszett.
 */
export function renderOAuthLinkConfirmationEmail(
  name: string,
  providerName: string,
  confirmationUrl: string
): {
  subject: string;
  textContent: string;
  htmlContent: string;
} {
  const safeName = name?.trim() || 'Lehrperson';
  const subject = `prüefli-Konto mit ${providerName} verknüpfen`;

  const textContent = `Grüezi ${safeName}

Wir haben eine Anfrage erhalten, dein bestehendes prüefli-Konto mit deinem ${providerName}-Konto zu verknüpfen.

Aus Sicherheitsgründen wird diese Verknüpfung erst nach deiner Bestätigung aktiviert. Klicke auf folgenden Link, um die Verknüpfung zu bestätigen:
${confirmationUrl}

Dieser Bestätigungslink ist 24 Stunden gültig. Falls du diese Verknüpfung nicht angefordert hast, kannst du diese Nachricht ignorieren. Es werden keine Änderungen an deinem Konto vorgenommen.

Freundliche Grüsse
Dein prüefli-Team
https://pruefli.ch`;

  const htmlContent = `<!DOCTYPE html>
<html lang="de-CH">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #0f172a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f1f5f9; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 14px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(15, 23, 42, 0.05);" cellspacing="0" cellpadding="0">
          <!-- Header -->
          <tr>
            <td style="background-color: #0f172a; padding: 24px 32px; text-align: left;">
              <span style="font-size: 22px; font-weight: 800; color: #ffffff; letter-spacing: -0.02em;">prüefli</span>
              <span style="display: block; font-size: 13px; color: #94a3b8; margin-top: 4px; font-weight: 500;">Sichere Konto-Verknüpfung</span>
            </td>
          </tr>
          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px 28px 32px;">
              <h1 style="font-size: 20px; font-weight: 750; color: #0f172a; margin-top: 0; margin-bottom: 16px;">Grüezi ${safeName}</h1>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
                Wir haben eine Anfrage erhalten, dein bestehendes prüefli-Konto mit deinem <strong>${providerName}</strong>-Konto zu verknüpfen.
              </p>
              <p style="font-size: 15px; line-height: 1.6; color: #334155; margin-bottom: 24px;">
                Zum Schutz deines Kontos vor unberechtigtem Zugriff wird ein Nachweis der Konto-Inhaberschaft vorausgesetzt. Bitte bestätige die Verknüpfung über die folgende Schaltfläche:
              </p>
              <!-- Action Button -->
              <table role="presentation" cellspacing="0" cellpadding="0" style="margin: 28px 0;">
                <tr>
                  <td align="left" style="border-radius: 8px; background-color: #1b77d1;">
                    <a href="${confirmationUrl}" target="_blank" style="display: inline-block; padding: 13px 26px; font-size: 15px; font-weight: 700; color: #ffffff; text-decoration: none; border-radius: 8px;">
                      Konto-Verknüpfung jetzt bestätigen
                    </a>
                  </td>
                </tr>
              </table>
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px;">
                Dieser Bestätigungslink ist <strong>24 Stunden gültig</strong>. Falls der Button nicht funktioniert, kopiere diesen Link in deinen Browser:
              </p>
              <p style="font-size: 12px; line-height: 1.4; color: #1b77d1; word-break: break-all; margin-top: 6px;">
                <a href="${confirmationUrl}" style="color: #1b77d1; text-decoration: underline;">${confirmationUrl}</a>
              </p>
              <p style="font-size: 13px; line-height: 1.5; color: #64748b; margin-top: 24px; margin-bottom: 0;">
                Falls du diese Verknüpfung nicht angefordert hast, kannst du diese Nachricht ignorieren. Es werden keine Änderungen an deinem Konto vorgenommen.
              </p>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; font-size: 12px; color: #64748b; text-align: left;">
              <p style="margin: 0 0 6px 0; font-weight: 600; color: #475569;">prüefli</p>
              <p style="margin: 0; color: #94a3b8;">
                Diese E-Mail wurde automatisch von <a href="https://pruefli.ch" style="color: #64748b; text-decoration: underline;">pruefli.ch</a> versendet.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return { subject, textContent, htmlContent };
}

/**
 * Sends an email link to confirm account linking.
 */
export async function sendOAuthLinkConfirmationEmail(params: {
  toEmail: string;
  toName: string;
  providerName: string;
  confirmToken: string;
}): Promise<SendEmailResult> {
  const { toEmail, toName, providerName, confirmToken } = params;
  const baseUrl = getAppUrl();
  const confirmationUrl = `${baseUrl}/api/auth/oauth/link-confirm-email?token=${encodeURIComponent(confirmToken)}`;

  const { subject, textContent, htmlContent } = renderOAuthLinkConfirmationEmail(
    toName,
    providerName,
    confirmationUrl
  );

  return sendTransactionalEmail({
    to: { email: toEmail, name: toName },
    subject,
    textContent,
    htmlContent,
    template: 'oauth_link',
  });
}
