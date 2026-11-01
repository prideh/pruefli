import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOAuthPendingLinkToken } from '@/lib/jwt';
import { getProviderDisplayName, isOauthOnlyAccount } from '@/lib/oauth';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      return NextResponse.json({ error: 'Token ist erforderlich.' }, { status: 400 });
    }

    const payload = await verifyOAuthPendingLinkToken(token);
    if (!payload) {
      return NextResponse.json(
        { error: 'Die Anfrage ist ungültig oder abgelaufen (Gültigkeit: 15 Minuten).' },
        { status: 400 }
      );
    }

    const teacher = await db.teacher.findUnique({
      where: { id: payload.existingTeacherId },
      select: { id: true, email: true, name: true, passwordHash: true },
    });

    if (!teacher) {
      return NextResponse.json({ error: 'Benutzerkonto nicht gefunden.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      email: teacher.email,
      name: teacher.name,
      provider: payload.provider,
      providerDisplayName: getProviderDisplayName(payload.provider),
      hasPassword: !isOauthOnlyAccount(teacher.passwordHash),
    });
  } catch (err) {
    console.error('Error fetching OAuth pending link info:', err);
    return NextResponse.json(
      { error: 'Fehler beim Laden der Verknüpfungsinformationen.' },
      { status: 500 }
    );
  }
}
