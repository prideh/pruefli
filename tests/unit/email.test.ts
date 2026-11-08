import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

const {
  mockTeacherFindUnique,
  mockTeacherCreate,
  mockTeacherUpdate,
  mockExecuteRawUnsafe,
  mockQueryRawUnsafe,
  mockGetSession,
  mockCreateSession,
} = vi.hoisted(() => ({
  mockTeacherFindUnique: vi.fn(),
  mockTeacherCreate: vi.fn(),
  mockTeacherUpdate: vi.fn(),
  mockExecuteRawUnsafe: vi.fn(),
  mockQueryRawUnsafe: vi.fn(),
  mockGetSession: vi.fn(),
  mockCreateSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    teacher: {
      findUnique: mockTeacherFindUnique,
      create: mockTeacherCreate,
      update: mockTeacherUpdate,
    },
    $executeRawUnsafe: mockExecuteRawUnsafe,
    $queryRawUnsafe: mockQueryRawUnsafe,
  },
}));

vi.mock('@/lib/session', () => ({
  getSession: mockGetSession,
  createSession: mockCreateSession,
}));

import {
  renderOAuthLinkConfirmationEmail,
  sendOAuthLinkConfirmationEmail,
  sendVerificationEmail,
  sendPasswordResetEmail,
  getMockSentEmails,
  clearMockSentEmails,
  redactEmail,
  isLiveSendingEnabled,
} from '@/lib/email';
import {
  markEmailVerified,
  isEmailVerified,
  resetVerificationMemoryState,
} from '@/lib/email-verification';
import {
  signJWT,
  signEmailVerificationToken,
  signPasswordResetToken,
  signMobileRelayToken,
} from '@/lib/jwt';
import { hashPassword, verifyPassword } from '@/lib/auth';
import { resetRateLimits } from '@/lib/rate-limit';
import { POST as forgotPasswordPOST } from '@/app/api/auth/forgot-password/route';
import { POST as resendVerificationPOST } from '@/app/api/auth/resend-verification/route';
import { POST as verifyEmailPOST } from '@/app/api/auth/verify-email/route';
import { POST as resetPasswordPOST } from '@/app/api/auth/reset-password/route';
import { POST as registerPOST } from '@/app/api/auth/register/route';
import { POST as loginPOST } from '@/app/api/auth/login/route';
import { GET as meGET } from '@/app/api/auth/me/route';
import { GET as classesGET, POST as classesPOST } from '@/app/api/classes/route';
import { GET as examsGET } from '@/app/api/exams/route';
import { GET as submissionsGET } from '@/app/api/submissions/route';
import { GET as subjectsGET } from '@/app/api/subjects/route';
import { GET as logsGET } from '@/app/api/logs/route';
import { POST as correctPOST } from '@/app/api/correct/route';
import { POST as generatePOST } from '@/app/api/exams/generate/route';
import { POST as regenerateTaskPOST } from '@/app/api/exams/[id]/regenerate-task/route';
import { POST as parseRubricPOST } from '@/app/api/exams/parse-rubric/route';
import { POST as replacePOST } from '@/app/api/submissions/[id]/replace/route';
import { POST as mobileRelayUploadPOST } from '@/app/api/mobile-relay/upload/route';
import { GET as geminiHealthGET } from '@/app/api/health/gemini/route';

describe('Email Transport, Anti-Enumeration & Verification/Reset Lifecycle (Issue #70)', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;

  // Simulated PostgreSQL state for teacher and teacher_email_verifications
  let teachersTable: Map<string, { id: string; email: string; name: string; passwordHash: string }>;
  let verificationsTable: Map<string, { teacher_id: string; email: string; verified_at: Date }>;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.BREVO_LIVE_SENDING;
    delete process.env.BREVO_API_KEY;

    clearMockSentEmails();
    resetVerificationMemoryState();
    resetRateLimits();
    vi.clearAllMocks();

    teachersTable = new Map();
    verificationsTable = new Map();

    const initialHash = await hashPassword('InitialPass123!');
    teachersTable.set('teacher-1', {
      id: 'teacher-1',
      email: 'lehrer@schule.ch',
      name: 'Frau Meier',
      passwordHash: initialHash,
    });
    teachersTable.set('teacher-verified', {
      id: 'teacher-verified',
      email: 'verified@schule.ch',
      name: 'Herr Keller',
      passwordHash: initialHash,
    });
    verificationsTable.set('teacher-verified', {
      teacher_id: 'teacher-verified',
      email: 'verified@schule.ch',
      verified_at: new Date(),
    });

    mockGetSession.mockResolvedValue(null);
    mockCreateSession.mockResolvedValue(undefined);

    mockTeacherFindUnique.mockImplementation(
      async ({ where }: { where: { id?: string; email?: string } }) => {
        if (where.id) {
          return teachersTable.get(where.id) || null;
        }
        if (where.email) {
          const target = where.email.toLowerCase();
          for (const t of teachersTable.values()) {
            if (t.email.toLowerCase() === target) return t;
          }
        }
        return null;
      }
    );

    mockTeacherCreate.mockImplementation(
      async ({ data }: { data: { name: string; email: string; passwordHash: string } }) => {
        const created = {
          id: `teacher-${teachersTable.size + 1}`,
          name: data.name,
          email: data.email.toLowerCase(),
          passwordHash: data.passwordHash,
        };
        teachersTable.set(created.id, created);
        return created;
      }
    );

    mockTeacherUpdate.mockImplementation(
      async ({
        where,
        data,
      }: {
        where: { id: string };
        data: { passwordHash?: string; email?: string };
      }) => {
        const existing = teachersTable.get(where.id);
        if (!existing) throw new Error('Not found');
        const updated = {
          ...existing,
          ...(data.passwordHash ? { passwordHash: data.passwordHash } : {}),
          ...(data.email ? { email: data.email } : {}),
        };
        teachersTable.set(where.id, updated);
        return updated;
      }
    );

    mockExecuteRawUnsafe.mockImplementation(
      async (sql: string, teacherId?: string, email?: string) => {
        if (sql.includes('INSERT INTO teacher_email_verifications') && teacherId && email) {
          verificationsTable.set(teacherId, {
            teacher_id: teacherId,
            email: email.toLowerCase(),
            verified_at: new Date(),
          });
        }
        return 1;
      }
    );

    mockQueryRawUnsafe.mockImplementation(async (sql: string, teacherId?: string) => {
      if (sql.includes('FROM teacher_email_verifications') && teacherId) {
        const row = verificationsTable.get(teacherId);
        return row ? [row] : [];
      }
      return [];
    });
  });

  afterEach(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    clearMockSentEmails();
    resetVerificationMemoryState();
  });

  describe('1. Review-Gate Double-Lock & Honest Transport State (lib/email.ts)', () => {
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

    it('keeps live sending disabled unless BOTH BREVO_LIVE_SENDING=true and BREVO_API_KEY are set', async () => {
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy as unknown as typeof fetch;

      // Default: neither set
      expect(isLiveSendingEnabled()).toBe(false);

      // Only API key set -> still mock mode, never calls external fetch
      process.env.BREVO_API_KEY = 'xkeysib-test-key';
      expect(isLiveSendingEnabled()).toBe(false);
      const resKeyOnly = await sendVerificationEmail({
        toEmail: 'lehrer@schule.ch',
        toName: 'Frau Meier',
        verificationToken: 'tok-1',
      });
      expect(resKeyOnly.simulated).toBe(true);
      expect(resKeyOnly.sent).toBe(false);
      expect(resKeyOnly.liveSendingEnabled).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      // Only BREVO_LIVE_SENDING=true without API key -> still mock mode
      delete process.env.BREVO_API_KEY;
      process.env.BREVO_LIVE_SENDING = 'true';
      expect(isLiveSendingEnabled()).toBe(false);
      const resFlagOnly = await sendPasswordResetEmail({
        toEmail: 'lehrer@schule.ch',
        toName: 'Frau Meier',
        resetToken: 'tok-2',
      });
      expect(resFlagOnly.simulated).toBe(true);
      expect(resFlagOnly.sent).toBe(false);
      expect(resFlagOnly.liveSendingEnabled).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();

      expect(getMockSentEmails()).toHaveLength(2);
    });

    it('sends link confirmation email via mock transport and redacts email addresses safely', async () => {
      const res = await sendOAuthLinkConfirmationEmail({
        toEmail: 'lehrer@schule.ch',
        toName: 'Frau Meier',
        providerName: 'Microsoft',
        confirmToken: 'test-token-777',
      });

      expect(res.success).toBe(true);
      expect(res.simulated).toBe(true);
      expect(res.sent).toBe(false);
      expect(res.liveSendingEnabled).toBe(false);

      const history = getMockSentEmails();
      expect(history.length).toBe(1);
      expect(history[0].to.email).toBe('lehrer@schule.ch');
      expect(history[0].template).toBe('oauth_link');

      expect(redactEmail('lehrer@schule.ch')).toBe('le***@schule.ch');
      expect(redactEmail('a@b.com')).toBe('a***@b.com');
    });
  });

  describe('2. Honest Transport Status & Anti-Enumeration on forgot-password', () => {
    it('returns uniform honest inactive status in Mock mode without leaking account existence', async () => {
      const reqExisting = new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'lehrer@schule.ch' }),
      });
      const resExisting = await forgotPasswordPOST(reqExisting);
      const dataExisting = await resExisting.json();

      const reqUnknown = new Request('http://localhost/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'unbekannt@schule.ch' }),
      });
      const resUnknown = await forgotPasswordPOST(reqUnknown);
      const dataUnknown = await resUnknown.json();

      // Anti-enumeration: identical HTTP status and body for existing vs non-existing email
      expect(resExisting.status).toBe(200);
      expect(resUnknown.status).toBe(200);
      expect(dataExisting).toEqual(dataUnknown);

      // Honest transport status: must NOT claim an email was sent when Mock-Transport is active
      expect(dataExisting.sent).toBe(false);
      expect(dataExisting.simulated).toBe(true);
      expect(dataExisting.liveSendingEnabled).toBe(false);
      expect(dataExisting.status).toBe('email_delivery_inactive');
      expect(dataExisting.message).toContain('E-Mail-Versand ist derzeit nicht aktiv');
      expect(dataExisting.message).not.toContain('wurde eine E-Mail mit einem Link');

      // Internal mock transport still recorded the reset email only for the existing teacher
      expect(getMockSentEmails()).toHaveLength(1);
      expect(getMockSentEmails()[0].to.email).toBe('lehrer@schule.ch');
    });

    it('returns uniform anti-enumeration sent status when Live Sending is enabled', async () => {
      process.env.BREVO_LIVE_SENDING = 'true';
      process.env.BREVO_API_KEY = 'xkeysib-live-test-key';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: '<brevo-123@pruefli.ch>' }),
      }) as unknown as typeof fetch;

      const resExisting = await forgotPasswordPOST(
        new Request('http://localhost/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'lehrer@schule.ch' }),
        })
      );
      const dataExisting = await resExisting.json();

      const resUnknown = await forgotPasswordPOST(
        new Request('http://localhost/api/auth/forgot-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'niemand@schule.ch' }),
        })
      );
      const dataUnknown = await resUnknown.json();

      expect(resExisting.status).toBe(200);
      expect(resUnknown.status).toBe(200);
      expect(dataExisting).toEqual(dataUnknown);
      expect(dataExisting.sent).toBe(true);
      expect(dataExisting.simulated).toBe(false);
      expect(dataExisting.liveSendingEnabled).toBe(true);
      expect(dataExisting.message).toContain('Falls ein Konto mit dieser E-Mail-Adresse existiert');
    });
  });

  describe('3. Anti-Enumeration & Honest Transport Status on resend-verification', () => {
    it('closes account enumeration gap on unauthenticated path (identical response for existing, verified, and non-existing emails)', async () => {
      // 1. Existing unverified account
      const resUnverified = await resendVerificationPOST(
        new Request('http://localhost/api/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'lehrer@schule.ch' }),
        })
      );
      const dataUnverified = await resUnverified.json();

      // 2. Non-existing account (previously returned 400 -> enumeration leak!)
      const resNonExisting = await resendVerificationPOST(
        new Request('http://localhost/api/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'nicht-existent@schule.ch' }),
        })
      );
      const dataNonExisting = await resNonExisting.json();

      // 3. Existing already-verified account (must not leak alreadyVerified on unauthenticated path)
      const resAlreadyVerified = await resendVerificationPOST(
        new Request('http://localhost/api/auth/resend-verification', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'verified@schule.ch' }),
        })
      );
      const dataAlreadyVerified = await resAlreadyVerified.json();

      expect(resUnverified.status).toBe(200);
      expect(resNonExisting.status).toBe(200);
      expect(resAlreadyVerified.status).toBe(200);

      expect(dataUnverified).toEqual(dataNonExisting);
      expect(dataUnverified).toEqual(dataAlreadyVerified);

      // Honest transport status in Mock mode
      expect(dataUnverified.sent).toBe(false);
      expect(dataUnverified.simulated).toBe(true);
      expect(dataUnverified.liveSendingEnabled).toBe(false);
      expect(dataUnverified.message).toContain('E-Mail-Versand ist derzeit nicht aktiv');
      expect(dataUnverified.message).not.toContain('erfolgreich gesendet');

      // Only the unverified existing account triggered an internal mock email
      expect(getMockSentEmails()).toHaveLength(1);
      expect(getMockSentEmails()[0].to.email).toBe('lehrer@schule.ch');
    });

    it('reports honest inactive transport status on authenticated session resend, register, and /api/auth/me', async () => {
      mockGetSession.mockResolvedValue({ userId: 'teacher-1' });

      const resResend = await resendVerificationPOST(
        new Request('http://localhost/api/auth/resend-verification', {
          method: 'POST',
        })
      );
      const dataResend = await resResend.json();

      expect(resResend.status).toBe(200);
      expect(dataResend.sent).toBe(false);
      expect(dataResend.simulated).toBe(true);
      expect(dataResend.liveSendingEnabled).toBe(false);
      expect(dataResend.status).toBe('email_delivery_inactive');
      expect(dataResend.message).toContain('E-Mail-Versand ist derzeit nicht aktiv');

      const resMe = await meGET(new Request('http://localhost/api/auth/me'));
      const dataMe = await resMe.json();
      expect(dataMe.authenticated).toBe(true);
      expect(dataMe.isEmailVerified).toBe(false);
      expect(dataMe.liveSendingEnabled).toBe(false);

      const resReg = await registerPOST(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Neue Lehrperson',
            email: 'neu@schule.ch',
            password: 'SecurePass123!',
            confirmPassword: 'SecurePass123!',
          }),
        })
      );
      const dataReg = await resReg.json();
      expect(resReg.status).toBe(200);
      expect(dataReg.liveSendingEnabled).toBe(false);
      expect(dataReg.emailVerification.sent).toBe(false);
      expect(dataReg.emailVerification.simulated).toBe(true);
      expect(dataReg.emailVerification.liveSendingEnabled).toBe(false);
      expect(dataReg.emailVerification.status).toBe('email_delivery_inactive');
    });
  });

  describe('4. Deterministic Store & Route Lifecycle: Email Verification (teacher_email_verifications)', () => {
    it('persists verification in teacher_email_verifications and survives in-memory cache reset', async () => {
      expect(await isEmailVerified('teacher-1', 'lehrer@schule.ch')).toBe(false);

      await markEmailVerified('teacher-1', 'lehrer@schule.ch');
      expect(await isEmailVerified('teacher-1', 'lehrer@schule.ch')).toBe(true);

      // Clear in-memory state to verify DB query against teacher_email_verifications
      resetVerificationMemoryState();
      expect(await isEmailVerified('teacher-1', 'lehrer@schule.ch')).toBe(true);
      expect(mockQueryRawUnsafe).toHaveBeenCalled();

      // Ownership binding in store: mismatched email is not considered verified
      expect(await isEmailVerified('teacher-1', 'changed@schule.ch')).toBe(false);
    });

    it('enforces single-use (replay prevention against DB), expiry, purpose-binding, and ownership on POST /api/auth/verify-email', async () => {
      const validToken = await signEmailVerificationToken({
        teacherId: 'teacher-1',
        email: 'lehrer@schule.ch',
      });

      // 1. First use succeeds and writes to teacher_email_verifications
      const firstRes = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: validToken }),
        })
      );
      const firstData = await firstRes.json();
      expect(firstRes.status).toBe(200);
      expect(firstData.success).toBe(true);
      expect(verificationsTable.has('teacher-1')).toBe(true);

      // 2. Replay check against DB (even after clearing in-memory cache): second use of same token is rejected
      resetVerificationMemoryState();
      const replayRes = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: validToken }),
        })
      );
      const replayData = await replayRes.json();
      expect(replayRes.status).toBe(400);
      expect(replayData.error).toContain('bereits verwendet');

      // 3. Expired token is rejected
      teachersTable.set('teacher-exp', {
        id: 'teacher-exp',
        email: 'exp@schule.ch',
        name: 'Herr Ablauf',
        passwordHash: 'hash',
      });
      const expiredToken = await signEmailVerificationToken(
        { teacherId: 'teacher-exp', email: 'exp@schule.ch' },
        '-1s'
      );
      const expRes = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: expiredToken }),
        })
      );
      expect(expRes.status).toBe(400);
      expect(verificationsTable.has('teacher-exp')).toBe(false);

      // 4. Purpose-binding: password_reset token and session JWT are rejected on verify-email route
      const resetToken = await signPasswordResetToken({
        teacherId: 'teacher-exp',
        email: 'exp@schule.ch',
        pwdHashPrefix: '1234567890abcdef',
      });
      const wrongPurposeRes1 = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: resetToken }),
        })
      );
      expect(wrongPurposeRes1.status).toBe(400);

      const sessionToken = await signJWT({ userId: 'teacher-exp' });
      const wrongPurposeRes2 = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: sessionToken }),
        })
      );
      expect(wrongPurposeRes2.status).toBe(400);

      // 5. Ownership-binding: token issued for old/foreign email does not match teacher's current DB email
      const mismatchedEmailToken = await signEmailVerificationToken({
        teacherId: 'teacher-exp',
        email: 'fremd@schule.ch',
      });
      const mismatchRes = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: mismatchedEmailToken }),
        })
      );
      expect(mismatchRes.status).toBe(400);
      expect(verificationsTable.has('teacher-exp')).toBe(false);
    });
  });

  describe('5. Deterministic Route & DB Lifecycle: Password Reset (POST /api/auth/reset-password)', () => {
    it('enforces single-use via DB pwdHashPrefix replay check, expiry, purpose-binding, and email ownership', async () => {
      const teacherBefore = teachersTable.get('teacher-1')!;
      const validResetToken = await signPasswordResetToken({
        teacherId: teacherBefore.id,
        email: teacherBefore.email,
        pwdHashPrefix: teacherBefore.passwordHash.slice(0, 16),
      });

      // 1. Purpose-binding: email_verification token cannot reset password
      const verifyToken = await signEmailVerificationToken({
        teacherId: teacherBefore.id,
        email: teacherBefore.email,
      });
      const wrongPurposeRes = await resetPasswordPOST(
        new Request('http://localhost/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: verifyToken, password: 'NewPassword123!' }),
        })
      );
      expect(wrongPurposeRes.status).toBe(400);

      // 2. Expiry: expired password_reset token is rejected
      const expiredResetToken = await signPasswordResetToken(
        {
          teacherId: teacherBefore.id,
          email: teacherBefore.email,
          pwdHashPrefix: teacherBefore.passwordHash.slice(0, 16),
        },
        '-1s'
      );
      const expiredRes = await resetPasswordPOST(
        new Request('http://localhost/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: expiredResetToken, password: 'NewPassword123!' }),
        })
      );
      expect(expiredRes.status).toBe(400);

      // 3. Ownership-binding: token with mismatched email for teacherId is rejected
      const wrongEmailResetToken = await signPasswordResetToken({
        teacherId: teacherBefore.id,
        email: 'andere-adresse@schule.ch',
        pwdHashPrefix: teacherBefore.passwordHash.slice(0, 16),
      });
      const wrongEmailRes = await resetPasswordPOST(
        new Request('http://localhost/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: wrongEmailResetToken, password: 'NewPassword123!' }),
        })
      );
      expect(wrongEmailRes.status).toBe(400);

      // 4. First valid reset succeeds and updates passwordHash in DB
      const firstResetRes = await resetPasswordPOST(
        new Request('http://localhost/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: validResetToken, password: 'UpdatedPassword2026!' }),
        })
      );
      const firstResetData = await firstResetRes.json();
      expect(firstResetRes.status).toBe(200);
      expect(firstResetData.success).toBe(true);

      const teacherAfter = teachersTable.get('teacher-1')!;
      expect(teacherAfter.passwordHash).not.toBe(teacherBefore.passwordHash);
      expect(await verifyPassword('UpdatedPassword2026!', teacherAfter.passwordHash)).toBe(true);
      expect(await verifyPassword('InitialPass123!', teacherAfter.passwordHash)).toBe(false);

      // 5. Single-use / Replay check against DB: reusing the same reset token fails with 400
      const replayResetRes = await resetPasswordPOST(
        new Request('http://localhost/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: validResetToken, password: 'SecondAttemptPassword!' }),
        })
      );
      const replayResetData = await replayResetRes.json();
      expect(replayResetRes.status).toBe(400);
      expect(replayResetData.error).toContain('bereits verwendet');

      // Password in DB remains the one from the first valid reset
      expect(
        await verifyPassword('UpdatedPassword2026!', teachersTable.get('teacher-1')!.passwordHash)
      ).toBe(true);
    });
  });

  describe('6. Server-Side Email Verification Enforcement across Protected APIs (Issue #98)', () => {
    it('enforces Registrierung -> eingeschraenkter Zustand (403 auf APIs) -> Bestaetigung via Link -> voller Zugriff', async () => {
      process.env.EMAIL_VERIFICATION_ENFORCED = 'true';
      process.env.BREVO_LIVE_SENDING = 'true';
      process.env.BREVO_API_KEY = 'xkeysib-live-test-key';
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        status: 201,
        json: async () => ({ messageId: '<brevo-reg-98@pruefli.ch>' }),
      }) as unknown as typeof fetch;

      // 1. Registrierung einer neuen Lehrperson
      const regRes = await registerPOST(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Sandra Frei',
            email: 'sandra.frei@schule.ch',
            password: 'ValidPassword123!',
            confirmPassword: 'ValidPassword123!',
          }),
        })
      );
      const regData = await regRes.json();
      expect(regRes.status).toBe(200);
      expect(regData.isEmailVerified).toBe(false);
      expect(regData.emailVerificationRequired).toBe(true);
      expect(regData.enforcementEnabled).toBe(true);

      const newTeacherId = regData.teacher.id;
      mockGetSession.mockResolvedValue({ userId: newTeacherId });

      // 2. /api/auth/me und /api/auth/login melden eingeschraenkten Zustand (emailVerificationRequired: true)
      const meBeforeRes = await meGET(new Request('http://localhost/api/auth/me'));
      const meBeforeData = await meBeforeRes.json();
      expect(meBeforeRes.status).toBe(200);
      expect(meBeforeData.isEmailVerified).toBe(false);
      expect(meBeforeData.emailVerificationRequired).toBe(true);

      const loginRes = await loginPOST(
        new Request('http://localhost/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: 'sandra.frei@schule.ch',
            password: 'ValidPassword123!',
          }),
        })
      );
      const loginData = await loginRes.json();
      expect(loginRes.status).toBe(200);
      expect(loginData.isEmailVerified).toBe(false);
      expect(loginData.emailVerificationRequired).toBe(true);

      // 3. Geschuetzte API-Endpunkte lehnen unbestaetigte Konten serverseitig mit HTTP 403 ab
      const classesGetRes = await classesGET(new Request('http://localhost/api/classes'));
      expect(classesGetRes.status).toBe(403);
      const classesGetData = await classesGetRes.json();
      expect(classesGetData.code).toBe('EMAIL_VERIFICATION_REQUIRED');
      expect(classesGetData.emailVerificationRequired).toBe(true);

      const classesPostRes = await classesPOST(
        new Request('http://localhost/api/classes', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'Klasse 1a' }),
        })
      );
      expect(classesPostRes.status).toBe(403);

      const examsGetRes = await examsGET(new Request('http://localhost/api/exams'));
      expect(examsGetRes.status).toBe(403);

      const submissionsGetRes = await submissionsGET(
        new Request('http://localhost/api/submissions')
      );
      expect(submissionsGetRes.status).toBe(403);

      const subjectsGetRes = await subjectsGET(new Request('http://localhost/api/subjects'));
      expect(subjectsGetRes.status).toBe(403);

      const logsGetRes = await logsGET(new Request('http://localhost/api/logs'));
      expect(logsGetRes.status).toBe(403);

      // 4. Bestaetigung via Verifizierungs-Token (POST /api/auth/verify-email)
      const verifyToken = await signEmailVerificationToken({
        teacherId: newTeacherId,
        email: 'sandra.frei@schule.ch',
      });
      const verifyRes = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: verifyToken }),
        })
      );
      expect(verifyRes.status).toBe(200);

      // 5. Nach erfolgreicher Bestaetigung: voller Zugriff freigeschaltet
      const meAfterRes = await meGET(new Request('http://localhost/api/auth/me'));
      const meAfterData = await meAfterRes.json();
      expect(meAfterRes.status).toBe(200);
      expect(meAfterData.isEmailVerified).toBe(true);
      expect(meAfterData.emailVerificationRequired).toBe(false);
    });
  });

  describe('7. Existing Account Registration Recovery & Anti-Enumeration (Issue #99)', () => {
    it('Szenario 1 & 2 + Anti-Enumeration: bietet fuer unbestaetigte sowie OAuth-first-Konten Wiederherstellungspfade ohne Enumeration-Leak', async () => {
      // OAuth-first Konto in der simulierten Datenbank anlegen
      teachersTable.set('teacher-oauth', {
        id: 'teacher-oauth',
        email: 'oauth.lehrer@schule.ch',
        name: 'Herr Google',
        passwordHash: 'oauth_disabled:randomhex',
      });
      verificationsTable.set('teacher-oauth', {
        teacher_id: 'teacher-oauth',
        email: 'oauth.lehrer@schule.ch',
        verified_at: new Date(),
      });

      // 1. Szenario 1: Unbestaetigtes Konto versucht erneute Registrierung
      const resUnverified = await registerPOST(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Frau Meier',
            email: 'lehrer@schule.ch',
            password: 'NewAttemptPassword123!',
            confirmPassword: 'NewAttemptPassword123!',
          }),
        })
      );
      const dataUnverified = await resUnverified.json();

      // 2. Szenario 2: OAuth-first-Konto versucht E-Mail/Passwort-Registrierung
      const resOAuth = await registerPOST(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Herr Google',
            email: 'oauth.lehrer@schule.ch',
            password: 'NewAttemptPassword123!',
            confirmPassword: 'NewAttemptPassword123!',
          }),
        })
      );
      const dataOAuth = await resOAuth.json();

      // 3. Bereits verifiziertes Passwort-Konto versucht erneute Registrierung
      const resVerified = await registerPOST(
        new Request('http://localhost/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: 'Herr Keller',
            email: 'verified@schule.ch',
            password: 'NewAttemptPassword123!',
            confirmPassword: 'NewAttemptPassword123!',
          }),
        })
      );
      const dataVerified = await resVerified.json();

      expect(resUnverified.status).toBe(400);
      expect(resOAuth.status).toBe(400);
      expect(resVerified.status).toBe(400);

      // Strikte Anti-Enumeration: identische Antwort fuer unbestaetigte, OAuth-first- und verifizierte Konten
      expect(dataUnverified).toEqual(dataOAuth);
      expect(dataUnverified).toEqual(dataVerified);

      // Szenario 2 Pruefung: Fehlermeldung und strukturierte Recovery-Optionen nennen OAuth & Passwort-Reset
      expect(dataOAuth.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(dataOAuth.error).toContain('existiert bereits ein Account');
      expect(dataOAuth.error).toContain('Bestätigungs-E-Mail erneut senden');
      expect(dataOAuth.error).toContain('Google oder Microsoft');
      expect(dataOAuth.error).toContain('Passwort-Zurücksetzen');
      expect(dataOAuth.recoveryOptions).toEqual({
        canResendVerification: true,
        resendVerificationEndpoint: '/api/auth/resend-verification',
        verifyEmailUrl: '/verify-email',
        loginUrl: '/login',
        forgotPasswordUrl: '/forgot-password',
        oauthProviders: ['google', 'microsoft'],
      });

      // Szenario 1 Pruefung: Aus der Registrierungs-Fehlersituation heraus neuen Bestaetigungslink anfordern
      clearMockSentEmails();
      const resendRes = await resendVerificationPOST(
        new Request(
          `http://localhost${dataUnverified.recoveryOptions.resendVerificationEndpoint}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: 'lehrer@schule.ch' }),
          }
        )
      );
      const resendData = await resendRes.json();
      expect(resendRes.status).toBe(200);
      expect(getMockSentEmails()).toHaveLength(1);
      expect(getMockSentEmails()[0].to.email).toBe('lehrer@schule.ch');

      // Anti-Enumeration auch beim Resend aus der Fehlersituation fuer das OAuth-first-Konto
      const resendOAuthRes = await resendVerificationPOST(
        new Request(`http://localhost${dataOAuth.recoveryOptions.resendVerificationEndpoint}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'oauth.lehrer@schule.ch' }),
        })
      );
      const resendOAuthData = await resendOAuthRes.json();
      expect(resendOAuthRes.status).toBe(200);
      expect(resendOAuthData).toEqual(resendData);
      expect(getMockSentEmails()).toHaveLength(1);
    });
  });

  describe('8. Gezielte Sperre bezahlter KI-Endpunkte fuer unbestaetigte E-Mail-Konten (Issue #110)', () => {
    it('lehnt direkte API-Aufrufe auf alle LLM-Routen fuer unbestaetigte Konten mit 403 EMAIL_VERIFICATION_REQUIRED ab, waehrend das pauschale #98-Gate aus bleibt', async () => {
      // Pauschales Gate (#98) bleibt deaktiviert
      delete process.env.EMAIL_VERIFICATION_ENFORCED;

      // teacher-1 ist unbestaetigt
      mockGetSession.mockResolvedValue({ userId: 'teacher-1' });

      // /api/auth/me liefert 200 OK mit isEmailVerified: false, emailVerificationRequired: false (#98 aus)
      const meRes = await meGET(new Request('http://localhost/api/auth/me'));
      const meData = await meRes.json();
      expect(meRes.status).toBe(200);
      expect(meData.isEmailVerified).toBe(false);
      expect(meData.emailVerificationRequired).toBe(false);

      // 1. POST /api/correct -> 403 EMAIL_VERIFICATION_REQUIRED
      const correctRes = await correctPOST(
        new Request('http://localhost/api/correct', { method: 'POST' })
      );
      expect(correctRes.status).toBe(403);
      expect(await correctRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // 2. POST /api/exams/generate -> 403 EMAIL_VERIFICATION_REQUIRED
      const genRes = await generatePOST(
        new Request('http://localhost/api/exams/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ classId: 'c1', subject: 'Mathematik', materialText: 'Material' }),
        })
      );
      expect(genRes.status).toBe(403);
      expect(await genRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // 3. POST /api/exams/[id]/regenerate-task -> 403 EMAIL_VERIFICATION_REQUIRED
      const regenRes = await regenerateTaskPOST(
        new Request('http://localhost/api/exams/ex-1/regenerate-task', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskId: '1' }),
        }),
        { params: Promise.resolve({ id: 'ex-1' }) }
      );
      expect(regenRes.status).toBe(403);
      expect(await regenRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // 4. POST /api/exams/parse-rubric -> 403 EMAIL_VERIFICATION_REQUIRED
      const parseRes = await parseRubricPOST(
        new Request('http://localhost/api/exams/parse-rubric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rubricText: 'Aufgabe 1: 5 Punkte' }),
        })
      );
      expect(parseRes.status).toBe(403);
      expect(await parseRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // 5. POST /api/submissions/[id]/replace -> 403 EMAIL_VERIFICATION_REQUIRED
      const replaceRes = await replacePOST(
        new Request('http://localhost/api/submissions/sub-1/replace', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        }),
        { params: Promise.resolve({ id: 'sub-1' }) }
      );
      expect(replaceRes.status).toBe(403);
      expect(await replaceRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // 6. POST /api/mobile-relay/upload -> 403 EMAIL_VERIFICATION_REQUIRED
      const relayToken = await signMobileRelayToken({
        teacherId: 'teacher-1',
        targetMode: 'SUBMISSION',
      });
      const relayForm = new FormData();
      relayForm.append('token', relayToken);
      const relayRes = await mobileRelayUploadPOST(
        new Request('http://localhost/api/mobile-relay/upload', {
          method: 'POST',
          body: relayForm,
        })
      );
      expect(relayRes.status).toBe(403);
      expect(await relayRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // 7. GET /api/health/gemini?probe=generateContent -> 403 EMAIL_VERIFICATION_REQUIRED
      const healthProbeRes = await geminiHealthGET(
        new Request('http://localhost/api/health/gemini?probe=generateContent')
      );
      expect(healthProbeRes.status).toBe(403);
      expect(await healthProbeRes.json()).toMatchObject({
        code: 'EMAIL_VERIFICATION_REQUIRED',
        emailVerificationRequired: true,
      });

      // Nach Bestaetigung der E-Mail-Adresse via Link ist die 403-Sperre aufgehoben
      const verifyToken = await signEmailVerificationToken({
        teacherId: 'teacher-1',
        email: 'lehrer@schule.ch',
      });
      const verifyRes = await verifyEmailPOST(
        new Request('http://localhost/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: verifyToken }),
        })
      );
      expect(verifyRes.status).toBe(200);

      // Verifiziertes Konto wird nicht mehr mit 403 EMAIL_VERIFICATION_REQUIRED abgewiesen
      const parseAfterVerify = await parseRubricPOST(
        new Request('http://localhost/api/exams/parse-rubric', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rubricText: '' }),
        })
      );
      expect(parseAfterVerify.status).not.toBe(403);
    });
  });
});
