import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getSession } from '@/lib/session';
import {
  type OAuthProvider,
  getFederatedIdentitiesForTeacher,
  unlinkFederatedIdentity,
  isOauthOnlyAccount,
} from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const identities = await getFederatedIdentitiesForTeacher(session.userId);
    return NextResponse.json({
      identities: identities.map((i) => ({
        id: i.id,
        provider: i.provider,
        email: i.email,
        createdAt: i.createdAt,
      })),
    });
  } catch (err) {
    console.error('Error fetching federated identities:', err);
    return NextResponse.json(
      { error: 'Fehler beim Abrufen der verknüpften Konten.' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    const { provider } = await request.json();
    if (provider !== 'google' && provider !== 'microsoft') {
      return NextResponse.json({ error: 'Ungültiger Provider.' }, { status: 400 });
    }

    const oauthProvider = provider as OAuthProvider;
    const teacher = await db.teacher.findUnique({
      where: { id: session.userId },
      select: { id: true, passwordHash: true },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Benutzerkonto nicht gefunden.' }, { status: 404 });
    }

    const identities = await getFederatedIdentitiesForTeacher(teacher.id);

    // Guard: Prevent lockout if account has no password and only this identity
    if (isOauthOnlyAccount(teacher.passwordHash) && identities.length <= 1) {
      return NextResponse.json(
        {
          error:
            'Das letzte Login-Verfahren kann nicht entfernt werden. Bitte lege zuerst ein Passwort fest.',
        },
        { status: 400 }
      );
    }

    await unlinkFederatedIdentity(teacher.id, oauthProvider);

    return NextResponse.json({
      success: true,
      message: `${oauthProvider === 'google' ? 'Google' : 'Microsoft'}-Verknüpfung wurde erfolgreich entfernt.`,
    });
  } catch (err) {
    console.error('Error unlinking federated identity:', err);
    return NextResponse.json({ error: 'Fehler beim Trennen der Verknüpfung.' }, { status: 500 });
  }
}
