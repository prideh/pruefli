import fs from 'fs';
import path from 'path';
import { describe, it, expect } from 'vitest';
import {
  isValidMaxPointsInput,
  normalizeMaxPointsInput,
  parseMaxPointsInput,
  shouldClearWizardValidationError,
} from '@/lib/ux-polish';

describe('Issue #127: Maximum-Points Input (Empty Editing, No Sticky Leading Zero & Submit Validation)', () => {
  describe('1. normalizeMaxPointsInput — Empty Editing & Leading Zero Normalization', () => {
    it('keeps empty and whitespace input empty instead of forcing 0', () => {
      expect(normalizeMaxPointsInput('')).toBe('');
      expect(normalizeMaxPointsInput('   ')).toBe('');
      expect(normalizeMaxPointsInput(null)).toBe('');
      expect(normalizeMaxPointsInput(undefined)).toBe('');
    });

    it('strips sticky leading zeros before digits so display and numeric value stay consistent', () => {
      expect(normalizeMaxPointsInput('01')).toBe('1');
      expect(normalizeMaxPointsInput('017')).toBe('17');
      expect(normalizeMaxPointsInput('0020')).toBe('20');
      expect(normalizeMaxPointsInput('0017.5')).toBe('17.5');
      expect(normalizeMaxPointsInput('00')).toBe('0');
      expect(normalizeMaxPointsInput('000')).toBe('0');
      expect(normalizeMaxPointsInput('-017')).toBe('-17');
    });

    it('preserves valid decimal prefixes and half-point inputs during typing', () => {
      expect(normalizeMaxPointsInput('0')).toBe('0');
      expect(normalizeMaxPointsInput('0.')).toBe('0.');
      expect(normalizeMaxPointsInput('0.5')).toBe('0.5');
      expect(normalizeMaxPointsInput('00.5')).toBe('0.5');
      expect(normalizeMaxPointsInput('17.5')).toBe('17.5');
      expect(normalizeMaxPointsInput('12,5')).toBe('12.5');
      expect(normalizeMaxPointsInput(20)).toBe('20');
    });
  });

  describe('2. parseMaxPointsInput & isValidMaxPointsInput — Numeric Scoring Semantics & Submit Validation', () => {
    it('parses valid positive integer and decimal scores accurately', () => {
      expect(parseMaxPointsInput('20')).toBe(20);
      expect(parseMaxPointsInput('17')).toBe(17);
      expect(parseMaxPointsInput('017')).toBe(17);
      expect(parseMaxPointsInput('17.5')).toBe(17.5);
      expect(parseMaxPointsInput('12,5')).toBe(12.5);
      expect(parseMaxPointsInput('0.5')).toBe(0.5);
      expect(parseMaxPointsInput('0,5')).toBe(0.5);
      expect(parseMaxPointsInput(20)).toBe(20);
      expect(parseMaxPointsInput(0.5)).toBe(0.5);

      expect(isValidMaxPointsInput('20')).toBe(true);
      expect(isValidMaxPointsInput('17.5')).toBe(true);
      expect(isValidMaxPointsInput('0.5')).toBe(true);
    });

    it('rejects empty, zero, negative, and non-finite values on submit', () => {
      for (const invalid of [
        '',
        '   ',
        '0',
        '00',
        '0.0',
        '-1',
        '-17.5',
        'abc',
        null,
        undefined,
        0,
        -5,
        NaN,
        Infinity,
      ]) {
        expect(parseMaxPointsInput(invalid)).toBeNull();
        expect(isValidMaxPointsInput(invalid)).toBe(false);
      }
    });

    it('clears wizard validation error only when maxPoints becomes valid (> 0)', () => {
      const baseState = {
        hasClass: true,
        hasStudent: true,
        isNewExam: true,
        hasTitle: true,
        hasSubject: true,
        hasValidMaxPoints: isValidMaxPointsInput(''),
        hasFiles: true,
      };

      expect(
        shouldClearWizardValidationError(
          'Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.',
          baseState
        )
      ).toBe(false);

      expect(
        shouldClearWizardValidationError(
          'Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.',
          {
            ...baseState,
            hasValidMaxPoints: isValidMaxPointsInput('0'),
          }
        )
      ).toBe(false);

      expect(
        shouldClearWizardValidationError(
          'Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.',
          {
            ...baseState,
            hasValidMaxPoints: isValidMaxPointsInput('17'),
          }
        )
      ).toBe(true);
    });
  });

  describe('3. Component Wiring in app/dashboard/page.tsx and app/exams/page.tsx', () => {
    it('wires string state and normalizeMaxPointsInput in app/dashboard/page.tsx without per-keystroke 0 fallback', () => {
      const dashboardSource = fs.readFileSync(
        path.resolve(__dirname, '../../app/dashboard/page.tsx'),
        'utf-8'
      );

      expect(dashboardSource).toContain(
        "const [examMaxPoints, setExamMaxPoints] = useState<string>('20');"
      );
      expect(dashboardSource).toContain('normalizeMaxPointsInput(e.target.value)');
      expect(dashboardSource).toContain('parseMaxPointsInput(examMaxPoints)');
      expect(dashboardSource).toContain('isValidMaxPointsInput(examMaxPoints)');
      expect(dashboardSource).not.toContain('setExamMaxPoints(val > 0 ? val : 0)');
      expect(dashboardSource).not.toContain('ß');
    });

    it('wires string state and normalizeMaxPointsInput in app/exams/page.tsx for create and copy dialogs', () => {
      const examsSource = fs.readFileSync(
        path.resolve(__dirname, '../../app/exams/page.tsx'),
        'utf-8'
      );

      expect(examsSource).toContain(
        "const [examMaxPoints, setExamMaxPoints] = useState<string>('20');"
      );
      expect(examsSource).toContain(
        "const [copyMaxPoints, setCopyMaxPoints] = useState<string>('20');"
      );
      expect(examsSource).toContain('normalizeMaxPointsInput(e.target.value)');
      expect(examsSource).toContain('parseMaxPointsInput(examMaxPoints)');
      expect(examsSource).toContain('parseMaxPointsInput(copyMaxPoints)');
      expect(examsSource).not.toContain('setExamMaxPoints(Number(e.target.value))');
      expect(examsSource).not.toContain('setCopyMaxPoints(Number(e.target.value))');
      expect(examsSource).not.toContain('ß');
    });
  });
});
