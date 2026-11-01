import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyEmailVerificationToken } from '@/lib/jwt';
import { isEmailVerified, markEmailVerified } from '@/lib/email-verification';

export async function POST(request: Request) {
  try {
    const { token } = await request.json();

    if (!token || typeof token !== 'string') {
      return NextResponse.json({ error: 'Token ist erforderlich.' }, { status: 400 });
    }

    const payload = await verifyEmailVerificationToken(token);
    if (!payload || !payload.teacherId || !payload.email) {
      return NextResponse.json(
        { error: 'Der Verifizierungs-Link ist ungültig oder abgelaufen.' },
        { status: 400 }
      );
    }

    const teacher = await db.teacher.findUnique({
      where: { id: payload.teacherId },
      select: { id: true, email: true, name: true },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Benutzerkonto nicht gefunden.' }, { status: 404 });
    }

    // Ownership binding: verify that token email matches the teacher's current email in DB
    if (teacher.email.toLowerCase() !== payload.email.toLowerCase()) {
      return NextResponse.json(
        {
          error: 'Der Verifizierungs-Link ist ungültig oder gehört nicht zu dieser E-Mail-Adresse.',
        },
        { status: 400 }
      );
    }

    // Single-use / Replay check against teacher_email_verifications
    const alreadyVerified = await isEmailVerified(teacher.id, teacher.email);
    if (alreadyVerified) {
      return NextResponse.json(
        { error: 'Dieser Verifizierungs-Link wurde bereits verwendet.' },
        { status: 400 }
      );
    }

    await markEmailVerified(teacher.id, teacher.email);

    return NextResponse.json({
      success: true,
      message: 'E-Mail-Adresse erfolgreich bestätigt.',
      teacher: {
        id: teacher.id,
        email: teacher.email,
        name: teacher.name,
        isEmailVerified: true,
      },
    });
  } catch (err) {
    console.error('Error verifying email:', err);
    return NextResponse.json({ error: 'Fehler bei der E-Mail-Verifizierung.' }, { status: 500 });
  }
}
