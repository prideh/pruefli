import { describe, it, expect } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { proxy, applySecurityHeaders, SECURITY_HEADERS, config } from '@/proxy';
import { signJWT } from '@/lib/jwt';
import * as fs from 'fs';
import * as path from 'path';

describe('Security Headers (Issue #15)', () => {
  it('definiert alle vier Standard-Sicherheits-Header gemaess Vorgabe', () => {
    expect(SECURITY_HEADERS['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(SECURITY_HEADERS['X-Content-Type-Options']).toBe('nosniff');
    expect(SECURITY_HEADERS['X-Frame-Options']).toBe('DENY');
    expect(SECURITY_HEADERS['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("default-src 'self'");
    expect(SECURITY_HEADERS['Content-Security-Policy']).toContain("object-src 'none'");
  });

  it('applySecurityHeaders setzt alle vier Header auf einer NextResponse', () => {
    const res = NextResponse.next();
    const secured = applySecurityHeaders(res);

    expect(secured.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(secured.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(secured.headers.get('X-Frame-Options')).toBe('DENY');
    expect(secured.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
    expect(secured.headers.get('Content-Security-Policy')).toContain("default-src 'self'");
  });

  it('proxy setzt Sicherheits-Header bei oeffentlichen Seitenaufrufen', async () => {
    const req = new NextRequest('http://localhost:3000/');
    const res = await proxy(req);

    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('proxy setzt Sicherheits-Header bei Weiterleitungen unauthentifizierter Anfragen', async () => {
    const req = new NextRequest('http://localhost:3000/dashboard');
    const res = await proxy(req);

    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe('http://localhost:3000/login');
    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('proxy setzt Sicherheits-Header bei API-Routen', async () => {
    const req = new NextRequest('http://localhost:3000/api/classes');
    const res = await proxy(req);

    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('proxy setzt Sicherheits-Header bei authentifizierten Anfragen mit aktivem JWT', async () => {
    const token = await signJWT({ userId: 'test-user-123' }, '7d');
    const req = new NextRequest('http://localhost:3000/dashboard', {
      headers: {
        cookie: `grade_ai_session=${token}`,
      },
    });

    const res = await proxy(req);

    expect(res.headers.get('Strict-Transport-Security')).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('matcher schliesst API-Routen nicht aus (erfasst alle Seiten- und API-Pfade)', () => {
    const matcherList = Array.isArray(config.matcher) ? config.matcher : [config.matcher];
    const matcherString = matcherList.join(' ');
    // api darf nicht in der Ausschluss-Liste sein
    expect(matcherString).not.toMatch(/api\|/);
  });

  it('haelt Schweizer Rechtschreibung ein (kein "ß")', () => {
    const proxyFilePath = path.join(process.cwd(), 'proxy.ts');
    const content = fs.readFileSync(proxyFilePath, 'utf-8');
    expect(content).not.toContain('ß');
  });
});
