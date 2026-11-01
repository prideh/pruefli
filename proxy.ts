import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { verifyJWT, signJWT } from '@/lib/jwt';

const SESSION_COOKIE_NAME = 'grade_ai_session';

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
 * Helper to dynamically refresh the stateless session token (sliding session)
 * if the remaining lifetime of the JWT is less than 3 days.
 */
async function handleSlidingSession(
  response: NextResponse,
  payload: { userId: string; exp?: number } | null,
  userId: string,
  request?: NextRequest
): Promise<NextResponse> {
  if (!payload || !payload.exp) return response;

  const nowInSeconds = Math.floor(Date.now() / 1000);
  const threeDaysInSeconds = 3 * 24 * 60 * 60;

  // Slide the session only if less than 3 days are remaining before expiration
  if (payload.exp - nowInSeconds < threeDaysInSeconds) {
    const newSessionToken = await signJWT({ userId }, '7d');
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    // Update response cookies so the browser stores the fresh token
    response.cookies.set(SESSION_COOKIE_NAME, newSessionToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      expires: expiresAt,
      sameSite: 'lax',
      path: '/',
    });

    // If request is provided, also set the cookie in the forwarded request headers
    // so downstream Server Components and API handlers immediately see the fresh token
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

      // Synchronize the updated response cookie to the new next response object
      updatedResponse.cookies.set(SESSION_COOKIE_NAME, newSessionToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        expires: expiresAt,
        sameSite: 'lax',
        path: '/',
      });

      return updatedResponse;
    }
  }

  return response;
}

export async function proxy(request: NextRequest) {
  const session = request.cookies.get(SESSION_COOKIE_NAME)?.value;
  const { pathname } = request.nextUrl;

  // Cryptographically verify the session token at the edge level
  const payload = session ? await verifyJWT(session) : null;
  const user = payload ? { userId: payload.userId } : null;

  // Protect all authenticated application routes at the edge level
  const protectedPrefixes = [
    '/dashboard',
    '/correct',
    '/classes',
    '/exams',
    '/students',
    '/submissions',
    '/logs',
  ];
  const isProtectedRoute = protectedPrefixes.some((prefix) => pathname.startsWith(prefix));

  if (!user && isProtectedRoute) {
    const response = NextResponse.redirect(new URL('/login', request.url));
    // Purge the old/invalid session cookie from the browser only if a cookie was actually present
    if (session) {
      response.cookies.delete(SESSION_COOKIE_NAME);
    }
    return applySecurityHeaders(response, pathname);
  }

  // Redirect authenticated users away from login/register back to the dashboard
  if (user && (pathname === '/login' || pathname === '/register')) {
    const response = NextResponse.redirect(new URL('/dashboard', request.url));
    const slidingRes = await handleSlidingSession(response, payload, user.userId);
    return applySecurityHeaders(slidingRes, pathname);
  }

  // Purge the cookie if it is present but invalid/expired to prevent redirect loops or invalid token fetches
  if (!user && session) {
    const response = NextResponse.next();
    response.cookies.delete(SESSION_COOKIE_NAME);
    return applySecurityHeaders(response, pathname);
  }

  // Slide session for authenticated active users
  if (user) {
    const slidingRes = await handleSlidingSession(
      NextResponse.next(),
      payload,
      user.userId,
      request
    );
    return applySecurityHeaders(slidingRes, pathname);
  }

  return applySecurityHeaders(NextResponse.next(), pathname);
}

// Intercept all page and API routes while bypassing static files and next assets
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)'],
};
