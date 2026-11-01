import { Buffer } from 'node:buffer';
import zlib from 'node:zlib';
import { classifyDocumentWithGemini, type DocumentClassificationResult } from '@/lib/gemini';

export interface DocumentValidationResult {
  valid: boolean;
  error?: string;
  status?: number;
  reason?:
    | 'EMPTY'
    | 'TOO_SMALL'
    | 'INVALID_FORMAT'
    | 'CORRUPT'
    | 'BLANK_SCAN'
    | 'NON_EXAM_DOCUMENT'
    | 'UNREADABLE';
  classification?: DocumentClassificationResult;
  canOverride?: boolean;
}

export interface DocumentValidationOptions {
  overrideDocumentType?: boolean;
  teacherId?: string;
  bypassCache?: boolean;
  skipAiClassification?: boolean;
}

export interface DocumentInput {
  buffer?: Buffer;
  name?: string;
  mimeType?: string;
  text?: string;
  label?: string;
  expectedType?: 'student_exam' | 'reference' | 'material';
}

// Regex for detecting administrative, non-exam filenames (supporting both umlaut ä and ASCII ae)
const NON_EXAM_FILENAME_REGEX =
  /(?:einverst(?:ae|[aä])ndnis|einwilligung|declaration[-_]?of[-_]?consent|parental[-_]?consent|consent[-_]?form|datenschutz|privacy[-_]?policy|schweigepflicht|vollmacht|power[-_]?of[-_]?attorney|rechnung|invoice|quittung|receipt|kassenzettel|kontoauszug|bank[-_]?statement|arbeitsunf(?:ae|[aä])higkeit|arztzeugnis|attest|krankmeldung|sick[-_]?note|anmeldeformular|registration[-_]?form)/i;

// Regex for detecting explicit consent forms in text/metadata
const CONSENT_TEXT_REGEX =
  /\b(einverst(?:ae|[aä])ndniserkl(?:ae|[aä])rung|einverst(?:ae|[aä])ndnisformular|declaration of consent|consent form|parental consent|einwilligungserkl(?:ae|[aä])rung|einwilligungsformular|hiermit willige ich ein|hiermit willigen wir ein|ich erkl(?:ae|[aä])re mich damit einverstanden|unterschrift der erziehungsberechtigten|unterschrift der eltern|unterschrift des gesetzlichen vertreters|foto-?\s*und videoeinwilligung|veröffentlichung von fotos|datenschutz-einwilligung)\b/i;

// Regex for detecting legal / privacy texts
const PRIVACY_LEGAL_TEXT_REGEX =
  /\b(datenschutzerkl(?:ae|[aä])rung|datenschutzvereinbarung|privacy policy|schweigepflichtentbindung|entbindung von der schweigepflicht|vollmacht zur vertretung|power of attorney|allgemeine gesch(?:ae|[aä])ftsbedingungen|nutzungsbedingungen)\b/i;

// Regex for detecting billing / financial texts
const INVOICE_FINANCIAL_TEXT_REGEX =
  /\b(rechnung nr\.|rechnungsbetrag|zahlungsziel|f(?:ae|[aä])lligkeitsdatum|gesamtbetrag f(?:ae|[aä])llig|invoice number|amount due|rechnungsanschrift)\b/i;

// Regex for detecting medical leave certificates
const MEDICAL_TEXT_REGEX =
  /\b(arbeitsunf(?:ae|[aä])higkeitsbescheinigung|(?:ae|[aä])rztliches attest|(?:ae|[aä])rztliches zeugnis|krankmeldung)\b/i;

// Regex indicating legitimate exam structures (tasks, points, solutions)
const EXAM_STRUCTURE_INDICATOR_REGEX =
  /\b(aufgabe\s*\d+|aufg\.\s*\d+|frage\s*\d+|task\s*\d+|punkte|erwartungshorizont|musterl[oö]sung|schritte|l[oö]sungsweg|teilpunkte|maximale? punkte)\b/i;

/**
 * Checks if a given filename, text or extracted metadata belongs to a non-exam document.
 */
export function isNonExamDocument(params: { name?: string; text?: string; buffer?: Buffer }): {
  isNonExam: boolean;
  reason?: string;
  detectedCategory?: string;
} {
  const { name, text, buffer } = params;

  // 1. Filename check: explicit administrative filenames are unambiguous
  if (name && NON_EXAM_FILENAME_REGEX.test(name)) {
    const lowerName = name.toLowerCase();
    if (
      lowerName.includes('einverst') ||
      lowerName.includes('consent') ||
      lowerName.includes('einwilligung')
    ) {
      return {
        isNonExam: true,
        detectedCategory: 'Einverständniserklärung',
        reason:
          'Das Dokument wurde anhand des Dateinamens als Einverständniserklärung oder administratives Formular erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
      };
    }
    if (lowerName.includes('datenschutz') || lowerName.includes('privacy')) {
      return {
        isNonExam: true,
        detectedCategory: 'Datenschutzerklärung',
        reason:
          'Das Dokument wurde anhand des Dateinamens als Datenschutzerklärung oder rechtliches Dokument erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
      };
    }
    if (
      lowerName.includes('rechnung') ||
      lowerName.includes('invoice') ||
      lowerName.includes('quittung') ||
      lowerName.includes('receipt')
    ) {
      return {
        isNonExam: true,
        detectedCategory: 'Rechnung / Beleg',
        reason:
          'Das Dokument wurde anhand des Dateinamens als Rechnung oder Zahlungsbeleg erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
      };
    }
    if (
      lowerName.includes('arbeitsunf') ||
      lowerName.includes('attest') ||
      lowerName.includes('arztzeugnis') ||
      lowerName.includes('sick')
    ) {
      return {
        isNonExam: true,
        detectedCategory: 'Ärztliches Attest',
        reason:
          'Das Dokument wurde anhand des Dateinamens als ärztliches Attest oder Krankmeldung erkannt. Bitte laden Sie die tatsächliche Prüfungsarbeit hoch.',
      };
    }

    return {
      isNonExam: true,
      detectedCategory: 'Administratives Formular',
      reason:
        'Das Dokument wurde als administratives Formular erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
    };
  }

  // 2. Extract any embedded text from buffer if not already supplied
  let combinedText = text || '';
  if (buffer && buffer.length > 0) {
    const extracted = extractDocumentText(buffer);
    if (extracted) {
      combinedText = `${combinedText}\n${extracted}`;
    }
  }

  if (!combinedText || combinedText.trim().length === 0) {
    return { isNonExam: false };
  }

  const hasExamIndicators = EXAM_STRUCTURE_INDICATOR_REGEX.test(combinedText);

  // 3. Consent form check
  if (CONSENT_TEXT_REGEX.test(combinedText)) {
    return {
      isNonExam: true,
      detectedCategory: 'Einverständniserklärung',
      reason:
        'Das Dokument wurde als Einverständniserklärung oder administratives Formular erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
    };
  }

  // 4. Privacy & legal texts (only if not an exam with questions about data protection)
  if (PRIVACY_LEGAL_TEXT_REGEX.test(combinedText) && !hasExamIndicators) {
    return {
      isNonExam: true,
      detectedCategory: 'Datenschutzerklärung',
      reason:
        'Das Dokument wurde als Datenschutzerklärung oder rechtliches Dokument erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
    };
  }

  // 5. Invoice & billing texts (only if not a math exam problem about a bill)
  if (INVOICE_FINANCIAL_TEXT_REGEX.test(combinedText) && !hasExamIndicators) {
    return {
      isNonExam: true,
      detectedCategory: 'Rechnung / Beleg',
      reason:
        'Das Dokument wurde als Rechnung oder Zahlungsbeleg erkannt und kann nicht als Prüfung oder Musterlösung verwendet werden. Bitte laden Sie ein prüfungsrelevantes Dokument hoch.',
    };
  }

  // 6. Medical notes (only if not a biology or medical exam)
  if (MEDICAL_TEXT_REGEX.test(combinedText) && !hasExamIndicators) {
    return {
      isNonExam: true,
      detectedCategory: 'Ärztliches Attest',
      reason:
        'Das Dokument wurde als ärztliches Attest oder Krankmeldung erkannt. Bitte laden Sie die tatsächliche Prüfungsarbeit hoch.',
    };
  }

  return { isNonExam: false };
}

/**
 * Extracts plain text, metadata tags, or stream text from PDF and PNG/JPEG binary buffers.
 */
export function extractDocumentText(buffer: Buffer): string {
  if (!buffer || buffer.length < 10) return '';

  const texts: string[] = [];

  // --- PDF Text & Metadata Extraction ---
  if (
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d
  ) {
    const rawPdf = buffer.toString('binary');

    // 1. Info dictionary /Title, /Subject, /Keywords
    const titleMatch = rawPdf.match(/\/Title\s*\(([^)]+)\)/i);
    if (titleMatch) texts.push(titleMatch[1]);
    const subjectMatch = rawPdf.match(/\/Subject\s*\(([^)]+)\)/i);
    if (subjectMatch) texts.push(subjectMatch[1]);
    const keywordsMatch = rawPdf.match(/\/Keywords\s*\(([^)]+)\)/i);
    if (keywordsMatch) texts.push(keywordsMatch[1]);

    // 2. XMP packet titles and descriptions
    const xmpTitleMatch = rawPdf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/i);
    if (xmpTitleMatch) texts.push(xmpTitleMatch[1]);
    const xmpDescMatch = rawPdf.match(/<dc:description[^>]*>([\s\S]*?)<\/dc:description>/i);
    if (xmpDescMatch) texts.push(xmpDescMatch[1]);

    // 3. Decompress /FlateDecode streams or read uncompressed streams
    const streamRegex = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
    let match: RegExpExecArray | null;
    let streamCount = 0;

    while ((match = streamRegex.exec(rawPdf)) !== null && streamCount < 20) {
      streamCount++;
      const streamContent = match[1];
      const streamStartIndex = match.index;
      const dictPrefix = rawPdf.substring(Math.max(0, streamStartIndex - 400), streamStartIndex);

      if (dictPrefix.includes('/FlateDecode')) {
        try {
          const streamBuf = Buffer.from(streamContent, 'binary');
          const decompressed = zlib.inflateSync(streamBuf);
          const decompText = decompressed.toString('utf-8');
          texts.push(decompText);
        } catch {
          // Stream might be encrypted or partial, continue to next stream
        }
      } else {
        texts.push(streamContent);
      }
    }

    return texts.join('\n');
  }

  // --- PNG Metadata Extraction (tEXt, zTXt, iTXt chunks) ---
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    let offset = 8;
    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('latin1', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) break;

      if (type === 'tEXt') {
        const chunkData = buffer.subarray(dataStart, dataEnd);
        const nullIdx = chunkData.indexOf(0);
        if (nullIdx !== -1) {
          texts.push(chunkData.subarray(nullIdx + 1).toString('utf-8'));
        }
      } else if (type === 'zTXt') {
        const chunkData = buffer.subarray(dataStart, dataEnd);
        const nullIdx = chunkData.indexOf(0);
        if (nullIdx !== -1 && nullIdx + 2 < chunkData.length) {
          try {
            const decompressed = zlib.inflateSync(chunkData.subarray(nullIdx + 2));
            texts.push(decompressed.toString('utf-8'));
          } catch {}
        }
      } else if (type === 'iTXt') {
        const chunkData = buffer.subarray(dataStart, dataEnd);
        const nullIdx1 = chunkData.indexOf(0);
        if (nullIdx1 !== -1 && nullIdx1 + 3 < chunkData.length) {
          const compFlag = chunkData[nullIdx1 + 1];
          const remainder = chunkData.subarray(nullIdx1 + 3);
          const nullIdx2 = remainder.indexOf(0);
          if (nullIdx2 !== -1) {
            const remainder2 = remainder.subarray(nullIdx2 + 1);
            const nullIdx3 = remainder2.indexOf(0);
            if (nullIdx3 !== -1) {
              const textData = remainder2.subarray(nullIdx3 + 1);
              if (compFlag === 1) {
                try {
                  const decompressed = zlib.inflateSync(textData);
                  texts.push(decompressed.toString('utf-8'));
                } catch {}
              } else {
                texts.push(textData.toString('utf-8'));
              }
            }
          }
        }
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4;
    }

    return texts.join('\n');
  }

  // --- JPEG Metadata Extraction (COM, XMP) ---
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    const rawJpg = buffer.toString('binary');
    const xmpStart = rawJpg.indexOf('http://ns.adobe.com/xap/1.0/');
    if (xmpStart !== -1) {
      const xmpEnd = rawJpg.indexOf('</x:xmpmeta>', xmpStart);
      if (xmpEnd !== -1) {
        texts.push(rawJpg.substring(xmpStart, xmpEnd));
      }
    }
    return texts.join('\n');
  }

  return '';
}

/**
 * Detects whether an image is completely blank, solid color, or degenerate.
 */
export function detectBlankOrEmptyImage(buffer: Buffer): { isBlank: boolean; reason?: string } {
  if (!buffer || buffer.length < 8) {
    return { isBlank: true, reason: 'Datei enthält keine lesbaren Bilddaten.' };
  }

  // 1. PNG Image analysis
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    let offset = 8;
    let width = 0;
    let height = 0;
    const idatBuffers: Buffer[] = [];

    while (offset + 8 <= buffer.length) {
      const length = buffer.readUInt32BE(offset);
      const type = buffer.toString('latin1', offset + 4, offset + 8);
      const dataStart = offset + 8;
      const dataEnd = dataStart + length;
      if (dataEnd + 4 > buffer.length) break;

      if (type === 'IHDR' && length >= 8) {
        width = buffer.readUInt32BE(dataStart);
        height = buffer.readUInt32BE(dataStart + 4);
      } else if (type === 'IDAT') {
        idatBuffers.push(buffer.subarray(dataStart, dataEnd));
      } else if (type === 'IEND') {
        break;
      }
      offset = dataEnd + 4;
    }

    if (width > 0 && height > 0 && (width < 20 || height < 20)) {
      return {
        isBlank: true,
        reason: 'Die Bildabmessungen sind zu klein für ein lesbares Dokument.',
      };
    }

    if (width >= 20 && height >= 20 && idatBuffers.length > 0) {
      try {
        const compressed = Buffer.concat(idatBuffers);
        const decompressed = zlib.inflateSync(compressed);
        if (decompressed.length > 500) {
          let pureWhiteCount = 0;
          let pureBlackCount = 0;
          let darkInkCount = 0;
          let totalPixelBytes = 0;
          let minVal = 255;
          let maxVal = 0;
          const bytesPerRow = height > 0 ? decompressed.length / height : 0;
          const stride = bytesPerRow > 1 ? Math.floor(bytesPerRow) : 1;

          for (let i = 0; i < decompressed.length; i++) {
            if (stride > 1 && i % stride === 0) {
              // skip filter byte at start of scanline
              continue;
            }
            totalPixelBytes++;
            const b = decompressed[i];
            if (b < minVal) minVal = b;
            if (b > maxVal) maxVal = b;

            if (b >= 250) pureWhiteCount++;
            if (b <= 5) pureBlackCount++;
            if (b <= 160) darkInkCount++;
          }

          if (totalPixelBytes > 500) {
            // Case 1: Pure solid uniform color (standard deviation ~ 0)
            const isUniform = maxVal - minVal <= 5;
            // Case 2: Uniformly blank white sheet (paper with no ink marks whatsoever)
            const isBlankWhite = pureWhiteCount / totalPixelBytes >= 0.998 && darkInkCount < 10;
            // Case 3: Uniformly black / blocked camera lens
            const isBlankBlack =
              pureBlackCount / totalPixelBytes >= 0.998 && totalPixelBytes - pureBlackCount < 10;

            if (isUniform || isBlankWhite || isBlankBlack) {
              return {
                isBlank: true,
                reason:
                  'Die hochgeladene Seite ist vollständig leer oder unbeschrieben (keine handschriftlichen oder gedruckten Inhalte erkennbar). Bitte laden Sie einen lesbaren Scan mit sichtbaren Aufgaben hoch.',
              };
            }
          }
        }
      } catch {
        // IDAT parsing failure, ignore
      }
    }
  }

  // 2. JPEG Image analysis
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    // Valid JPEG format detected
  }

  return { isBlank: false };
}

/**
 * Validates document buffer, headers, size, emptiness, and content plausibility.
 */
export async function validateDocument(
  input: DocumentInput,
  options?: DocumentValidationOptions
): Promise<DocumentValidationResult> {
  const { buffer, name, text, label = 'Das Dokument' } = input;

  // 1. Text-only validation
  if (!buffer && text !== undefined) {
    const trimmed = text.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        status: 400,
        reason: 'EMPTY',
        error: `${label} ist leer. Bitte geben Sie aussagekräftige Aufgaben oder Kriterien ein.`,
      };
    }
    if (trimmed.length < 5 || (trimmed.match(/[a-zA-Z0-9äöüÄÖÜ]/g) || []).length < 3) {
      return {
        valid: false,
        status: 400,
        reason: 'UNREADABLE',
        error: `${label} ist zu kurz oder unleserlich. Bitte geben Sie aussagekräftige Unterlagen oder Aufgabenstellungen ein.`,
      };
    }

    if (!options?.overrideDocumentType) {
      const nonExamCheck = isNonExamDocument({ name, text: trimmed });
      if (nonExamCheck.isNonExam) {
        return {
          valid: false,
          status: 400,
          reason: 'NON_EXAM_DOCUMENT',
          error: nonExamCheck.reason,
          canOverride: true,
          classification: {
            isExamRelated: false,
            documentType: 'CONSENT_FORM',
            confidence: 'HIGH',
            detectedSummary: nonExamCheck.detectedCategory || 'Administratives Formular',
            rejectionReason: nonExamCheck.reason || '',
            canOverride: true,
          },
        };
      }
    }

    return { valid: true };
  }

  // 2. Binary buffer validation: check emptiness
  if (!buffer || buffer.length === 0) {
    return {
      valid: false,
      status: 400,
      reason: 'EMPTY',
      error: `${label} ist leer (0 Bytes). Bitte laden Sie ein lesbares Dokument hoch.`,
    };
  }

  // 3. Format header verification
  const isPdf =
    buffer.length >= 5 &&
    buffer[0] === 0x25 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x44 &&
    buffer[3] === 0x46 &&
    buffer[4] === 0x2d;

  const isPng =
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a;

  const isJpg =
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

  const isWebp =
    buffer.length >= 12 &&
    buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP';

  if (!isPdf && !isPng && !isJpg && !isWebp) {
    return {
      valid: false,
      status: 400,
      reason: 'INVALID_FORMAT',
      error: `Das Dateiformat von ${label} ist ungültig oder beschädigt. Erlaubt sind JPG, PNG, WebP und PDF.`,
    };
  }

  // 4. Truncation check
  if (buffer.length < 30) {
    return {
      valid: false,
      status: 400,
      reason: 'TOO_SMALL',
      error: `${label} ist unvollständig oder zu klein, um ein lesbares Dokument zu sein. Bitte prüfen Sie den Scan.`,
    };
  }

  // 5. Blank or degenerate image check
  if (isPng || isJpg) {
    const blankCheck = detectBlankOrEmptyImage(buffer);
    if (blankCheck.isBlank) {
      return {
        valid: false,
        status: 400,
        reason: 'BLANK_SCAN',
        error: blankCheck.reason || `${label} ist vollständig leer oder unleserlich.`,
      };
    }
  }

  // 6. Non-exam document check (e.g. consent form, declaration of consent, invoice)
  if (!options?.overrideDocumentType) {
    // 6a. Fast local heuristic check (filename, embedded text, PDF metadata)
    const nonExamCheck = isNonExamDocument({ name, buffer, text });
    if (nonExamCheck.isNonExam) {
      return {
        valid: false,
        status: 400,
        reason: 'NON_EXAM_DOCUMENT',
        error: nonExamCheck.reason,
        canOverride: true,
        classification: {
          isExamRelated: false,
          documentType: 'CONSENT_FORM',
          confidence: 'HIGH',
          detectedSummary: nonExamCheck.detectedCategory || 'Administratives Formular',
          rejectionReason: nonExamCheck.reason || '',
          canOverride: true,
        },
      };
    }

    // 6b. Deep inspection via lightweight Gemini vision call when API key is configured
    if (
      !options?.skipAiClassification &&
      buffer &&
      buffer.length > 0 &&
      process.env.GEMINI_API_KEY
    ) {
      const classification = await classifyDocumentWithGemini({
        buffer,
        mimeType:
          input.mimeType || (isPng ? 'image/png' : isPdf ? 'application/pdf' : 'image/jpeg'),
        fileName: name,
        expectedType: input.expectedType,
        teacherId: options?.teacherId,
        bypassCache: options?.bypassCache,
      });

      if (
        classification &&
        (!classification.isExamRelated || classification.documentType === 'AMBIGUOUS')
      ) {
        return {
          valid: false,
          status: 400,
          reason: 'NON_EXAM_DOCUMENT',
          error:
            classification.rejectionReason ||
            `${label} wurde nicht als Prüfungsdokument erkannt. Sie können es über "Trotzdem als Prüfung behandeln" dennoch verwenden.`,
          canOverride: true,
          classification,
        };
      }
    }
  }

  return { valid: true };
}

/**
 * Validates a student exam file upload before any model or storage calls.
 */
export async function validateStudentExamUpload(
  file:
    | File
    | {
        name?: string;
        type?: string;
        size?: number;
        arrayBuffer?: () => Promise<ArrayBuffer | ArrayBufferLike>;
      }
    | Buffer,
  label = 'Die Schülerarbeit',
  options?: DocumentValidationOptions
): Promise<DocumentValidationResult> {
  if (!file) {
    return {
      valid: false,
      status: 400,
      reason: 'EMPTY',
      error: 'Es wurde keine Schülerarbeit hochgeladen.',
    };
  }

  if (Buffer.isBuffer(file)) {
    return validateDocument({ buffer: file, label, expectedType: 'student_exam' }, options);
  }

  if ('size' in file && typeof file.size === 'number' && file.size === 0) {
    return {
      valid: false,
      status: 400,
      reason: 'EMPTY',
      error: `${label} ist leer (0 Bytes). Bitte laden Sie ein lesbares Dokument hoch.`,
    };
  }

  let buffer: Buffer;
  if ('arrayBuffer' in file && typeof file.arrayBuffer === 'function') {
    const bytes = await file.arrayBuffer();
    buffer = Buffer.from(bytes);
  } else {
    return { valid: true };
  }

  return validateDocument(
    {
      buffer,
      name: file.name,
      mimeType: file.type,
      label,
      expectedType: 'student_exam',
    },
    options
  );
}

/**
 * Validates reference uploads (Musterlösung / Rubrik or Prüfungsvorlage / Exam Template)
 * whether provided as File, string, or base64 JSON structure.
 */
export async function validateReferenceUpload(
  payload: unknown,
  label = 'Die Musterlösung',
  options?: DocumentValidationOptions
): Promise<DocumentValidationResult> {
  if (!payload) {
    return {
      valid: false,
      status: 400,
      reason: 'EMPTY',
      error: `${label} fehlt oder ist leer.`,
    };
  }

  // 1. File or Blob
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'arrayBuffer' in payload &&
    typeof (payload as { arrayBuffer: unknown }).arrayBuffer === 'function'
  ) {
    const file = payload as {
      name?: string;
      type?: string;
      size?: number;
      arrayBuffer: () => Promise<ArrayBuffer>;
    };
    if (file.size === 0) {
      return {
        valid: false,
        status: 400,
        reason: 'EMPTY',
        error: `${label} ist leer (0 Bytes). Bitte laden Sie eine gültige Datei hoch.`,
      };
    }
    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);
    return validateDocument(
      {
        buffer,
        name: file.name,
        mimeType: file.type,
        label,
        expectedType: 'reference',
      },
      options
    );
  }

  // 2. Object with mimeType and base64 data
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'data' in payload &&
    typeof (payload as { data: unknown }).data === 'string'
  ) {
    const item = payload as { data: string; mimeType?: string; name?: string };
    const buffer = Buffer.from(item.data, 'base64');
    return validateDocument(
      {
        buffer,
        name: item.name,
        mimeType: item.mimeType,
        label,
        expectedType: 'reference',
      },
      options
    );
  }

  // 3. Array of objects
  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return {
        valid: false,
        status: 400,
        reason: 'EMPTY',
        error: `${label} enthält keine Seiten oder Inhalte.`,
      };
    }
    for (let i = 0; i < payload.length; i++) {
      const page = payload[i];
      const pageRes = await validateReferenceUpload(page, `${label} (Seite ${i + 1})`, options);
      if (!pageRes.valid) return pageRes;
    }
    return { valid: true };
  }

  // 4. String (plain text or serialized JSON)
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (trimmed.length === 0) {
      return {
        valid: false,
        status: 400,
        reason: 'EMPTY',
        error: `${label} ist leer. Bitte geben Sie aussagekräftige Aufgaben oder Kriterien ein.`,
      };
    }

    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        return validateReferenceUpload(parsed, label, options);
      } catch {
        // Plain text fallback
      }
    }

    return validateDocument(
      {
        text: trimmed,
        label,
        expectedType: 'reference',
      },
      options
    );
  }

  return { valid: true };
}

/**
 * Validates teaching material used for exam generation.
 */
export async function validateExamMaterialInput(
  material: unknown,
  options?: DocumentValidationOptions
): Promise<DocumentValidationResult> {
  return validateReferenceUpload(material, 'Das Unterrichtsmaterial', options);
}
