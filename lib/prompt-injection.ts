import type { ExamCorrectionResult } from './gemini';
import { extractDocumentText } from './document-validation';
import { calculateSwissGrade } from './grading';

/**
 * Kategorie der erkannten Manipulation oder Prompt-Injection.
 */
export type PromptInjectionCategory =
  | 'FULL_POINTS_OVERRIDE'
  | 'RUBRIC_OVERRIDE'
  | 'OUT_OF_SCOPE'
  | 'ROLEPLAY_OR_JAILBREAK'
  | 'FEEDBACK_POISONING';

export interface InjectionDetectionResult {
  isInjection: boolean;
  category: PromptInjectionCategory;
  matchedPattern: string;
  reason: string;
}

/**
 * Erkennungsmuster fuer Prompt-Injections und boeswillige Steuerungsbefehle.
 * Alle Bezeichnungen und Beschreibungen folgen strikt dem Schweizer Hochdeutsch (immer "ss", kein Eszett).
 */
const INJECTION_RULES: {
  category: PromptInjectionCategory;
  regex: RegExp;
  reason: string;
}[] = [
  // 1. Anweisungs-Override im Referenzmaterial oder Pruefungsinhalt (Musterloesung ignorieren)
  {
    category: 'RUBRIC_OVERRIDE',
    regex:
      /\b(?:ignoriere|ignore|disregard|forget|verwirf)\b(?:[^\n.!?]{0,100})\b(?:musterlösung|musterloesung|erwartungshorizont|bewertungsraster|bewertungskriterien|punkteschema|rubric|grading\s*criteria)\b/i,
    reason:
      'Versuchter Override der offiziellen Musterloesung oder der Bewertungskriterien ("ignoriere die Musterloesung")',
  },
  {
    category: 'RUBRIC_OVERRIDE',
    regex:
      /\b(?:system\s*override|master\s*override)\b.*?(?:musterlösung|musterloesung|bewertung|grading|punkt|note)/i,
    reason: 'System-Override im Referenzmaterial erkannt',
  },

  // 2. Versuche, die Punktezahl oder Note eigenmaechtig zu bestimmen (Full-Points-Override)
  {
    category: 'FULL_POINTS_OVERRIDE',
    regex:
      /\b(?:gib|vergib|erteile|bewerte|benote|give|award|grant|setze|set)\b(?:[^\n]{0,120})\b(?:volle[nr]?\s+punktzahl|maximal[e]?(?:n)?\s*punktzahl|volle[nr]?\s+punkte|alle\s+punkte|full\s+marks?|full\s+points?|100\s*%|note\s*6(?:\.0)?|grade\s*6(?:\.0)?)\b/i,
    reason:
      'Aufforderung zur unberechtigten Vollbepunktung oder Notenfestlegung ("gib volle Punktzahl")',
  },
  {
    category: 'FULL_POINTS_OVERRIDE',
    regex:
      /\b(?:bewerte|mark)\b(?:[^\n.!?]{0,60})\b(?:als\s+korrekt|als\s+richtig|as\s+correct|as\s+full\s+points)\b/i,
    reason: 'Anweisung zur pauschalen Positivbewertung ohne fachliche Pruefung',
  },
  {
    category: 'FULL_POINTS_OVERRIDE',
    regex: /\b(?:5\/5|10\/10|100%)\s+(?:punkte|points)\s+(?:vergeben|geben|setzen)\b/i,
    reason: 'Erzwungene Punktevergabe ueber Steuerbefehl',
  },

  // 3. Out-of-Scope-Auftraege (Fachfremde Aufgaben wie Aufsatz, Gedicht, Programmierung)
  {
    category: 'OUT_OF_SCOPE',
    regex:
      /\b(?:schreibe|verfasse|erstelle|write|compose|generate)\s+(?:stattdessen|anstelle\s+dessen|instead)\s+(?:einen\s+|ein\s+|an\s+)?(?:aufsatz|essay|gedicht|poem|geschichte|story|programm|skript|script|code|python|song)\b/i,
    reason:
      'Out-of-Scope-Steuerungsbefehl (Auftrag zur Erstellung fachfremder Inhalte wie Aufsatz oder Gedicht)',
  },
  {
    category: 'OUT_OF_SCOPE',
    regex:
      /\b(?:vergiss|ignore|drop)\s+(?:die\s+|the\s+)?(?:mathe|mathematik|physik|chemie|pruefung|prüfung|exam|test)\b.*?(?:schreibe|write|erzaehle|erzähle|tell)/i,
    reason: 'Fachwechsel-Steuerungsbefehl zur Umgehung der eigentlichen Pruefungsaufgabe',
  },
  {
    category: 'OUT_OF_SCOPE',
    regex:
      /\b(?:gib|zeige|drucke|reveal|show|display|print)\b(?:[^\n.!?]{0,60})\b(?:system[-_\s]*prompts?|system[-_\s]*anweisungen|system[-_\s]*instruktionen|hidden\s*instructions?)\b/i,
    reason: 'Versuchte Exfiltration interner Systemanweisungen oder des System-Prompts',
  },

  // 4. Roleplay- / Jailbreak- / Prompt-Reset-Versuche
  {
    category: 'ROLEPLAY_OR_JAILBREAK',
    regex:
      /\b(?:ignoriere|vergiss|missachte|disregard|ignore)\b(?:[^\n.!?]{0,60})\b(?:anweisungen|instruktionen|regeln|system[-_\s]*prompts?|vorgaben|instructions?|rules?)\b/i,
    reason: 'Versuchter Instruction-Override oder Prompt-Reset ("ignoriere alle Anweisungen")',
  },
  {
    category: 'ROLEPLAY_OR_JAILBREAK',
    regex:
      /\b(?:du\s+bist\s+jetzt|you\s+are\s+now|act\s+as|pretend\s+you\s+are|ab\s+jetzt\s+gilt)\b.*?(?:keine\s+lehrperson|not\s+a\s+teacher|dan\s+mode|jailbreak|unrestricted)/i,
    reason: 'Versuchter Persona- oder Rollenspiel-Override zur Schrankenumgehung',
  },

  // 5. Manipulation des Feedback-Textes / Link-Smuggling
  {
    category: 'FEEDBACK_POISONING',
    regex:
      /\b(?:schreibe|sage|sag|tell|instruct)\s+(?:dem\s+schüler|der\s+schülerin|dem\s+studenten|to\s+the\s+student)\b.*?(?:klick|öffne|open|visit|gehe\s+auf|download|install)\b/i,
    reason: 'Versuchter Missbrauch des Schueler-Feedbacks fuer externe Handlungsanweisungen',
  },
];

/**
 * Prueft einen Text auf bekannte Prompt-Injection- und Steuerungsbefehl-Muster.
 */
export function detectPromptInjection(
  text: string | null | undefined
): InjectionDetectionResult | null {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (trimmed.length < 5) return null;

  for (const rule of INJECTION_RULES) {
    const match = trimmed.match(rule.regex);
    if (match) {
      return {
        isInjection: true,
        category: rule.category,
        matchedPattern: match[0],
        reason: rule.reason,
      };
    }
  }

  return null;
}

/**
 * Prueft einen Text auf eingeschmuggelte URLs, Hyperlinks, Markdown-Links oder HTML-Tags.
 */
export function detectLinkSmuggling(text: string | null | undefined): {
  hasLinks: boolean;
  links: string[];
} {
  if (!text || typeof text !== 'string') return { hasLinks: false, links: [] };

  const links: string[] = [];

  // URLs (http, https, ftp, www)
  const urlMatches = text.match(/\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')]+/gi);
  if (urlMatches) {
    links.push(...urlMatches);
  }

  // Markdown links: [anchor](url)
  const mdMatches = text.match(/\[([^\]]+)\]\(([^)]+)\)/g);
  if (mdMatches) {
    links.push(...mdMatches);
  }

  // HTML tags wie <script>, <a>, <iframe>, <img ...>
  const htmlMatches = text.match(/<\s*(?:script|iframe|object|embed|a|img|link|form)[^>]*>/gi);
  if (htmlMatches) {
    links.push(...htmlMatches);
  }

  // JavaScript URIs
  const jsUriMatches = text.match(/javascript\s*:\s*[^\s"'>]+/gi);
  if (jsUriMatches) {
    links.push(...jsUriMatches);
  }

  return {
    hasLinks: links.length > 0,
    links,
  };
}

/**
 * Bereinigt Textfelder im Schueler-Feedback von gefaehrlichen Hyperlinks, HTML/Script-Tags
 * und bösartigen Steuerungsanweisungen.
 */
export function sanitizeFeedbackText(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';

  const sanitized = text
    // Entferne Script-Tags und gefaehrliche HTML-Tags
    .replace(/<\s*script[^>]*>[\s\S]*?<\s*\/\s*script\s*>/gi, '')
    .replace(
      /<\s*(?:iframe|object|embed|applet|form)[^>]*>[\s\S]*?<\s*\/\s*(?:iframe|object|embed|applet|form)\s*>/gi,
      ''
    )
    .replace(/<\s*a[^>]*>(.*?)<\s*\/\s*a\s*>/gi, '$1')
    .replace(/<\s*[^>]+>/g, '')
    // Neutralisiere URLs
    .replace(/\b(?:https?:\/\/|ftp:\/\/|www\.)[^\s<>"')]+/gi, '[Link entfernt]')
    // Neutralisiere Markdown-Links [label](url) -> label
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    // Neutralisiere javascript: URIs
    .replace(/javascript\s*:[^\s"'>]+/gi, '')
    .trim();

  // Pruefe, ob der Feedback-Text selbst ein eingeschleuster Steuerungsbefehl war
  const detected = detectPromptInjection(sanitized);
  if (detected) {
    return 'Achte bei der Bearbeitung auf sachliche und vollstaendige Rechen- und Loesungsschritte gemaess Aufgabenstellung.';
  }

  return sanitized;
}

/**
 * Tiefen-Sanitization fuer das gesamte schuelerFeedback-Objekt.
 */
export function sanitizeStudentFeedback(
  feedback: ExamCorrectionResult['schuelerFeedback'] | null | undefined
): ExamCorrectionResult['schuelerFeedback'] {
  const fallback = {
    staerken: [],
    schwaechen: ['Keine Bearbeitung erkennbar'],
    hilfreicherTipp: 'Bearbeite die Aufgabenstellungen selbstaendig und nachvollziehbar.',
    uebungsEmpfehlung: 'Grundlegende Aufgaben zum Thema ueben.',
  };

  if (!feedback || typeof feedback !== 'object') {
    return fallback;
  }

  const cleanStaerken = Array.isArray(feedback.staerken)
    ? feedback.staerken
        .map((s) => sanitizeFeedbackText(String(s || '')))
        .filter((s) => s.length > 0 && !s.includes('[Link entfernt]'))
    : [];

  const cleanSchwaechen = Array.isArray(feedback.schwaechen)
    ? feedback.schwaechen
        .map((s) => sanitizeFeedbackText(String(s || '')))
        .filter((s) => s.length > 0 && !s.includes('[Link entfernt]'))
    : [];

  const cleanTipp = sanitizeFeedbackText(feedback.hilfreicherTipp) || fallback.hilfreicherTipp;
  const cleanUebung =
    sanitizeFeedbackText(feedback.uebungsEmpfehlung) || fallback.uebungsEmpfehlung;

  return {
    staerken:
      cleanStaerken.length > 0 ? cleanStaerken : ['Gute Ansätze bei der Aufgabenbearbeitung'],
    schwaechen:
      cleanSchwaechen.length > 0
        ? cleanSchwaechen
        : ['Achte auf eine lückenlose Dokumentation aller Loesungsschritte'],
    hilfreicherTipp: cleanTipp,
    uebungsEmpfehlung: cleanUebung,
  };
}

export interface SecurityAuditInputs {
  studentText?: string;
  rubricText?: unknown;
  examTemplateText?: unknown;
  gradingNotes?: string;
}

const INJECTION_HEADER_REGEX =
  /\b(?:HINWEIS\s+AN\s+DAS\s+BEWERTUNGSSYSTEM|ANWEISUNG\s+AN\s+DIE\s+KI|SYSTEM\s*OVERRIDE|MASTER\s*OVERRIDE|ADMIN\s*OVERRIDE|PROMPT\s*INJECTION)\b[:\s-]*/gi;

const INJECTION_UNSICHERHEIT_REGEX =
  /\b(?:manipulationsversuch|manipulationsbefehl|steuerungsanweisung|steuerungsbefehl|prompt[-_\s]*injection|hinweis\s+an\s+das\s+bewertungssystem|system\s*override|master\s*override)\b/i;

const INJECTION_LINE_START_REGEX =
  /^[\s,-]*(?:hinweis\s+an\s+das\s+bewertungssystem|anweisung\s+an\s+die\s+ki|system\s*override|master\s*override|admin\s*override|prompt\s*injection|ignoriere|vergiss|missachte|disregard|ignore|forget|drop|gib|vergib|erteile|bewerte|benote|setze|give|award|grant|set|mark|schreibe\s+stattdessen|verfasse\s+stattdessen|erstelle\s+stattdessen|write\s+instead|compose\s+instead|du\s+bist\s+jetzt|you\s+are\s+now|act\s+as|pretend\s+you\s+are)\b/i;

/**
 * Entfernt erkannte Prompt-Injection-Passagen und Steuerungs-Header aus einem Text,
 * laesst aber echte fachliche Loesungsinhalte (z. B. Gleichungen, Rechenschritte, Antwortsaetze)
 * vollstaendig erhalten.
 */
export function stripInjectionSegments(text: string | null | undefined): string {
  if (!text || typeof text !== 'string') return '';

  const lines = text.split(/\r?\n/);
  const keptLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;

    // Wenn eine Zeile bereits mit einem Steuerungs-Header oder Manipulationsbefehl beginnt und als Injection erkannt wird,
    // ist die gesamte Zeile ein Angriffsvektor und wird vollstaendig verworfen.
    if (
      INJECTION_LINE_START_REGEX.test(line) &&
      (detectPromptInjection(line) || INJECTION_HEADER_REGEX.test(line))
    ) {
      INJECTION_HEADER_REGEX.lastIndex = 0;
      continue;
    }
    INJECTION_HEADER_REGEX.lastIndex = 0;

    // Zerlege Zeilen, in denen ein Injection-Header, ein Satzwechsel oder ein angehaengter Steuerungsbefehl vorkommt
    const segments = line
      .split(
        /(?<=[.!?])\s+|\s*(?=\b(?:HINWEIS\s+AN\s+DAS\s+BEWERTUNGSSYSTEM|ANWEISUNG\s+AN\s+DIE\s+KI|SYSTEM\s*OVERRIDE|MASTER\s*OVERRIDE|ADMIN\s*OVERRIDE|Ignoriere\s+alle|Vergiss\s+(?:alle|die\s+Mathe|Mathematik)|Schreibe\s+stattdessen|Gib\s+(?:mir\s+|fuer\s+|für\s+)?(?:sofort\s+)?(?:die\s+)?volle)\b)/i
      )
      .map((seg) => seg.trim())
      .filter(Boolean);

    const keptSegments: string[] = [];
    for (const seg of segments) {
      const cleanedSeg = seg
        .replace(INJECTION_HEADER_REGEX, '')
        .replace(/^[,;:\s-]+|[,;:\s-]+$/g, '')
        .trim();
      INJECTION_HEADER_REGEX.lastIndex = 0;
      if (!cleanedSeg) continue;

      if (detectPromptInjection(cleanedSeg) || INJECTION_LINE_START_REGEX.test(cleanedSeg)) {
        continue;
      }

      keptSegments.push(cleanedSeg);
    }

    if (keptSegments.length > 0) {
      keptLines.push(keptSegments.join(' '));
    }
  }

  return keptLines.join('\n').trim();
}

/**
 * Prueft, ob ein (bereits von Injection-Segmenten bereinigter) Text
 * substantielle fachliche Zeichen (Zahlen, Variablen, Woerter, Terme) enthaelt.
 */
function hasSubstantialSubjectContent(cleanedText: string): boolean {
  const trimmed = cleanedText.trim();
  if (trimmed.length < 2) return false;
  const alnumMatches = trimmed.match(/[A-Za-z0-9\u00C0-\u017F]/g);
  return Boolean(alnumMatches && alnumMatches.length >= 2);
}

/**
 * Extrahiert durchsuchbaren Klartext aus Referenzmaterial (Rubric-Text, Musterloesungs-Datei
 * als `{ mimeType, data }`, Array von Teilen oder JSON-serialisierter String),
 * damit eingebettete Prompt-Injections sowohl im Rubric-Text als auch in Musterloesungs-Dateien
 * zuverlaessig erkannt werden.
 */
export function extractReferenceMaterialText(material: unknown): string {
  if (!material) return '';

  if (typeof material === 'string') {
    const trimmed = material.trim();
    if (!trimmed) return '';
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        const extractedFromJson = extractReferenceMaterialText(parsed);
        if (extractedFromJson) {
          return `${trimmed}\n${extractedFromJson}`;
        }
      } catch {
        // Kein valides JSON, als normalen String behandeln
      }
    }
    return trimmed;
  }

  if (Array.isArray(material)) {
    return material
      .map((item) => extractReferenceMaterialText(item))
      .filter(Boolean)
      .join('\n');
  }

  if (typeof material === 'object') {
    const obj = material as Record<string, unknown>;
    const parts: string[] = [];

    if (typeof obj.data === 'string' && obj.data.length > 0) {
      try {
        const buf = Buffer.from(obj.data, 'base64');
        const docText = extractDocumentText(buf);
        if (docText) {
          parts.push(docText);
        }
        // Fallback fuer eingebettete ASCII/UTF-8-Segmente in Binaerdaten (z. B. PDF/PNG-Metadaten)
        const rawLatin1 = buf.toString('latin1');
        const asciiRuns = rawLatin1.match(/[A-Za-z0-9ÄÖÜäöü.,:;!?()[\]/+-=\s]{8,}/g);
        if (asciiRuns && asciiRuns.length > 0) {
          parts.push(asciiRuns.join(' '));
        }
      } catch {
        // Ignoriere ungueltige Base64-Daten
      }
    }

    for (const [key, value] of Object.entries(obj)) {
      if (key === 'data' || key === 'mimeType') continue;
      if (typeof value === 'string' && value.trim()) {
        parts.push(value.trim());
      } else if (value && typeof value === 'object') {
        const nested = extractReferenceMaterialText(value);
        if (nested) parts.push(nested);
      }
    }

    return parts.join('\n');
  }

  return '';
}

/**
 * Bereinigt extrahierte Aufgaben aus `/api/exams/parse-rubric`, falls in einer
 * Musterloesungs-Datei oder einem Rubric-Text eine Prompt-Injection eingebettet wurde.
 * Reine Manipulations-Scheinaufgaben werden entfernt; angehaengte Injektionen im Titel
 * werden abgestreift.
 */
export function sanitizeParsedRubricTasks<
  T extends { taskId: string; title: string; maxPoints: number },
>(tasks: T[]): T[] {
  if (!Array.isArray(tasks)) return [];

  const sanitized: T[] = [];
  for (const task of tasks) {
    if (!task || typeof task !== 'object') continue;
    const rawTitle = String(task.title || '').trim();
    const rawTaskId = String(task.taskId || '').trim();

    const titleInjection = detectPromptInjection(rawTitle);
    const idInjection = detectPromptInjection(rawTaskId);

    if (titleInjection || idInjection) {
      const cleanedTitle = stripInjectionSegments(rawTitle);
      const cleanedId = stripInjectionSegments(rawTaskId);
      if (!hasSubstantialSubjectContent(cleanedTitle) || !cleanedId) {
        // Reine Scheinaufgabe aus einer Prompt-Injection -> verwerfen
        continue;
      }
      sanitized.push({
        ...task,
        taskId: cleanedId,
        title: cleanedTitle,
      });
    } else {
      sanitized.push(task);
    }
  }

  return sanitized;
}

/**
 * Prae- und Post-Processing-Sicherheitswaechter fuer ExamCorrectionResult.
 *
 * Explizite Verhaltensentscheidung (Issues #58 & #66):
 * 1. Angriff ignorieren + melden: Jede erkannte Manipulation im Schueler-Scan oder Referenzmaterial
 *    wird der Lehrperson sichtbar ueber `[SICHERHEITSHINWEIS: ...]` in `lehrerKommentar` gemeldet.
 * 2. Reale Loesung trotzdem inhaltlich korrekt benoten: Wenn neben einer Prompt-Injection eine echte
 *    fachliche Loesung vorliegt, behalten alle realen Teilschritte ihre regulär verdienten Punkte.
 *    Nur reine Manipulations-Aufgaben ohne fachliche Loesung oder reine Injektions-Schritte erhalten 0 Punkte.
 * 3. Unsicherheit nur dort, wo die Loesung selbst unklar ist: Echte, lesbare und fachlich eindeutige
 *    Loesungsschritte werden wegen einer danebenstehenden Prompt-Injection NICHT kuenstlich auf
 *    `istUnsicher = true` gesetzt. `istUnsicher = true` bleibt ausschliesslich echten Unklarheiten
 *    der Schuelerloesung (z. B. unleserliche Handschrift `[?]`) oder reinen Manipulations-Eintraegen
 *    ohne Fachloesung vorbehalten.
 * 4. Schueler-Feedback wird von Links, Scripts und boesartigen Anweisungen bereinigt.
 * 5. Ausgabe bleibt 100% schema-konform.
 */
export function auditAndEnforceCorrectionSecurity(
  result: ExamCorrectionResult,
  inputs?: SecurityAuditInputs
): ExamCorrectionResult {
  if (!result || !Array.isArray(result.aufgaben)) {
    return result;
  }

  // 1. Schueler-Feedback grundsaetzlich tiefenreinigen (Schutz vor Link-Smuggling und XSS)
  result.schuelerFeedback = sanitizeStudentFeedback(result.schuelerFeedback);

  // 2. Pruefe Referenzmaterial-Inputs (Tier 2/3: Musterloesungs-Datei, Rubric-Text, Korrekturhinweise) auf versuchte Overrides
  const extractedRubricText = extractReferenceMaterialText(inputs?.rubricText);
  const extractedTemplateText = extractReferenceMaterialText(inputs?.examTemplateText);
  const rubricInjection =
    detectPromptInjection(extractedRubricText) ||
    detectPromptInjection(extractedTemplateText) ||
    detectPromptInjection(inputs?.gradingNotes);

  let detectedAnyManipulation = false;

  // 3. Jede Aufgabe auditieren
  for (const task of result.aufgaben) {
    const studentAnswer = task.schuelerAntwort || '';
    const taskInjection = detectPromptInjection(studentAnswer);
    const linkCheck = detectLinkSmuggling(studentAnswer);

    // Pruefe auch, ob in einem einzelnen Schritt-Text eine Injection steckt, selbst wenn schuelerAntwort gekuerzt wurde
    const stepLevelInjection = Array.isArray(task.schritte)
      ? task.schritte
          .map((s) => detectPromptInjection(s.schrittText))
          .find((det) => det !== null) || null
      : null;

    const effectiveTaskInjection = taskInjection || stepLevelInjection;
    const hasInjection = Boolean(effectiveTaskInjection || rubricInjection);

    if (hasInjection) {
      detectedAnyManipulation = true;
      const detectedReason =
        effectiveTaskInjection?.reason || rubricInjection?.reason || 'Prompt-Injection';

      // Pruefe, ob neben dem Manipulationsversuch ein echter fachlicher Loesungsinhalt existiert
      const cleanedStudentAnswer = stripInjectionSegments(studentAnswer);
      const isNoAnswerPlaceholder =
        /^(?:keine\s+antwort(?:\s+vorhanden)?|nicht\s+bearbeitet|leer|-+)$/i.test(
          cleanedStudentAnswer.trim()
        );
      const hasSubstantialAnswerText =
        !isNoAnswerPlaceholder && hasSubstantialSubjectContent(cleanedStudentAnswer);

      // Pruefe, ob mindestens ein Teilschritt echten fachlichen Loesungsinhalt besitzt
      const hasValidSubjectSteps =
        Array.isArray(task.schritte) &&
        task.schritte.some((s) => {
          const cleanedStep = stripInjectionSegments(s.schrittText);
          const isStepNoAnswer =
            /^(?:keine\s+antwort(?:\s+vorhanden)?|nicht\s+bearbeitet|leer|-+)$/i.test(
              cleanedStep.trim()
            );
          return !isStepNoAnswer && hasSubstantialSubjectContent(cleanedStep);
        });

      const hasGenuineSolutionContent =
        effectiveTaskInjection !== null
          ? hasSubstantialAnswerText && hasValidSubjectSteps
          : hasSubstantialAnswerText || hasValidSubjectSteps;

      // Sicherheitsvermerk fuer die Lehrperson (steuert Badge "Manipulation erkannt" und roten Hinweis-Banner)
      const locationLabel =
        rubricInjection && !effectiveTaskInjection ? 'im Referenzmaterial' : 'im Pruefungsinhalt';
      const securityDetail = hasGenuineSolutionContent
        ? 'Die unzulaessige Anweisung wurde ignoriert und die reale Fachloesung wurde inhaltlich bewertet.'
        : 'Die unzulaessige Anweisung wurde ignoriert und die Bewertung erfolgte strikt regelkonform.';
      const securityPrefix = `[SICHERHEITSHINWEIS: Manipulationsversuch ${locationLabel} erkannt (${detectedReason}). ${securityDetail}]`;

      if (!task.lehrerKommentar || !task.lehrerKommentar.includes('[SICHERHEITSHINWEIS:')) {
        task.lehrerKommentar = task.lehrerKommentar
          ? `${securityPrefix} ${task.lehrerKommentar}`
          : securityPrefix;
      }

      const isPureInjection = !hasGenuineSolutionContent;

      if (isPureInjection) {
        task.erzieltePunkte = 0;
        task.status = 'Fehler';

        if (Array.isArray(task.schritte) && task.schritte.length > 0) {
          for (const step of task.schritte) {
            step.erreichtePunkte = 0;
            step.istKorrekt = false;
            step.fehlerTyp = 'SonstigerFehler';
            step.istUnsicher = true;
            step.unsicherheitsGrund = `Manipulationsversuch erkannt (${locationLabel}): ${detectedReason}. Vorlaeufig 0 Punkte vergeben.`;
          }
        }
      } else {
        // Robustheitsverhalten (Issue #66):
        // Reale Fachloesung neben Angriffsvektor (oder bei Injection im Referenzmaterial) vorhanden.
        // 1. Angriff ignorieren + melden (ueber [SICHERHEITSHINWEIS: ...] in lehrerKommentar).
        // 2. Reale Loesung inhaltlich korrekt benoten: Echte Teilschritte behalten ihre verdienten Punkte.
        //    Falls ein Teilschritt nur aus dem Injection-Text besteht, erhaelt dieser Schritt 0 Punkte.
        //    Falls der Injection-Text an einen echten Rechenschritt angehaengt wurde, wird der Schritttext bereinigt.
        // 3. Unsicherheit nur dort, wo die Loesung selbst unklar ist: Keine kuenstliche Unsicherheits-Markierung
        //    auf klaren Fachschritten wegen des bereits gemeldeten Manipulationsversuchs.
        if (Array.isArray(task.schritte) && task.schritte.length > 0) {
          for (const step of task.schritte) {
            const stepTextInjection = detectPromptInjection(step.schrittText);
            if (stepTextInjection) {
              const cleanedStepText = stripInjectionSegments(step.schrittText);
              if (hasSubstantialSubjectContent(cleanedStepText)) {
                // Echter Rechenschritt mit angehaengtem Injection-Text -> Injection-Text abstreifen, Punkte behalten
                step.schrittText = cleanedStepText;
              } else {
                // Reiner Manipulationsschritt ohne Fachinhalt -> 0 Punkte, aber kein Gate auf der Gesamtaufgabe erzwingen
                step.erreichtePunkte = 0;
                step.istKorrekt = false;
                step.fehlerTyp = 'SonstigerFehler';
                step.istUnsicher = false;
                step.unsicherheitsGrund = '';
                continue;
              }
            }

            // Wenn im Referenzmaterial eine Injection vorlag und ein inkorrekter/leerer Schritt trotzdem Punkte erhielt, nullen
            if (
              rubricInjection &&
              !step.istKorrekt &&
              step.fehlerTyp !== 'KeinFehler' &&
              step.fehlerTyp !== 'Folgefehler' &&
              Number(step.erreichtePunkte) > 0
            ) {
              step.erreichtePunkte = 0;
            }

            // Falls das Modell selbst einen klaren Rechenschritt nur wegen des Manipulationsversuchs auf istUnsicher gesetzt hat,
            // bereinigen wir dieses Flag, damit Unsicherheit nur bei echter inhaltlicher/handschriftlicher Unklarheit aktiv ist.
            if (
              step.istUnsicher &&
              step.unsicherheitsGrund &&
              INJECTION_UNSICHERHEIT_REGEX.test(step.unsicherheitsGrund)
            ) {
              step.istUnsicher = false;
              step.unsicherheitsGrund = '';
            }
          }

          // Punkte der echten Teilschritte neu aufsummieren
          task.erzieltePunkte =
            Math.round(
              task.schritte.reduce((sum, s) => sum + (Number(s.erreichtePunkte) || 0), 0) * 10
            ) / 10;

          if (task.erzieltePunkte === 0) {
            task.status = 'Fehler';
          } else if (
            task.erzieltePunkte >= task.maximalPunkte &&
            task.maximalPunkte > 0 &&
            task.schritte.every((s) => !s.istKorrekt || s.fehlerTyp === 'KeinFehler')
          ) {
            task.status = 'Korrekt';
          } else if (task.schritte.some((s) => s.fehlerTyp === 'Folgefehler')) {
            task.status = 'Folgefehler';
          }
        }
      }
    }

    // Wenn Hyperlinks oder HTML in der Schuelerantwort vorkommen, sicherstellen dass sie im Transkript unschaedlich sind
    if (linkCheck.hasLinks) {
      if (!task.lehrerKommentar.includes('[SICHERHEITSHINWEIS:')) {
        task.lehrerKommentar =
          `[SICHERHEITSHINWEIS: Verdaechtige Hyperlinks oder Code-Fragmente in der Schuelerantwort erkannt.] ${task.lehrerKommentar}`.trim();
      }
    }
  }

  // 4. Punkte neu summieren und Note nach offizieller Formel neuberechnen
  const recalculatedEarned =
    Math.round(result.aufgaben.reduce((sum, t) => sum + (Number(t.erzieltePunkte) || 0), 0) * 10) /
    10;
  result.gesamterzieltePunkte = recalculatedEarned;

  const maxPoints = Math.max(
    Number(result.gesamtmaximalPunkte || 0),
    result.aufgaben.reduce((sum, t) => sum + (Number(t.maximalPunkte) || 0), 0)
  );
  result.gesamtmaximalPunkte = maxPoints;

  result.note = calculateSwissGrade(
    result.gesamterzieltePunkte,
    result.gesamtmaximalPunkte,
    result.gradingFormula || 'LINEAR_60',
    result.gradeRounding || '0.1'
  );

  // 5. Bei erkannten Manipulationen zusaetzlich Feedback absichern
  if (detectedAnyManipulation && result.gesamterzieltePunkte === 0) {
    result.schuelerFeedback.schwaechen = [
      'Keine fachliche Bearbeitung der Aufgabenstellung; stattdessen unzulaessige Steuerungsanweisungen eingereicht.',
    ];
    result.schuelerFeedback.hilfreicherTipp =
      'Konzentriere dich auf die fachliche Aufgabenstellung und formuliere eigenstaendige mathematische Loesungswege.';
  }

  return result;
}
