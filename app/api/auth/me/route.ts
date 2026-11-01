import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import { isEmailVerified } from '@/lib/email-verification';

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

    const verified = await isEmailVerified(teacher.id);

    return NextResponse.json({
      authenticated: true,
      teacher,
      isEmailVerified: verified,
    });
  } catch (error) {
    console.error('Error fetching current teacher session:', error);
    return NextResponse.json(
      { authenticated: false, error: 'Interner Serverfehler.' },
      { status: 500 }
    );
  }
}
