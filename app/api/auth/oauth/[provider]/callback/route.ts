import { NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getAppUrl } from '@/lib/app-url';
import {
  type OAuthProvider,
  exchangeCodeForTokens,
  fetchOAuthUserProfile,
  findFederatedIdentity,
  linkFederatedIdentity,
  generateOauthDisabledPasswordHash,
} from '@/lib/oauth';
import {
  verifyOAuthStateToken,
  signOAuthPendingLinkToken,
  signEmailVerificationToken,
} from '@/lib/jwt';
import { createSession } from '@/lib/session';
import { sendVerificationEmail } from '@/lib/email';
import {
  getEmailVerificationStatus,
  markEmailVerificationPending,
  markEmailVerified,
} from '@/lib/email-verification';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, props: { params: Promise<{ provider: string }> }) {
  const requestUrl = new URL(request.url);

  try {
    const { provider: rawProvider } = await props.params;
    const provider = rawProvider?.toLowerCase();

    if (provider !== 'google' && provider !== 'microsoft') {
      const url = new URL('/login', getAppUrl());
      url.searchParams.set('error', 'unsupported_provider');
      return NextResponse.redirect(url);
    }

    const oauthProvider = provider as OAuthProvider;
    const code = requestUrl.searchParams.get('code');
    const state = requestUrl.searchParams.get('state');
    const oauthError = requestUrl.searchParams.get('error');

    if (oauthError) {
      console.warn(`OAuth flow cancelled or rejected by provider (${oauthProvider}):`, oauthError);
      const url = new URL('/login', getAppUrl());
      url.searchParams.set('error', 'oauth_cancelled');
      return NextResponse.redirect(url);
    }

    if (!code || !state) {
      const url = new URL('/login', getAppUrl());
      url.searchParams.set('error', 'missing_code_or_state');
      return NextResponse.redirect(url);
    }

    // Cryptographically verify CSRF state token
    const statePayload = await verifyOAuthStateToken(state);
    if (!statePayload || statePayload.provider !== oauthProvider) {
      const url = new URL('/login', getAppUrl());
      url.searchParams.set('error', 'invalid_state');
      return NextResponse.redirect(url);
    }

    // Exchange authorization code for access tokens
    const { accessToken } = await exchangeCodeForTokens(oauthProvider, code);

    // Fetch profile from provider
    const profile = await fetchOAuthUserProfile(oauthProvider, accessToken);
    const normEmail = profile.email.toLowerCase();
    const providerAccountId = profile.providerAccountId;

    // Flow 1: Linking account from within an authenticated session
    if (statePayload.action === 'link') {
      const teacherId = statePayload.teacherId;
      if (!teacherId) {
        const url = new URL('/login', getAppUrl());
        url.searchParams.set('error', 'invalid_link_state');
        return NextResponse.redirect(url);
      }

      const currentTeacher = await db.teacher.findUnique({
        where: { id: teacherId },
      });
      if (!currentTeacher) {
        const url = new URL('/login', getAppUrl());
        url.searchParams.set('error', 'user_not_found');
        return NextResponse.redirect(url);
      }

      try {
        await linkFederatedIdentity({
          teacherId: currentTeacher.id,
          provider: oauthProvider,
          providerAccountId,
          email: normEmail,
        });

        const url = new URL('/dashboard', getAppUrl());
        url.searchParams.set('linked', oauthProvider);
        return NextResponse.redirect(url);
      } catch (linkErr) {
        const url = new URL('/dashboard', getAppUrl());
        url.searchParams.set(
          'error',
          linkErr instanceof Error ? linkErr.message : 'provider_link_failed'
        );
        return NextResponse.redirect(url);
      }
    }

    // Flow 2: Social Login
    const existingIdentity = await findFederatedIdentity(oauthProvider, providerAccountId);

    if (existingIdentity) {
      // Identity exists -> authenticate directly (existing linked accounts remain unchanged)
      const teacher = await db.teacher.findUnique({
        where: { id: existingIdentity.teacherId },
      });

      if (teacher) {
        await createSession(teacher.id);
        return NextResponse.redirect(new URL('/dashboard', getAppUrl()));
      }
    }

    // Check if an existing teacher account has matching email address
    const existingTeacher = await db.teacher.findUnique({
      where: { email: normEmail },
    });

    if (existingTeacher) {
      // Account exists, but identity is not linked yet:
      // STRICT REQUIREMENT: Account linking requires proof of ownership (password or email confirmation).
      // We NEVER merge or link silently based solely on matching email or provider verified claims.
      const pendingToken = await signOAuthPendingLinkToken({
        provider: oauthProvider,
        providerAccountId,
        providerEmail: normEmail,
        providerName: profile.name,
        existingTeacherId: existingTeacher.id,
        existingTeacherEmail: existingTeacher.email,
      });

      const url = new URL('/auth/link-account', getAppUrl());
      url.searchParams.set('token', pendingToken);
      return NextResponse.redirect(url);
    }

    // Flow 3: New teacher signup via Social Login
    const newTeacher = await db.teacher.create({
      data: {
        email: normEmail,
        name: profile.name || 'Lehrperson',
        passwordHash: generateOauthDisabledPasswordHash(),
      },
    });

    await linkFederatedIdentity({
      teacherId: newTeacher.id,
      provider: oauthProvider,
      providerAccountId,
      email: normEmail,
    });

    // Only mark email as verified when the provider supplies a reliable verification claim
    // (Google with email_verified === true). Microsoft Graph /v1.0/me provides no verification claim,
    // and Google profiles with email_verified !== true must remain unverified until confirmed via email flow.
    const hasVerifiedProviderClaim = oauthProvider === 'google' && profile.emailVerified === true;

    if (hasVerifiedProviderClaim) {
      await markEmailVerified(newTeacher.id, newTeacher.email);
    } else {
      await markEmailVerificationPending?.(newTeacher.id, newTeacher.email);
      try {
        const verificationToken = await signEmailVerificationToken({
          teacherId: newTeacher.id,
          email: newTeacher.email,
        });
        await sendVerificationEmail({
          toEmail: newTeacher.email,
          toName: newTeacher.name,
          verificationToken,
        });
      } catch (mailErr) {
        console.error('Failed to dispatch verification email on OAuth signup:', mailErr);
      }
    }

    await createSession(newTeacher.id);

    const verificationStatus = await getEmailVerificationStatus?.(newTeacher.id, {
      email: newTeacher.email,
      createdAt: newTeacher.createdAt ?? new Date(),
      request,
    });

    if (verificationStatus?.emailVerificationRequired) {
      return NextResponse.redirect(new URL('/verify-email', getAppUrl()));
    }

    return NextResponse.redirect(new URL('/dashboard', getAppUrl()));
  } catch (err) {
    console.error('Error during OAuth callback handling:', err);
    const url = new URL('/login', getAppUrl());
    url.searchParams.set('error', 'oauth_exchange_failed');
    return NextResponse.redirect(url);
  }
}
