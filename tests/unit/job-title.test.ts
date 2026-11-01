import { describe, it, expect } from 'vitest';
import { getDashboardJobTitle, isDuplicateSubmissionError } from '@/lib/job-title';

describe('Dashboard Job Card Title Logic (lib/job-title.ts)', () => {
  it('formats failed unassigned jobs without "läuft" text', () => {
    const title = getDashboardJobTitle({
      studentName: 'Nicht zugeordnet',
      examTitle: 'Demo-Prüfung: Teil 1',
      className: 'Demoklasse 3a',
      status: 'FAILED',
    });

    expect(title).toBe('Korrektur fehlgeschlagen (Demo-Prüfung) (Demoklasse 3a)');
    expect(title).not.toContain('läuft');
  });

  it('keeps "🤖 Auto-Match läuft..." for processing unassigned jobs', () => {
    const title = getDashboardJobTitle({
      studentName: 'Nicht zugeordnet',
      examTitle: 'Demo-Prüfung: Teil 1',
      className: 'Demoklasse 3a',
      status: 'PROCESSING',
    });

    expect(title).toBe('🤖 Auto-Match läuft... (Demo-Prüfung) (Demoklasse 3a)');
    expect(title).toContain('Auto-Match läuft...');
  });

  it('keeps "🤖 Auto-Match läuft..." for pending unassigned jobs', () => {
    const title = getDashboardJobTitle({
      studentName: 'Nicht zugeordnet',
      examTitle: 'Demo-Prüfung',
      className: 'Demoklasse 3a',
      status: 'PENDING',
    });

    expect(title).toBe('🤖 Auto-Match läuft... (Demo-Prüfung) (Demoklasse 3a)');
    expect(title).toContain('Auto-Match läuft...');
  });

  it('leaves completed unassigned jobs unchanged in standard format', () => {
    const title = getDashboardJobTitle({
      studentName: 'Nicht zugeordnet',
      examTitle: 'Demo-Prüfung: Teil 1',
      className: 'Demoklasse 3a',
      status: 'COMPLETED',
    });

    expect(title).toBe('Nicht zugeordnet — Demo-Prüfung: Teil 1 (Demoklasse 3a)');
    expect(title).not.toContain('läuft');
  });

  it('leaves assigned jobs unchanged regardless of status', () => {
    const baseJob = {
      studentName: 'Lukas Müller',
      examTitle: 'Mathematik Prüfung 1',
      className: 'Klasse 3a',
    };

    expect(getDashboardJobTitle({ ...baseJob, status: 'FAILED' })).toBe(
      'Lukas Müller — Mathematik Prüfung 1 (Klasse 3a)'
    );
    expect(getDashboardJobTitle({ ...baseJob, status: 'PROCESSING' })).toBe(
      'Lukas Müller — Mathematik Prüfung 1 (Klasse 3a)'
    );
    expect(getDashboardJobTitle({ ...baseJob, status: 'PENDING' })).toBe(
      'Lukas Müller — Mathematik Prüfung 1 (Klasse 3a)'
    );
    expect(getDashboardJobTitle({ ...baseJob, status: 'COMPLETED' })).toBe(
      'Lukas Müller — Mathematik Prüfung 1 (Klasse 3a)'
    );
  });

  it('extracts student name from duplicate error message if studentName is still "Nicht zugeordnet"', () => {
    const title = getDashboardJobTitle({
      studentName: 'Nicht zugeordnet',
      examTitle: 'Mathematik Prüfung 1: Gleichungen',
      className: 'Klasse 3a',
      status: 'FAILED',
      errorMessage:
        'Für Schüler/in "Anna Beispiel" existiert bereits eine Korrektur. Klicke auf \'Korrektur ersetzen\', um sie zu überschreiben.',
    });

    expect(title).toBe('Anna Beispiel — Mathematik Prüfung 1: Gleichungen (Klasse 3a)');
    expect(
      isDuplicateSubmissionError(
        'Für Schüler/in "Anna Beispiel" existiert bereits eine Korrektur. Klicke auf \'Korrektur ersetzen\', um sie zu überschreiben.'
      )
    ).toBe(true);
  });

  it('shows "Duplikat erkannt" title for duplicate error without quoted student name when unassigned', () => {
    const title = getDashboardJobTitle({
      studentName: 'Nicht zugeordnet',
      examTitle: 'Demo-Prüfung: Teil 1',
      className: 'Demoklasse 3a',
      status: 'FAILED',
      errorMessage:
        "Für diese/n Schüler/in existiert bereits eine Korrektur. Klicke auf 'Korrektur ersetzen', um sie zu überschreiben.",
    });

    expect(title).toBe('Duplikat erkannt (Demo-Prüfung) (Demoklasse 3a)');
  });
});
