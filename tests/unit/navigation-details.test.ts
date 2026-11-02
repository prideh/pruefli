import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { signJWT, verifyJWT } from '@/lib/jwt';
import Home from '@/app/page';

const mockCookieGet = vi.fn();
const mockRedirect = vi.fn((url: string): never => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mockCookieGet,
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: (url: string) => mockRedirect(url),
}));

describe('UX Navigation Details Improvements, Landingpage-Header (#71) & Startseiten-Weiterleitung (#85)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('Klassenkarten verlinken den Klassennamen direkt auf die Klassendetailseite', () => {
    const classesFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/classes/page.tsx'),
      'utf-8'
    );
    expect(classesFile).toContain('href={`/classes/${cls.id}`}');
    expect(classesFile).toContain('{cls.name}');
    // Check that Link wraps cls.name
    const linkMatch = classesFile.match(
      /<Link[\s\S]*?href=\{`\/classes\/\$\{cls\.id\}`\}[\s\S]*?>[\s\S]*?\{cls\.name\}[\s\S]*?<\/Link>/
    );
    expect(linkMatch).not.toBeNull();
  });

  it('Startseite zeigt im Header immer Login und Registrieren (kein "Zum Workspace" im Header, #71)', () => {
    const landingFile = fs.readFileSync(path.resolve(__dirname, '../../app/page.tsx'), 'utf-8');
    const headerMatch = landingFile.match(
      /<Box\s+component="header"[\s\S]*?>([\s\S]*?){\/\* Hero section \*\/}/
    );
    expect(headerMatch).not.toBeNull();
    const headerBlock = headerMatch![1];

    expect(headerBlock).toContain('href="/login"');
    expect(headerBlock).toContain('href="/register"');
    expect(headerBlock).toContain('Login');
    expect(headerBlock).toContain('Registrieren');
    expect(headerBlock).not.toContain('Zum Workspace');
    expect(headerBlock).not.toContain('isAuthenticated');
  });

  it('rendert ohne gueltige Session (ausgeloggt, ungueltiges oder abgelaufenes Cookie) die Landingpage inkl. Login/Registrieren-Header (#71, #85) und leitet mit gueltiger Session serverseitig via redirect("/dashboard") weiter (#85)', async () => {
    // 1. Ausgeloggter Zustand (kein Cookie)
    mockCookieGet.mockReturnValue(undefined);
    const loggedOutHtml = renderToStaticMarkup(await Home());
    const loggedOutHeader = loggedOutHtml.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1] || '';

    expect(mockRedirect).not.toHaveBeenCalled();
    expect(loggedOutHeader).toContain('href="/login"');
    expect(loggedOutHeader).toContain('Login');
    expect(loggedOutHeader).toContain('href="/register"');
    expect(loggedOutHeader).toContain('Registrieren');
    expect(loggedOutHeader).not.toContain('Zum Workspace');
    expect(loggedOutHtml).toContain('Jetzt kostenlos starten');
    expect(loggedOutHtml).toContain('Login / Registrieren');
    expect(loggedOutHtml).toContain('Spare bis zu 80% deiner Korrekturzeit.');

    // 2. Ungueltiges Cookie -> Landingpage ohne Redirect-Schleife
    mockCookieGet.mockReturnValue({ value: 'invalid.jwt.token' });
    const invalidCookieHtml = renderToStaticMarkup(await Home());
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(invalidCookieHtml).toContain('Jetzt kostenlos starten');

    // 3. Abgelaufenes Cookie -> Landingpage ohne Redirect-Schleife
    const now = Math.floor(Date.now() / 1000);
    const secret = process.env.JWT_SECRET || 'pruefli-dev-secret-key-safe-fallback';
    const hdr = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const expiredPld = Buffer.from(
      JSON.stringify({ userId: 'teacher-expired', iat: now - 7200, exp: now - 3600 })
    ).toString('base64url');
    const expiredSig = crypto
      .createHmac('sha256', secret)
      .update(`${hdr}.${expiredPld}`)
      .digest('base64url');
    const expiredToken = `${hdr}.${expiredPld}.${expiredSig}`;
    expect(await verifyJWT(expiredToken)).toBeNull();

    mockCookieGet.mockReturnValue({ value: expiredToken });
    const expiredCookieHtml = renderToStaticMarkup(await Home());
    expect(mockRedirect).not.toHaveBeenCalled();
    expect(expiredCookieHtml).toContain('Jetzt kostenlos starten');

    // 4. Eingeloggter Zustand (gueltige Session) -> serverseitige Weiterleitung auf /dashboard (#85)
    const validToken = await signJWT({ userId: 'teacher-85' }, '7d');
    const verified = await verifyJWT(validToken);
    expect(verified?.userId).toBe('teacher-85');

    mockCookieGet.mockReturnValue({ value: validToken });
    await expect(Home()).rejects.toThrow('NEXT_REDIRECT:/dashboard');
    expect(mockRedirect).toHaveBeenCalledWith('/dashboard');
  }, 20000);

  it('Logout im DashboardLayout leitet zur Landingpage (/) weiter (#85)', () => {
    const dashboardLayoutFile = fs.readFileSync(
      path.resolve(__dirname, '../../components/DashboardLayout.tsx'),
      'utf-8'
    );
    const logoutBlock = dashboardLayoutFile.match(
      /const handleLogout = async \(\) => \{[\s\S]*?\};/
    )?.[0];
    expect(logoutBlock).toBeTruthy();
    expect(logoutBlock).toContain("router.push('/')");
    expect(dashboardLayoutFile).not.toContain('\u00DF');
  });

  it('Startseite bietet in der Hero-Sektion einen sichtbaren Login/Registrieren-Button', () => {
    const landingFile = fs.readFileSync(path.resolve(__dirname, '../../app/page.tsx'), 'utf-8');
    expect(landingFile).toContain('Login / Registrieren');
  });

  it('Verwendet kein Eszett in geaenderten Navigationstexten (Schweizer Rechtschreibung)', () => {
    const landingFile = fs.readFileSync(path.resolve(__dirname, '../../app/page.tsx'), 'utf-8');
    const classesFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/classes/page.tsx'),
      'utf-8'
    );
    expect(landingFile).not.toContain('\u00DF');
    expect(classesFile).not.toContain('\u00DF');
  });
});
