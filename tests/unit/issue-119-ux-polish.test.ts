import React from 'react';
import fs from 'fs';
import path from 'path';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const mockUseParams = vi.fn(() => ({ id: 'exam-123' }));
const mockUseSearchParams = vi.fn(() => new URLSearchParams());

vi.mock('next/navigation', () => ({
  useParams: () => mockUseParams(),
  useSearchParams: () => mockUseSearchParams(),
}));

import ErrorState from '@/components/ErrorState';
import ExamPrintFeedbackPage from '@/app/exams/[id]/print/page';
import {
  DEFAULT_ERROR_RECOVERY_HINT,
  resolveErrorStateMessage,
  canCreateExamWithClasses,
  resolveCreateExamDisabledHint,
  shouldClearWizardValidationError,
  applyUpdatedClassStudentCount,
  buildFeedbackPrintHref,
  filterFeedbackSheetsForPrint,
} from '@/lib/ux-polish';

const SAMPLE_SHEETS = [
  {
    submissionId: 'sub-1',
    examId: 'exam-123',
    examTitle: 'Bruchrechnen 1',
    fach: 'Mathematik',
    className: 'Sek 2a',
    schuelerName: 'Anna Beispiel',
    datum: '08.11.2026',
    gesamterzieltePunkte: 18,
    gesamtmaximalPunkte: 20,
    note: '5.5',
    aufgaben: [
      {
        aufgabeId: '1',
        titel: 'Aufgabe 1: Brüche kürzen',
        schuelerAntwort: '3/4',
        erzieltePunkte: 4,
        maximalPunkte: 4,
        status: 'Korrekt',
        lehrerKommentar: 'Sehr sauber gelöst.',
      },
    ],
    schuelerFeedback: {
      staerken: ['Sicheres Kürzen'],
      schwaechen: ['Vorzeichen bei Textaufgaben'],
      hilfreicherTipp: 'Zwischenschritte immer notieren.',
      uebungsEmpfehlung: 'Übungsblatt 3, Aufgaben 1–4.',
    },
  },
  {
    submissionId: 'sub-2',
    examId: 'exam-123',
    examTitle: 'Bruchrechnen 1',
    fach: 'Mathematik',
    className: 'Sek 2a',
    schuelerName: 'Ben Muster',
    datum: '08.11.2026',
    gesamterzieltePunkte: 15,
    gesamtmaximalPunkte: 20,
    note: '4.8',
    aufgaben: [
      {
        aufgabeId: '1',
        titel: 'Aufgabe 1: Brüche kürzen',
        schuelerAntwort: '6/8',
        erzieltePunkte: 3,
        maximalPunkte: 4,
        status: 'Folgefehler',
        lehrerKommentar: 'Nicht vollständig gekürzt.',
      },
    ],
    schuelerFeedback: {
      staerken: ['Guter Ansatz'],
      schwaechen: ['Endresultat vollständig kürzen'],
      hilfreicherTipp: 'Prüfe den grössten gemeinsamen Teiler.',
      uebungsEmpfehlung: 'Übungsblatt 2, Aufgaben 5–8.',
    },
  },
];

describe('Issue #119 UX Polish Regression Suite (5 verified UX items)', () => {
  beforeEach(() => {
    mockUseParams.mockReturnValue({ id: 'exam-123' });
    mockUseSearchParams.mockReturnValue(new URLSearchParams());
  });

  describe('1. Duplicate Error Heading / Body on /exams and /submissions', () => {
    it('replaces identical heading and message with actionable recovery hint while preserving distinct messages', () => {
      expect(
        resolveErrorStateMessage(
          'Fehler beim Laden der Prüfungen',
          'Fehler beim Laden der Prüfungen.'
        )
      ).toBe(DEFAULT_ERROR_RECOVERY_HINT);

      expect(
        resolveErrorStateMessage(
          'Fehler beim Laden der Korrekturen',
          'Fehler beim Laden der Korrekturen.'
        )
      ).toBe(DEFAULT_ERROR_RECOVERY_HINT);

      expect(
        resolveErrorStateMessage(
          'Fehler beim Laden der Prüfungen',
          'Zeitüberschreitung bei der Datenbankverbindung.'
        )
      ).toBe('Zeitüberschreitung bei der Datenbankverbindung.');

      const html = renderToStaticMarkup(
        React.createElement(ErrorState, {
          title: 'Fehler beim Laden der Prüfungen',
          message: 'Fehler beim Laden der Prüfungen.',
        })
      );
      expect(html).toContain('Fehler beim Laden der Prüfungen');
      expect(html).toContain(DEFAULT_ERROR_RECOVERY_HINT);
      expect(html).not.toContain('Fehler beim Laden der Prüfungen.');
    });
  });

  describe('2. Create Exam Buttons Enabled When Exam List Fails on /exams', () => {
    it('keeps exam creation enabled when classes are loaded despite exam list failure', () => {
      expect(
        canCreateExamWithClasses({
          classesLoading: false,
          classesError: null,
          classesCount: 2,
        })
      ).toBe(true);

      expect(
        canCreateExamWithClasses({
          classesLoading: true,
          classesError: null,
          classesCount: 2,
        })
      ).toBe(false);

      expect(
        canCreateExamWithClasses({
          classesLoading: false,
          classesError: 'Fehler beim Laden der Klassen.',
          classesCount: 2,
        })
      ).toBe(false);

      expect(
        canCreateExamWithClasses({
          classesLoading: false,
          classesError: null,
          classesCount: 0,
        })
      ).toBe(false);
    });

    it('provides clear explanatory hints when creation buttons are disabled', () => {
      expect(
        resolveCreateExamDisabledHint({
          isUnverified: true,
          forAiGeneration: true,
          classesLoading: false,
          classesError: null,
          classesCount: 2,
        })
      ).toContain('E-Mail-Adresse');

      expect(
        resolveCreateExamDisabledHint({
          classesLoading: false,
          classesError: 'Fehler beim Laden der Klassen.',
          classesCount: 0,
        })
      ).toContain('sobald die Klassenliste geladen werden konnte');

      expect(
        resolveCreateExamDisabledHint({
          classesLoading: false,
          classesError: null,
          classesCount: 0,
        })
      ).toContain('Erstelle zuerst eine Klasse');

      expect(
        resolveCreateExamDisabledHint({
          classesLoading: false,
          classesError: null,
          classesCount: 1,
        })
      ).toBe('');
    });

    it('wires canCreateExamWithClasses into /exams header buttons so examsError does not disable them', () => {
      const examsPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/exams/page.tsx'),
        'utf-8'
      );
      expect(examsPage).toContain('canCreateExamWithClasses');
      expect(examsPage).toContain('disabled={isUnverified || !canCreateExam}');
      expect(examsPage).toContain('disabled={!canCreateExam}');
      expect(examsPage).not.toContain(
        'disabled={isUnverified || loading || !!error || classes.length === 0}'
      );
      expect(examsPage).not.toContain('disabled={loading || !!error || classes.length === 0}');
    });
  });

  describe('3. Validation Banner Clears Immediately After Selecting Subject', () => {
    it('clears "Fach ist erforderlich." and related validation banners as soon as condition is fulfilled', () => {
      const baseState = {
        hasClass: true,
        hasStudent: true,
        isNewExam: true,
        hasTitle: true,
        hasSubject: false,
        hasValidMaxPoints: true,
        hasFiles: false,
      };

      expect(shouldClearWizardValidationError('Fach ist erforderlich.', baseState)).toBe(false);
      expect(
        shouldClearWizardValidationError('Fach ist erforderlich.', {
          ...baseState,
          hasSubject: true,
        })
      ).toBe(true);

      expect(
        shouldClearWizardValidationError(
          'Bitte gib einen Prüfungstitel und ein Fach für die neue Prüfung an.',
          {
            ...baseState,
            hasTitle: true,
            hasSubject: true,
          }
        )
      ).toBe(true);

      expect(
        shouldClearWizardValidationError('Netzwerkfehler beim Speichern.', {
          ...baseState,
          hasSubject: true,
        })
      ).toBe(false);
    });

    it('wires immediate validation clearing and effectiveExamSubject in app/dashboard/page.tsx', () => {
      const dashboardPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/dashboard/page.tsx'),
        'utf-8'
      );
      expect(dashboardPage).toContain('shouldClearWizardValidationError');
      expect(dashboardPage).toContain('subject: (examSubject || effectiveExamSubject).trim()');
    });
  });

  describe('4. Student Counters Update Immediately Without Reload After Adding Student', () => {
    it('updates _count.students and total student count in memory for the target class', () => {
      const initialClasses = [
        { id: 'class-1', name: 'Sek 2a', _count: { students: 0, exams: 1 } },
        { id: 'class-2', name: 'Sek 3b', _count: { students: 5, exams: 2 } },
      ];

      const updated = applyUpdatedClassStudentCount(initialClasses, 'class-1', 1);
      expect(updated[0]._count?.students).toBe(1);
      expect(updated[1]._count?.students).toBe(5);

      const totalStudents = updated.reduce((sum, cls) => sum + (cls._count?.students || 0), 0);
      expect(totalStudents).toBe(6);
    });

    it('wires applyUpdatedClassStudentCount into handleCreateStudentSubmit in app/dashboard/page.tsx', () => {
      const dashboardPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/dashboard/page.tsx'),
        'utf-8'
      );
      expect(dashboardPage).toContain(
        'applyUpdatedClassStudentCount(prev, targetClassId, updatedStudents.length)'
      );
    });
  });

  describe('5. "Feedback drucken" on /correct/[id] Navigates to /exams/[id]/print Safely Without Leaking Other Students', () => {
    it('builds dedicated print view href and NEVER falls back to all sheets when targetSubmissionId is missing', () => {
      expect(buildFeedbackPrintHref('exam-123', 'sub-456')).toBe(
        '/exams/exam-123/print?submissionId=sub-456'
      );
      expect(buildFeedbackPrintHref('exam-123')).toBe('/exams/exam-123/print');
      expect(buildFeedbackPrintHref('')).toBeNull();

      expect(filterFeedbackSheetsForPrint(SAMPLE_SHEETS, 'sub-2')).toEqual([SAMPLE_SHEETS[1]]);
      expect(filterFeedbackSheetsForPrint(SAMPLE_SHEETS, 'sub-missing-id')).toEqual([]);
      expect(filterFeedbackSheetsForPrint(SAMPLE_SHEETS, null)).toHaveLength(2);
    });

    it('renders ONLY the requested student sheet when ?submissionId=sub-2 is passed via useSearchParams', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('submissionId=sub-2'));

      const html = renderToStaticMarkup(
        React.createElement(ExamPrintFeedbackPage, {
          initialData: {
            examTitle: 'Bruchrechnen 1',
            sheets: SAMPLE_SHEETS,
            totalCount: 2,
            completedCount: 2,
            ungradedCount: 0,
          },
        })
      );

      expect(html).toContain('Schüler: Ben Muster');
      expect(html).not.toContain('Anna Beispiel');
      expect(html).toContain('Zurück zur Korrektur');
      expect(html).toContain('href="/correct/sub-2"');
      expect(html).toContain('Jetzt drucken (1 Schüler/innen)');
    });

    it('renders explicit not-found state, 0 student sheets, and disables print button when ?submissionId is missing/invalid', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams('submissionId=sub-invalid-999'));

      const html = renderToStaticMarkup(
        React.createElement(ExamPrintFeedbackPage, {
          initialData: {
            examTitle: 'Bruchrechnen 1',
            sheets: SAMPLE_SHEETS,
            totalCount: 2,
            completedCount: 2,
            ungradedCount: 0,
          },
        })
      );

      expect(html).toContain('data-testid="print-target-not-found"');
      expect(html).toContain('Gewünschter Feedback-Bericht nicht gefunden');
      expect(html).toContain('sub-invalid-999');
      expect(html).not.toContain('Anna Beispiel');
      expect(html).not.toContain('Ben Muster');
      expect(html).not.toContain('class="print-page"');
      expect(html).toContain('Jetzt drucken (0 Schüler/innen)');
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>.*Jetzt drucken \(0 Schüler\/innen\)/);
    });

    it('renders all completed sheets when no submissionId query parameter is present', () => {
      mockUseSearchParams.mockReturnValue(new URLSearchParams());

      const html = renderToStaticMarkup(
        React.createElement(ExamPrintFeedbackPage, {
          initialData: {
            examTitle: 'Bruchrechnen 1',
            sheets: SAMPLE_SHEETS,
            totalCount: 3,
            completedCount: 2,
            ungradedCount: 1,
          },
        })
      );

      expect(html).toContain('Schüler: Anna Beispiel');
      expect(html).toContain('Schüler: Ben Muster');
      expect(html).toContain('Jetzt drucken (2 Schüler/innen)');
      expect(html).toContain('1 of 3 not yet graded - not included');
    });
  });
});
