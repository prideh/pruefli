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

  it('provides direct "Korrektur ersetzen" actions in Dashboard banner and history table and cleans up orphaned duplicates on overwrite (Issue #67)', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');

    const dashboardSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/dashboard/page.tsx'),
      'utf8'
    );
    const patchRouteSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/submissions/[id]/route.ts'),
      'utf8'
    );
    const correctRouteSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/correct/route.ts'),
      'utf8'
    );
    const replaceRouteSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/submissions/[id]/replace/route.ts'),
      'utf8'
    );

    // 1. Dashboard has direct 'Korrektur ersetzen' action in both the top Alert banner and history table row
    expect(dashboardSrc).toContain('duplicateAssignConflict');
    expect(dashboardSrc).toContain('isRowDuplicateConflict');
    expect(dashboardSrc).toContain(
      'handleManualAssign(duplicateAssignConflict.submissionId, true)'
    );
    expect(dashboardSrc).toContain('onAssign(sub.id, true)');
    expect(dashboardSrc).not.toContain('ß');

    // 2. PATCH /api/submissions/[id] supports overwrite: true and deletes existing + orphaned duplicate rows
    expect(patchRouteSrc).toContain('const shouldOverwrite = overwrite === true');
    expect(patchRouteSrc).toContain("Klicke auf 'Korrektur ersetzen', um sie zu überschreiben.");
    expect(patchRouteSrc).toContain('deletedDuplicateIds');
    expect(patchRouteSrc).not.toContain('ß');

    // 3. Background job (POST /api/correct) detects duplicates via candidateStudentId, extractedStudentName, or reused scan
    expect(correctRouteSrc).toContain(
      'const candidateStudentId = matchedStudentId || suggestedStudentId'
    );
    expect(correctRouteSrc).toContain('existingDuplicate');
    expect(correctRouteSrc).not.toContain('ß');

    // 4. Replace route resolves duplicate student and cleans up orphaned duplicate submissions
    expect(replaceRouteSrc).toContain('duplicatesToDelete');
    expect(replaceRouteSrc).not.toContain('ß');
  });
});
