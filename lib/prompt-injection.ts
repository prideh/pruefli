import type { ExamCorrectionResult } from './gemini';
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
  // 1. Versuche, die Punktezahl oder Note eigenmaechtig zu bestimmen (Full-Points-Override)
  {
    category: 'FULL_POINTS_OVERRIDE',
    regex:
      /\b(?:gib|vergib|give|award|setze|set)\b(?:[^\n.!?]{0,50})\b(?:volle\s+punktzahl|maximalpunktzahl|alle\s+punkte|full\s+marks?|full\s+points?|100\s*%|note\s*6(?:\.0)?|grade\s*6(?:\.0)?)\b/i,
    reason:
      'Aufforderung zur unberechtigten Vollbepunktung oder Notenfestlegung ("gib volle Punktzahl")',
  },
  {
    category: 'FULL_POINTS_OVERRIDE',
    regex:
      /\b(?:bewerte|mark)\b(?:[^\n.!?]{0,40})\b(?:als\s+korrekt|als\s+richtig|as\s+correct|as\s+full\s+points)\b/i,
    reason: 'Anweisung zur pauschalen Positivbewertung ohne fachliche Pruefung',
  },
  {
    category: 'FULL_POINTS_OVERRIDE',
    regex: /\b(?:5\/5|10\/10|100%)\s+(?:punkte|points)\s+(?:vergeben|geben|setzen)\b/i,
    reason: 'Erzwungene Punktevergabe ueber Steuerbefehl',
  },

  // 2. Anweisungs-Override im Referenzmaterial oder Pruefungsinhalt (Musterloesung ignorieren)
  {
    category: 'RUBRIC_OVERRIDE',
    regex:
      /\b(?:ignoriere|ignore|disregard|forget|verwirf)\b(?:[^\n.!?]{0,40})\b(?:musterlösung|musterloesung|erwartungshorizont|rubric|grading\s*criteria)\b/i,
    reason:
      'Versuchter Override der offiziellen Musterloesung oder der Bewertungskriterien ("ignoriere die Musterloesung")',
  },
  {
    category: 'RUBRIC_OVERRIDE',
    regex:
      /\b(?:system\s*override|master\s*override)\b.*?(?:musterlösung|musterloesung|bewertung|grading|punkt)/i,
    reason: 'System-Override im Referenzmaterial erkannt',
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
      /\b(?:gib|zeige|drucke|reveal|show|display|print)\b(?:[^\n.!?]{0,40})\b(?:system[-_\s]*prompts?|system[-_\s]*anweisungen|system[-_\s]*instruktionen|hidden\s*instructions?)\b/i,
    reason: 'Versuchte Exfiltration interner Systemanweisungen oder des System-Prompts',
  },

  // 4. Roleplay- / Jailbreak- / Prompt-Reset-Versuche
  {
    category: 'ROLEPLAY_OR_JAILBREAK',
    regex:
      /\b(?:ignoriere|vergiss|missachte|disregard|ignore)\b(?:[^\n.!?]{0,40})\b(?:anweisungen|instruktionen|regeln|system[-_\s]*prompts?|vorgaben|instructions?|rules?)\b/i,
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
  rubricText?: string;
  gradingNotes?: string;
}

/**
 * Prae- und Post-Processing-Sicherheitswaechter fuer ExamCorrectionResult.
 *
 * Garantiert alle Akzeptanzkriterien aus Issue #58:
 * 1. Anweisung wird ignoriert.
 * 2. Bewertung bleibt regelkonform (Manipulationsbefehle erhalten keine unberechtigten Punkte).
 * 3. Manipulationsversuche werden der Lehrperson sichtbar gemeldet (lehrerKommentar, schritte.istUnsicher, unsicherheitsGrund).
 * 4. Schueler-Feedback wird von Links, Scripts und bösartigen Anweisungen bereinigt.
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

  // 2. Pruefe Referenzmaterial-Inputs (Tier 2/3) auf versuchte Overrides
  const rubricInjection =
    detectPromptInjection(inputs?.rubricText) || detectPromptInjection(inputs?.gradingNotes);

  let detectedAnyManipulation = false;

  // 3. Jede Aufgabe auditieren
  for (const task of result.aufgaben) {
    const studentAnswer = task.schuelerAntwort || '';
    const taskInjection = detectPromptInjection(studentAnswer);
    const linkCheck = detectLinkSmuggling(studentAnswer);

    const hasInjection = Boolean(taskInjection || rubricInjection);
    if (hasInjection) {
      detectedAnyManipulation = true;
      const detectedReason = taskInjection?.reason || rubricInjection?.reason || 'Prompt-Injection';

      // Pruefe, ob neben dem Manipulationsversuch ein echter fachlicher Loesungsinhalt existiert
      let hasGenuineSolutionContent = false;
      if (taskInjection !== null) {
        // Bereinige den Antworttext um erkannte Injektionsmuster
        const textWithoutInjection = studentAnswer
          .replace(
            new RegExp(taskInjection.matchedPattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
            ''
          )
          .replace(/HINWEIS\s+AN\s+DAS\s+BEWERTUNGSSYSTEM[:\s]*/gi, '')
          .replace(/SYSTEM\s*OVERRIDE[:\s]*/gi, '')
          .trim();

        // Hat der Schueler ausserhalb des Steuerungsbefehls substantielle fachliche Angaben gemacht?
        const hasSubstantialText =
          textWithoutInjection.length >= 5 && /\w{2,}/.test(textWithoutInjection);

        // Pruefe, ob die vom Modell erkannten Teilschritte fachliche Rechenschritte und keine Injektionen sind
        const hasValidSteps =
          Array.isArray(task.schritte) &&
          task.schritte.some(
            (s) =>
              !detectPromptInjection(s.schrittText) &&
              !detectPromptInjection(s.begruendung) &&
              (Number(s.erreichtePunkte) > 0 || s.istKorrekt)
          );

        // Out-of-Scope und reine Rollenspiele gelten nie als fachliche Loesung
        if (
          taskInjection.category !== 'OUT_OF_SCOPE' &&
          taskInjection.category !== 'ROLEPLAY_OR_JAILBREAK' &&
          hasSubstantialText &&
          hasValidSteps
        ) {
          hasGenuineSolutionContent = true;
        }
      }

      // Sicherheitsvermerk fuer die Lehrperson
      const locationLabel =
        rubricInjection && !taskInjection ? 'im Referenzmaterial' : 'im Pruefungsinhalt';
      const securityDetail = hasGenuineSolutionContent
        ? 'Die unzulaessige Anweisung wurde ignoriert und die reale Fachloesung wurde inhaltlich bewertet. Bitte manuell pruefen.'
        : 'Die unzulaessige Anweisung wurde ignoriert und die Bewertung erfolgte strikt regelkonform.';
      const securityPrefix = `[SICHERHEITSHINWEIS: Manipulationsversuch ${locationLabel} erkannt (${detectedReason}). ${securityDetail}]`;

      if (!task.lehrerKommentar || !task.lehrerKommentar.includes('[SICHERHEITSHINWEIS:')) {
        task.lehrerKommentar = task.lehrerKommentar
          ? `${securityPrefix} ${task.lehrerKommentar}`
          : securityPrefix;
      }

      const isPureInjection = taskInjection !== null && !hasGenuineSolutionContent;

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
        // Robustheitsverhalten (Issue #66): Reale Fachloesung neben Angriffsvektor oder im Referenzmaterial vorhanden.
        // 1. Teilschritte, die selbst den Injektionstext enthalten, werden auf 0 Punkte gesetzt.
        // 2. Teilschritte mit echten fachlichen Loesungen behalten ihre verdienten Punkte (keine pauschale Nullung).
        // 3. Erstschritt wird als unsicher markiert, damit die Lehrperson die Pruefung im Workspace bestaetigen muss.
        if (Array.isArray(task.schritte) && task.schritte.length > 0) {
          for (const step of task.schritte) {
            const stepInjection =
              detectPromptInjection(step.schrittText) || detectPromptInjection(step.begruendung);
            if (stepInjection) {
              step.erreichtePunkte = 0;
              step.istKorrekt = false;
              step.fehlerTyp = 'SonstigerFehler';
              step.istUnsicher = true;
              step.unsicherheitsGrund = `Manipulationsbefehl im Teilschritt (${stepInjection.reason}). 0 Punkte.`;
            }
          }

          // Erstschritt fuer das Lehrer-Bestaetigungs-Gate markieren
          const firstStep = task.schritte[0];
          firstStep.istUnsicher = true;
          firstStep.unsicherheitsGrund = `Manipulationsversuch erkannt (${locationLabel}): ${detectedReason}. Bitte Loesung manuell pruefen.`;

          // Punkte der echten Teilschritte neu aufsummieren
          task.erzieltePunkte =
            Math.round(
              task.schritte.reduce((sum, s) => sum + (Number(s.erreichtePunkte) || 0), 0) * 10
            ) / 10;

          if (task.erzieltePunkte === 0) {
            task.status = 'Fehler';
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
