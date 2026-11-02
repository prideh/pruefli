import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Issue #90: Mobile (390px) Korrektur-Workspace stapelt Bereiche vertikal', () => {
  const correctPagePath = path.join(process.cwd(), 'app/correct/[id]/page.tsx');
  const source = fs.readFileSync(correctPagePath, 'utf-8');

  it('stapelt Schuelerarbeit und Bewertungspanel auf Mobile/Tablet (< md, inkl. 390px und 768px) vertikal', () => {
    expect(source).toContain("flexDirection: { xs: 'column', md: 'row' }");
    expect(source).toContain("height: { xs: 'auto', md: 'calc(100vh - 64px)' }");
    expect(source).toContain("overflow: { xs: 'visible', md: 'hidden' }");
  });

  it('vergibt volle Breite (100%) und minWidth: 0 an beide Workspace-Spalten auf Mobile', () => {
    expect(source).toContain("flex: { xs: '0 0 auto', md: 1.1 }");
    expect(source).toContain("flex: { xs: '1 1 auto', md: 1 }");
    expect(source).toContain("width: { xs: '100%', md: 'auto' }");
  });

  it('bricht Kopfzeile, Sicherheitshinweis-Banner und Teilschritt-Zeilen auf Mobile sauber um', () => {
    expect(source).toContain("padding: { xs: '10px 12px', md: '12px 24px' }");
    expect(source).toContain('Sicherheitshinweis (Manipulationsversuch erkannt):');
    expect(source).toContain("overflowWrap: 'break-word'");
    expect(source).toContain("direction={{ xs: 'column', sm: 'row' }}");
  });
});
