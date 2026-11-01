import { GoogleGenAI, Type, ThinkingLevel, type Schema } from '@google/genai';
import {
  DEFAULT_GEMINI_MODEL,
  appendReferenceMaterialToContents,
  type ReferenceMaterialInput,
} from '@/lib/gemini';
import {
  computeExamGenerationHash,
  computeTaskRegenerationHash,
  buildLlmCacheKey,
  getCachedLlmResult,
  setCachedLlmResult,
  LLM_PROMPT_VERSIONS,
} from '@/lib/llm-cache';
import { validateExamMaterialInput } from '@/lib/document-validation';

export interface GeneratedTask {
  taskId: string;
  title: string;
  maxPoints: number;
  sourceReference: string; // e.g. "Seite 2, Abschnitt 2.1 'Der Satz des Pythagoras'"
  taskQuestion: string;
  taskSolution: string;
}

export interface GeneratedExamPackage {
  examTitle: string;
  examTemplateText: string;
  rubricText: string;
  tasks: GeneratedTask[];
  totalPoints: number;
}

const GENERATE_EXAM_SCHEMA: Schema = {
  type: Type.OBJECT,
  description:
    'Vollständiges Prüfungspaket aus Unterrichtsmaterial: Aufgabenblatt, Musterlösung und Aufgabenstruktur.',
  properties: {
    examTitle: {
      type: Type.STRING,
      description:
        'Prägnanter Prüfungstitel in Schweizer Hochdeutsch (immer "ss", z. B. "Mathematik: Lineare Gleichungen").',
    },
    examTemplateText: {
      type: Type.STRING,
      description:
        'Vollständiges, druckreifes Aufgabenblatt für die Schülerinnen und Schüler (ohne Lösungen), formatiert in sauberem Markdown mit allen Aufgabenstellungen, Platzhaltern und Punkteangaben.',
    },
    rubricText: {
      type: Type.STRING,
      description:
        'Detaillierte Musterlösung und Erwartungshorizont für die Lehrperson mit korrekten Teilschritten, Zwischenergebnissen, Kriterien für Folgefehler und Punkteverteilung pro Schritt.',
    },
    tasks: {
      type: Type.ARRAY,
      description:
        'Strukturierte Liste aller Aufgaben mit Maximalpunkten und Quellennachweis aus dem Material.',
      items: {
        type: Type.OBJECT,
        properties: {
          taskId: {
            type: Type.STRING,
            description: 'Aufgabennummer (z. B. "1", "2", "3").',
          },
          title: {
            type: Type.STRING,
            description: 'Lesbarer Titel der Aufgabe (z. B. "Aufgabe 1: Gleichung auflösen").',
          },
          maxPoints: {
            type: Type.NUMBER,
            description:
              'Maximal erreichbare Punkte für diese Aufgabe (positive Zahl, z. B. 4 oder 5).',
          },
          sourceReference: {
            type: Type.STRING,
            description:
              'Exakte Quellenangabe aus dem hochgeladenen Unterrichtsmaterial, aus dem diese Aufgabe abgeleitet wurde (z. B. "Seite 3, Abschnitt \'Gleichungen mit Klammern\'" oder "Kapitel 2, Beispiel 4").',
          },
          taskQuestion: {
            type: Type.STRING,
            description: 'Wortlaut der Aufgabenstellung für das Aufgabenblatt.',
          },
          taskSolution: {
            type: Type.STRING,
            description: 'Ausführliche Musterlösung und Bepunktungskriterien für diese Aufgabe.',
          },
        },
        required: [
          'taskId',
          'title',
          'maxPoints',
          'sourceReference',
          'taskQuestion',
          'taskSolution',
        ],
      },
    },
  },
  required: ['examTitle', 'examTemplateText', 'rubricText', 'tasks'],
};

const REGENERATE_TASK_SCHEMA: Schema = {
  type: Type.OBJECT,
  description:
    'Einzelne neu generierte Prüfungsaufgabe mit Quellennachweis aus dem Unterrichtsmaterial.',
  properties: {
    taskId: {
      type: Type.STRING,
      description: 'Aufgabennummer (unverändert beibehalten).',
    },
    title: {
      type: Type.STRING,
      description: 'Überarbeiteter, lesbarer Titel der Aufgabe.',
    },
    maxPoints: {
      type: Type.NUMBER,
      description: 'Maximal erreichbare Punkte für diese Aufgabe.',
    },
    sourceReference: {
      type: Type.STRING,
      description: 'Quellenangabe aus dem Unterrichtsmaterial für diese neu generierte Aufgabe.',
    },
    taskQuestion: {
      type: Type.STRING,
      description: 'Neue Aufgabenstellung für das Aufgabenblatt.',
    },
    taskSolution: {
      type: Type.STRING,
      description: 'Neue Musterlösung und Kriterien für diese Aufgabe.',
    },
  },
  required: ['taskId', 'title', 'maxPoints', 'sourceReference', 'taskQuestion', 'taskSolution'],
};

export interface GenerateExamOptions {
  teacherId: string;
  material: ReferenceMaterialInput;
  subject?: string;
  topic?: string;
  stufe?: string;
  difficulty?: string;
  totalPoints?: number;
  taskCount?: number;
  customTitle?: string;
  modelName?: string;
  bypassCache?: boolean;
}

export async function generateExamFromMaterial(
  options: GenerateExamOptions
): Promise<{ examPackage: GeneratedExamPackage; cached: boolean }> {
  if (!options.material) {
    throw new Error('Unterrichtsmaterial ist erforderlich. Bitte lade mindestens eine Datei hoch.');
  }

  // Material may be empty string or empty array
  if (typeof options.material === 'string' && options.material.trim() === '') {
    throw new Error('Unterrichtsmaterial ist erforderlich. Bitte lade mindestens eine Datei hoch.');
  }
  if (Array.isArray(options.material) && options.material.length === 0) {
    throw new Error('Unterrichtsmaterial ist erforderlich. Bitte lade mindestens eine Datei hoch.');
  }

  const materialValidation = await validateExamMaterialInput(options.material);
  if (!materialValidation.valid) {
    throw new Error(materialValidation.error || 'Ungültiges Unterrichtsmaterial.');
  }

  const modelName = options.modelName || DEFAULT_GEMINI_MODEL;
  const promptVersion = LLM_PROMPT_VERSIONS.examGeneration;
  const targetPoints = options.totalPoints && options.totalPoints > 0 ? options.totalPoints : 20;
  const targetTaskCount = options.taskCount && options.taskCount > 0 ? options.taskCount : 4;

  const contentHash = computeExamGenerationHash({
    teacherId: options.teacherId,
    modelName,
    promptVersion,
    material: options.material,
    subject: options.subject,
    topic: options.topic,
    stufe: options.stufe,
    difficulty: options.difficulty,
    totalPoints: targetPoints,
    taskCount: targetTaskCount,
  });

  const cacheKey = buildLlmCacheKey(options.teacherId, 'exam_generation', contentHash);

  if (!options.bypassCache) {
    const cached = await getCachedLlmResult<GeneratedExamPackage>(cacheKey);
    if (cached) {
      return { examPackage: cached.result, cached: true };
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API-Schlüssel ist auf dem Server nicht konfiguriert.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];

  contents.push(
    '=== VERBINDLICHES UNTERRICHTSMATERIAL (AUSSCHLIESSLICHE GRUNDLAGE FÜR DIE PRÜFUNG) ==='
  );
  appendReferenceMaterialToContents(contents, options.material);

  const GENERATION_SYSTEM_PROMPT = `
Du bist eine erfahrene Schweizer Lehrperson. Deine Aufgabe ist es, aus dem bereitgestellten Unterrichtsmaterial eine vollwertige, didaktisch durchdachte schriftliche Prüfung zu generieren.

STRIKTE GROUNDING-REGEL (WICHTIGSTE ANFORDERUNG):
- Leite ausnahmslos ALLE Aufgaben, Fragestellungen und Musterlösungen DIREKT aus den im hochgeladenen Material behandelten Themen, Definitionen, Beispielen und Übungen ab.
- Führe KEINE externen Themen, Konzepte oder Fakten ein, die im Material nicht vorkommen.
- Das angegebene Thema ("${options.topic || 'Gesamtes Material'}") dient ausschliesslich dazu, die Auswahl INNERHALB des hochgeladenen Materials einzugrenzen.

DIDAKTISCHE VORGABEN:
- Fach: ${options.subject || 'Allgemein'}
- Schulstufe: ${options.stufe || 'Sekundarstufe I'}
- Schwierigkeitsgrad: ${options.difficulty || 'Standard (Mittelschwer)'}
- Ziel-Gesamtpunktzahl: ${targetPoints} Punkte
- Gewünschte Aufgabenanzahl: ca. ${targetTaskCount} Aufgaben
- Die Summe aller Aufgaben-Maximalpunkte ("maxPoints") MUSS exakt ${targetPoints} Punkte ergeben.

RÜCKVERFOLGBARKEIT (TRACEABILITY):
- Jede generierte Aufgabe MUSS im Feld "sourceReference" einen konkreten Quellennachweis tragen (z. B. "Seite 2, Abschnitt 2.1", "Kapitel 'Bruchrechnen', S. 14, Übung 3").

SPRACHREGELN (SCHWEIZER HOCHDEUTSCH):
- Schreibe ausnahmslos in Schweizer Hochdeutsch (de-CH).
- Verwende IMMER "ss", NIEMALS das Eszett "\u00df" (z. B. "schliessen", "Musterlösung", "gross", "heisst").

STRUKTUR DER AUSGABE:
1. "examTitle": Sinnvoller Prüfungstitel${options.customTitle ? ` (bevorzugt: "${options.customTitle}")` : ''}.
2. "examTemplateText": Das druckreife Aufgabenblatt für die Schülerinnen und Schüler mit Titel, Bearbeitungshinweisen, allen nummerierten Aufgaben und markierten Antwortbereichen.
3. "rubricText": Die detaillierte Musterlösung für die Lehrperson mit Teilschritten, Zwischenwerten und Bepunktungskriterien pro Schritt.
4. "tasks": Das Array der Aufgaben mit ID, Titel, maximalen Punkten, Quellennachweis, Fragetext und Musterlösung.
`;

  contents.push(GENERATION_SYSTEM_PROMPT);

  const response = await ai.models.generateContent({
    model: modelName,
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: GENERATE_EXAM_SCHEMA,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
      temperature: 0.2,
      seed: 42,
    },
  });

  const responseText = (response.text || '').trim();
  if (!responseText) {
    throw new Error('Leere Antwort vom KI-Modell erhalten.');
  }

  const parsed = JSON.parse(responseText) as {
    examTitle: string;
    examTemplateText: string;
    rubricText: string;
    tasks: GeneratedTask[];
  };

  const tasks = Array.isArray(parsed.tasks) ? parsed.tasks : [];
  const calculatedTotal = tasks.reduce((sum, t) => sum + (Number(t.maxPoints) || 0), 0);

  const examPackage: GeneratedExamPackage = {
    examTitle: options.customTitle?.trim() || parsed.examTitle || 'Generierte Prüfung',
    examTemplateText: parsed.examTemplateText || '',
    rubricText: parsed.rubricText || '',
    tasks,
    totalPoints: calculatedTotal > 0 ? calculatedTotal : targetPoints,
  };

  await setCachedLlmResult(cacheKey, {
    result: examPackage,
    cachedAt: Date.now(),
    cachedAtIso: new Date().toISOString(),
    model: modelName,
    hash: contentHash,
    callType: 'exam_generation',
    promptVersion,
    teacherId: options.teacherId,
  });

  return { examPackage, cached: false };
}

export interface RegenerateTaskOptions {
  teacherId: string;
  material: ReferenceMaterialInput;
  taskId: string;
  existingTaskTitle?: string;
  targetMaxPoints?: number;
  instructions?: string;
  subject?: string;
  topic?: string;
  stufe?: string;
  difficulty?: string;
  modelName?: string;
  bypassCache?: boolean;
}

export async function regenerateSingleTask(
  options: RegenerateTaskOptions
): Promise<{ task: GeneratedTask; cached: boolean }> {
  if (!options.material) {
    throw new Error('Unterrichtsmaterial ist für die Neu-Generierung erforderlich.');
  }

  const modelName = options.modelName || DEFAULT_GEMINI_MODEL;
  const promptVersion = LLM_PROMPT_VERSIONS.taskRegeneration;

  const contentHash = computeTaskRegenerationHash({
    teacherId: options.teacherId,
    modelName,
    promptVersion,
    material: options.material,
    taskId: options.taskId,
    existingTitle: options.existingTaskTitle,
    maxPoints: options.targetMaxPoints,
    instructions: options.instructions,
    subject: options.subject,
    topic: options.topic,
    stufe: options.stufe,
    difficulty: options.difficulty,
  });

  const cacheKey = buildLlmCacheKey(options.teacherId, 'task_regeneration', contentHash);

  if (!options.bypassCache) {
    const cached = await getCachedLlmResult<GeneratedTask>(cacheKey);
    if (cached) {
      return { task: cached.result, cached: true };
    }
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Gemini API-Schlüssel ist auf dem Server nicht konfiguriert.');
  }

  const ai = new GoogleGenAI({ apiKey });
  const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];

  contents.push('=== UNTERRICHTSMATERIAL (BASIS FÜR DIE AUFGABE) ===');
  appendReferenceMaterialToContents(contents, options.material);

  const REGENERATE_PROMPT = `
Generiere ausschliesslich Aufgabe ${options.taskId} neu, basierend auf dem hochgeladenen Unterrichtsmaterial.

VORAB-INFORMATIONEN ZUR AUFGABE:
- Aufgabennummer: ${options.taskId}
- Bisheriger Titel: ${options.existingTaskTitle || `Aufgabe ${options.taskId}`}
- Ziel-Maximalpunkte: ${options.targetMaxPoints ?? 4} Punkte
- Fach: ${options.subject || 'Allgemein'}
- Eingrenzung / Thema: ${options.topic || 'Thema gemäss Material'}
- Schulstufe: ${options.stufe || 'Sekundarstufe I'}
- Schwierigkeitsgrad: ${options.difficulty || 'Standard'}
${options.instructions ? `- Spezifische Anweisung der Lehrperson: "${options.instructions}"` : ''}

REGELN:
1. Leite die neue Aufgabe und deren Lösung lückenlos aus dem Unterrichtsmaterial ab (keine externen Inhalte).
2. Gib im Feld "sourceReference" die genaue Fundstelle im Material an.
3. Verwende Schweizer Hochdeutsch (immer "ss", niemals Eszett "\u00df").
4. "maxPoints" muss eine positive Zahl sein (Standard: ${options.targetMaxPoints ?? 4}).
`;

  contents.push(REGENERATE_PROMPT);

  const response = await ai.models.generateContent({
    model: modelName,
    contents,
    config: {
      responseMimeType: 'application/json',
      responseSchema: REGENERATE_TASK_SCHEMA,
      thinkingConfig: {
        thinkingLevel: ThinkingLevel.LOW,
      },
      temperature: 0.3,
      seed: 42,
    },
  });

  const responseText = (response.text || '').trim();
  if (!responseText) {
    throw new Error('Leere Antwort vom KI-Modell erhalten.');
  }

  const parsed = JSON.parse(responseText) as GeneratedTask;
  const task: GeneratedTask = {
    taskId: options.taskId,
    title: parsed.title || `Aufgabe ${options.taskId}`,
    maxPoints: Number(parsed.maxPoints) || options.targetMaxPoints || 4,
    sourceReference: parsed.sourceReference || 'Unterrichtsmaterial',
    taskQuestion: parsed.taskQuestion || '',
    taskSolution: parsed.taskSolution || '',
  };

  await setCachedLlmResult(cacheKey, {
    result: task,
    cachedAt: Date.now(),
    cachedAtIso: new Date().toISOString(),
    model: modelName,
    hash: contentHash,
    callType: 'task_regeneration',
    promptVersion,
    teacherId: options.teacherId,
  });

  return { task, cached: false };
}

/**
 * Replaces a specific task's section in a multi-task markdown document (examTemplateText or rubricText).
 * Matches patterns like:
 * ## Aufgabe 2... or ### Aufgabe 2... or **Aufgabe 2**... up to the next Aufgabe header or end of document.
 */
export function replaceTaskInText(
  originalText: string,
  taskId: string,
  newContent: string
): string {
  if (!originalText || !originalText.trim()) {
    return newContent;
  }

  // Regex to locate the start of this task
  const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const taskStartRegex = new RegExp(
    `(^|\\n)(#{1,4}\\s*Aufgabe\\s+${escapedId}\\b[^\\n]*|\\*\\*Aufgabe\\s+${escapedId}\\b[^\\n]*\\*\\*)`,
    'i'
  );

  const startMatch = taskStartRegex.exec(originalText);
  if (!startMatch || startMatch.index === undefined) {
    // If not found, append to end
    return `${originalText.trim()}\n\n${newContent.trim()}`;
  }

  const startIdx = startMatch.index + (startMatch[1] ? startMatch[1].length : 0);

  // Look for the next task header after startIdx
  const nextTaskRegex = /(^|\n)(#{1,4}\s*Aufgabe\s+\w+|\*\*Aufgabe\s+\w+)/gi;
  nextTaskRegex.lastIndex = startIdx + startMatch[2].length;

  const nextMatch = nextTaskRegex.exec(originalText);
  const endIdx = nextMatch
    ? nextMatch.index + (nextMatch[1] ? nextMatch[1].length : 0)
    : originalText.length;

  const before = originalText.slice(0, startIdx).trimEnd();
  const after = originalText.slice(endIdx).trimStart();

  const parts = [before, newContent.trim(), after].filter((p) => p.length > 0);
  return parts.join('\n\n');
}
