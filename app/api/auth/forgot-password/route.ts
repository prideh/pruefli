import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { signPasswordResetToken } from '@/lib/jwt';
import { sendPasswordResetEmail } from '@/lib/email';
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

    const teacher = await db.teacher.findUnique({
      where: { email: cleanEmail },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    // Uniform response to prevent account enumeration
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

    return NextResponse.json({
      success: true,
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
