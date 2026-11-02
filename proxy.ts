import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import {
  SESSION_COOKIE_NAME,
  verifySessionToken,
  isSafeReturnUrl,
  resolveSafeReturnUrl,
  type VerifiedSessionResult,
} from '@/lib/session';

export const SECURITY_HEADERS = {
  'Strict-Transport-Security': 'max-age=63072000; includeSubDomains; preload',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  // Content-Security-Policy (CSP): Deliberately deferred to prevent breaking MUI inline styles,
  // camera video feeds, and client-side blob/data URLs until a verified nonce-based CSP is tested.
} as const;

export function applySecurityHeaders(response: NextResponse, pathname?: string): NextResponse {
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) {
    response.headers.set(key, value);
  }

  // Dateien aus der eigenen Upload-/Storage-Route duerfen same-origin geframed werden,
  // damit eingebettete PDF-Vorschauen in der Korrekturansicht angezeigt werden koennen.
  const normalizedPath = pathname?.toLowerCase() || '';
  if (normalizedPath === '/uploads' || normalizedPath.startsWith('/uploads/')) {
    response.headers.set('X-Frame-Options', 'SAMEORIGIN');
  }

  if (pathname) {
    if (pathname === '/') {
      response.headers.set('X-Robots-Tag', 'index, follow');
    } else {
      response.headers.set('X-Robots-Tag', 'noindex, nofollow');
    }
  }
  return response;
}

/**
 * Synchronizes a renewed sliding session token onto the response and forwarded request headers.
 */
function applySlidingRenewalCookie(
  response: NextResponse,
  verified: VerifiedSessionResult | null,
  request?: NextRequest
): NextResponse {
  if (!verified || !verified.renewed || !verified.renewedToken) {
    return response;
  }

  const newSessionToken = verified.renewedToken;
  const expiresAt = verified.expiresAt;

  response.cookies.set(SESSION_COOKIE_NAME, newSessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    expires: expiresAt,
    sameSite: 'lax',
    path: '/',
  });

  if (request) {
    const requestHeaders = new Headers(request.headers);
    const rawCookies = request.headers.get('cookie') || '';
    const cookieRegex = new RegExp(`${SESSION_COOKIE_NAME}=[^;]+`);
    let newCookies = rawCookies;

    if (cookieRegex.test(rawCookies)) {
      newCookies = rawCookies.replace(cookieRegex, `${SESSION_COOKIE_NAME}=${newSessionToken}`);
    } else {
      newCookies = rawCookies
        ? `${rawCookies}; ${SESSION_COOKIE_NAME}=${newSessionToken}`
        : `${SESSION_COOKIE_NAME}=${newSessionToken}`;
    }
    requestHeaders.set('cookie', newCookies);

    const updatedResponse = NextResponse.next({
      request: {
        headers: requestHeaders,
      },
    });

    updatedResponse.cookies.set(SESSION_COOKIE_NAME, newSessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
      sameSite: 'lax',
      path: '/',
    });

    return updatedResponse;
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { pathname } = request.nextUrl;

  // Verify the session token cryptographically and against server-side lifecycle & revocation state
  const verified = session ? await verifySessionToken(session, { renewIfEligible: true }) : null;
  const user = verified ? { userId: verified.userId } : null;

  // Protect all authenticated application routes at the edge level
  const protectedPrefixes = [
    '/dashboard',
    '/correct',
    '/classes',
    '/exams',
    '/subjects',
    '/students',
    '/submissions',
    '/logs',
  ];
  const isProtectedRoute = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));

  if (!user && isProtectedRoute) {
    const loginUrl = new URL('/login', request.url);
    const fullTargetPath = `${pathname}${request.nextUrl.search || ''}`;
    if (isSafeReturnUrl(fullTargetPath) && fullTargetPath !== '/dashboard') {
      loginUrl.searchParams.set('returnTo', fullTargetPath);
    }
    const response = NextResponse.redirect(loginUrl);
    // Purge the old/invalid session cookie from the browser only if a cookie was actually present
    if (session) {
      response.cookies.delete(SESSION_COOKIE_NAME);
    }
    return applySecurityHeaders(response, pathname);
  }

  // Redirect authenticated users away from login/register back to safe returnTo or dashboard
  if (user && (pathname === '/login' || pathname === '/register')) {
    const targetPath = resolveSafeReturnUrl(
      request.nextUrl.searchParams.get('returnTo'),
      '/dashboard'
    );
    const response = NextResponse.redirect(new URL(targetPath, request.url));
    const slidingRes = applySlidingRenewalCookie(response, verified);
    return applySecurityHeaders(slidingRes, pathname);
  }

  // Purge the cookie if it is present but invalid/expired/revoked to prevent redirect loops or invalid token fetches
  if (!user && session) {
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE_NAME);
    return applySecurityHeaders(response, pathname);
  }

  // Apply renewed cookie for authenticated active users when sliding renewal triggered
  if (user) {
    const slidingRes = applySlidingRenewalCookie(NextResponse.next(), verified, request);
    return applySecurityHeaders(slidingRes, pathname);
  }

  return applySecurityHeaders(NextResponse.next(), pathname);
}

// Intercept all page and API routes while bypassing static files and next assets
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
