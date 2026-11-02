import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { isEmailVerified } from '@/lib/email-verification';
import { isLiveSendingEnabled } from '@/lib/email';

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json(
        { authenticated: false, error: 'Nicht autorisiert.' },
        { status: 401 }
      );
    }

    const teacher = await db.teacher.findUnique({
      where: { id: session.userId },
      select: {
        id: true,
        name: true,
        email: true,
      },
    });

    if (!teacher) {
      return NextResponse.json(
        { authenticated: false, error: 'Benutzer existiert nicht mehr.' },
        { status: 401 }
      );
    }

    const verified = await isEmailVerified(teacher.id, teacher.email);
    const liveSending = isLiveSendingEnabled();

    const sessionMeta =
      session.sessionId || session.expiresAt
        ? {
            id: session.sessionId ?? null,
            createdAt: session.createdAt ? session.createdAt.toISOString() : null,
            expiresAt: session.expiresAt ? session.expiresAt.toISOString() : null,
            remainingSeconds:
              typeof session.remainingSeconds === 'number' ? session.remainingSeconds : null,
            expiringSoon: Boolean(session.expiringSoon),
          }
        : undefined;

    return NextResponse.json({
      authenticated: true,
      teacher,
      isEmailVerified: verified,
      liveSendingEnabled: liveSending,
      ...(sessionMeta ? { session: sessionMeta } : {}),
    });
  } catch (error) {
    console.error('Error fetching current teacher session:', error);
    return NextResponse.json(
      { authenticated: false, error: 'Interner Serverfehler.' },
      { status: 500 }
    );
  }
}
