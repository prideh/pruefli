import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';
import { signEmailVerificationToken } from '@/lib/jwt';
import { sendVerificationEmail } from '@/lib/email';

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
      return NextResponse.json(
        { error: 'Es existiert bereits ein Account mit dieser E-Mail-Adresse.' },
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

    // Create session cookie
    await createSession(teacher.id);

    // Dispatch account verification email (uses Mock-Transport or Brevo HTTP API)
    try {
      const verificationToken = await signEmailVerificationToken({
        teacherId: teacher.id,
        email: teacher.email,
      });
      await sendVerificationEmail({
        toEmail: teacher.email,
        toName: teacher.name,
        verificationToken,
      });
    } catch (mailErr) {
      console.error('Failed to dispatch verification email on registration:', mailErr);
    }

    return NextResponse.json({
      success: true,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
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
