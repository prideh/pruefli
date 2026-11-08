import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  parseSchoolSystemRosterInput,
  formatExamGradeExport,
  splitStudentFullName,
  SCHOOL_SYSTEM_EXPORT_OPTIONS,
} from '@/lib/school-systems';
import {
  embedExamMetadata,
  parseExamMetadata,
  buildExamSheetQrPayload,
  parseExamSheetQrPayload,
} from '@/lib/exam-meta';
import {
  resolveInitialTaskIndex,
  findNextUncertaintyTarget,
  buildSiblingNavigationHref,
} from '@/lib/speed-grading';

describe('High-Impact Feature 1: PUPIL (pupil.ch), LehrerOffice & Schulnetz Integration', () => {
  it('parses PUPIL (pupil.ch) CSV exports with Vorname and Nachname columns and skips headers', () => {
    const pupilCsv = [
      'PupilId;Vorname;Nachname;Klasse;Geschlecht',
      '1001;Anna;Meier;Sek 2a;w',
      '1002;Lukas;Keller;Sek 2a;m',
      '1003;Sophie;Müller;Sek 2a;w',
    ].join('\r\n');

    const result = parseSchoolSystemRosterInput(pupilCsv);
    expect(result.detectedFormat).toBe('PUPIL');
    expect(result.names).toEqual(['Anna Meier', 'Lukas Keller', 'Sophie Müller']);
  });

  it('parses PUPIL JSON exports and normalizes student names', () => {
    const pupilJson = JSON.stringify({
      pupils: [
        { pupilId: 'p-1', Rufname: 'Matteo', Familienname: 'Brunner' },
        { pupilId: 'p-2', Vorname: 'Elena', Nachname: 'Schmid' },
      ],
    });

    const result = parseSchoolSystemRosterInput(pupilJson);
    expect(result.detectedFormat).toBe('PUPIL');
    expect(result.names).toEqual(['Matteo Brunner', 'Elena Schmid']);
  });

  it('parses LehrerOffice CSV exports (S_Name;S_Vorname) into Vorname Nachname', () => {
    const lehrerOfficeCsv = [
      'S_Name;S_Vorname;Klasse;Geburtsdatum',
      'Baumann;Noah;1b;12.04.2011',
      'Frei;Mia;1b;03.09.2011',
    ].join('\n');

    const result = parseSchoolSystemRosterInput(lehrerOfficeCsv);
    expect(result.detectedFormat).toBe('LEHREROFFICE');
    expect(result.names).toEqual(['Noah Baumann', 'Mia Frei']);
  });

  it('parses Schulnetz / Evento CSV exports and "Nachname, Vorname" plain lists', () => {
    const schulnetzCsv = [
      'Nachname;Vorname;Klassenbezeichnung',
      'Widmer;Leon;G2c',
      'studer;Nina;G2c',
    ].join('\n');

    const result = parseSchoolSystemRosterInput(schulnetzCsv);
    expect(result.detectedFormat).toBe('SCHULNETZ');
    expect(result.names).toEqual(['Leon Widmer', 'Nina studer']);

    const plainCommaList = 'Hug, Jonas\nZiegler, Lara';
    const plainRes = parseSchoolSystemRosterInput(plainCommaList);
    expect(plainRes.detectedFormat).toBe('PLAIN_LIST');
    expect(plainRes.names).toEqual(['Jonas Hug', 'Lara Ziegler']);
  });

  it('splits full names and generates PUPIL, LehrerOffice, Schulnetz, and Standard CSV grade exports with UTF-8 BOM', () => {
    expect(splitStudentFullName('Anna Maria Meier')).toEqual({
      firstName: 'Anna Maria',
      lastName: 'Meier',
      normalizedFullName: 'Anna Maria Meier',
    });

    expect(SCHOOL_SYSTEM_EXPORT_OPTIONS.map((o) => o.value)).toEqual([
      'STANDARD_CSV',
      'PUPIL',
      'LEHREROFFICE',
      'SCHULNETZ',
    ]);

    const sampleRows = [
      {
        studentName: 'Anna Meier',
        status: 'COMPLETED',
        earnedPoints: 18.5,
        grade: '5.5',
        date: '08.11.2026',
        uncertainStepsCount: 0,
      },
      {
        studentName: 'Lukas Keller',
        status: 'DRAFT',
        earnedPoints: 12,
        grade: '4.0',
        date: '—',
        uncertainStepsCount: 2,
      },
    ];

    const pupilExport = formatExamGradeExport({
      format: 'PUPIL',
      examTitle: 'Bruchrechnen 1',
      subject: 'Mathematik',
      className: 'Sek 2a',
      maxPoints: 20,
      dateStr: '2026-11-08',
      rows: sampleRows,
    });
    expect(pupilExport.content.startsWith('\uFEFF')).toBe(true);
    expect(pupilExport.filename).toBe('PUPIL_Notenimport_Sek_2a_Bruchrechnen_1.csv');
    expect(pupilExport.content).toContain(
      'Klasse;Fach;Prüfung;Datum;Vorname;Nachname;Schüler/in;Punkte;Maximalpunkte;Note;Status'
    );
    expect(pupilExport.content).toContain(
      'Sek 2a;Mathematik;Bruchrechnen 1;08.11.2026;Anna;Meier;Anna Meier;18.5;20;5.5;Abgeschlossen'
    );

    const loExport = formatExamGradeExport({
      format: 'LEHREROFFICE',
      examTitle: 'Bruchrechnen 1',
      subject: 'Mathematik',
      className: 'Sek 2a',
      maxPoints: 20,
      dateStr: '2026-11-08',
      rows: sampleRows,
    });
    expect(loExport.filename).toBe('LehrerOffice_Sek_2a_Bruchrechnen_1.csv');
    expect(loExport.content).toContain(
      'S_Name;S_Vorname;Klasse;Fach;Prüfung;Datum;Punkte;MaxPunkte;Note;Bemerkung'
    );
    expect(loExport.content).toContain('2 KI-unsichere Schritte geprüft');

    const snExport = formatExamGradeExport({
      format: 'SCHULNETZ',
      examTitle: 'Bruchrechnen 1',
      subject: 'Mathematik',
      className: 'Sek 2a',
      maxPoints: 20,
      rows: sampleRows,
    });
    expect(snExport.filename).toBe('Schulnetz_Sek_2a_Bruchrechnen_1.csv');
    expect(snExport.content).toContain(
      'Nachname;Vorname;Klassenbezeichnung;Fach;Prüfungstitel;Note;Punkte;Maximalpunkte;Status'
    );
  });
});

describe('High-Impact Feature 2: Optional QR-Coded Smart Exam Sheets (Default OFF)', () => {
  it('builds and parses deterministic PRUEFLI_EXAM_SHEET QR payloads', () => {
    const raw = buildExamSheetQrPayload({
      examId: 'exam-ch-42',
      title: 'Satz des Pythagoras',
      className: 'Sek 3b',
      subject: 'Mathematik',
    });

    const parsed = parseExamSheetQrPayload(raw);
    expect(parsed).toEqual({
      type: 'PRUEFLI_EXAM_SHEET',
      v: 1,
      examId: 'exam-ch-42',
      title: 'Satz des Pythagoras',
      className: 'Sek 3b',
      subject: 'Mathematik',
    });

    expect(parseExamSheetQrPayload('invalid-json')).toBeNull();
    expect(parseExamSheetQrPayload(JSON.stringify({ type: 'OTHER', examId: '123' }))).toBeNull();
  });

  it('persists enableQrSheet in ExamMetadata generatorParams and defaults to off in UI and API', () => {
    const embeddedOff = embedExamMetadata('Hinweise', {
      isGenerated: true,
      isApproved: false,
      approvedAt: null,
      generatorParams: {
        topic: 'Pythagoras',
        enableQrSheet: false,
      },
    });
    const parsedOff = parseExamMetadata(embeddedOff);
    expect(parsedOff.metadata.generatorParams?.enableQrSheet).toBe(false);

    const embeddedOn = embedExamMetadata('Hinweise', {
      isGenerated: true,
      isApproved: true,
      approvedAt: '2026-11-08T12:00:00.000Z',
      generatorParams: {
        topic: 'Pythagoras',
        enableQrSheet: true,
      },
    });
    const parsedOn = parseExamMetadata(embeddedOn);
    expect(parsedOn.metadata.generatorParams?.enableQrSheet).toBe(true);

    const examsPageSrc = fs.readFileSync(path.join(process.cwd(), 'app/exams/page.tsx'), 'utf-8');
    expect(examsPageSrc).toContain('useState<boolean>(false)');
    expect(examsPageSrc).toContain('QR-Code auf Aufgabenblatt einbetten (optional)');
    expect(examsPageSrc).toContain('Standardmässig deaktiviert');

    const generateRouteSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/api/exams/generate/route.ts'),
      'utf-8'
    );
    expect(generateRouteSrc).toContain('enableQrSheet = false');
    expect(generateRouteSrc).toContain('enableQrSheet: Boolean(enableQrSheet)');

    const printSheetSrc = fs.readFileSync(
      path.join(process.cwd(), 'app/exams/[id]/print-task-sheet/page.tsx'),
      'utf-8'
    );
    expect(printSheetSrc).toContain('Boolean(data.exam?.generatorParams?.enableQrSheet)');
    expect(printSheetSrc).toContain('data-testid="smart-exam-qr-badge"');
  });
});

describe('High-Impact Feature 3: Horizontal Task-by-Task Speed-Grading & Express Uncertainty Queue', () => {
  const sampleTasks = [
    { aufgabeId: '1', schritte: [{ istUnsicher: false }] },
    { aufgabeId: '2a', schritte: [{ istUnsicher: true }] },
    { aufgabeId: '3', schritte: [{ istUnsicher: false }, { istUnsicher: true }] },
  ];

  it('resolves initial task index from queryTaskParam, pinnedTaskId, or uncertain mode', () => {
    expect(
      resolveInitialTaskIndex({
        tasks: sampleTasks,
        queryTaskParam: '3',
      })
    ).toBe(2);

    expect(
      resolveInitialTaskIndex({
        tasks: sampleTasks,
        pinnedTaskId: '2a',
      })
    ).toBe(1);

    expect(
      resolveInitialTaskIndex({
        tasks: sampleTasks,
        isUncertainMode: true,
      })
    ).toBe(1);

    expect(
      resolveInitialTaskIndex({
        tasks: sampleTasks,
      })
    ).toBe(0);
  });

  it('finds next uncertainty target in current submission first, then across sibling submissions', () => {
    const siblings = [
      { id: 'sub-1', studentName: 'Anna Meier', uncertainStepsCount: 2 },
      { id: 'sub-2', studentName: 'Lukas Keller', uncertainStepsCount: 0 },
      { id: 'sub-3', studentName: 'Sophie Müller', uncertainStepsCount: 1 },
    ];

    // From task index 1 ('2a'), task index 2 ('3') in the same submission also has istUnsicher: true
    const sameSubTarget = findNextUncertaintyTarget({
      currentSubmissionId: 'sub-1',
      activeTaskIndex: 1,
      tasks: sampleTasks,
      siblingSubmissions: siblings,
    });
    expect(sameSubTarget).toEqual({ type: 'SAME_SUBMISSION_TASK', taskIndex: 2 });

    // From task index 2 ('3'), no further task in sub-1 -> jumps to sub-3 (since sub-2 has 0 uncertain)
    const nextSibTarget = findNextUncertaintyTarget({
      currentSubmissionId: 'sub-1',
      activeTaskIndex: 2,
      tasks: sampleTasks,
      siblingSubmissions: siblings,
    });
    expect(nextSibTarget).toEqual({
      type: 'SIBLING_SUBMISSION',
      submissionId: 'sub-3',
      studentName: 'Sophie Müller',
    });
  });

  it('builds sibling navigation href preserving pinned task and uncertain mode', () => {
    expect(
      buildSiblingNavigationHref({
        targetSubmissionId: 'sub-3',
        isTaskPinned: true,
        activeTaskId: '2a',
        activeTaskIndex: 1,
        isUncertainMode: false,
      })
    ).toBe('/correct/sub-3?task=2a');

    expect(
      buildSiblingNavigationHref({
        targetSubmissionId: 'sub-3',
        isTaskPinned: true,
        activeTaskId: '2a',
        activeTaskIndex: 1,
        isUncertainMode: true,
      })
    ).toBe('/correct/sub-3?task=2a&mode=uncertain');

    expect(
      buildSiblingNavigationHref({
        targetSubmissionId: 'sub-2',
        isTaskPinned: false,
        activeTaskId: '1',
        activeTaskIndex: 0,
        isUncertainMode: false,
      })
    ).toBe('/correct/sub-2');
  });
});
