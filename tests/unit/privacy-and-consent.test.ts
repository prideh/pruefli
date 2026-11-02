import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Privacy, Cookie Audit & Datenschutzerklaerung (Issue #18)', () => {
  const privacyFilePath = path.join(process.cwd(), 'app/privacy/page.tsx');
  const globalsCssPath = path.join(process.cwd(), 'app/globals.css');
  const registerPagePath = path.join(process.cwd(), 'app/register/page.tsx');
  const loginPagePath = path.join(process.cwd(), 'app/login/page.tsx');
  const homePagePath = path.join(process.cwd(), 'app/page.tsx');

  const privacyContent = fs.readFileSync(privacyFilePath, 'utf-8');
  const globalsCssContent = fs.readFileSync(globalsCssPath, 'utf-8');
  const registerContent = fs.readFileSync(registerPagePath, 'utf-8');
  const loginContent = fs.readFileSync(loginPagePath, 'utf-8');
  const homeContent = fs.readFileSync(homePagePath, 'utf-8');

  it('entfernt saemtliche Google Fonts Imports aus globals.css und nutzt System-Fonts', () => {
    expect(globalsCssContent).not.toContain('fonts.googleapis.com');
    expect(globalsCssContent).not.toContain('fonts.gstatic.com');
    expect(globalsCssContent).toContain('system-ui');
  });

  it('Datenschutzerklaerung beschreibt Hosting-Provider und Server-Region Frankfurt/EU', () => {
    expect(privacyContent).toContain('Render');
    expect(privacyContent).toContain('Frankfurt');
    expect(privacyContent).toContain('PostgreSQL');
  });

  it('Datenschutzerklaerung beschreibt das technisch notwendige Session-Cookie grade_ai_session', () => {
    expect(privacyContent).toContain('grade_ai_session');
    expect(privacyContent).toContain('HttpOnly');
    expect(privacyContent).toContain('Secure');
    expect(privacyContent).toContain('SameSite=lax');
    expect(privacyContent).toContain('7 Tage');
  });

  it('Datenschutzerklaerung erlaeutert die ausschliesslich lokale Speicherung fuer UI-Praeferenzen', () => {
    expect(privacyContent).toContain('localStorage');
    expect(privacyContent).toContain('keine');
  });

  it('Datenschutzerklaerung beschreibt die Gemini-KI-Verarbeitung und den aktuellen Testbetrieb', () => {
    expect(privacyContent).toContain('Gemini');
    expect(privacyContent).toContain('synthetische Testdaten');
    expect(privacyContent).toContain('Schülerdaten');
  });

  it('Datenschutzerklaerung enthaelt die freigegebene Betreiber-Identitaet + Kontaktadresse ohne Platzhalter sowie DSG-Rechte', () => {
    expect(privacyContent).toContain('Mahdi Nasserzadeh');
    expect(privacyContent).toContain('support@pruefli.ch');
    expect(privacyContent).not.toContain('PLATZHALTER');
    expect(privacyContent).not.toContain('[Name / Rechtliche Identität');
    expect(privacyContent).not.toContain('[Kontaktadresse');
    expect(privacyContent).toContain('Schweizer Bundesgesetz über den Datenschutz (DSG)');
    expect(privacyContent).toContain('Auskunft');
  });

  it('Startseite, Registrierungs- und Login-Seiten verlinken transparent auf /privacy', () => {
    expect(homeContent).toContain('/privacy');
    expect(homeContent).toContain('Datenschutzerklärung');

    expect(registerContent).toContain('/privacy');
    expect(registerContent).toContain('Datenschutzerklärung');

    expect(loginContent).toContain('/privacy');
    expect(loginContent).toContain('Datenschutzerklärung');
  });

  it('verwendet kein Eszett in allen Datenschutz- und Font-Dateien (Schweizer Orthografie)', () => {
    const eszett = String.fromCharCode(0xdf);
    expect(privacyContent).not.toContain(eszett);
    expect(registerContent).not.toContain(eszett);
    expect(loginContent).not.toContain(eszett);
    expect(homeContent).not.toContain(eszett);
  });
});
