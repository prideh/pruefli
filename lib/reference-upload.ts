import type { ReferenceMaterialInput } from '@/lib/gemini';

export interface ReferenceFileLike {
  name: string;
  size: number;
  type?: string;
  lastModified?: number;
  arrayBuffer: () => Promise<ArrayBuffer>;
}

const EXT_TO_MIME: Record<string, string> = {
  pdf: 'application/pdf',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  txt: 'text/plain',
};

/**
 * Resolves a normalized MIME type for a reference upload file (rubric or exam template).
 * Falls back to the file extension when mobile browsers omit `file.type`.
 */
export function resolveReferenceMimeType(file: { name?: string; type?: string }): string {
  const rawMime = (file.type || '').toLowerCase().trim();
  if (rawMime === 'image/jpg') return 'image/jpeg';
  if (
    rawMime === 'application/pdf' ||
    rawMime === 'image/jpeg' ||
    rawMime === 'image/png' ||
    rawMime === 'image/webp' ||
    rawMime === 'text/plain'
  ) {
    return rawMime;
  }

  const ext = ((file.name || '').split('.').pop() || '').toLowerCase();
  if (EXT_TO_MIME[ext]) {
    return EXT_TO_MIME[ext];
  }

  if (rawMime.startsWith('image/')) {
    return rawMime;
  }

  return rawMime || 'application/octet-stream';
}

export function isTextReferenceFile(file: { name?: string; type?: string }): boolean {
  return resolveReferenceMimeType(file) === 'text/plain';
}

function getFileDedupKey(file: { name: string; size: number; lastModified?: number }): string {
  return `${file.name}:${file.size}:${file.lastModified ?? 0}`;
}

/**
 * Appends newly selected reference files to the existing ordered page list.
 * - Deduplicates identical file metadata entries (e.g. duplicate change events) while preserving page order.
 * - If either existing or incoming files are plain text (.txt), replaces rather than mixing text and binary pages.
 */
export function appendReferenceFiles<
  T extends { name: string; size: number; lastModified?: number; type?: string },
>(currentFiles: T[], incomingFiles: T[]): T[] {
  if (!incomingFiles || incomingFiles.length === 0) {
    return currentFiles;
  }

  const incomingAllText = incomingFiles.every((f) => isTextReferenceFile(f));
  const currentHasText = currentFiles.some((f) => isTextReferenceFile(f));

  const baseFiles = incomingAllText || currentHasText ? [] : currentFiles;
  const seen = new Set<string>();
  const ordered: T[] = [];

  for (const file of baseFiles) {
    const key = getFileDedupKey(file);
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(file);
    }
  }

  for (const file of incomingFiles) {
    const key = getFileDedupKey(file);
    if (!seen.has(key)) {
      seen.add(key);
      ordered.push(file);
    }
  }

  return ordered;
}

/**
 * Reorders a page in a multi-page reference upload list.
 */
export function moveReferenceFile<T>(files: T[], fromIndex: number, toIndex: number): T[] {
  if (
    fromIndex < 0 ||
    fromIndex >= files.length ||
    toIndex < 0 ||
    toIndex >= files.length ||
    fromIndex === toIndex
  ) {
    return files;
  }
  const next = [...files];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
}

/**
 * Removes a single page at the given index from a reference upload list.
 */
export function removeReferenceFileAt<T>(files: T[], index: number): T[] {
  if (index < 0 || index >= files.length) {
    return files;
  }
  return files.filter((_, idx) => idx !== index);
}

/**
 * Formats a concise UI label for single or multi-page reference uploads.
 */
export function formatReferenceFilesSummary(
  files: { name: string }[],
  kind: 'rubric' | 'template'
): string {
  if (!files || files.length === 0) return '';
  if (files.length === 1) {
    return kind === 'rubric' ? `Musterlösung: ${files[0].name}` : files[0].name;
  }
  return kind === 'rubric'
    ? `Musterlösung (${files.length} Seiten)`
    : `Vorlage (${files.length} Seiten)`;
}

function arrayBufferToBase64(bytes: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const uint8 = new Uint8Array(bytes);
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function arrayBufferToUtf8(bytes: ArrayBuffer): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('utf-8');
  }
  return new TextDecoder('utf-8').decode(bytes);
}

async function readFileArrayBuffer(file: {
  arrayBuffer?: () => Promise<ArrayBuffer>;
}): Promise<ArrayBuffer> {
  if (typeof file.arrayBuffer === 'function') {
    return await file.arrayBuffer();
  }
  if (typeof FileReader !== 'undefined' && file instanceof Blob) {
    return await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as ArrayBuffer) || new ArrayBuffer(0));
      reader.onerror = () =>
        reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));
      reader.readAsArrayBuffer(file);
    });
  }
  throw new Error('Datei konnte nicht gelesen werden.');
}

/**
 * Serializes one or more uploaded reference files into the canonical single-page or multi-page
 * ReferenceMaterialInput and JSON/text string representation, preserving exact page order.
 */
export async function serializeReferenceFiles(
  files: Array<{
    name?: string;
    type?: string;
    arrayBuffer?: () => Promise<ArrayBuffer>;
  }>
): Promise<{
  param: ReferenceMaterialInput;
  storedText: string;
  fileNameSummary: string;
  pageCount: number;
}> {
  const validFiles = (files || []).filter(Boolean);
  if (validFiles.length === 0) {
    return { param: '', storedText: '', fileNameSummary: '', pageCount: 0 };
  }

  const allPlainText = validFiles.every((file) => {
    const mime = resolveReferenceMimeType(file);
    return (
      mime === 'text/plain' ||
      (!mime.startsWith('image/') && mime !== 'application/pdf' && file.type === '')
    );
  });

  // Note: Only treat as plain text if explicitly text/plain or not binary image/pdf
  const isBinaryDoc = validFiles.some((file) => {
    const mime = resolveReferenceMimeType(file);
    return mime.startsWith('image/') || mime === 'application/pdf';
  });

  if (!isBinaryDoc && allPlainText) {
    const textParts: string[] = [];
    for (const file of validFiles) {
      const bytes = await readFileArrayBuffer(file);
      textParts.push(arrayBufferToUtf8(bytes));
    }
    const joinedText = textParts.join('\n\n');
    const fileNameSummary =
      validFiles.length === 1
        ? validFiles[0].name || 'Textdatei'
        : `${validFiles.length} Dateien (${validFiles.map((f, i) => f.name || `Datei ${i + 1}`).join(', ')})`;
    return {
      param: joinedText,
      storedText: joinedText,
      fileNameSummary,
      pageCount: validFiles.length,
    };
  }

  const pages: { name?: string; mimeType: string; data: string }[] = [];
  for (const file of validFiles) {
    const rawMime = resolveReferenceMimeType(file);
    const mimeType =
      rawMime === 'application/pdf' || rawMime.startsWith('image/') ? rawMime : 'image/jpeg';
    const bytes = await readFileArrayBuffer(file);
    const base64Data = arrayBufferToBase64(bytes);
    pages.push({
      ...(file.name ? { name: file.name } : {}),
      mimeType,
      data: base64Data,
    });
  }

  if (pages.length === 1) {
    const page = pages[0];
    const singleParam = {
      mimeType: page.mimeType,
      data: page.data,
      ...(page.name ? { name: page.name } : {}),
    };
    const storedObj = page.name
      ? { name: page.name, mimeType: page.mimeType, data: page.data }
      : { mimeType: page.mimeType, data: page.data };
    return {
      param: singleParam,
      storedText: JSON.stringify(storedObj),
      fileNameSummary: page.name || '1 Seite',
      pageCount: 1,
    };
  }

  const fileNameSummary = `${pages.length} Seiten (${pages
    .map((p, idx) => p.name || `Seite ${idx + 1}`)
    .join(', ')})`;

  return {
    param: pages,
    storedText: JSON.stringify(pages),
    fileNameSummary,
    pageCount: pages.length,
  };
}

/**
 * Extracts a reference upload field ('rubric' or 'examTemplate') from FormData,
 * supporting a single File, multiple ordered Files (multi-page scan), or a string payload.
 */
export function extractFormDataReferenceInput(
  formData: FormData,
  fieldName: string
): File[] | File | string | null {
  const entries = formData.getAll(fieldName);
  if (!entries || entries.length === 0) {
    return null;
  }

  const files = entries.filter(
    (entry): entry is File =>
      entry instanceof File ||
      (typeof entry === 'object' &&
        entry !== null &&
        'arrayBuffer' in entry &&
        typeof (entry as { arrayBuffer?: unknown }).arrayBuffer === 'function')
  );

  if (files.length > 1) {
    return files;
  }
  if (files.length === 1) {
    return files[0];
  }

  for (const entry of entries) {
    if (typeof entry === 'string') {
      return entry;
    }
  }

  return null;
}
