import { describe, it, expect } from 'vitest';
import {
  calculateRawSwissGrade,
  calculateSwissGrade,
  matchStudentByNameWithConfidence,
  parseStudentExamUrls,
  SUBJECT_PROFILES,
  getSubjectSupportInfo,
} from '@/lib/grading';
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
});
