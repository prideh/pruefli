import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { verifyPasswordResetToken } from '@/lib/jwt';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';

export async function POST(request: Request) {
  try {
    const { token, password } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token ist erforderlich.' }, { status: 400 });
    }

    if (!password || typeof password !== 'string') {
      return NextResponse.json({ error: 'Neues Passwort ist erforderlich.' }, { status: 400 });
    }

    if (password.length < 6) {
      return NextResponse.json(
        { error: 'Das Passwort muss mindestens 6 Zeichen lang sein.' },
        { status: 400 }
      );
    }

    const payload = await verifyPasswordResetToken(token);
    if (!payload || !payload.teacherId || !payload.pwdHashPrefix) {
      return NextResponse.json(
        { error: 'Der Link zum Zurücksetzen des Passworts ist ungültig oder abgelaufen.' },
        { status: 400 }
      );
    }

    // Rate limiting
    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'reset-password',
      email: payload.email,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'reset-password');
    }

    const teacher = await db.teacher.findUnique({
      where: { id: payload.teacherId },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Benutzerkonto nicht gefunden.' }, { status: 404 });
    }

    // Replay check: verify current password hash still matches the prefix stored in token
    if (!teacher.passwordHash.startsWith(payload.pwdHashPrefix)) {
      return NextResponse.json(
        { error: 'Dieser Link wurde bereits verwendet oder ist ungültig.' },
        { status: 400 }
      );
    }

    // Hash the new password securely using scrypt
    const newPasswordHash = await hashPassword(password);

    await db.teacher.update({
      where: { id: teacher.id },
      data: { passwordHash: newPasswordHash },
    });

    return NextResponse.json({
      success: true,
      message:
        'Passwort erfolgreich geändert. Du kannst dich jetzt mit deinem neuen Passwort anmelden.',
    });
  } catch (err) {
    console.error('Error in reset-password API:', err);
    return NextResponse.json({ error: 'Fehler beim Zurücksetzen des Passworts.' }, { status: 500 });
  }
}
