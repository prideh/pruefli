import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { signEmailVerificationToken } from '@/lib/jwt';
import { isLiveSendingEnabled, sendVerificationEmail } from '@/lib/email';
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
    const clientIp = extractClientIp(request);
    const liveSending = isLiveSendingEnabled();

    // Path 1: Authenticated session resend (when no explicit foreign email is requested)
    if (session) {
      const sessionTeacher = await db.teacher.findUnique({
        where: { id: session.userId },
        select: { id: true, email: true, name: true },
      });

      if (sessionTeacher && (!email || sessionTeacher.email.toLowerCase() === email)) {
        const rateLimit = await checkAuthRateLimit({
          action: 'resend-verification',
          email: sessionTeacher.email,
          ip: clientIp,
        });
        if (!rateLimit.allowed) {
          return createAuthRateLimitResponse(rateLimit, 'resend-verification');
        }

        const alreadyVerified = await isEmailVerified(sessionTeacher.id, sessionTeacher.email);
        if (alreadyVerified) {
          return NextResponse.json({
            success: true,
            alreadyVerified: true,
            sent: false,
            liveSendingEnabled: liveSending,
            message: 'Deine E-Mail-Adresse ist bereits bestätigt.',
          });
        }

        const verificationToken = await signEmailVerificationToken({
          teacherId: sessionTeacher.id,
          email: sessionTeacher.email,
        });

        const result = await sendVerificationEmail({
          toEmail: sessionTeacher.email,
          toName: sessionTeacher.name,
          verificationToken,
        });

        if (!liveSending || result.simulated) {
          return NextResponse.json({
            success: false,
            sent: false,
            simulated: true,
            liveSendingEnabled: false,
            status: 'email_delivery_inactive',
            message:
              'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine Bestätigungs-E-Mail versendet.',
          });
        }

        if (!result.success) {
          return NextResponse.json(
            {
              success: false,
              sent: false,
              simulated: false,
              liveSendingEnabled: true,
              error: result.error || 'Bestätigungs-E-Mail konnte nicht gesendet werden.',
            },
            { status: 502 }
          );
        }

        return NextResponse.json({
          success: true,
          sent: true,
          simulated: false,
          liveSendingEnabled: true,
          status: 'sent',
          message: 'Bestätigungs-Link wurde erfolgreich gesendet.',
        });
      }
    }

    // Path 2: Unauthenticated email-based request (must prevent account enumeration)
    if (!email || !email.includes('@')) {
      return NextResponse.json(
        { error: 'Keine gültige Sitzung oder E-Mail-Adresse angegeben.' },
        { status: 400 }
      );
    }

    // Rate limit before DB lookup so existing and non-existing accounts behave identically
    const rateLimit = await checkAuthRateLimit({
      action: 'resend-verification',
      email,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'resend-verification');
    }

    const teacher = await db.teacher.findUnique({
      where: { email },
      select: { id: true, email: true, name: true },
    });

    if (teacher) {
      const alreadyVerified = await isEmailVerified(teacher.id, teacher.email);
      if (!alreadyVerified) {
        const verificationToken = await signEmailVerificationToken({
          teacherId: teacher.id,
          email: teacher.email,
        });

        try {
          await sendVerificationEmail({
            toEmail: teacher.email,
            toName: teacher.name,
            verificationToken,
          });
        } catch (mailErr) {
          console.error('Failed to dispatch verification email:', mailErr);
        }
      }
    }

    // Uniform response for unauthenticated path: never leak whether account exists or is already verified
    if (!liveSending) {
      return NextResponse.json({
        success: false,
        sent: false,
        simulated: true,
        liveSendingEnabled: false,
        status: 'email_delivery_inactive',
        message:
          'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine Bestätigungs-E-Mail versendet.',
      });
    }

    return NextResponse.json({
      success: true,
      sent: true,
      simulated: false,
      liveSendingEnabled: true,
      status: 'sent',
      message:
        'Falls ein unverifiziertes Konto mit dieser E-Mail-Adresse existiert, wurde ein neuer Bestätigungs-Link versendet.',
    });
  } catch (err) {
    console.error('Error resending verification email:', err);
    return NextResponse.json(
      { error: 'Fehler beim erneuten Senden der Bestätigungs-E-Mail.' },
      { status: 500 }
    );
  }
}
