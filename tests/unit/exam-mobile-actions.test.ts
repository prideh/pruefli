import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Issue #89: Mobile (390px) Aktions-Buttons auf Pruefungsseite nicht abgeschnitten', () => {
  const examPagePath = path.join(process.cwd(), 'app/exams/[id]/page.tsx');
  const source = fs.readFileSync(examPagePath, 'utf-8');
  const layoutPath = path.join(process.cwd(), 'components/DashboardLayout.tsx');
  const layoutSource = fs.readFileSync(layoutPath, 'utf-8');

  it('begrenzt den Haupt-Flex-Container in DashboardLayout auf 100% Viewport-Breite mit minWidth: 0', () => {
    expect(layoutSource).toContain("maxWidth: '100vw'");
    expect(layoutSource).toContain("overflowX: 'hidden'");
    expect(layoutSource).toContain('minWidth: 0');
    expect(layoutSource).toContain("width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` }");
    expect(layoutSource).toContain("maxWidth: '100%'");
  });

  it('stapelt den Aktions-Button-Container auf Mobile-Viewports (xs) vertikal mit voller Breite und useFlexGap', () => {
    expect(source).toContain("direction={{ xs: 'column', sm: 'row' }}");
    expect(source).toContain('useFlexGap');
    expect(source).toContain("alignItems: { xs: 'stretch', sm: 'center' }");
  });

  it('rendert alle Kopfzeilen-Aktionsbuttons inklusive Tooltip-Links mit voller Breite auf xs', () => {
    expect(source).toContain('Aufgabenblatt drucken (PDF)');
    expect(source).toContain('Feedback für alle drucken');
    expect(source).toContain('Prüfung duplizieren');
    expect(source).toContain('Klassensatz / Arbeiten hochladen');
    expect(source).toContain('Mit Smartphone scannen (QR)');
    expect(source).toContain('Prüfung löschen');
    expect(source).toContain("display: { xs: 'block', sm: 'inline-flex' }");
    expect(source).toContain("width: { xs: '100%', sm: 'auto' }");
  });

  it('verhindert horizontale Aufweitung der Pruefungsseite durch Tabellen via overflowX: auto und minWidth: 0', () => {
    const tableContainerBlocks = source.split('<TableContainer').slice(1);
    expect(tableContainerBlocks.length).toBeGreaterThanOrEqual(4);
    for (const block of tableContainerBlocks) {
      const tagPart = block.split('>')[0];
      expect(tagPart).toContain("overflowX: 'auto'");
      expect(tagPart).not.toContain("overflow: 'hidden'");
    }
  });
});
