import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, beforeEach } from 'vitest';
import {
  clearDataCache,
  getCachedData,
  setCachedData,
  mutateCache,
  subscribeToCacheKey,
} from '@/lib/dataCache';
import {
  SUBJECT_PROFILES,
  resolveTeacherSubjects,
  resolveFilterAndViewSubjects,
  resolveClassSubjectOptions,
} from '@/lib/grading';
import { resetTeacherSubjectsMemoryState } from '@/lib/teacher-subjects';
import { GET as getSubjects, PUT as putSubjects } from '@/app/api/subjects/route';
import * as sessionModule from '@/lib/session';
import { db } from '@/lib/db';
import { vi } from 'vitest';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/class-archive', () => ({
  getArchivedClassIds: vi.fn().mockResolvedValue(new Set<string>()),
}));

vi.mock('@/lib/db', () => ({
  db: {
    exam: {
      findMany: vi.fn(),
    },
  },
}));

interface CachedTeacherSubjects {
  hasConfigured?: boolean;
  savedSubjects?: string[] | null;
  existingExamSubjects?: string[];
}

describe('Fächer-Seite (#87): Liste aktualisiert sich nach "Meine Fächer speichern" sofort ohne Reload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDataCache();
    resetTeacherSubjectsMemoryState();
    vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'teacher-87' });
    vi.mocked(db.exam.findMany).mockResolvedValue([]);
  });

  it('aktualisiert nach PUT /api/subjects und mutateCache("/api/subjects", data, false) sofort Zähler, Karten und Status-Badges ohne Cache-Löschung', async () => {
    // 1. Ausgangszustand beim Öffnen von /subjects: Noch keine Auswahl gespeichert -> 11 Katalog-Profile ("Meine Fächer (11)")
    const initialGetRes = await getSubjects();
    expect(initialGetRes.status).toBe(200);
    const initialData = (await initialGetRes.json()) as CachedTeacherSubjects;
    expect(initialData.savedSubjects).toBeNull();

    setCachedData('/api/subjects', initialData);

    const initialCached = getCachedData<CachedTeacherSubjects>('/api/subjects');
    const initialVisible = resolveFilterAndViewSubjects(initialCached?.savedSubjects ?? null, []);
    expect(initialVisible).toHaveLength(11);

    // 2. Lehrperson wählt im Dialog "Meine Fächer verwalten" 1 Katalog-Profil (Mathematik) + 1 eigenes Fach (Musik) und klickt "Meine Fächer speichern"
    let listenerNotificationCount = 0;
    const unsubscribe = subscribeToCacheKey('/api/subjects', () => {
      listenerNotificationCount++;
    });

    const putRes = await putSubjects(
      new Request('http://localhost/api/subjects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: ['Mathematik', 'Musik'] }),
      })
    );
    expect(putRes.status).toBe(200);
    const savedData = (await putRes.json()) as CachedTeacherSubjects;
    expect(savedData.savedSubjects).toEqual(['Mathematik', 'Musik']);

    // persistTeacherSubjects aktualisiert den gemeinsamen Cache-Key '/api/subjects' ohne ihn danach via invalidateSubjects() zu löschen
    await mutateCache('/api/subjects', savedData, false);
    unsubscribe();

    expect(listenerNotificationCount).toBeGreaterThanOrEqual(1);

    // 3. Ohne Reload zeigt /subjects sofort die neue Liste: Zähler = 2, Karten = Mathematik & Musik, korrekte Status-Badges
    const updatedCached = getCachedData<CachedTeacherSubjects>('/api/subjects');
    expect(updatedCached).toBeDefined();
    expect(updatedCached?.savedSubjects).toEqual(['Mathematik', 'Musik']);

    const updatedVisible = resolveFilterAndViewSubjects(updatedCached?.savedSubjects ?? null, []);
    expect(updatedVisible).toHaveLength(2);
    expect(updatedVisible.map((s) => s.label)).toEqual(['Mathematik', 'Musik']);
    expect(updatedVisible[0].isCatalog).toBe(true);
    expect(updatedVisible[0].supportInfo.supportBadge).toBe('Verifizierte Modalität');
    expect(updatedVisible[1].isCatalog).toBe(false);
    expect(updatedVisible[1].supportInfo.supportBadge).toBe('Basis-Korrektur');

    // Nicht ausgewählte Katalog-Profile unter "Weitere Fächer hinzufügen" sind sofort 10
    const unselectedCatalog = SUBJECT_PROFILES.filter(
      (p) => !updatedVisible.some((s) => s.value.toLowerCase() === p.value.toLowerCase())
    );
    expect(unselectedCatalog).toHaveLength(10);

    // 4. Zweiter Durchgang: Eigenes Fach "Geschichte" hinzufügen und "Musik" entfernen -> sofortige Aktualisierung ohne Reload
    const putRes2 = await putSubjects(
      new Request('http://localhost/api/subjects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: ['Mathematik', 'Physik', 'Geschichte'] }),
      })
    );
    const savedData2 = (await putRes2.json()) as CachedTeacherSubjects;
    await mutateCache('/api/subjects', savedData2, false);

    const updatedCached2 = getCachedData<CachedTeacherSubjects>('/api/subjects');
    const updatedVisible2 = resolveFilterAndViewSubjects(updatedCached2?.savedSubjects ?? null, []);
    expect(updatedVisible2).toHaveLength(3);
    expect(updatedVisible2.map((s) => s.label)).toEqual(['Mathematik', 'Physik', 'Geschichte']);
    expect(updatedVisible2[1].supportInfo.supportBadge).toBe('Fokus-Profil');
    expect(updatedVisible2[2].supportInfo.supportBadge).toBe('Basis-Korrektur');
  });

  it('übernimmt die gespeicherte Fächerliste sofort ohne Reload in Anlege-Dialogen und Fächer-Filtern (/exams, /subjects, /classes)', async () => {
    const putRes = await putSubjects(
      new Request('http://localhost/api/subjects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: ['Biologie', 'Theater'] }),
      })
    );
    const savedData = (await putRes.json()) as CachedTeacherSubjects;
    await mutateCache('/api/subjects', savedData, false);

    // Alle Ansichten lesen denselben Cache-Key '/api/subjects'
    const sharedCache = getCachedData<CachedTeacherSubjects>('/api/subjects');
    const mySubjects = resolveTeacherSubjects(sharedCache?.savedSubjects ?? null, []);

    // Anlege-Dialog ohne Klassen-Einschränkung zeigt sofort Biologie + Theater
    const createDialogOptions = resolveClassSubjectOptions(mySubjects, []);
    expect(createDialogOptions.map((s) => s.value)).toEqual(['Biologie', 'Theater']);

    // Fächer-Filter auf der Prüfungsliste (/exams) zeigt sofort Biologie + Theater (+ ggf. vorhandene Prüfungsfächer)
    const examFilterSubjects = resolveFilterAndViewSubjects(sharedCache?.savedSubjects ?? null, [
      'Mathematik',
    ]);
    expect(examFilterSubjects.map((s) => s.value)).toEqual(['Biologie', 'Theater', 'Mathematik']);
  });

  it('stellt sicher, dass persistTeacherSubjects in app/subjects/page.tsx den mutierten Cache nicht durch invalidateSubjects() löscht', () => {
    const subjectsPagePath = path.join(process.cwd(), 'app', 'subjects', 'page.tsx');
    const source = fs.readFileSync(subjectsPagePath, 'utf8');

    expect(source).toContain('await mutateSubjects(nextData, false)');
    expect(source).not.toContain('invalidateSubjects()');

    const dataCachePath = path.join(process.cwd(), 'lib', 'dataCache.ts');
    const dataCacheSource = fs.readFileSync(dataCachePath, 'utf8');
    expect(dataCacheSource).toContain('isUnfetchedOrInvalidated');
  });
});
