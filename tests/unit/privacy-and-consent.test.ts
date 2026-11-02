import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Privacy, Cookie Audit & Datenschutzerklaerung (Issues #18, #38, #88)', () => {
  const privacyFilePath = path.join(process.cwd(), 'app/privacy/page.tsx');
  const globalsCssPath = path.join(process.cwd(), 'app/globals.css');
  const registerPagePath = path.join(process.cwd(), 'app/register/page.tsx');
  const loginPagePath = path.join(process.cwd(), 'app/login/page.tsx');
  const homePagePath = path.join(process.cwd(), 'app/page.tsx');
  const sessionPath = path.join(process.cwd(), 'lib/session.ts');

  const privacyContent = fs.readFileSync(privacyFilePath, 'utf-8');
  const globalsCssContent = fs.readFileSync(globalsCssPath, 'utf-8');
  const registerContent = fs.readFileSync(registerPagePath, 'utf-8');
  const loginContent = fs.readFileSync(loginPagePath, 'utf-8');
  const homeContent = fs.readFileSync(homePagePath, 'utf-8');
  const sessionContent = fs.readFileSync(sessionPath, 'utf-8');

  it('entfernt saemtliche Google Fonts Imports aus globals.css und nutzt System-Fonts', () => {
    expect(globalsCssContent).not.toContain('fonts.googleapis.com');
    expect(globalsCssContent).not.toContain('fonts.gstatic.com');
    expect(globalsCssContent).toContain('system-ui');
  });

  it('Datenschutzerklaerung enthaelt exakt die 6 freigegebenen Abschnitte (Issue #88)', () => {
    const normalized = privacyContent.replace(/\s+/g, ' ');

    expect(normalized).toContain('1. Verantwortliche Stelle');
    expect(normalized).toContain('Mahdi Nasserzadeh, support@pruefli.ch');

    expect(normalized).toContain('2. Daten und Zwecke');
    expect(normalized).toContain(
      'prüefli bearbeitet Konto- und Zugangsdaten der Lehrpersonen, Klassenbezeichnungen und Schülernamen, Prüfungsangaben, eingescannte Prüfungsarbeiten und Korrekturresultate. Dies dient dem Betrieb der Plattform und der KI-unterstützten Prüfungskorrektur.'
    );

    expect(normalized).toContain('3. Eingesetzte Dienste');
    expect(normalized).toContain(
      'Google (Gemini API) erhält Scans sowie zugehörige Prüfungs- und Schülerangaben zur Korrektur. Cloudflare R2 speichert die Scans. Render betreibt die Anwendung und Datenbank. Infomaniak stellt die Kontakt-E-Mail-Adresse bereit.'
    );

    expect(normalized).toContain('4. Bearbeitung im Ausland');
    expect(normalized).toContain(
      'Die Anwendung und Datenbank werden bei Render in Frankfurt am Main betrieben; der Anbieter Render Services Inc. sitzt in den USA. Die Scans werden bei Cloudflare in der EU gespeichert. Infomaniak hat seinen Sitz in der Schweiz.'
    );
    expect(normalized).toContain(
      'Bei der kostenpflichtigen Gemini-API verwendet Google die übermittelten Inhalte nicht zur Produktverbesserung. Eine vorübergehende Speicherung kann weltweit in Einrichtungen von Google oder seinen Unterauftragsverarbeitern erfolgen. Für Übermittlungen in die USA sieht Googles Datenverarbeitungsvereinbarung das Schweizerisch-US-amerikanische Data Privacy Framework vor, für andere Drittstaaten Standardvertragsklauseln.'
    );

    expect(normalized).toContain('5. Cookies');
    expect(normalized).toContain(
      'Für die Anmeldung wird ein technisch notwendiges Cookie eingesetzt.'
    );

    expect(normalized).toContain('6. Ihre Rechte');
    expect(normalized).toContain(
      'Anfragen zu Auskunft, Berichtigung oder Löschung Ihrer Daten richten Sie an support@pruefli.ch.'
    );
  });

  it('Datenschutzerklaerung enthaelt kein grade_ai / grade-ai im Seitentext, waehrend das Cookie im Code unveraendert bleibt', () => {
    expect(privacyContent).not.toContain('grade_ai');
    expect(privacyContent).not.toContain('grade-ai');
    expect(privacyContent).not.toContain('PLATZHALTER');
    expect(sessionContent).toContain('grade_ai_session');
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
