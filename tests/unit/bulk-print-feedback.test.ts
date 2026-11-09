import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Feature: Print feedback sheets for whole class in one action', () => {
  it('Prüfungsdetailseite bietet "Feedback für alle drucken" an', () => {
    const detailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/exams/[id]/page.tsx'),
      'utf-8'
    );
    expect(detailFile).toContain('Feedback für alle drucken');
    expect(detailFile).toContain('href={`/exams/${examId}/print`}');
  });

  it('Deaktiviert Druck-Aktion bei 0 bewerteten Arbeiten mit Hinweis', () => {
    const detailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/exams/[id]/page.tsx'),
      'utf-8'
    );
    expect(detailFile).toContain('disabled={completedCount === 0}');
    expect(detailFile).toContain('Noch keine bewerteten Arbeiten vorhanden');
  });

  it('Zeigt Anzahl noch nicht bewerteter Arbeiten an ("not yet graded - not included")', () => {
    const detailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/exams/[id]/page.tsx'),
      'utf-8'
    );
    expect(detailFile).toContain('not yet graded - not included');

    const printPageFile = [
      fs.readFileSync(path.resolve(__dirname, '../../app/exams/[id]/print/page.tsx'), 'utf-8'),
      fs.readFileSync(
        path.resolve(__dirname, '../../components/ExamPrintFeedbackContent.tsx'),
        'utf-8'
      ),
    ].join('\n');
    expect(printPageFile).toContain('not yet graded - not included');
  });

  it('API schliesst unfertige Arbeiten aus und sortiert alphabetisch nach Schülernamen', () => {
    const apiFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/exams/[id]/feedback-sheets/route.ts'),
      'utf-8'
    );
    expect(apiFile).toContain("s.status === 'COMPLETED'");
    expect(apiFile).toContain("localeCompare(nameB, 'de-CH')");
    expect(apiFile).toContain('ungradedCount');
    expect(apiFile).toContain('examTitle: exam.title');
    expect(apiFile).toContain('schuelerName');
  });

  it('Kombinierte Druckansicht nutzt .print-page mit Seitenumbruch und enthaelt Pruefungstitel & Schuelernamen', () => {
    const printPageFile = [
      fs.readFileSync(path.resolve(__dirname, '../../app/exams/[id]/print/page.tsx'), 'utf-8'),
      fs.readFileSync(
        path.resolve(__dirname, '../../components/ExamPrintFeedbackContent.tsx'),
        'utf-8'
      ),
    ].join('\n');
    expect(printPageFile).toContain('className="print-page"');
    expect(printPageFile).toContain('pageBreakAfter');
    expect(printPageFile).toContain('window.print()');
    expect(printPageFile).toContain('sheet.examTitle');
    expect(printPageFile).toContain('sheet.schuelerName');
  });

  it('Einzelner Druckpfad in Korrekturansicht bleibt unveraendert erhalten', () => {
    const correctFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/correct/[id]/page.tsx'),
      'utf-8'
    );
    expect(correctFile).toContain('Feedback drucken');
    expect(correctFile).toContain('window.print()');
    expect(correctFile).toContain('print-only print-page');
  });

  it('Verwendet kein "ß" in allen neuen und geaenderten Dateien (Schweizer Rechtschreibung)', () => {
    const detailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/exams/[id]/page.tsx'),
      'utf-8'
    );
    const printPageFile = [
      fs.readFileSync(path.resolve(__dirname, '../../app/exams/[id]/print/page.tsx'), 'utf-8'),
      fs.readFileSync(
        path.resolve(__dirname, '../../components/ExamPrintFeedbackContent.tsx'),
        'utf-8'
      ),
    ].join('\n');
    const apiFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/api/exams/[id]/feedback-sheets/route.ts'),
      'utf-8'
    );

    expect(detailFile).not.toContain('ß');
    expect(printPageFile).not.toContain('ß');
    expect(apiFile).not.toContain('ß');
  });
});
