import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Issue #129: QR-Scan-Dialog auf schmalem Mobile-Viewport (~390px und kleiner) ohne Clipping', () => {
  const dialogPath = path.join(process.cwd(), 'components/QrScannerDialog.tsx');
  const source = fs.readFileSync(dialogPath, 'utf-8');

  it('begrenzt die Dialog-Hoehe auf 100dvh und verhindert horizontales Ueberlaufen auf Mobile-Viewports', () => {
    expect(source).toContain("maxHeight: { xs: 'calc(100dvh - 24px)', sm: 'calc(100dvh - 64px)' }");
    expect(source).toContain("maxWidth: { xs: 'calc(100vw - 24px)', sm: '600px' }");
    expect(source).toContain("overflowY: 'auto'");
    expect(source).toContain("overflowX: 'hidden'");
  });

  it('stapelt bzw. bricht die Step-Chips auf schmalen Viewports um und erlaubt mehrzeilige Chip-Labels ohne Ellipsis-Abschnitt', () => {
    expect(source).toContain('label="1. QR-Code mit Handy scannen"');
    expect(source).toContain('label="2. Seiten abfotografieren"');
    expect(source).toContain("direction={{ xs: 'column', sm: 'row' }}");
    expect(source).toContain("flexWrap: 'wrap'");
    expect(source).toContain('useFlexGap');
    expect(source).toContain("height: 'auto'");
    expect(source).toContain("whiteSpace: 'normal'");
    expect(source).toContain("overflowWrap: 'anywhere'");
  });

  it('skaliert das QR-Code-Bild responsiv innerhalb des Containers und haelt Schweizer Rechtschreibung (kein Eszett) ein', () => {
    expect(source).toContain('width: { xs: 176, sm: 210 }');
    expect(source).toContain('height: { xs: 176, sm: 210 }');
    expect(source).toContain("maxWidth: '100%'");
    expect(source).not.toMatch(/\u00df/);
  });
});
