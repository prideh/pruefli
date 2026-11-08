import React from 'react';
import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import ErrorState from '@/components/ErrorState';
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

describe('Issue #119 UX Polish Regression Suite (5 verified UX items)', () => {
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

  describe('5. "Feedback drucken" on /correct/[id] Navigates to /exams/[id]/print Instead of Blank Tab', () => {
    it('builds dedicated print view href with submissionId filter and filters sheets accurately', () => {
      expect(buildFeedbackPrintHref('exam-123', 'sub-456')).toBe(
        '/exams/exam-123/print?submissionId=sub-456'
      );
      expect(buildFeedbackPrintHref('exam-123')).toBe('/exams/exam-123/print');
      expect(buildFeedbackPrintHref('')).toBeNull();

      const sheets = [
        { submissionId: 'sub-1', schuelerName: 'Anna' },
        { submissionId: 'sub-2', schuelerName: 'Ben' },
      ];
      expect(filterFeedbackSheetsForPrint(sheets, 'sub-2')).toEqual([
        { submissionId: 'sub-2', schuelerName: 'Ben' },
      ]);
      expect(filterFeedbackSheetsForPrint(sheets, null)).toHaveLength(2);
    });

    it('wires buildFeedbackPrintHref in /correct/[id] and filterFeedbackSheetsForPrint in /exams/[id]/print', () => {
      const correctPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/correct/[id]/page.tsx'),
        'utf-8'
      );
      expect(correctPage).toContain('buildFeedbackPrintHref(data.examId, String(id))');
      expect(correctPage).toContain('router.push(printHref)');

      const printPage = fs.readFileSync(
        path.resolve(__dirname, '../../app/exams/[id]/print/page.tsx'),
        'utf-8'
      );
      expect(printPage).toContain('filterFeedbackSheetsForPrint(sheets, targetSubmissionId)');
      expect(printPage).toContain('Zurück zur Korrektur');
    });
  });
});
