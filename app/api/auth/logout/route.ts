import { NextResponse } from 'next/server';
import { deleteSession } from '@/lib/session';

export async function POST(request: Request) {
  try {
    let allSessions = false;
    if (request) {
      try {
        const body = await request.json();
        allSessions = Boolean(body?.allSessions);
      } catch {
        // Optional request body
      }
    }
    await deleteSession({ allSessions });
    return NextResponse.json({
      success: true,
      allSessionsRevoked: allSessions,
      message: 'Erfolgreich abgemeldet.',
    });
  } catch (error) {
    console.error('Error in logout API:', error);
    return NextResponse.json({ error: 'Abmeldung fehlgeschlagen.' }, { status: 500 });
  }
}
