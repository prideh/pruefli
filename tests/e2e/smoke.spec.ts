import { test, expect } from '@playwright/test';

test.describe('Smoke Tests — Critical Availability, Security Boundaries & Orthography', () => {
  test('1. Public landing, login, and register pages render 200 OK with strict Swiss German orthography (no Eszett)', async ({
    page,
  }) => {
    for (const route of ['/', '/login', '/register']) {
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

  test('3. Protected API endpoints reject unauthenticated requests with HTTP 401', async ({
    request,
  }) => {
    const meRes = await request.get('/api/auth/me');
    expect(meRes.status()).toBe(401);

    const classesRes = await request.get('/api/classes');
    expect(classesRes.status()).toBe(401);

    const relayPostRes = await request.post('/api/mobile-relay', {
      data: { targetMode: 'SUBMISSION' },
    });
    expect(relayPostRes.status()).toBe(401);
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
});
