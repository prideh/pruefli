import { NextResponse } from 'next/server';
import { getSession } from '@/lib/session';
import { checkAiRateLimit, createRateLimitResponse } from '@/lib/rate-limit';
import { validateRubricOrTemplatePayload, createPayloadErrorResponse } from '@/lib/payload-limits';
import { validateReferenceUpload } from '@/lib/document-validation';
import { GoogleGenAI, Type, ThinkingLevel, type Schema } from '@google/genai';
import { DEFAULT_GEMINI_MODEL, appendReferenceMaterialToContents } from '@/lib/gemini';
import {
  computeRubricParseHash,
  buildLlmCacheKey,
  getCachedLlmResult,
  setCachedLlmResult,
  LLM_PROMPT_VERSIONS,
} from '@/lib/llm-cache';

const RUBRIC_PARSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  description: 'Liste aller erkannten Prüfungsaufgaben mit ihrer jeweiligen Maximalpunktzahl.',
  items: {
    type: Type.OBJECT,
    properties: {
      taskId: {
        type: Type.STRING,
        description: 'Eindeutige Aufgaben-ID (z. B. "1", "2", "3a").',
      },
      title: {
        type: Type.STRING,
        description:
          'Lesbarer Titel der Aufgabe in Schweizer Hochdeutsch mit "ss" statt Eszett (z. B. "Aufgabe 1: Gleichungen lösen").',
      },
      maxPoints: {
        type: Type.NUMBER,
        description: 'Maximal erreichbare Punktzahl für diese Aufgabe als positive Zahl.',
      },
    },
    required: ['taskId', 'title', 'maxPoints'],
  },
};

export async function POST(request: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ error: 'Nicht autorisiert.' }, { status: 401 });
    }

    // Rate limiting for AI endpoints
    const rateLimit = await checkAiRateLimit({
      identifier: session.userId,
      scope: 'teacher',
      endpoint: 'parse-rubric',
    });
    if (!rateLimit.allowed) {
      return createRateLimitResponse(rateLimit);
    }

    const body = await request.json();
    const { rubricText, bypassCache, overrideDocumentType: explicitOverride, override } = body;
    const overrideDocumentType = explicitOverride === true || override === true;

    if (!rubricText) {
      return NextResponse.json({ error: 'Musterlösung fehlt.' }, { status: 400 });
    }

    // Size limit check for rubric payload
    const validation = validateRubricOrTemplatePayload(rubricText, 'Die Musterlösung');
    if (!validation.valid) {
      return createPayloadErrorResponse(validation);
    }

    // Content and document type check (reject invalid/empty/consent form before cache/LLM)
    const docValidation = await validateReferenceUpload(rubricText, 'Die Musterlösung', {
      overrideDocumentType,
      teacherId: session.userId,
    });
    if (!docValidation.valid) {
      return NextResponse.json(
        {
          error: docValidation.error,
          reason: docValidation.reason,
          canOverride: docValidation.canOverride,
          classification: docValidation.classification,
        },
        { status: docValidation.status || 400 }
      );
    }

    const rubricHash = computeRubricParseHash({
      teacherId: session.userId,
      modelName: DEFAULT_GEMINI_MODEL,
      promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
      rubricText,
    });
    const cacheKey = buildLlmCacheKey(session.userId, 'rubric_parse', rubricHash);

    if (!bypassCache) {
      const cached = await getCachedLlmResult<unknown[]>(cacheKey);
      if (cached) {
        return NextResponse.json({ success: true, tasks: cached.result, cached: true });
      }
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: 'Gemini API-Schlüssel ist auf dem Server nicht konfiguriert.' },
        { status: 500 }
      );
    }

    const ai = new GoogleGenAI({ apiKey });
    const contents: (string | { inlineData: { mimeType: string; data: string } })[] = [];

    // Parse the rubric payload (could be single or multi-page image/pdf in base64 or plain text)
    appendReferenceMaterialToContents(contents, rubricText);

    const PARSE_PROMPT = `
Analysiere die bereitgestellte Musterlösung / den Erwartungshorizont einer Prüfung vollständig von oben nach unten.
Identifiziere jede einzelne Aufgabe (z. B. Aufgabe 1, Aufgabe 2 usw.) und lies die dafür vorgesehene maximale Punktzahl präzise heraus.

Regeln:
1. Achte besonders auf Punktangaben wie "(4 Punkte)", "[5 P.]", "Maximal 3 Pkt." oder Teilpunktesummen.
2. Wenn eine Aufgabe aus Teilaufgaben (z. B. 1a, 1b) besteht, die gemeinsam unter einer Hauptaufgabe stehen, kannst du entweder die Hauptaufgabe mit der Punktesumme erfassen oder – falls die Teilaufgaben klar getrennt bepunktet sind – die Aufgaben so strukturieren, wie sie auf dem Prüfungsblatt nummeriert sind.
3. "maxPoints" muss eine positive Zahl sein (z. B. 4, 2.5, 6). Falls auf dem Dokument überhaupt keine Punkte angegeben sind, vergib einen sinnvollen Standardwert anhand des Umfangs (z. B. 4.0).
4. Verwende im Feld "title" Schweizer Hochdeutsch (immer "ss", niemals "\u00df").
`;

    contents.push(PARSE_PROMPT);

    const response = await ai.models.generateContent({
      model: DEFAULT_GEMINI_MODEL,
      contents: contents,
      config: {
        responseMimeType: 'application/json',
        responseSchema: RUBRIC_PARSE_SCHEMA,
        thinkingConfig: {
          thinkingLevel: ThinkingLevel.LOW,
        },
        temperature: 0.0,
        seed: 42,
      },
    });

    const responseText = (response.text || '').trim();
    const parsedTasks = responseText ? JSON.parse(responseText) : [];

    if (Array.isArray(parsedTasks) && parsedTasks.length > 0) {
      await setCachedLlmResult(cacheKey, {
        result: parsedTasks,
        cachedAt: Date.now(),
        cachedAtIso: new Date().toISOString(),
        model: DEFAULT_GEMINI_MODEL,
        hash: rubricHash,
        callType: 'rubric_parse',
        promptVersion: LLM_PROMPT_VERSIONS.rubricParse,
        teacherId: session.userId,
      });
    }

    return NextResponse.json({ success: true, tasks: parsedTasks, cached: false });
  } catch (error) {
    console.error('Error parsing rubric text:', error);
    return NextResponse.json(
      { error: 'Die Musterlösung konnte nicht analysiert werden.' },
      { status: 500 }
    );
  }
}
