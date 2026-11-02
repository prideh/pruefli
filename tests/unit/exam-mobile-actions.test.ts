import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Issue #89: Mobile (390px) Aktions-Buttons auf Pruefungsseite nicht abgeschnitten', () => {
  const examPagePath = path.join(process.cwd(), 'app/exams/[id]/page.tsx');
  const source = fs.readFileSync(examPagePath, 'utf-8');

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
});
