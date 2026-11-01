import { NextResponse } from 'next/server';
import crypto from 'crypto';
import { type OAuthProvider, isProviderConfigured, getAuthorizationUrl } from '@/lib/oauth';
import { signOAuthStateToken } from '@/lib/jwt';
import { getSession } from '@/lib/session';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, props: { params: Promise<{ provider: string }> }) {
  try {
    const { provider: rawProvider } = await props.params;
    const provider = rawProvider?.toLowerCase();

    if (provider === 'apple') {
      return NextResponse.json(
        { error: 'Apple Social-Login wird nicht unterstützt.' },
        { status: 400 }
      );
    }

    if (provider !== 'google' && provider !== 'microsoft') {
      return NextResponse.json(
        { error: `Nicht unterstützter Provider: ${rawProvider}` },
        { status: 400 }
      );
    }

    const oauthProvider = provider as OAuthProvider;

    if (!isProviderConfigured(oauthProvider)) {
      const url = new URL('/login', request.url);
      url.searchParams.set('error', 'provider_not_configured');
      return NextResponse.redirect(url);
    }

    const requestUrl = new URL(request.url);
    const action = requestUrl.searchParams.get('action') === 'link' ? 'link' : 'login';
    let teacherId: string | null = null;

    if (action === 'link') {
      const session = await getSession();
      if (!session) {
        const url = new URL('/login', request.url);
        url.searchParams.set('error', 'session_required');
        return NextResponse.redirect(url);
      }
      teacherId = session.userId;
    }

    const nonce = crypto.randomBytes(16).toString('hex');
    const stateToken = await signOAuthStateToken({
      provider: oauthProvider,
      action,
      teacherId,
      nonce,
    });

    const authUrl = getAuthorizationUrl(oauthProvider, stateToken);
    return NextResponse.redirect(authUrl);
  } catch (err) {
    console.error('Error initiating OAuth flow:', err);
    const url = new URL('/login', request.url);
    url.searchParams.set('error', 'oauth_init_failed');
    return NextResponse.redirect(url);
  }
}
