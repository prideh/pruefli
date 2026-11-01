import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { signPasswordResetToken } from '@/lib/jwt';
import { isLiveSendingEnabled, sendPasswordResetEmail } from '@/lib/email';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { email } = await request.json();

    if (!email || typeof email !== 'string' || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Bitte gib eine gültige E-Mail-Adresse ein.' },
        { status: 400 }
      );
    }

    const cleanEmail = email.trim().toLowerCase();

    // Rate limiting against brute-force and email enumeration
    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'forgot-password',
      email: cleanEmail,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'forgot-password');
    }

    const liveSending = isLiveSendingEnabled();

    const teacher = await db.teacher.findUnique({
      where: { email: cleanEmail },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Uniform dispatch (records in mock history when liveSending is false, or sends via Brevo when true)
    if (teacher) {
      const pwdHashPrefix = teacher.passwordHash.slice(0, 16);
      const resetToken = await signPasswordResetToken({
        teacherId: teacher.id,
        email: teacher.email,
        pwdHashPrefix,
      });

      try {
        await sendPasswordResetEmail({
          toEmail: teacher.email,
          toName: teacher.name,
          resetToken,
        });
      } catch (mailErr) {
        console.error('Failed to dispatch password reset email:', mailErr);
      }
    }

    // Uniform response preserving anti-enumeration while honestly reporting transport state
    if (!liveSending) {
      return NextResponse.json({
        success: false,
        sent: false,
        simulated: true,
        liveSendingEnabled: false,
        status: 'email_delivery_inactive',
        message:
          'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine E-Mail zum Zurücksetzen des Passworts versendet.',
      });
    }

    return NextResponse.json({
      success: true,
      sent: true,
      simulated: false,
      liveSendingEnabled: true,
      status: 'sent',
      message:
        'Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail mit einem Link zum Zurücksetzen des Passworts versendet.',
    });
  } catch (err) {
    console.error('Error handling forgot-password request:', err);
    return NextResponse.json(
      { error: 'Fehler beim Anfordern des Passwort-Resets.' },
      { status: 500 }
    );
  }
}
