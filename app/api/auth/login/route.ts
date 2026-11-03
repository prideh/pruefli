import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/auth';
import { createSession } from '@/lib/session';
import { getEmailVerificationStatus } from '@/lib/email-verification';
import { checkAuthRateLimit, createAuthRateLimitResponse, extractClientIp } from '@/lib/rate-limit';

// Precomputed 16-byte hex salt + 64-byte hex key for constant-time dummy verification when user is not found
const DUMMY_PASSWORD_HASH = '00000000000000000000000000000000:' + '0'.repeat(128);

export async function POST(request: Request) {
  try {
    const { email, password } = await request.json();

    if (!email || !password) {
      return NextResponse.json({ error: 'Bitte gib E-Mail und Passwort ein.' }, { status: 400 });
    }

    // Ratenlimit gegen Brute-Force-Angriffe (IP- und E-Mail-basiert)
    const clientIp = extractClientIp(request);
    const rateLimit = await checkAuthRateLimit({
      action: 'login',
      email: typeof email === 'string' ? email : undefined,
      ip: clientIp,
    });
    if (!rateLimit.allowed) {
      return createAuthRateLimitResponse(rateLimit, 'login');
    }

    // Find the teacher by email
    const teacher = await db.teacher.findUnique({
      where: { email: email.toLowerCase() },
    });

    // Always run scrypt verification even if teacher is not found to prevent timing-based email enumeration
    const targetHash = teacher ? teacher.passwordHash : DUMMY_PASSWORD_HASH;
    const isPasswordValid = await verifyPassword(password, targetHash);

    if (!teacher || !isPasswordValid) {
      return NextResponse.json(
        { error: 'Ungültige E-Mail-Adresse oder Passwort.' },
        { status: 401 }
      );
    }

    // Set the session cookie
    await createSession(teacher.id);

    const verificationStatus = await getEmailVerificationStatus(teacher.id, {
      email: teacher.email,
      createdAt: teacher.createdAt,
      request,
    });

    return NextResponse.json({
      success: true,
      teacher: {
        id: teacher.id,
        name: teacher.name,
        email: teacher.email,
      },
      isEmailVerified: verificationStatus.isEmailVerified,
      emailVerificationRequired: verificationStatus.emailVerificationRequired,
      isGrandfathered: verificationStatus.isGrandfathered,
      enforcementEnabled: verificationStatus.enforcementEnabled,
    });
  } catch (error) {
    console.error('Error in teacher login API:', error);
    return NextResponse.json(
      {
        error: 'Anmeldung fehlgeschlagen. Bitte versuchen Sie es später erneut.',
      },
      { status: 500 }
    );
  }
}
