import { describe, it, expect, beforeEach } from 'vitest';
import {
  renderOAuthLinkConfirmationEmail,
  sendOAuthLinkConfirmationEmail,
  getMockSentEmails,
  clearMockSentEmails,
  redactEmail,
} from '@/lib/email';

describe('OAuth Link Confirmation Emails (lib/email.ts)', () => {
  beforeEach(() => {
    clearMockSentEmails();
  });

  it('renders de-CH Swiss German email templates without Eszett', () => {
    const rendered = renderOAuthLinkConfirmationEmail(
      'Frau Meier',
      'Google',
      'https://pruefli.ch/link-confirm?token=xyz'
    );

    expect(rendered.subject).toBe('prüefli-Konto mit Google verknüpfen');
    expect(rendered.textContent).toContain('Grüezi Frau Meier');
    expect(rendered.textContent).toContain('Freundliche Grüsse');
    expect(rendered.textContent).not.toContain('ß');
    expect(rendered.htmlContent).toContain('Konto-Verknüpfung');
    expect(rendered.htmlContent).not.toContain('ß');
  });

  it('sends link confirmation email via mock transport and logs safely', async () => {
    const res = await sendOAuthLinkConfirmationEmail({
      toEmail: 'lehrer@schule.ch',
      toName: 'Frau Meier',
      providerName: 'Microsoft',
      confirmToken: 'test-token-777',
    });

    expect(res.success).toBe(true);
    expect(res.simulated).toBe(true);

    const history = getMockSentEmails();
    expect(history.length).toBe(1);
    expect(history[0].to.email).toBe('lehrer@schule.ch');
    expect(history[0].template).toBe('oauth_link');
    expect(history[0].subject).toContain('Microsoft');
  });

  it('redacts email addresses cleanly for privacy-safe logs', () => {
    expect(redactEmail('lehrer@schule.ch')).toBe('le***@schule.ch');
    expect(redactEmail('a@b.com')).toBe('a***@b.com');
  });
});
