import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseExamMetadata, embedExamMetadata } from '@/lib/exam-meta';

describe('Rebrand Audit (Issue #62): GradeAI -> prüefli', () => {
  describe('Kategorie A: Nutzer-sichtbare Anzeigenamen', () => {
    const categoryAFiles = [
      '../../app/correct/[id]/page.tsx',
      '../../app/exams/[id]/print/page.tsx',
      '../../app/exams/[id]/print-task-sheet/page.tsx',
      '../../app/exams/page.tsx',
      '../../app/api/exams/generate/route.ts',
    ];

    it('enthaelt in allen Kategorie-A-Dateien kein "GradeAi" oder "GradeAI"', () => {
      for (const rel of categoryAFiles) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt noch GradeAi`).not.toMatch(/GradeAi/);
        expect(content, `Datei ${rel} enthaelt noch GradeAI`).not.toMatch(/GradeAI/);
      }
    });

    it('enthaelt die korrekte Benennung "prüefli" in allen Druck- und Berichtsvorlagen', () => {
      const feedbackPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/correct/[id]/page.tsx'),
        'utf-8'
      );
      expect(feedbackPage).toContain('prüefli - Schüler-Feedbackbericht');

      const printPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/exams/[id]/print/page.tsx'),
        'utf-8'
      );
      expect(printPage).toContain('prüefli - Schüler-Feedbackbericht');

      const taskSheetPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/exams/[id]/print-task-sheet/page.tsx'),
        'utf-8'
      );
      expect(taskSheetPage).toContain('Qualitätsrichtlinien von prüefli');
      expect(taskSheetPage).toContain('Erstellt mit prüefli • Lehrperson geprüft und freigegeben');

      const examsPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/exams/page.tsx'),
        'utf-8'
      );
      expect(examsPage).toContain(
        'prüefli generiert Prüfungen ausschliesslich auf Basis Ihrer Unterlagen'
      );
      expect(examsPage).toContain('prüefli generiert die\n                  Aufgabenstellung');

      const generateRoute = fs.readFileSync(
        path.resolve(__dirname, '../../app/api/exams/generate/route.ts'),
        'utf-8'
      );
      expect(generateRoute).toContain(
        'prüefli generiert Prüfungen ausschliesslich auf Basis Ihrer Unterlagen'
      );
    });
  });

  describe('Kategorie B: Abwaertskompatible Metadaten & Speicher', () => {
    it('erzeugt standardmaessig das neue PRUEFLI_EXAM_META Praefix', () => {
      const embedded = embedExamMetadata('Notizen', {
        isGenerated: true,
        isApproved: false,
        approvedAt: null,
      });
      expect(embedded).toContain('<!-- PRUEFLI_EXAM_META:');
      const parsed = parseExamMetadata(embedded);
      expect(parsed.metadata.isGenerated).toBe(true);
      expect(parsed.metadata.isApproved).toBe(false);
      expect(parsed.cleanNotes).toBe('Notizen');
    });

    it('liest aeltere GRADEAI_EXAM_META Praefixe abwaertskompatibel aus bestehenden Dateien', () => {
      const legacy =
        '<!-- GRADEAI_EXAM_META:{"isGenerated":true,"isApproved":true,"approvedAt":"2026-10-31T20:00:00Z","taskSources":{"1":"Buch S. 12"}} --> Bestehende Lehrernotizen';
      const parsed = parseExamMetadata(legacy);
      expect(parsed.metadata.isGenerated).toBe(true);
      expect(parsed.metadata.isApproved).toBe(true);
      expect(parsed.metadata.approvedAt).toBe('2026-10-31T20:00:00Z');
      expect(parsed.metadata.taskSources?.['1']).toBe('Buch S. 12');
      expect(parsed.cleanNotes).toBe('Bestehende Lehrernotizen');
    });
  });

  describe('Schweizer Orthografie (kein Eszett)', () => {
    it('verwendet ausschliesslich "ss" in allen modifizierten Dateien', () => {
      const files = [
        '../../app/correct/[id]/page.tsx',
        '../../app/exams/[id]/print/page.tsx',
        '../../app/exams/[id]/print-task-sheet/page.tsx',
        '../../app/exams/page.tsx',
        '../../app/api/exams/generate/route.ts',
        '../../lib/exam-meta.ts',
        '../../lib/jwt.ts',
        '../../lib/cache.ts',
        '../../lib/rate-limit.ts',
        '../../lib/llm-cache.ts',
      ];

      for (const rel of files) {
        const fullPath = path.resolve(__dirname, rel);
        const content = fs.readFileSync(fullPath, 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
