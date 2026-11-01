import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOAuthPendingLinkToken, signOAuthConfirmLinkEmailToken } from '@/lib/jwt';
import { getProviderDisplayName } from '@/lib/oauth';
import { isLiveSendingEnabled, sendOAuthLinkConfirmationEmail, redactEmail } from '@/lib/email';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token) {
      return NextResponse.json({ error: 'Token ist erforderlich.' }, { status: 400 });
    }

    const payload = await verifyOAuthPendingLinkToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Die Verknüpfungs-Anfrage ist ungültig oder abgelaufen.' },
        { status: 400 }
      );
    }

    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'resend-verification',
      email: payload.existingTeacherEmail,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'resend-verification');
    }

    const teacher = await db.teacher.findUnique({
      where: { id: payload.existingTeacherId },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Benutzerkonto nicht gefunden.' }, { status: 404 });
    }

    // Sign a 24-hour email confirmation token
    const confirmToken = await signOAuthConfirmLinkEmailToken({
      provider: payload.provider,
      providerAccountId: payload.providerAccountId,
      providerEmail: payload.providerEmail,
      teacherId: teacher.id,
    });

    const providerName = getProviderDisplayName(payload.provider);
    const liveSending = isLiveSendingEnabled();
    const result = await sendOAuthLinkConfirmationEmail({
      toEmail: teacher.email,
      toName: teacher.name,
      providerName,
      confirmToken,
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
          error: result.error || 'Fehler beim Senden des Bestätigungs-Links.',
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
      message: `Bestätigungs-Link wurde an ${redactEmail(teacher.email)} gesendet. Bitte prüfe deinen Posteingang.`,
    });
  } catch (err) {
    console.error('Error sending OAuth link confirmation email:', err);
    return NextResponse.json(
      { error: 'Fehler beim Senden des Bestätigungs-Links.' },
      { status: 500 }
    );
  }
}
