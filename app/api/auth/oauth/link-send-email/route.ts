import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOAuthPendingLinkToken, signOAuthConfirmLinkEmailToken } from '@/lib/jwt';
import { getProviderDisplayName } from '@/lib/oauth';
import { sendOAuthLinkConfirmationEmail, redactEmail } from '@/lib/email';
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
    await sendOAuthLinkConfirmationEmail({
      toEmail: teacher.email,
      toName: teacher.name,
      providerName,
      confirmToken,
    });

    return NextResponse.json({
      success: true,
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
