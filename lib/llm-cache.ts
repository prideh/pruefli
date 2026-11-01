import crypto from 'node:crypto';
import { getStorageAdapter } from '@/lib/storage';

export type LlmCallType =
  | 'grading'
  | 'rubric_parse'
  | 'scan_identification'
  | 'exam_generation'
  | 'task_regeneration'
  | 'document_classification';

export interface LlmCacheEntry<T> {
  result: T;
  cachedAt: number;
  cachedAtIso: string;
  model: string;
  hash: string;
  callType: LlmCallType;
  promptVersion: string;
  teacherId: string;
}

export const LLM_PROMPT_VERSIONS = {
  grading: '2026-11-01-grading-v3-robustness',
  rubricParse: '2026-11-01-rubric-v3',
  scanIdentification: '2026-10-30-scan-v1',
  examGeneration: '2026-10-30-generation-v1',
  taskRegeneration: '2026-10-30-task-regen-v1',
  documentClassification: '2026-11-01-doc-class-v1',
} as const;

/**
 * Erzeugt einen deterministischen, sortierten JSON-String unabhaengig von Key-Reihenfolgen.
 */
export function canonicalizeJson(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalizeJson(item)).join(',')}]`;
  }
  const obj = value as Record<string, unknown>;
  const sortedKeys = Object.keys(obj).sort();
  const entries = sortedKeys
    .filter((k) => obj[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalizeJson(obj[k])}`);
  return `{${entries.join(',')}}`;
}

/**
 * Berechnet einen kryptografischen SHA-256 Digest ueber deterministisch serialisierte Eingaben.
 */
export function computeSha256(content: string): string {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex');
}

/**
 * Normalisiert Referenzdokumente (Musterloesung / Vorlage) fuer deterministisches Content-Hashing,
 * sodass serialisierte JSON-Strings (z. B. `{"name":"...","mimeType":"...","data":"..."}`) und
 * bereits geparste `{ mimeType, data }`-Objekte denselben Hash ueber den Dokumentinhalt erzeugen.
 */
export function normalizeMaterialForHash(material: unknown): unknown {
  if (!material) return null;
  if (typeof material === 'string') {
    const trimmed = material.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return normalizeMaterialForHash(parsed);
      } catch {
        return material;
      }
    }
    return material;
  }
  if (Array.isArray(material)) {
    const isDocArray =
      material.length > 0 &&
      material.every(
        (item) =>
          item &&
          typeof item === 'object' &&
          typeof (item as { mimeType?: unknown }).mimeType === 'string' &&
          typeof (item as { data?: unknown }).data === 'string'
      );
    if (isDocArray) {
      return material.map((item) => {
        const doc = item as { mimeType: string; data: string };
        return {
          mimeType: doc.mimeType,
          dataHash: computeSha256(doc.data.trim()),
        };
      });
    }
    return material;
  }
  if (
    typeof material === 'object' &&
    typeof (material as { mimeType?: unknown }).mimeType === 'string' &&
    typeof (material as { data?: unknown }).data === 'string'
  ) {
    const doc = material as { mimeType: string; data: string };
    return {
      mimeType: doc.mimeType,
      dataHash: computeSha256(doc.data.trim()),
    };
  }
  return material;
}

/**
 * Berechnet den Content-Hash fuer einen Grading-Aufruf.
 * Beruecksichtigt saemtliche Eingaben, die das Modell-Ergebnis beeinflussen:
 * - Mandanten-ID (teacherId zur strikten Mandantentrennung)
 * - Modell-Name (z. B. gemini-3.8-flash)
 * - Prompt-Template-Version
 * - Seiten der Schuelerarbeit (MIME + Base64-Daten)
 * - Musterloesung / Erwartungshorizont (rubric)
 * - Vorlagenpruefung (examTemplate)
 * - Notizen / Unterrichtsmaterial (gradingNotes)
 * - Vorgegebene Aufgabenstruktur (predefinedTasks)
 * - Unterrichtsfach (subject)
 */
export function computeGradingHash(params: {
  teacherId: string;
  modelName: string;
  promptVersion?: string;
  studentPages: { mimeType: string; data: string }[];
  rubric: unknown;
  examTemplate?: unknown;
  gradingNotes?: string | null;
  predefinedTasks?: { taskId: string; title: string; maxPoints: number }[];
  subject?: string | null;
}): string {
  const canonical = canonicalizeJson({
    teacherId: params.teacherId,
    modelName: params.modelName,
    promptVersion: params.promptVersion || LLM_PROMPT_VERSIONS.grading,
    studentPages: params.studentPages.map((p) => ({
      mimeType: p.mimeType,
      dataHash: computeSha256(p.data),
    })),
    rubric: normalizeMaterialForHash(params.rubric),
    examTemplate: normalizeMaterialForHash(params.examTemplate) || null,
    gradingNotes: params.gradingNotes?.trim() || null,
    predefinedTasks: params.predefinedTasks || null,
    subject: params.subject?.trim().toLowerCase() || null,
  });
  return computeSha256(canonical);
}

/**
 * Berechnet den Content-Hash fuer das Parsen einer Musterloesung.
 */
export function computeRubricParseHash(params: {
  teacherId: string;
  modelName: string;
  promptVersion?: string;
  rubricText: unknown;
}): string {
  const canonical = canonicalizeJson({
    teacherId: params.teacherId,
    modelName: params.modelName,
    promptVersion: params.promptVersion || LLM_PROMPT_VERSIONS.rubricParse,
    rubricText: normalizeMaterialForHash(params.rubricText),
  });
  return computeSha256(canonical);
}

/**
 * Berechnet den Content-Hash fuer die automatische Zuordnung von Scan-Seiten zu Pruefung und Schueler.
 */
export function computeScanIdentificationHash(params: {
  teacherId: string;
  modelName: string;
  promptVersion?: string;
  pages: { mimeType: string; data: string }[];
  candidates: unknown;
}): string {
  const canonical = canonicalizeJson({
    teacherId: params.teacherId,
    modelName: params.modelName,
    promptVersion: params.promptVersion || LLM_PROMPT_VERSIONS.scanIdentification,
    pages: params.pages.map((p) => ({
      mimeType: p.mimeType,
      dataHash: computeSha256(p.data),
    })),
    candidates: params.candidates,
  });
  return computeSha256(canonical);
}

/**
 * Berechnet den Content-Hash fuer die vollstaendige Generierung einer Pruefung aus Unterrichtsmaterial.
 */
export function computeExamGenerationHash(params: {
  teacherId: string;
  modelName: string;
  promptVersion?: string;
  material: unknown;
  subject?: string | null;
  topic?: string | null;
  stufe?: string | null;
  difficulty?: string | null;
  totalPoints?: number | null;
  taskCount?: number | null;
}): string {
  const canonical = canonicalizeJson({
    teacherId: params.teacherId,
    modelName: params.modelName,
    promptVersion: params.promptVersion || LLM_PROMPT_VERSIONS.examGeneration,
    material: params.material,
    subject: params.subject?.trim().toLowerCase() || null,
    topic: params.topic?.trim() || null,
    stufe: params.stufe?.trim() || null,
    difficulty: params.difficulty?.trim() || null,
    totalPoints: params.totalPoints || null,
    taskCount: params.taskCount || null,
  });
  return computeSha256(canonical);
}

/**
 * Berechnet den Content-Hash fuer die isolierte Neu-Generierung einer einzelnen Aufgabe.
 */
export function computeTaskRegenerationHash(params: {
  teacherId: string;
  modelName: string;
  promptVersion?: string;
  material: unknown;
  taskId: string;
  existingTitle?: string | null;
  maxPoints?: number | null;
  instructions?: string | null;
  subject?: string | null;
  topic?: string | null;
  stufe?: string | null;
  difficulty?: string | null;
}): string {
  const canonical = canonicalizeJson({
    teacherId: params.teacherId,
    modelName: params.modelName,
    promptVersion: params.promptVersion || LLM_PROMPT_VERSIONS.taskRegeneration,
    material: params.material,
    taskId: params.taskId,
    existingTitle: params.existingTitle || null,
    maxPoints: params.maxPoints || null,
    instructions: params.instructions?.trim() || null,
    subject: params.subject?.trim().toLowerCase() || null,
    topic: params.topic?.trim() || null,
    stufe: params.stufe?.trim() || null,
    difficulty: params.difficulty?.trim() || null,
  });
  return computeSha256(canonical);
}

/**
 * Berechnet den Content-Hash fuer die Vorab-Klassifizierung eines Dokumenttyps.
 */
export function computeDocumentClassificationHash(params: {
  teacherId: string;
  modelName: string;
  promptVersion?: string;
  dataHash: string;
  mimeType: string;
  expectedType?: string;
}): string {
  const canonical = canonicalizeJson({
    teacherId: params.teacherId,
    modelName: params.modelName,
    promptVersion: params.promptVersion || LLM_PROMPT_VERSIONS.documentClassification,
    dataHash: params.dataHash,
    mimeType: params.mimeType,
    expectedType: params.expectedType || null,
  });
  return computeSha256(canonical);
}

export function buildLlmCacheKey(
  teacherId: string,
  callType: LlmCallType,
  contentHash: string
): string {
  return `llm:${teacherId}:${callType}:${contentHash}`;
}

// In-Memory-Speicher, ueber Next.js HMR und Worker-Aufrufe hinweg bestaendig
const globalForLlmCache = globalThis as unknown as {
  __pruefliLlmStore?: Map<string, LlmCacheEntry<unknown>>;
  __gradeAiLlmStore?: Map<string, LlmCacheEntry<unknown>>;
};

const memoryStore: Map<string, LlmCacheEntry<unknown>> = globalForLlmCache.__pruefliLlmStore ??
globalForLlmCache.__gradeAiLlmStore ??
new Map();

if (process.env.NODE_ENV !== 'production') {
  globalForLlmCache.__pruefliLlmStore = memoryStore;
}

function getStorageSafeKey(cacheKey: string): string {
  const sanitized = cacheKey.replace(/[^a-zA-Z0-9_-]/g, '_');
  return `llm-cache/${sanitized}.json`;
}

/**
 * Liest ein gecachtes LLM-Ergebnis aus dem Speicher oder persistenten Storage.
 */
export async function getCachedLlmResult<T>(cacheKey: string): Promise<LlmCacheEntry<T> | null> {
  // 1. In-Memory Pruefung (schnellster Pfad)
  const inMem = memoryStore.get(cacheKey);
  if (inMem) {
    return inMem as LlmCacheEntry<T>;
  }

  // 2. Persistenter Storage-Fallback (fuer Server-Neustarts)
  try {
    const storage = getStorageAdapter();
    const storageKey = getStorageSafeKey(cacheKey);
    const file = await storage.read(storageKey);
    if (file) {
      const parsed = JSON.parse(file.buffer.toString('utf-8')) as LlmCacheEntry<T>;
      memoryStore.set(cacheKey, parsed);
      return parsed;
    }
  } catch {
    // Storage read miss or non-existent
  }

  return null;
}

/**
 * Speichert ein gueltiges LLM-Ergebnis atomar im Memory-Cache und persistenten Storage.
 * Fehlerhafte oder leere Resultate duerfen niemals uebergeben werden.
 */
export async function setCachedLlmResult<T>(
  cacheKey: string,
  entry: LlmCacheEntry<T>
): Promise<void> {
  memoryStore.set(cacheKey, entry as LlmCacheEntry<unknown>);

  try {
    const storage = getStorageAdapter();
    const storageKey = getStorageSafeKey(cacheKey);
    const payload = Buffer.from(JSON.stringify(entry), 'utf-8');
    await storage.write(storageKey, payload, 'application/json');
  } catch {
    // In Test- oder schreibgeschuetzten Umgebungen bleibt der In-Memory-Speicher aktiv
  }
}

/**
 * Loescht einen einzelnen Eintrag aus Memory und Storage.
 */
export async function deleteCachedLlmResult(cacheKey: string): Promise<void> {
  memoryStore.delete(cacheKey);
  try {
    const storage = getStorageAdapter();
    const storageKey = getStorageSafeKey(cacheKey);
    await storage.delete(storageKey);
  } catch {
    // Ignorieren falls nicht vorhanden
  }
}

/**
 * Bereinigt den LLM-Cache (Primaer fuer Unit-Tests).
 */
export async function clearLlmCache(): Promise<void> {
  memoryStore.clear();
}

/**
 * Ermittelt die Anzahl aktuell im Memory gecachter LLM-Eintraege.
 */
export function getLlmCacheSize(): number {
  return memoryStore.size;
}
