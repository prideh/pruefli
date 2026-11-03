import { test, expect } from '@playwright/test';
import crypto from 'crypto';

function createSmokeSessionToken(
  userId: string,
  options?: { expiresInSeconds?: number; purpose?: string; secret?: string }
): string {
  const secret =
    options?.secret || process.env.JWT_SECRET || 'pruefli-dev-secret-key-safe-fallback';
  const now = Math.floor(Date.now() / 1000);
  const expOffset = options?.expiresInSeconds ?? 7 * 24 * 60 * 60;
  const header = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      userId,
      ...(options?.purpose ? { purpose: options.purpose } : {}),
      iat: now,
      exp: now + expOffset,
    })
  ).toString('base64url');
  const sig = crypto
    .createHmac('sha256', secret)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${sig}`;
}

test.describe('Smoke Tests — Critical Availability, Security Boundaries & Orthography', () => {
  test('1. Public landing, login, and register pages render 200 OK with strict Swiss German orthography (no Eszett)', async ({
    page,
  }) => {
    for (const route of ['/', '/login', '/register', '/forgot-password']) {
      const response = await page.goto(route);
      expect(response?.status()).toBe(200);
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toContain('ß');
    }
  });

  test('2. Edge Proxy (proxy.ts) redirects unauthenticated requests on protected routes to /login', async ({
    page,
  }) => {
    for (const protectedRoute of ['/dashboard', '/classes', '/exams', '/submissions']) {
      await page.goto(protectedRoute);
      await expect(page).toHaveURL(/\/login/);
    }
  });

  test('3. Protected API endpoints reject anonymous, expired, tampered, and foreign-purpose credentials with HTTP 401 (#101, #103)', async ({
    request,
  }) => {
    // 1. Anonymous matrix across all protected GET endpoints
    for (const endpoint of [
      '/api/auth/me',
      '/api/auth/oauth/identities',
      '/api/exams',
      '/api/exams/exam-smoke-id',
      '/api/exams/exam-smoke-id/feedback-sheets',
      '/api/exams/exam-smoke-id/task-analysis',
      '/api/classes',
      '/api/classes/class-smoke-id',
      '/api/classes/class-smoke-id/exams',
      '/api/classes/class-smoke-id/students',
      '/api/students/student-smoke-id',
      '/api/subjects',
      '/api/submissions',
      '/api/submissions/sub-smoke-id',
      '/api/logs',
      '/api/health/gemini',
      '/uploads/sample.pdf',
    ]) {
      const res = await request.get(endpoint);
      expect(res.status(), `Expected 401 for unauthenticated GET ${endpoint}`).toBe(401);
    }

    // 2. Anonymous matrix across protected write endpoints (POST/PUT/PATCH/DELETE)
    for (const endpoint of [
      '/api/classes',
      '/api/classes/class-smoke-id/students',
      '/api/exams',
      '/api/exams/exam-smoke-id/approve',
      '/api/exams/exam-smoke-id/duplicate',
      '/api/exams/exam-smoke-id/regenerate-task',
      '/api/exams/generate',
      '/api/exams/parse-rubric',
      '/api/submissions/sub-smoke-id',
      '/api/submissions/sub-smoke-id/add-task',
      '/api/submissions/sub-smoke-id/replace',
      '/api/correct',
      '/api/mobile-relay',
    ]) {
      const res = await request.post(endpoint, { data: {} });
      expect(res.status(), `Expected 401 for unauthenticated POST ${endpoint}`).toBe(401);
    }

    // 3. Negative credential checks against production server (expired, wrong secret, foreign purpose)
    const expiredToken = createSmokeSessionToken('smoke-expired-user', { expiresInSeconds: -600 });
    const wrongSecretToken = createSmokeSessionToken('smoke-forged-user', {
      secret: 'wrong-signing-secret-key-for-negative-test',
    });
    const wrongPurposeToken = createSmokeSessionToken('smoke-relay-user', {
      purpose: 'mobile_relay',
    });

    for (const invalidToken of [expiredToken, wrongSecretToken, wrongPurposeToken]) {
      const res = await request.get('/api/exams', {
        headers: { Cookie: `grade_ai_session=${invalidToken}` },
      });
      expect(res.status()).toBe(401);
    }
  });

  test('4. Public Mobile QR Scanner route (/scan/[token]) is reachable without cookie auth and rejects invalid tokens', async ({
    page,
  }) => {
    const res = await page.goto('/scan/invalid-smoke-token');
    expect(res?.status()).toBe(200);
    await expect(
      page.getByText(/QR-Code ist abgelaufen oder ungültig|nicht verifiziert/i).first()
    ).toBeVisible();
  });

  test('5. Baseline HTTP security headers are set on page and API responses', async ({
    page,
    request,
  }) => {
    const pageRes = await page.goto('/login');
    const pageHeaders = pageRes?.headers() || {};
    expect(pageHeaders['strict-transport-security']).toContain('max-age=63072000');
    expect(pageHeaders['x-content-type-options']).toBe('nosniff');
    expect(pageHeaders['x-frame-options']).toBe('DENY');
    expect(pageHeaders['referrer-policy']).toBe('strict-origin-when-cross-origin');

    const apiRes = await request.get('/api/auth/me');
    const apiHeaders = apiRes.headers();
    expect(apiHeaders['strict-transport-security']).toContain('max-age=63072000');
    expect(apiHeaders['x-content-type-options']).toBe('nosniff');
    expect(apiHeaders['x-frame-options']).toBe('DENY');
    expect(apiHeaders['referrer-policy']).toBe('strict-origin-when-cross-origin');

    const uploadRes = await request.get('/uploads/sample.pdf');
    const uploadHeaders = uploadRes.headers();
    expect(uploadHeaders['strict-transport-security']).toContain('max-age=63072000');
    expect(uploadHeaders['x-content-type-options']).toBe('nosniff');
    expect(uploadHeaders['x-frame-options']).toBe('SAMEORIGIN');
    expect(uploadHeaders['referrer-policy']).toBe('strict-origin-when-cross-origin');
  });

  test('6. SEO routes /robots.txt and /sitemap.xml return 200 OK and landing page has OG & canonical meta tags', async ({
    page,
    request,
  }) => {
    const robotsRes = await request.get('/robots.txt');
    expect(robotsRes.status()).toBe(200);
    const robotsText = await robotsRes.text();
    expect(robotsText).toContain('Allow:');

    const sitemapRes = await request.get('/sitemap.xml');
    expect(sitemapRes.status()).toBe(200);
    const sitemapText = await sitemapRes.text();
    expect(sitemapText).toContain('<urlset');

    const landingRes = await page.goto('/');
    expect(landingRes?.status()).toBe(200);
    const ogTitle = await page.locator('meta[property="og:title"]').getAttribute('content');
    expect(ogTitle).toContain('prüefli');

    // Never emit hardcoded invented fallback domains (e.g. dead grade-ai.ch)
    const html = await page.content();
    expect(html).not.toContain('grade-ai.ch');

    const configuredBase =
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.BASE_URL && process.env.BASE_URL !== '/' ? process.env.BASE_URL : undefined) ||
      process.env.RENDER_EXTERNAL_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);

    if (configuredBase) {
      const normalized =
        configuredBase.startsWith('http://') || configuredBase.startsWith('https://')
          ? configuredBase
          : `https://${configuredBase}`;
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      expect(canonical).toContain(new URL(normalized).origin);
    } else {
      const canonicalCount = await page.locator('link[rel="canonical"]').count();
      expect(canonicalCount).toBe(0);
    }

    await page.goto('/login');
    const robotsMeta = await page.locator('meta[name="robots"]').getAttribute('content');
    expect(robotsMeta).toBe('noindex, nofollow');
  });

  test('7. Landingpage-Header shows "Login" and "Registrieren" (never "Zum Workspace") in logged-out state (#71) and redirects authenticated teachers on "/" server-side to "/dashboard" (#85)', async ({
    page,
    request,
  }) => {
    const viewports = [
      { width: 1280, height: 800 },
      { width: 375, height: 667 },
    ];

    // 1. Logged-out state across Desktop and Mobile viewports
    await page.context().clearCookies();
    for (const vp of viewports) {
      await page.setViewportSize(vp);
      const res = await page.goto('/');
      expect(res?.status()).toBe(200);

      const header = page.locator('header');
      const loginBtn = header
        .getByRole('button', { name: 'Login' })
        .or(header.getByRole('link', { name: 'Login' }))
        .first();
      const registerBtn = header
        .getByRole('button', { name: 'Registrieren' })
        .or(header.getByRole('link', { name: 'Registrieren' }))
        .first();

      await expect(loginBtn).toBeVisible();
      await expect(registerBtn).toBeVisible();
      await expect(header.getByText('Zum Workspace')).toHaveCount(0);
      await expect(
        page
          .getByRole('button', { name: 'Jetzt kostenlos starten' })
          .or(page.getByRole('link', { name: 'Jetzt kostenlos starten' }))
          .first()
      ).toBeVisible();

      const loginBox = await loginBtn.boundingBox();
      const registerBox = await registerBtn.boundingBox();
      expect(loginBox).not.toBeNull();
      expect(registerBox).not.toBeNull();
      expect(loginBox!.width).toBeGreaterThan(0);
      expect(loginBox!.height).toBeGreaterThan(0);
      expect(registerBox!.width).toBeGreaterThan(0);
      expect(registerBox!.height).toBeGreaterThan(0);
    }

    // 2. Logged-in state: GET / responds with server-side redirect to /dashboard (#85)
    const token = createSmokeSessionToken('smoke-teacher-85');
    const redirectRes = await request.get('/', {
      headers: {
        Cookie: `grade_ai_session=${token}`,
      },
      maxRedirects: 0,
    });
    expect([302, 303, 307, 308]).toContain(redirectRes.status());
    expect(redirectRes.headers()['location']).toContain('/dashboard');

    await page.context().clearCookies();
    await page.setViewportSize({ width: 1280, height: 800 });
  });

  test('8. /register and /login render on Mobile (390x844) without layout shift or empty SSO placeholder, including when /api/auth/oauth/providers is unreachable (#104)', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    for (const check of [
      { route: '/register', footerLinkText: 'Jetzt anmelden' },
      { route: '/login', footerLinkText: 'Jetzt registrieren' },
    ]) {
      await page.goto(check.route, { waitUntil: 'domcontentloaded' });
      const footerLink = page.getByRole('link', { name: check.footerLinkText });
      await expect(footerLink).toBeVisible();
      const initialBox = await footerLink.boundingBox();
      expect(initialBox).not.toBeNull();

      await page.waitForLoadState('networkidle');
      const settledBox = await footerLink.boundingBox();
      expect(settledBox).not.toBeNull();
      expect(settledBox!.y).toBe(initialBox!.y);
    }

    // Fetch error path (/api/auth/oauth/providers unreachable) also causes zero layout shift
    await page.route('**/api/auth/oauth/providers', (route) =>
      route.fulfill({ status: 500, body: 'Unavailable' })
    );
    for (const check of [
      { route: '/register', footerLinkText: 'Jetzt anmelden' },
      { route: '/login', footerLinkText: 'Jetzt registrieren' },
    ]) {
      await page.goto(check.route, { waitUntil: 'domcontentloaded' });
      const footerLink = page.getByRole('link', { name: check.footerLinkText });
      await expect(footerLink).toBeVisible();
      const initialBox = await footerLink.boundingBox();
      expect(initialBox).not.toBeNull();

      await page.waitForLoadState('networkidle');
      const settledBox = await footerLink.boundingBox();
      expect(settledBox).not.toBeNull();
      expect(settledBox!.y).toBe(initialBox!.y);
    }

    await page.unroute('**/api/auth/oauth/providers');
    await page.setViewportSize({ width: 1280, height: 800 });
  });
});
