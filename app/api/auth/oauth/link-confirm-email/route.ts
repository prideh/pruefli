import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { verifyOAuthConfirmLinkEmailToken } from '@/lib/jwt';
import { linkFederatedIdentity } from '@/lib/oauth';
import { createSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const token = url.searchParams.get('token');

    if (!token) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'missing_token');
      return NextResponse.redirect(redirectUrl);
    }

    const payload = await verifyOAuthConfirmLinkEmailToken(token);
    if (!payload) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'link_token_expired');
      return NextResponse.redirect(redirectUrl);
    }

    const teacher = await db.teacher.findUnique({
      where: { id: payload.teacherId },
    });

    if (!teacher) {
      const redirectUrl = new URL('/login', request.url);
      redirectUrl.searchParams.set('error', 'user_not_found');
      return NextResponse.redirect(redirectUrl);
    }

    // Proof of ownership established via email link -> Link identity
    await linkFederatedIdentity({
      teacherId: teacher.id,
      provider: payload.provider,
      providerAccountId: payload.providerAccountId,
      email: payload.providerEmail,
    });

    // Establish authenticated session
    await createSession(teacher.id);

    const redirectUrl = new URL('/dashboard', request.url);
    redirectUrl.searchParams.set('linked', payload.provider);
    return NextResponse.redirect(redirectUrl);
  } catch (err) {
    console.error('Error confirming OAuth link via email:', err);
    const redirectUrl = new URL('/login', request.url);
    redirectUrl.searchParams.set('error', 'link_confirmation_failed');
    return NextResponse.redirect(redirectUrl);
  }
}
