import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { renderToStaticMarkup } from 'react-dom/server';
import { signJWT, verifyJWT } from '@/lib/jwt';

const mockCookieGet = vi.fn();

vi.mock('next/headers', () => ({
  cookies: vi.fn(async () => ({
    get: mockCookieGet,
  })),
}));

describe('UX Navigation Details Improvements & Landingpage-Header (#71)', () => {
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

  it('rendert auf der Startseite sowohl ausgeloggt als auch eingeloggt immer Login & Registrieren im Header, waehrend der Hero-CTA zustandsabhaengig bleibt (#71)', async () => {
    const { default: Home } = await import('@/app/page');

    // 1. Ausgeloggter Zustand
    mockCookieGet.mockReturnValue(undefined);
    const loggedOutHtml = renderToStaticMarkup(await Home());
    const loggedOutHeader = loggedOutHtml.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1] || '';

    expect(loggedOutHeader).toContain('href="/login"');
    expect(loggedOutHeader).toContain('Login');
    expect(loggedOutHeader).toContain('href="/register"');
    expect(loggedOutHeader).toContain('Registrieren');
    expect(loggedOutHeader).not.toContain('Zum Workspace');
    expect(loggedOutHtml).toContain('Jetzt kostenlos starten');
    expect(loggedOutHtml).toContain('Login / Registrieren');
    expect(loggedOutHtml).toContain('Spare bis zu 80% deiner Korrekturzeit.');

    // 2. Eingeloggter Zustand
    const validToken = await signJWT({ userId: 'teacher-71' }, '7d');
    const now = Math.floor(Date.now() / 1000);
    const secret = process.env.JWT_SECRET || 'pruefli-dev-secret-key-safe-fallback';
    const hdr = Buffer.from(JSON.stringify({ alg: 'HS256' })).toString('base64url');
    const pld = Buffer.from(
      JSON.stringify({ userId: 'teacher-71', iat: now, exp: now + 7 * 24 * 60 * 60 })
    ).toString('base64url');
    const sig = crypto.createHmac('sha256', secret).update(`${hdr}.${pld}`).digest('base64url');
    const hmacToken = `${hdr}.${pld}.${sig}`;
    const verifiedHmac = await verifyJWT(hmacToken);
    expect(verifiedHmac?.userId).toBe('teacher-71');

    mockCookieGet.mockReturnValue({ value: validToken });
    const loggedInHtml = renderToStaticMarkup(await Home());
    const loggedInHeader = loggedInHtml.match(/<header[^>]*>([\s\S]*?)<\/header>/)?.[1] || '';

    expect(loggedInHeader).toContain('href="/login"');
    expect(loggedInHeader).toContain('Login');
    expect(loggedInHeader).toContain('href="/register"');
    expect(loggedInHeader).toContain('Registrieren');
    expect(loggedInHeader).not.toContain('Zum Workspace');
    expect(loggedInHtml).toContain('Zum Korrektur-Workspace');
    expect(loggedInHtml).toContain('Spare bis zu 80% deiner Korrekturzeit.');
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
