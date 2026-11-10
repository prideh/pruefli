import { NextResponse } from 'next/server';
import { Buffer } from 'node:buffer';

/**
 * Konfigurierbare Grössen- und Längenlimits für API-Payloads (Kostenkontrolle und Schutz).
 *
 * Alle Limits können via Umgebungsvariablen gesteuert werden und besitzen
 * praxistaugliche Standardwerte, sodass reguläre Lehrerdokumente (Arbeitsblätter,
 * Hefte, mehrseitige Prüfungsscans) problemlos verarbeitet werden.
 */

export interface PayloadLimits {
  /** Maximale Dateigrösse für einen einzelnen Scan oder Dokument (in Bytes). Standard: 25 MB. */
  maxScanFileSizeBytes: number;
  /** Maximale Zeichenanzahl für reines Text-Unterrichtsmaterial. Standard: 100'000 Zeichen. */
  maxMaterialTextChars: number;
  /** Maximale Dokumentengrösse für Unterrichtsmaterial (Base64/PDF/Bilder in Bytes). Standard: 25 MB. */
  maxMaterialDocBytes: number;
  /** Maximale Anzahl Seiten bei Mobile-Relay-Uploads. Standard: 15 Seiten. */
  maxRelayPages: number;
  /** Maximale Dateigrösse pro Relay-Einzelseite (in Bytes). Standard: 20 MB. */
  maxRelayPageFileSizeBytes: number;
  /** Maximale Gesamtgrösse aller Relay-Seiten zusammen (in Bytes). Standard: 50 MB. */
  maxRelayTotalBytes: number;
  /** Maximale Zeichenanzahl für reine Text-Musterlösungen. Standard: 100'000 Zeichen. */
  maxRubricTextChars: number;
  /** Maximale Dokumentengrösse für Musterlösungen (Base64 in Bytes). Standard: 25 MB. */
  maxRubricDocBytes: number;
}

export interface ValidationResult {
  valid: boolean;
  error?: string;
  status?: number;
}

function parsePositiveInt(val: string | undefined, fallback: number): number {
  if (!val) return fallback;
  const parsed = parseInt(val, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function formatMb(bytes: number): string {
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}

export function getPayloadLimits(): PayloadLimits {
  return {
    maxScanFileSizeBytes: parsePositiveInt(process.env.MAX_SCAN_FILE_SIZE_BYTES, 25 * 1024 * 1024),
    maxMaterialTextChars: parsePositiveInt(process.env.MAX_MATERIAL_TEXT_CHARS, 100_000),
    maxMaterialDocBytes: parsePositiveInt(process.env.MAX_MATERIAL_DOC_BYTES, 25 * 1024 * 1024),
    maxRelayPages: parsePositiveInt(process.env.MAX_RELAY_PAGES, 15),
    maxRelayPageFileSizeBytes: parsePositiveInt(
      process.env.MAX_RELAY_PAGE_FILE_SIZE_BYTES,
      20 * 1024 * 1024
    ),
    maxRelayTotalBytes: parsePositiveInt(process.env.MAX_RELAY_TOTAL_BYTES, 50 * 1024 * 1024),
    maxRubricTextChars: parsePositiveInt(process.env.MAX_RUBRIC_TEXT_CHARS, 100_000),
    maxRubricDocBytes: parsePositiveInt(process.env.MAX_RUBRIC_DOC_BYTES, 25 * 1024 * 1024),
  };
}

function getBase64ByteLength(raw: string): number {
  try {
    let clean = raw.trim();
    const commaIdx = clean.indexOf(',');
    if (clean.startsWith('data:') && commaIdx !== -1) {
      clean = clean.slice(commaIdx + 1);
    }
    clean = clean.replace(/\s+/g, '');
    return Buffer.byteLength(clean, 'base64');
  } catch {
    return Math.floor((raw.length * 3) / 4);
  }
}

/**
 * Validiert das hochgeladene Unterrichtsmaterial für die Prüfungserstellung.
 */
export function validateMaterialPayload(material: unknown): ValidationResult {
  const limits = getPayloadLimits();

  if (!material) {
    return { valid: true };
  }

  // 1. Array of document pages or items
  if (Array.isArray(material)) {
    let totalBytes = 0;
    let hasDocObjects = false;

    for (const item of material) {
      if (
        item &&
        typeof item === 'object' &&
        'data' in item &&
        typeof (item as { data: unknown }).data === 'string'
      ) {
        hasDocObjects = true;
        totalBytes += getBase64ByteLength((item as { data: string }).data);
      }
    }

    if (hasDocObjects) {
      if (totalBytes > limits.maxMaterialDocBytes) {
        return {
          valid: false,
          error: `Das Unterrichtsmaterial überschreitet die maximale Dateigrösse von ${formatMb(limits.maxMaterialDocBytes)}.`,
          status: 413,
        };
      }
      return { valid: true };
    }
  }

  // 2. Single document object
  if (
    typeof material === 'object' &&
    material !== null &&
    'data' in material &&
    typeof (material as { data: unknown }).data === 'string'
  ) {
    const bytes = getBase64ByteLength((material as { data: string }).data);
    if (bytes > limits.maxMaterialDocBytes) {
      return {
        valid: false,
        error: `Das Unterrichtsmaterial überschreitet die maximale Dateigrösse von ${formatMb(limits.maxMaterialDocBytes)}.`,
        status: 413,
      };
    }
    return { valid: true };
  }

  // 3. String (could be serialized JSON or plain text)
  if (typeof material === 'string') {
    const trimmed = material.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          let totalBytes = 0;
          let hasDocObjects = false;
          for (const item of parsed) {
            if (
              item &&
              typeof item === 'object' &&
              'data' in item &&
              typeof item.data === 'string'
            ) {
              hasDocObjects = true;
              totalBytes += getBase64ByteLength(item.data);
            }
          }
          if (hasDocObjects) {
            if (totalBytes > limits.maxMaterialDocBytes) {
              return {
                valid: false,
                error: `Das Unterrichtsmaterial überschreitet die maximale Dateigrösse von ${formatMb(limits.maxMaterialDocBytes)}.`,
                status: 413,
              };
            }
            return { valid: true };
          }
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          'data' in parsed &&
          typeof parsed.data === 'string'
        ) {
          const bytes = getBase64ByteLength(parsed.data);
          if (bytes > limits.maxMaterialDocBytes) {
            return {
              valid: false,
              error: `Das Unterrichtsmaterial überschreitet die maximale Dateigrösse von ${formatMb(limits.maxMaterialDocBytes)}.`,
              status: 413,
            };
          }
          return { valid: true };
        }
      } catch {
        // Not valid JSON, falls through to text check
      }
    }

    if (material.length > limits.maxMaterialTextChars) {
      return {
        valid: false,
        error: `Das Unterrichtsmaterial ist zu lang. Maximal ${limits.maxMaterialTextChars.toLocaleString('de-CH')} Zeichen sind erlaubt.`,
        status: 413,
      };
    }

    return { valid: true };
  }

  return { valid: true };
}

/**
 * Validiert die Dateigrösse einer einzelnen Schülerarbeit oder Scandatei.
 */
export function validateScanFile(
  file: { size?: number; name?: string } | null | undefined,
  label = 'Die Schülerarbeit'
): ValidationResult {
  if (!file) return { valid: true };
  const limits = getPayloadLimits();
  const size = typeof file.size === 'number' ? file.size : 0;
  if (size > limits.maxScanFileSizeBytes) {
    return {
      valid: false,
      error: `${label} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxScanFileSizeBytes)}.`,
      status: 413,
    };
  }
  return { valid: true };
}

/**
 * Validiert Musterlösung oder Prüfungsvorlage (als File, serialisiertes Dokument oder Text).
 */
export function validateRubricOrTemplatePayload(
  payload: unknown,
  label = 'Die Musterlösung'
): ValidationResult {
  const limits = getPayloadLimits();

  if (!payload) {
    return { valid: true };
  }

  // 1. File or Blob with size property
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'size' in payload &&
    typeof (payload as { size: unknown }).size === 'number'
  ) {
    const size = (payload as { size: number }).size;
    if (size > limits.maxScanFileSizeBytes) {
      return {
        valid: false,
        error: `${label} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxScanFileSizeBytes)}.`,
        status: 413,
      };
    }
    return { valid: true };
  }

  // 2. Array of document pages or File items
  if (Array.isArray(payload)) {
    if (payload.length > limits.maxRelayPages) {
      return {
        valid: false,
        error: `${label} umfasst zu viele Seiten. Es können maximal ${limits.maxRelayPages} Seiten verarbeitet werden.`,
        status: 413,
      };
    }

    let totalBytes = 0;
    let hasDocObjects = false;

    for (let idx = 0; idx < payload.length; idx++) {
      const item = payload[idx];
      if (
        item &&
        typeof item === 'object' &&
        'size' in item &&
        typeof (item as { size: unknown }).size === 'number'
      ) {
        hasDocObjects = true;
        const fileSize = (item as { size: number }).size;
        if (fileSize > limits.maxScanFileSizeBytes) {
          return {
            valid: false,
            error: `${label} (Seite ${idx + 1}) überschreitet die maximale Dateigrösse von ${formatMb(limits.maxScanFileSizeBytes)}.`,
            status: 413,
          };
        }
        totalBytes += fileSize;
      } else if (
        item &&
        typeof item === 'object' &&
        'data' in item &&
        typeof (item as { data: unknown }).data === 'string'
      ) {
        hasDocObjects = true;
        totalBytes += getBase64ByteLength((item as { data: string }).data);
      }
    }

    if (hasDocObjects) {
      if (totalBytes > limits.maxRubricDocBytes) {
        return {
          valid: false,
          error: `${label} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxRubricDocBytes)}.`,
          status: 413,
        };
      }
      return { valid: true };
    }
  }

  // 3. Single document object
  if (
    typeof payload === 'object' &&
    payload !== null &&
    'data' in payload &&
    typeof (payload as { data: unknown }).data === 'string'
  ) {
    const bytes = getBase64ByteLength((payload as { data: string }).data);
    if (bytes > limits.maxRubricDocBytes) {
      return {
        valid: false,
        error: `${label} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxRubricDocBytes)}.`,
        status: 413,
      };
    }
    return { valid: true };
  }

  // 4. String (could be serialized JSON or plain text)
  if (typeof payload === 'string') {
    const trimmed = payload.trim();
    if (
      (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
    ) {
      try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) {
          let totalBytes = 0;
          let hasDocObjects = false;
          for (const item of parsed) {
            if (
              item &&
              typeof item === 'object' &&
              'data' in item &&
              typeof item.data === 'string'
            ) {
              hasDocObjects = true;
              totalBytes += getBase64ByteLength(item.data);
            }
          }
          if (hasDocObjects) {
            if (totalBytes > limits.maxRubricDocBytes) {
              return {
                valid: false,
                error: `${label} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxRubricDocBytes)}.`,
                status: 413,
              };
            }
            return { valid: true };
          }
        } else if (
          parsed &&
          typeof parsed === 'object' &&
          'data' in parsed &&
          typeof parsed.data === 'string'
        ) {
          const bytes = getBase64ByteLength(parsed.data);
          if (bytes > limits.maxRubricDocBytes) {
            return {
              valid: false,
              error: `${label} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxRubricDocBytes)}.`,
              status: 413,
            };
          }
          return { valid: true };
        }
      } catch {
        // Not valid JSON, falls through to text check
      }
    }

    if (payload.length > limits.maxRubricTextChars) {
      return {
        valid: false,
        error: `${label} ist zu lang. Maximal ${limits.maxRubricTextChars.toLocaleString('de-CH')} Zeichen sind erlaubt.`,
        status: 413,
      };
    }

    return { valid: true };
  }

  return { valid: true };
}

/**
 * Validiert die Anzahl und Grössen aller Seiten eines Mobile-Relay-Uploads.
 */
export function validateRelayPages(pages: { size?: number; name?: string }[]): ValidationResult {
  const limits = getPayloadLimits();

  if (pages.length > limits.maxRelayPages) {
    return {
      valid: false,
      error: `Zu viele Seiten hochgeladen. Es können maximal ${limits.maxRelayPages} Seiten auf einmal verarbeitet werden.`,
      status: 413,
    };
  }

  let totalBytes = 0;
  for (let idx = 0; idx < pages.length; idx++) {
    const page = pages[idx];
    const pageSize = typeof page.size === 'number' ? page.size : 0;
    if (pageSize > limits.maxRelayPageFileSizeBytes) {
      return {
        valid: false,
        error: `Seite ${idx + 1} überschreitet die maximale Dateigrösse von ${formatMb(limits.maxRelayPageFileSizeBytes)}.`,
        status: 413,
      };
    }
    totalBytes += pageSize;
  }

  if (totalBytes > limits.maxRelayTotalBytes) {
    return {
      valid: false,
      error: `Die Gesamtgrösse aller Seiten überschreitet das Limit von ${formatMb(limits.maxRelayTotalBytes)}.`,
      status: 413,
    };
  }

  return { valid: true };
}

/**
 * Erzeugt eine NextResponse bei Validierungsfehlern.
 */
export function createPayloadErrorResponse(validation: ValidationResult): NextResponse {
  return NextResponse.json(
    { error: validation.error || 'Payload ist zu gross.' },
    { status: validation.status || 413 }
  );
}

/**
 * Maximale Längenbeschränkung für Klassennamen (Standard: 100 Zeichen).
 */
export const MAX_CLASS_NAME_LENGTH = 100;

/**
 * Validiert einen Klassennamen serverseitig auf Existenz und maximale Länge.
 */
export function validateClassName(name: unknown): ValidationResult {
  if (name === null || name === undefined || typeof name !== 'string' || name.trim() === '') {
    return {
      valid: false,
      error: 'Klassenname ist erforderlich.',
      status: 400,
    };
  }

  const trimmed = name.trim();
  if (trimmed.length > MAX_CLASS_NAME_LENGTH) {
    return {
      valid: false,
      error: `Der Klassenname ist zu lang. Maximal ${MAX_CLASS_NAME_LENGTH} Zeichen sind erlaubt.`,
      status: 400,
    };
  }

  return { valid: true };
}
