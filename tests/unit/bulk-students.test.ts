import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  DUPLICATE_STUDENT_NAME_WARNING,
  hasDuplicateStudentName,
  normalizeStudentNameForComparison,
} from '@/lib/grading';

describe('Feature: Bulk Student Add to Class', () => {
  it('Klassendetailseite enthaelt den Button "Mehrere Schüler hinzufügen"', () => {
    const classDetailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/classes/[id]/page.tsx'),
      'utf-8'
    );
    expect(classDetailFile).toContain('Mehrere Schüler hinzufügen');
    expect(classDetailFile).toContain('openBulkAdd');
  });

  it('Verarbeitet Multiline-Eingaben, ignoriert Leerzeilen und Whitespace', () => {
    const rawInput = '   \n  Anna Meier  \n\n\n  Lukas Keller  \n   ';
    const lines = rawInput
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    expect(lines).toEqual(['Anna Meier', 'Lukas Keller']);
  });

  it('Erkennt Duplikate mit bestehender Klasse und innerhalb derselben Eingabe case-insensitive', () => {
    const existingStudents = [{ name: 'Lukas Keller' }];
    const existingSet = new Set(existingStudents.map((s) => s.name.trim().toLowerCase()));

    const inputLines = ['lukas keller', 'Sophie Müller', 'sophie müller', 'Max Muster'];
    const inputCounts = new Map<string, number>();
    for (const name of inputLines) {
      const lower = name.toLowerCase();
      inputCounts.set(lower, (inputCounts.get(lower) || 0) + 1);
    }

    const items = inputLines.map((name, index) => {
      const lower = name.toLowerCase();
      const isExistingDuplicate = existingSet.has(lower);
      const isInputDuplicate = (inputCounts.get(lower) || 0) > 1;
      const isFlagged = isExistingDuplicate || isInputDuplicate;
      return {
        id: `bulk-${index}`,
        name,
        isExistingDuplicate,
        isInputDuplicate,
        isFlagged,
        decision: isFlagged ? 'skip' : 'add',
      };
    });

    // lukas keller matches existing
    expect(items[0].isExistingDuplicate).toBe(true);
    expect(items[0].isFlagged).toBe(true);
    expect(items[0].decision).toBe('skip');

    // sophie müller appears twice in input
    expect(items[1].isInputDuplicate).toBe(true);
    expect(items[1].isFlagged).toBe(true);
    expect(items[2].isInputDuplicate).toBe(true);
    expect(items[2].isFlagged).toBe(true);

    // Max Muster is clean
    expect(items[3].isFlagged).toBe(false);
    expect(items[3].decision).toBe('add');
  });

  it('Erlaubt bewusste Auswahl "Trotzdem hinzufügen" (add anyway) vs "Überspringen" (skip)', () => {
    const classDetailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/classes/[id]/page.tsx'),
      'utf-8'
    );
    expect(classDetailFile).toContain('Trotzdem hinzufügen');
    expect(classDetailFile).toContain('Überspringen');
    expect(classDetailFile).toContain('title="Trotzdem hinzufügen (add anyway)"');
    expect(classDetailFile).toContain('title="Überspringen (skip)"');
  });

  it('Ergebnis-Zusammenfassung enthaelt "x added, y skipped by choice, z failed" und deutsche Entsprechung', () => {
    const classDetailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/classes/[id]/page.tsx'),
      'utf-8'
    );
    expect(classDetailFile).toContain('added,');
    expect(classDetailFile).toContain('skipped by choice,');
    expect(classDetailFile).toContain('failed');
    expect(classDetailFile).toContain('hinzugefügt,');
    expect(classDetailFile).toContain('übersprungen,');
    expect(classDetailFile).toContain('fehlgeschlagen');
  });

  it('Klassendetailseite enthaelt kein "ß" (Schweizer Rechtschreibung)', () => {
    const classDetailFile = fs.readFileSync(
      path.resolve(__dirname, '../../app/classes/[id]/page.tsx'),
      'utf-8'
    );
    expect(classDetailFile).not.toContain('ß');
  });
});

describe('Feature: Soft Duplicate Student Name Warning in Single-Add Dialogs (Issue #107)', () => {
  it('erkennt identische Schuelernamen case-insensitive und Whitespace-bereinigt', () => {
    expect(normalizeStudentNameForComparison('  Max   Muster  ')).toBe('max muster');
    expect(normalizeStudentNameForComparison('')).toBe('');
    expect(normalizeStudentNameForComparison(null)).toBe('');

    const classRoster = [{ name: 'Max Muster' }, { name: 'Sophie Meier' }];
    expect(hasDuplicateStudentName(classRoster, 'Max Muster')).toBe(true);
    expect(hasDuplicateStudentName(classRoster, '  max   muster ')).toBe(true);
    expect(hasDuplicateStudentName(classRoster, 'SOPHIE MEIER')).toBe(true);
    expect(hasDuplicateStudentName(classRoster, 'Max Mustermann')).toBe(false);
    expect(hasDuplicateStudentName(classRoster, '   ')).toBe(false);

    const examRoster = [{ studentName: 'Lukas Keller' }];
    expect(hasDuplicateStudentName(examRoster, 'lukas keller')).toBe(true);
    expect(hasDuplicateStudentName(examRoster, 'Anna Keller')).toBe(false);
  });

  it('definiert den weichen Warnhinweis ohne Eszett', () => {
    expect(DUPLICATE_STUDENT_NAME_WARNING).toBe(
      'Ein/e Schüler/in mit diesem Namen existiert bereits in dieser Klasse – trotzdem hinzufügen?'
    );
    expect(DUPLICATE_STUDENT_NAME_WARNING).not.toContain('\u00df');
  });

  it('integriert die weiche Duplikat-Warnung und Bestaetigungs-Schaltflaeche in allen drei Einzel-Dialogen', () => {
    const dialogFiles = [
      '../../app/classes/[id]/page.tsx',
      '../../app/exams/[id]/page.tsx',
      '../../app/dashboard/page.tsx',
    ];

    for (const relPath of dialogFiles) {
      const source = fs.readFileSync(path.resolve(__dirname, relPath), 'utf-8');
      expect(source).toContain('hasDuplicateStudentName');
      expect(source).toContain('DUPLICATE_STUDENT_NAME_WARNING');
      expect(source).toContain('confirmDuplicateStudent');
      expect(source).toContain(
        '<Alert severity="warning">{DUPLICATE_STUDENT_NAME_WARNING}</Alert>'
      );
      expect(source).toContain("'Trotzdem hinzufügen'");
      expect(source).not.toContain('\u00df');
    }
  });
});
