import { describe, it, expect } from 'vitest';
import {
  calculateRawSwissGrade,
  calculateSwissGrade,
  matchStudentByNameWithConfidence,
  parseStudentExamUrls,
  resolveEffectiveGradingMaxPoints,
  isAssignedCompletedSubmission,
  computeAssignedGradeAverage,
  SUBJECT_PROFILES,
  getSubjectSupportInfo,
  normalizeSubjectValue,
  resolveTeacherSubjects,
  resolveFilterAndViewSubjects,
  resolveClassSubjectOptions,
  resolveDefaultExamSubjectForClass,
  computeClassSubjectBreakdown,
} from '@/lib/grading';
import {
  getTeacherSavedSubjects,
  saveTeacherSubjects,
  getClassSavedSubjects,
  getMultipleClassesSavedSubjects,
  saveClassSubjects,
  deleteClassSubjects,
  resetTeacherSubjectsMemoryState,
} from '@/lib/teacher-subjects';
import { getSubjectFocusInstruction } from '@/lib/gemini';

describe('Swiss Grading Formulas & Rounding (lib/grading.ts)', () => {
  it('calculates LINEAR_60 grades accurately (Note 4.0 at 60%)', () => {
    expect(calculateSwissGrade(0, 20, 'LINEAR_60', '0.1')).toBe('1.0');
    expect(calculateSwissGrade(12, 20, 'LINEAR_60', '0.1')).toBe('4.0');
    expect(calculateSwissGrade(20, 20, 'LINEAR_60', '0.1')).toBe('6.0');
    expect(calculateSwissGrade(15, 20, 'LINEAR_60', '0.1')).toBe('4.8');
  });

  it('calculates KNICK_50 grades accurately (Note 4.0 at 50%)', () => {
    expect(calculateSwissGrade(10, 20, 'KNICK_50', '0.1')).toBe('4.0');
    expect(calculateSwissGrade(5, 20, 'KNICK_50', '0.1')).toBe('2.5');
    expect(calculateSwissGrade(15, 20, 'KNICK_50', '0.1')).toBe('5.0');
  });

  it('calculates KNICK_66 grades accurately (Note 4.0 at 66.7%)', () => {
    expect(calculateSwissGrade(20, 30, 'KNICK_66', '0.1')).toBe('4.0');
    expect(calculateSwissGrade(30, 30, 'KNICK_66', '0.1')).toBe('6.0');
  });

  it('supports 0.1, 0.25, and 0.5 Swiss grade rounding steps', () => {
    // 13.2 / 20 -> raw = 1 + 5 * 0.66 = 4.30
    expect(calculateRawSwissGrade(13.2, 20, 'LINEAR_60')).toBeCloseTo(4.3, 4);
    expect(calculateSwissGrade(13.2, 20, 'LINEAR_60', '0.1')).toBe('4.3');
    expect(calculateSwissGrade(13.2, 20, 'LINEAR_60', '0.25')).toBe('4.25');
    expect(calculateSwissGrade(13.2, 20, 'LINEAR_60', '0.5')).toBe('4.5');
  });

  it('clamps out-of-range or zero-maxPoints inputs safely between 1.0 and 6.0', () => {
    expect(calculateSwissGrade(10, 0)).toBe('1.0');
    expect(calculateSwissGrade(-5, 20)).toBe('1.0');
    expect(calculateSwissGrade(25, 20)).toBe('6.0');
  });

  it('matches students with calibrated HIGH, LOW, and NONE confidence', () => {
    const roster = [
      { id: 'st-1', name: 'Lukas Müller' },
      { id: 'st-2', name: 'Anna Meier' },
      { id: 'st-3', name: 'Sophie Keller' },
    ];

    // Exact match -> HIGH confidence
    expect(matchStudentByNameWithConfidence('Lukas Müller', roster, false)).toEqual({
      matchedStudentId: 'st-1',
      suggestedStudentId: 'st-1',
      confidence: 'HIGH',
    });

    // Token-reversed exact match ("Müller Lukas") -> HIGH confidence
    expect(matchStudentByNameWithConfidence('Mueller, Lukas', roster, false).confidence).toBe(
      'LOW'
    );
    expect(matchStudentByNameWithConfidence('Müller Lukas', roster, false)).toEqual({
      matchedStudentId: 'st-1',
      suggestedStudentId: 'st-1',
      confidence: 'HIGH',
    });

    // Exact match but AI flagged handwriting as uncertain -> downgraded to LOW
    expect(matchStudentByNameWithConfidence('Anna Meier', roster, true)).toEqual({
      matchedStudentId: null,
      suggestedStudentId: 'st-2',
      confidence: 'LOW',
    });

    // First-name-only match -> LOW confidence (suggested, requires teacher confirmation)
    expect(matchStudentByNameWithConfidence('Sophie', roster, false)).toEqual({
      matchedStudentId: null,
      suggestedStudentId: 'st-3',
      confidence: 'LOW',
    });

    // Unknown or illegible -> NONE
    expect(matchStudentByNameWithConfidence('Nicht lesbar', roster, false)).toEqual({
      matchedStudentId: null,
      suggestedStudentId: null,
      confidence: 'NONE',
    });
  });

  it('parses single and multi-page studentExamUrl strings', () => {
    expect(parseStudentExamUrls(null)).toEqual([]);
    expect(parseStudentExamUrls('/uploads/exams/page1.jpg')).toEqual(['/uploads/exams/page1.jpg']);
    expect(parseStudentExamUrls('["/uploads/exams/p1.jpg","/uploads/exams/p2.jpg"]')).toEqual([
      '/uploads/exams/p1.jpg',
      '/uploads/exams/p2.jpg',
    ]);
  });

  it('provides all 8 Swiss subject profiles without Eszett and with qualified support levels', () => {
    expect(SUBJECT_PROFILES.length).toBeGreaterThanOrEqual(8);
    for (const sp of SUBJECT_PROFILES) {
      expect(sp.label).not.toContain('ß');
      expect(sp.profileFocus).not.toContain('ß');
      expect(sp.supportBadge).not.toContain('ß');
      expect(sp.supportDescription).not.toContain('ß');
      expect(['VERIFIED_MODALITY', 'FOCUS_PROFILE']).toContain(sp.supportLevel);
    }

    const mathProfile = SUBJECT_PROFILES.find((p) => p.value === 'Mathematik');
    expect(mathProfile?.supportLevel).toBe('VERIFIED_MODALITY');
    expect(mathProfile?.supportBadge).toBe('Verifizierte Modalität');

    const physicsProfile = SUBJECT_PROFILES.find((p) => p.value === 'Physik');
    expect(physicsProfile?.supportLevel).toBe('FOCUS_PROFILE');
    expect(physicsProfile?.supportBadge).toBe('Fokus-Profil');
  });

  it('resolves qualified subject support info via getSubjectSupportInfo', () => {
    // Exact or substring match for verified modality
    const math = getSubjectSupportInfo('Mathematik');
    expect(math.supportLevel).toBe('VERIFIED_MODALITY');
    expect(math.supportBadge).toBe('Verifizierte Modalität');
    expect(math.matchedProfile?.value).toBe('Mathematik');

    const matheShort = getSubjectSupportInfo('Mathe');
    expect(matheShort.supportLevel).toBe('VERIFIED_MODALITY');

    // Focus profile
    const chem = getSubjectSupportInfo('Chemie');
    expect(chem.supportLevel).toBe('FOCUS_PROFILE');
    expect(chem.supportBadge).toBe('Fokus-Profil');

    const ict = getSubjectSupportInfo('Informatik / ICT');
    expect(ict.supportLevel).toBe('FOCUS_PROFILE');

    // Unknown or fallback subject
    const history = getSubjectSupportInfo('Geschichte');
    expect(history.supportLevel).toBe('GENERIC_FALLBACK');
    expect(history.supportBadge).toBe('Basis-Korrektur');
    expect(history.matchedProfile).toBeNull();
    expect(history.supportDescription).not.toContain('ß');

    const empty = getSubjectSupportInfo('');
    expect(empty.supportLevel).toBe('GENERIC_FALLBACK');
  });

  it('provides qualified getSubjectFocusInstruction with explicit general fallback', () => {
    // Math keywords get math instruction
    const mathInst = getSubjectFocusInstruction('Mathematik');
    expect(mathInst).toContain('FACHFOKUS MATHEMATIK:');
    expect(mathInst).not.toContain('ß');

    const algebraInst = getSubjectFocusInstruction('Algebra');
    expect(algebraInst).toContain('FACHFOKUS MATHEMATIK:');

    // Specific subjects get their focus instruction
    expect(getSubjectFocusInstruction('Physik')).toContain('FACHFOKUS PHYSIK:');
    expect(getSubjectFocusInstruction('Biologie')).toContain('FACHFOKUS BIOLOGIE:');
    expect(getSubjectFocusInstruction('Informatik')).toContain('FACHFOKUS INFORMATIK');

    // Unknown subjects get FACHFOKUS ALLGEMEIN (never silent math fallback!)
    const historyInst = getSubjectFocusInstruction('Geschichte');
    expect(historyInst).toContain('FACHFOKUS ALLGEMEIN:');
    expect(historyInst).not.toContain('FACHFOKUS MATHEMATIK');
    expect(historyInst).not.toContain('ß');

    const emptyInst = getSubjectFocusInstruction('');
    expect(emptyInst).toContain('FACHFOKUS ALLGEMEIN:');
    expect(emptyInst).not.toContain('FACHFOKUS MATHEMATIK');

    const undefInst = getSubjectFocusInstruction(undefined);
    expect(undefInst).toContain('FACHFOKUS ALLGEMEIN:');
    expect(undefInst).not.toContain('FACHFOKUS MATHEMATIK');
  });

  it('safely handles exam maxPoints fallbacks and positive validation', () => {
    // 0 or negative maxPoints clamped in grade calculation
    expect(calculateSwissGrade(10, 0)).toBe('1.0');
    expect(calculateSwissGrade(10, -5)).toBe('1.0');

    // Default maxPoints fallback value (20) used in dialog and API
    const fallbackMaxPoints = (raw: number | null | undefined) =>
      Number.isFinite(raw) && Number(raw) > 0 ? Number(raw) : 20;

    expect(fallbackMaxPoints(undefined)).toBe(20);
    expect(fallbackMaxPoints(null)).toBe(20);
    expect(fallbackMaxPoints(0)).toBe(20);
    expect(fallbackMaxPoints(-10)).toBe(20);
    expect(fallbackMaxPoints(30)).toBe(30);
    expect(fallbackMaxPoints(25.5)).toBe(25.5);
  });

  describe('Single Source of Truth Grading MaxPoints (resolveEffectiveGradingMaxPoints)', () => {
    it('nutzt das vom Lehrer vorgegebene Maximum verbindlich und ueberschreibt es nicht', () => {
      // Repro aus Issue #64: Lehrer vergibt 20 P., Modell liefert Aufgaben-Summe 6 P.
      const res = resolveEffectiveGradingMaxPoints({
        teacherMaxPoints: 20,
        resolvedMaxPoints: 6,
        hasPredefinedTasks: false,
      });

      expect(res.effectiveMaxPoints).toBe(20);
      expect(res.shouldUpdateExamMaxPoints).toBe(false);
      expect(res.isMaxPointsMismatch).toBe(true);

      // Note fuer 5.0 erreichte Punkte muss rechnerisch zum 20er Maximum passen: 1 + 5 * (5/20) = 2.25 ≈ 2.3
      const grade = calculateSwissGrade(5.0, res.effectiveMaxPoints, 'LINEAR_60', '0.1');
      expect(grade).toBe('2.3');
    });

    it('liefert fuer Korrektur-Dialog und QR-Upload bei identischen Eingaben identische Noten', () => {
      const input = {
        teacherMaxPoints: 20,
        resolvedMaxPoints: 6,
        hasPredefinedTasks: false,
      };

      const correctRouteResult = resolveEffectiveGradingMaxPoints(input);
      const qrRouteResult = resolveEffectiveGradingMaxPoints(input);

      expect(correctRouteResult.effectiveMaxPoints).toBe(qrRouteResult.effectiveMaxPoints);
      expect(correctRouteResult.shouldUpdateExamMaxPoints).toBe(
        qrRouteResult.shouldUpdateExamMaxPoints
      );

      const gradeCorrect = calculateSwissGrade(
        5.0,
        correctRouteResult.effectiveMaxPoints,
        'LINEAR_60',
        '0.1'
      );
      const gradeQr = calculateSwissGrade(
        5.0,
        qrRouteResult.effectiveMaxPoints,
        'LINEAR_60',
        '0.1'
      );

      expect(gradeCorrect).toBe('2.3');
      expect(gradeQr).toBe('2.3');
    });

    it('faellt bei fehlendem Lehrer-Maximum (0) auf die Aufgaben-Summe zurueck und initialisiert das Exam', () => {
      const res = resolveEffectiveGradingMaxPoints({
        teacherMaxPoints: 0,
        resolvedMaxPoints: 12,
        hasPredefinedTasks: false,
      });

      expect(res.effectiveMaxPoints).toBe(12);
      expect(res.shouldUpdateExamMaxPoints).toBe(true);
      expect(res.isMaxPointsMismatch).toBe(false);

      const grade = calculateSwissGrade(6.0, res.effectiveMaxPoints, 'LINEAR_60', '0.1');
      // 1 + 5 * (6/12) = 3.5
      expect(grade).toBe('3.5');
    });

    it('erkennt Uebereinstimmung ohne Mismatch wenn Aufgaben-Summe dem Lehrer-Maximum entspricht', () => {
      const res = resolveEffectiveGradingMaxPoints({
        teacherMaxPoints: 20,
        resolvedMaxPoints: 20,
        hasPredefinedTasks: true,
      });

      expect(res.effectiveMaxPoints).toBe(20);
      expect(res.shouldUpdateExamMaxPoints).toBe(false);
      expect(res.isMaxPointsMismatch).toBe(false);
    });
  });

  describe('Unified Grade Average Across Views (Issue #75: computeAssignedGradeAverage)', () => {
    it('schliesst nicht zugeordnete ("Zuordnung ausstehend", studentId == null) und unfertige Arbeiten vom Notenschnitt aus', () => {
      // Repro aus Issue #75:
      // 3 zugeordnete Schuelerarbeiten mit Schnitt 5.42 (5.25 + 5.50 + 5.50 = 16.25 / 3 = 5.4166... -> 5.42)
      // plus 2 nicht zugeordnete Arbeiten (studentId: null, "Nicht zugeordnet"), die den Schnitt sonst auf ~3.99 / 4.01 druecken wuerden
      const submissions = [
        {
          status: 'COMPLETED',
          studentId: 'student-1',
          assignedStudentId: 'student-1',
          studentName: 'Lukas Mueller',
          isStudentMatchUncertain: false,
          gradeRaw: 5.25,
          grade: '5.3',
        },
        {
          status: 'COMPLETED',
          studentId: 'student-2',
          assignedStudentId: 'student-2',
          studentName: 'Anna Meier',
          isStudentMatchUncertain: false,
          gradeRaw: 5.5,
          grade: '5.5',
        },
        {
          status: 'COMPLETED',
          studentId: 'student-3',
          assignedStudentId: 'student-3',
          studentName: 'Sophie Keller',
          isStudentMatchUncertain: false,
          gradeRaw: 5.5,
          grade: '5.5',
        },
        // Nicht zugeordnete Arbeiten ("Zuordnung ausstehend") aus Duplikat-/Auto-Match-Flow:
        {
          status: 'COMPLETED',
          studentId: null,
          assignedStudentId: null,
          studentName: 'Nicht zugeordnet',
          isStudentMatchUncertain: true,
          gradeRaw: 1.85,
          grade: '1.9',
        },
        {
          status: 'COMPLETED',
          studentId: null,
          assignedStudentId: null,
          studentName: 'Nicht zugeordnet',
          isStudentMatchUncertain: true,
          gradeRaw: 1.85,
          grade: '1.9',
        },
        // Fehlgeschlagene oder laufende Jobs:
        {
          status: 'FAILED',
          studentId: 'student-1',
          assignedStudentId: null,
          studentName: 'Lukas Mueller',
          isStudentMatchUncertain: false,
          gradeRaw: 1.0,
          grade: '—',
        },
      ];

      expect(isAssignedCompletedSubmission(submissions[0])).toBe(true);
      expect(isAssignedCompletedSubmission(submissions[3])).toBe(false);
      expect(isAssignedCompletedSubmission(submissions[5])).toBe(false);

      const result = computeAssignedGradeAverage(submissions);
      expect(result.count).toBe(3);
      expect(result.sum).toBeCloseTo(16.25, 4);
      expect(result.averageGrade).toBe('5.42');
    });

    it('berechnet ueber mehrere Pruefungen eines Fachs denselben gewichteten Schnitt wie Klassendetail und Uebersicht', () => {
      // Pruefung 1: 2 zugeordnete Abgaben (5.25, 5.50 -> sum = 10.75, avg = 5.38)
      // Pruefung 2: 1 zugeordnete Abgabe (5.50 -> sum = 5.50, avg = 5.50)
      const exam1Avg = computeAssignedGradeAverage([
        { status: 'COMPLETED', studentId: 's1', gradeRaw: 5.25 },
        { status: 'COMPLETED', studentId: 's2', gradeRaw: 5.5 },
        { status: 'COMPLETED', studentId: null, gradeRaw: 1.85 },
      ]);
      const exam2Avg = computeAssignedGradeAverage([
        { status: 'COMPLETED', studentId: 's3', gradeRaw: 5.5 },
        { status: 'COMPLETED', studentId: null, gradeRaw: 1.85 },
      ]);

      expect(exam1Avg.averageGrade).toBe('5.38');
      expect(exam1Avg.count).toBe(2);
      expect(exam2Avg.averageGrade).toBe('5.50');
      expect(exam2Avg.count).toBe(1);

      // Gewichteter Fach-/Klassenschnitt ueber alle 3 zugeordneten Arbeiten: (10.75 + 5.50) / 3 = 5.42
      const weightedSubjectAvg = (
        (exam1Avg.sum + exam2Avg.sum) /
        (exam1Avg.count + exam2Avg.count)
      ).toFixed(2);
      expect(weightedSubjectAvg).toBe('5.42');
    });

    it('stellt im Korrektur-Workspace-Header einen sichtbaren Trenner zwischen Fach und Gesamtpunkten sicher (Issue #74)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const workspaceSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/correct/[id]/page.tsx'),
        'utf8'
      );

      expect(workspaceSource).toContain("{'Fach: '}");
      expect(workspaceSource).toContain("{' · '}");
      expect(workspaceSource).toContain("{'Gesamtpunkte: '}");
    });

    it('synchronisiert die Klassenauswahl in der Pruefungsverwaltung und zeigt klaren Hinweis bzw. Disabled-Status bei fehlender Klasse (Issue #78)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const examsPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/exams/page.tsx'),
        'utf8'
      );
      const layoutSource = fs.readFileSync(
        path.resolve(process.cwd(), 'components/DashboardLayout.tsx'),
        'utf8'
      );

      expect(examsPageSource).toContain('handleOpenCreateExam');
      expect(examsPageSource).toContain('Zuerst eine Klasse wählen');
      expect(examsPageSource).toContain('disabled={!activeClassId}');
      expect(examsPageSource).toContain('label="Ausgewählt"');
      expect(examsPageSource).not.toContain('ß');
      expect(layoutSource).toContain('.MuiDialog-root');
      expect(layoutSource).toContain("querySelector('.MuiMenu-list, .MuiAutocomplete-popper')");
    });

    it('nutzt "Meine Faecher" (Katalog-Auswahl + eigene Faecher) als massgebliche Quelle in Anlegedialogen, Filtern und auf der Faecher-Seite (Issue #79 & #80)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const examsPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/exams/page.tsx'),
        'utf8'
      );
      const subjectsPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/subjects/page.tsx'),
        'utf8'
      );
      const examDetailPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/exams/[id]/page.tsx'),
        'utf8'
      );

      // 1. Alle 3 Dialoge (Manuell, Duplizieren, Generieren) bieten die Faecher aus "Meine Faecher" (via resolveClassSubjectOptions(mySubjects, ...)) an
      expect(examsPageSource).toContain('function SubjectCombobox');
      expect(examsPageSource).toContain('resolveClassSubjectOptions(mySubjects');
      expect(examsPageSource).toContain('options={createDialogSubjectOptions}');
      expect(examsPageSource).toContain('id="subject-combobox"');
      expect(examsPageSource).toContain('id="copy-subject-combobox"');
      expect(examsPageSource).toContain('id="gen-subject-combobox"');

      // 2. Freie Faecher werden getrimmt und unveraendert uebergeben
      expect(examsPageSource).toContain('subject: examSubject.trim()');
      expect(examsPageSource).toContain('subject: copySubject.trim()');
      expect(examsPageSource).toContain('subject: genSubject.trim()');

      // 3. Frei erfasste Faecher wie "Geschichte" oder "Franzoesisch" erhalten "Basis-Korrektur" (GENERIC_FALLBACK)
      for (const customSubject of ['Geschichte', 'Französisch', 'Geografie', 'Musik']) {
        const info = getSubjectSupportInfo(customSubject);
        expect(info.supportLevel).toBe('GENERIC_FALLBACK');
        expect(info.supportBadge).toBe('Basis-Korrektur');
        expect(info.matchedProfile).toBeNull();
      }

      // Bestehende 8 Katalog-Profile behalten ihren Status unveraendert
      expect(getSubjectSupportInfo('Mathematik').supportBadge).toBe('Verifizierte Modalität');
      expect(getSubjectSupportInfo('Sprache').supportBadge).toBe('Fokus-Profil');
      expect(getSubjectSupportInfo('Sprache / Deutsch').supportBadge).toBe('Fokus-Profil');

      // Pruefungsdetail zeigt den Support-Status ebenfalls an
      expect(examDetailPageSource).toContain('getSubjectSupportInfo(exam?.subject).supportBadge');

      // 4. Erstbefuellung & Aufloesung von "Meine Faecher"
      // Ohne gespeicherte Liste und ohne bestehende Pruefungen -> alle 8 Katalog-Presets
      const fallbackAll = resolveTeacherSubjects(null, []);
      expect(fallbackAll).toHaveLength(8);
      expect(fallbackAll.map((s) => s.value)).toEqual(SUBJECT_PROFILES.map((p) => p.value));

      // Erstbefuellung aus bestehenden Pruefungen der Lehrperson (ohne explizite Konfiguration)
      const initialFromExams = resolveTeacherSubjects(null, [
        'Mathematik',
        'Geschichte',
        'Mathematik',
      ]);
      expect(initialFromExams.map((s) => s.value)).toEqual(['Mathematik', 'Geschichte']);
      expect(initialFromExams[0].supportInfo.supportBadge).toBe('Verifizierte Modalität');
      expect(initialFromExams[1].supportInfo.supportBadge).toBe('Basis-Korrektur');

      // Explizite Auswahl der Lehrperson ("Meine Faecher"): Katalog-Auswahl + eigene Faecher
      const customConfigured = resolveTeacherSubjects(
        ['Physik', 'Mathematik', 'Französisch'],
        ['Biologie']
      );
      // Katalog-Reihenfolge (Mathematik vor Physik) + eigene Faecher (Franzoesisch)
      expect(customConfigured.map((s) => s.value)).toEqual(['Mathematik', 'Physik', 'Französisch']);
      expect(customConfigured[2].isCatalog).toBe(false);
      expect(customConfigured[2].supportInfo.supportBadge).toBe('Basis-Korrektur');

      // Filter- & Ansichts-Faecher kombinieren "Meine Faecher" mit tatsaechlich in Pruefungen vorkommenden Faechern
      const filterAndView = resolveFilterAndViewSubjects(
        ['Mathematik', 'Französisch'],
        ['Biologie', 'Geschichte']
      );
      expect(filterAndView.map((s) => s.value)).toEqual([
        'Mathematik',
        'Französisch',
        'Biologie',
        'Geschichte',
      ]);

      // Persistenz in lib/teacher-subjects.ts
      resetTeacherSubjectsMemoryState();
      const testTeacherId = `teacher-80-${Date.now()}`;
      expect(await getTeacherSavedSubjects(testTeacherId)).toBeNull();
      const saved = await saveTeacherSubjects(testTeacherId, [
        'Mathematik',
        '  Geschichte  ',
        'mathematik',
        'Sprache / Deutsch',
      ]);
      expect(saved).toEqual(['Mathematik', 'Geschichte', 'Sprache']);
      expect(await getTeacherSavedSubjects(testTeacherId)).toEqual([
        'Mathematik',
        'Geschichte',
        'Sprache',
      ]);
      expect(normalizeSubjectValue('Sprache / Deutsch')).toBe('Sprache');
      expect(normalizeSubjectValue('  Geschichte ')).toBe('Geschichte');

      // 5. Faecher-Seite (/subjects) enthaelt Verwaltungsansicht "Meine Faecher verwalten" und "Weitere Faecher hinzufuegen"
      expect(subjectsPageSource).toContain('Meine Fächer verwalten');
      expect(subjectsPageSource).toContain('Weitere Fächer hinzufügen');
      expect(subjectsPageSource).toContain('resolveFilterAndViewSubjects');
      expect(subjectsPageSource).toContain(
        "const key = matched ? matched.value : exSubTrimmed || 'Mathematik'"
      );
      expect(subjectsPageSource).not.toContain('ß');
      expect(examDetailPageSource).not.toContain('ß');
    });

    it('unterstuetzt Klassen-Faecher-Teilmenge, Vorauswahl pro Klasse, Klassendetail-Fachschnitte und Klassenfilter auf der Faecher-Seite (Issue #81)', async () => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const classesPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/classes/page.tsx'),
        'utf8'
      );
      const classDetailPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/classes/[id]/page.tsx'),
        'utf8'
      );
      const examsPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/exams/page.tsx'),
        'utf8'
      );
      const subjectsPageSource = fs.readFileSync(
        path.resolve(process.cwd(), 'app/subjects/page.tsx'),
        'utf8'
      );

      // 1. Persistenz der Klassen-Faecher-Teilmenge (Mehrfachauswahl, leer = keine Einschraenkung)
      resetTeacherSubjectsMemoryState();
      const classA = 'class-81-a';
      const classB = 'class-81-b';
      expect(await getClassSavedSubjects(classA)).toEqual([]);

      const savedA = await saveClassSubjects(classA, [
        'Mathematik',
        '  Französisch ',
        'mathematik',
      ]);
      expect(savedA).toEqual(['Mathematik', 'Französisch']);
      expect(await getClassSavedSubjects(classA)).toEqual(['Mathematik', 'Französisch']);

      const multi = await getMultipleClassesSavedSubjects([classA, classB]);
      expect(multi[classA]).toEqual(['Mathematik', 'Französisch']);
      expect(multi[classB]).toEqual([]);

      await deleteClassSubjects(classA);
      expect(await getClassSavedSubjects(classA)).toEqual([]);

      // 2. Teilmenge vs. volle Lehrerliste ("Meine Faecher") & sinnvolle Vorauswahl
      const teacherSubjects = resolveTeacherSubjects(
        ['Mathematik', 'Physik', 'Französisch', 'Geschichte'],
        []
      );

      // Ohne Teilmenge (leer = keine Einschraenkung): volle Lehrerliste verfuegbar
      const unrestrictedOptions = resolveClassSubjectOptions(teacherSubjects, []);
      expect(unrestrictedOptions.map((s) => s.value)).toEqual([
        'Mathematik',
        'Physik',
        'Französisch',
        'Geschichte',
      ]);

      // Mit Teilmenge: nur relevante Faecher der Klasse verfuegbar
      const subsetOptions = resolveClassSubjectOptions(teacherSubjects, [
        'Französisch',
        'Geschichte',
      ]);
      expect(subsetOptions.map((s) => s.value)).toEqual(['Französisch', 'Geschichte']);

      // Vorauswahl: einziges Fach in der Klasse -> direkt vorbelegt
      const singleSubset = resolveClassSubjectOptions(teacherSubjects, ['Französisch']);
      expect(resolveDefaultExamSubjectForClass(singleSubset, [])).toBe('Französisch');

      // Vorauswahl: mehrere Faecher -> zuletzt in dieser Klasse verwendetes Fach
      expect(
        resolveDefaultExamSubjectForClass(subsetOptions, [
          { subject: 'Geschichte' },
          { subject: 'Französisch' },
        ])
      ).toBe('Geschichte');

      // Vorauswahl ohne bisherige Pruefung -> erstes Fach der Teilmenge
      expect(resolveDefaultExamSubjectForClass(subsetOptions, [])).toBe('Französisch');

      // 3. Fachbezogene Schnitte/Statistiken pro Klasse aus vorhandenen Pruefungsdaten + unveraenderter Support-Status
      const breakdown = computeClassSubjectBreakdown(
        [
          { subject: 'Mathematik', submissionsCount: 2, averageGrade: '5.00' },
          { subject: 'Mathematik', submissionsCount: 1, averageGrade: '5.60' },
          { subject: 'Geschichte', submissionsCount: 2, averageGrade: '4.50' },
        ],
        ['Mathematik', 'Französisch', 'Geschichte']
      );

      expect(breakdown.map((b) => b.value)).toEqual(['Mathematik', 'Französisch', 'Geschichte']);
      const mathStat = breakdown.find((b) => b.value === 'Mathematik')!;
      expect(mathStat.examsCount).toBe(2);
      expect(mathStat.submissionsCount).toBe(3);
      // (2 * 5.00 + 1 * 5.60) / 3 = 15.60 / 3 = 5.20
      expect(mathStat.averageGrade).toBe('5.20');
      expect(mathStat.supportInfo.supportBadge).toBe('Verifizierte Modalität');

      const frStat = breakdown.find((b) => b.value === 'Französisch')!;
      expect(frStat.examsCount).toBe(0);
      expect(frStat.submissionsCount).toBe(0);
      expect(frStat.averageGrade).toBe('N/A');
      expect(frStat.supportInfo.supportBadge).toBe('Basis-Korrektur');

      const histStat = breakdown.find((b) => b.value === 'Geschichte')!;
      expect(histStat.examsCount).toBe(1);
      expect(histStat.submissionsCount).toBe(2);
      expect(histStat.averageGrade).toBe('4.50');
      expect(histStat.supportInfo.supportBadge).toBe('Basis-Korrektur');

      // 4. UI-Integration in Klassenverwaltung, Klassendetail, Pruefungsverwaltung und Faecher-Seite (plus Schweizer Rechtschreibung ohne ss-Fehler)
      expect(classesPageSource).toContain('Fächer dieser Klasse (Teilmenge aus „Meine Fächer“)');
      expect(classesPageSource).not.toContain('ß');
      expect(classDetailPageSource).toContain('Fächer & Fachschnitte dieser Klasse');
      expect(classDetailPageSource).toContain('computeClassSubjectBreakdown');
      expect(classDetailPageSource).not.toContain('ß');
      expect(examsPageSource).toContain('resolveDefaultExamSubjectForClass');
      expect(subjectsPageSource).toContain(
        'resolveClassSubjectOptions(allSubjects, selectedClass.subjects)'
      );
      expect(subjectsPageSource).not.toContain('ß');
    });
  });
});
