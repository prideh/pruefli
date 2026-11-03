import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';
import { signEmailVerificationToken } from '@/lib/jwt';
import { isLiveSendingEnabled, sendVerificationEmail, type SendEmailResult } from '@/lib/email';
import { getEmailVerificationStatus, markEmailVerificationPending } from '@/lib/email-verification';

export async function POST(request: Request) {
  try {
    const { name, email, password } = await request.json();

    if (!name || !email || !password) {
      return NextResponse.json(
        { error: 'Bitte fülle alle Pflichtfelder aus (Name, Email, Passwort).' },
        { status: 400 }
      );
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Das Passwort muss mindestens 6 Zeichen lang sein.' },
        { status: 400 }
      );
    }

    // Ratenlimit gegen Massenregistrierungen und Brute-Force (IP- und E-Mail-basiert)
    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'register',
      email: typeof email === 'string' ? email : undefined,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'register');
    }

    // Check if email already exists
    const existingTeacher = await db.teacher.findUnique({
      where: { email: email.toLowerCase() },
    });

    if (existingTeacher) {
      // Uniform anti-enumeration response covering both unverified accounts and OAuth-first / existing accounts
      return NextResponse.json(
        {
          error:
            'Es existiert bereits ein Account mit dieser E-Mail-Adresse. Falls dein Konto noch unbestätigt ist, kannst du die Bestätigungs-E-Mail erneut senden. Falls du dich mit Google oder Microsoft registriert hast, melde dich bitte über Google/Microsoft an oder setze dein Passwort über die Passwort-Zurücksetzen-Funktion.',
          code: 'EMAIL_ALREADY_REGISTERED',
          recoveryOptions: {
            canResendVerification: true,
            resendVerificationEndpoint: '/api/auth/resend-verification',
            verifyEmailUrl: '/verify-email',
            loginUrl: '/login',
            forgotPasswordUrl: '/forgot-password',
            oauthProviders: ['google', 'microsoft'],
          },
        },
        { status: 400 }
      );
    }

    // Hash the password securely
    const passwordHash = await hashPassword(password);

    // Create the teacher inside the database
    const teacher = await db.teacher.create({
      data: {
        name,
        email: email.toLowerCase(),
        passwordHash,
      },
    });

    await markEmailVerificationPending(teacher.id, teacher.email);

    // Create session cookie
    await createSession(teacher.id);

    const verificationStatus = await getEmailVerificationStatus(teacher.id, {
      email: teacher.email,
      createdAt: teacher.createdAt ?? new Date(),
      request,
    });

    // Dispatch account verification email (uses Mock-Transport or Brevo HTTP API)
    const liveSending = isLiveSendingEnabled();
    let emailResult: SendEmailResult | null = null;
    try {
      const verificationToken = await signEmailVerificationToken({
        teacherId: teacher.id,
        email: teacher.email,
      });
      emailResult = await sendVerificationEmail({
        toEmail: teacher.email,
        toName: teacher.name,
        verificationToken,
      });
    } catch (mailErr) {
      console.error('Failed to dispatch verification email on registration:', mailErr);
    }

    const verificationEmailSent = Boolean(
      liveSending && emailResult?.success && !emailResult?.simulated
    );

    return NextResponse.json({
      success: true,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
      },
      isEmailVerified: false,
      emailVerificationRequired: verificationStatus.emailVerificationRequired,
      enforcementEnabled: verificationStatus.enforcementEnabled,
      liveSendingEnabled: liveSending,
      emailVerification: {
        sent: verificationEmailSent,
        simulated: Boolean(emailResult?.simulated ?? !liveSending),
        liveSendingEnabled: liveSending,
        status: verificationEmailSent ? 'sent' : 'email_delivery_inactive',
        message: verificationEmailSent
          ? 'Bestätigungs-E-Mail wurde versendet.'
          : 'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine Bestätigungs-E-Mail versendet.',
      },
    });
  } catch (error) {
    console.error('Error in teacher registration API:', error);
    return NextResponse.json(
      {
        error: 'Registrierung fehlgeschlagen. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
