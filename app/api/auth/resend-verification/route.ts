import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { signEmailVerificationToken } from '@/lib/jwt';
import { sendVerificationEmail } from '@/lib/email';
import { isEmailVerified } from '@/lib/email-verification';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    let email: string | undefined;
    try {
      const body = await request.json();
      if (body && typeof body.email === 'string') {
        email = body.email.trim().toLowerCase();
      }
    } catch {
      // Body is optional if session exists
    }

    const session = await getSession();
    let teacher: { id: string; email: string; name: string } | null = null;

    if (session) {
      teacher = await db.teacher.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, name: true },
      });
    } else if (email) {
      teacher = await db.teacher.findUnique({
        where: { email },
        select: { id: true, email: true, name: true },
      });
    }

    if (!teacher) {
      return NextResponse.json(
        { error: 'Keine gültige Sitzung oder E-Mail-Adresse angegeben.' },
        { status: 400 }
      );
    }

    // Rate limiting against spamming
    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'resend-verification',
      email: teacher.email,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'resend-verification');
    }

    // Check if already verified
    const alreadyVerified = await isEmailVerified(teacher.id);
    if (alreadyVerified) {
      return NextResponse.json({
        success: true,
        alreadyVerified: true,
        message: 'Deine E-Mail-Adresse ist bereits bestätigt.',
      });
    }

    const verificationToken = await signEmailVerificationToken({
      teacherId: teacher.id,
      email: teacher.email,
    });

    const result = await sendVerificationEmail({
      toEmail: teacher.email,
      toName: teacher.name,
      verificationToken,
    });

    return NextResponse.json({
      success: result.success,
      message: 'Bestätigungs-Link wurde erfolgreich gesendet.',
      simulated: result.simulated,
    });
  } catch (err) {
    console.error('Error resending verification email:', err);
    return NextResponse.json(
      { error: 'Fehler beim erneuten Senden der Bestätigungs-E-Mail.' },
      { status: 500 }
    );
  }
}
