import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOAuthPendingLinkToken } from '@/lib/jwt';
import { verifyPassword } from '@/lib/auth';
import { linkFederatedIdentity } from '@/lib/oauth';
import { createSession } from '@/lib/session';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || !password) {
      return NextResponse.json({ error: 'Token und Passwort sind erforderlich.' }, { status: 400 });
    }

    const payload = await verifyOAuthPendingLinkToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Die Verknüpfungs-Anfrage ist ungültig oder abgelaufen.' },
        { status: 400 }
      );
    }

    // Rate-limiting check against brute-force password guessing
    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'login',
      email: payload.existingTeacherEmail,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'login');
    }

    const teacher = await db.teacher.findUnique({
      where: { id: payload.existingTeacherId },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Benutzerkonto nicht gefunden.' }, { status: 404 });
    }

    const isPasswordValid = await verifyPassword(password, teacher.passwordHash);
    if (!isPasswordValid) {
      return NextResponse.json(
        { error: 'Ungültiges Passwort. Bitte prüfe deine Eingabe.' },
        { status: 401 }
      );
    }

    // Proof of ownership established via password verification -> Link identity
    await linkFederatedIdentity({
      teacherId: teacher.id,
      provider: payload.provider,
      providerAccountId: payload.providerAccountId,
      email: payload.providerEmail,
    });

    // Create session cookie
    await createSession(teacher.id);

    return NextResponse.json({
      success: true,
      message: 'Konto erfolgreich verknüpft.',
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
      },
    });
  } catch (err) {
    console.error('Error confirming OAuth link with password:', err);
    return NextResponse.json(
      { error: 'Verknüpfung fehlgeschlagen. Bitte versuchen Sie es später erneut.' },
      { status: 500 }
    );
  }
}
