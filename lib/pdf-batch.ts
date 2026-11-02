/**
 * Lokale PDF-Klassensatz-Inspektion und manuelle Blattgrenzen-Zerlegung (Issue #83).
 *
 * WICHTIG (Owner-Entscheidung 1.11.2026):
 * - Rein lokal und deterministisch: KEINE KI-Aufrufe, keine automatische Erkennung
 *   von Blattgrenzen, keine Namens-/Kopf-Erkennung und keine Trennseiten-Erkennung.
 * - Die Lehrperson markiert die Startseiten manuell in der Seitenübersicht;
 *   daraus werden pro Schülerarbeit eigenständige PDF-Dokumente mit ihrem
 *   jeweiligen Seitenbereich erzeugt.
 */

import { matchStudentByNameWithConfidence } from '@/lib/grading';

export interface PdfPageInfo {
  /** 1-basierte Seitennummer (1..N) */
  pageNumber: number;
  /** Seitenbreite in PDF-Punkten (Standard A4: 595) */
  width: number;
  /** Seitenhöhe in PDF-Punkten (Standard A4: 842) */
  height: number;
  /** Eigenständiges 1-seitiges PDF für die lokale Thumbnail-Vorschau im Browser */
  singlePagePdfBytes: Uint8Array;
}

export interface PdfInspectionResult {
  isPdf: boolean;
  pageCount: number;
  pages: PdfPageInfo[];
}

export interface PdfSegmentRange {
  /** 1-basierter Index der Arbeit (Arbeit 1, Arbeit 2, ...) */
  workIndex: number;
  /** 1-basierte Startseite (inklusive) */
  startPage: number;
  /** 1-basierte Endseite (inklusive) */
  endPage: number;
  /** Anzahl Seiten dieser Arbeit */
  pageCount: number;
  /** Alle 1-basierten Seitennummern dieser Arbeit */
  pageNumbers: number[];
}

export interface SplitPdfWork extends PdfSegmentRange {
  /** Dateiname für die erzeugte Teilarbeit inkl. Seitenbereich */
  fileName: string;
  /** Binärdaten des eigenständigen PDFs für diese Arbeit */
  pdfBytes: Uint8Array;
}

interface ParsedPdfObject {
  id: number;
  gen: number;
  bodyStr: string;
  dictStr: string;
  bodyBytes: Uint8Array;
}

function toUint8Array(input: Uint8Array | ArrayBuffer): Uint8Array {
  return input instanceof Uint8Array ? input : new Uint8Array(input);
}

function bytesToLatin1(bytes: Uint8Array): string {
  let out = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    out += String.fromCharCode(...slice);
  }
  return out;
}

function latin1ToBytes(str: string): Uint8Array {
  const out = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) {
    out[i] = str.charCodeAt(i) & 0xff;
  }
  return out;
}

function concatUint8Arrays(chunks: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const c of chunks) {
    totalLength += c.length;
  }
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const c of chunks) {
    result.set(c, offset);
    offset += c.length;
  }
  return result;
}

/**
 * Prüft anhand von Dateiendung, MIME-Type oder `%PDF-`-Header, ob eine PDF-Datei vorliegt.
 */
export function isPdfFile(
  file: { name?: string; type?: string } | null | undefined,
  bytes?: Uint8Array | ArrayBuffer
): boolean {
  if (bytes) {
    const arr = toUint8Array(bytes);
    if (
      arr.length >= 5 &&
      arr[0] === 0x25 &&
      arr[1] === 0x50 &&
      arr[2] === 0x44 &&
      arr[3] === 0x46 &&
      arr[4] === 0x2d
    ) {
      return true;
    }
  }
  if (!file) return false;
  const mime = (file.type || '').toLowerCase().trim();
  if (mime === 'application/pdf') return true;
  const name = (file.name || '').toLowerCase().trim();
  return name.endsWith('.pdf');
}

/**
 * Berechnet aus den manuell gesetzten Startseiten die zusammenhängenden Seitenbereiche pro Arbeit.
 * Seite 1 ist immer der Beginn der ersten Arbeit; mehrseitige Arbeiten bleiben gruppiert.
 */
export function computeSegmentsFromStartPages(
  totalPages: number,
  startPages: Iterable<number>
): PdfSegmentRange[] {
  const safeTotal = Math.max(0, Math.floor(totalPages));
  if (safeTotal === 0) return [];

  const uniqueStarts = new Set<number>([1]);
  for (const rawPage of startPages) {
    const p = Math.floor(Number(rawPage));
    if (Number.isFinite(p) && p >= 1 && p <= safeTotal) {
      uniqueStarts.add(p);
    }
  }

  const sortedStarts = Array.from(uniqueStarts).sort((a, b) => a - b);
  return sortedStarts.map((startPage, idx) => {
    const endPage = idx + 1 < sortedStarts.length ? sortedStarts[idx + 1] - 1 : safeTotal;
    const pageCount = endPage - startPage + 1;
    const pageNumbers: number[] = [];
    for (let p = startPage; p <= endPage; p++) {
      pageNumbers.push(p);
    }
    return {
      workIndex: idx + 1,
      startPage,
      endPage,
      pageCount,
      pageNumbers,
    };
  });
}

/**
 * Schaltet die manuelle Startseiten-Markierung für eine Seite (ab Seite 2) um.
 * Seite 1 bleibt stets als Start der ersten Arbeit markiert.
 */
export function toggleStartPageMarker(
  totalPages: number,
  currentStartPages: Iterable<number>,
  pageNumber: number
): number[] {
  const safeTotal = Math.max(1, Math.floor(totalPages));
  const target = Math.floor(Number(pageNumber));
  const set = new Set<number>([1]);

  for (const p of currentStartPages) {
    const norm = Math.floor(Number(p));
    if (Number.isFinite(norm) && norm >= 1 && norm <= safeTotal) {
      set.add(norm);
    }
  }

  if (target >= 2 && target <= safeTotal) {
    if (set.has(target)) {
      set.delete(target);
    } else {
      set.add(target);
    }
  }

  return Array.from(set).sort((a, b) => a - b);
}

function parseMediaBoxDimensions(dictStr: string): { width: number; height: number } | null {
  const match = dictStr.match(
    /\/MediaBox\s*\[\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\]/
  );
  if (!match) return null;
  const x0 = parseFloat(match[1]);
  const y0 = parseFloat(match[2]);
  const x1 = parseFloat(match[3]);
  const y1 = parseFloat(match[4]);
  const width = Math.abs(x1 - x0);
  const height = Math.abs(y1 - y0);
  if (width > 0 && height > 0) {
    return { width: Math.round(width), height: Math.round(height) };
  }
  return null;
}

interface InternalParsedPdf {
  isPdf: boolean;
  objects: Map<number, ParsedPdfObject>;
  catalogId: number | null;
  rootPagesId: number | null;
  orderedPageIds: number[];
  fallbackCount: number;
  inheritedMediaBox: string | null;
  inheritedResources: string | null;
}

function parsePdfStructure(bytes: Uint8Array): InternalParsedPdf {
  if (
    bytes.length < 5 ||
    bytes[0] !== 0x25 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x44 ||
    bytes[3] !== 0x46 ||
    bytes[4] !== 0x2d
  ) {
    return {
      isPdf: false,
      objects: new Map(),
      catalogId: null,
      rootPagesId: null,
      orderedPageIds: [],
      fallbackCount: 0,
      inheritedMediaBox: null,
      inheritedResources: null,
    };
  }

  const raw = bytesToLatin1(bytes);
  const objects = new Map<number, ParsedPdfObject>();

  const objRegex = /(\d+)\s+(\d+)\s+obj\b([\s\S]*?)endobj/g;
  let match: RegExpExecArray | null;
  while ((match = objRegex.exec(raw)) !== null) {
    const id = parseInt(match[1], 10);
    const gen = parseInt(match[2], 10);
    const prefixLen = match[0].indexOf(match[3]);
    const bodyStart = match.index + prefixLen;
    const bodyEnd = bodyStart + match[3].length;
    const bodyStr = match[3];
    const streamIdx = bodyStr.search(/stream\r?\n/);
    const dictStr = streamIdx !== -1 ? bodyStr.slice(0, streamIdx) : bodyStr;

    objects.set(id, {
      id,
      gen,
      bodyStr,
      dictStr,
      bodyBytes: bytes.subarray(bodyStart, bodyEnd),
    });
  }

  let catalogId: number | null = null;
  let rootPagesId: number | null = null;

  for (const [id, obj] of objects.entries()) {
    if (/\/Type\s*\/Catalog\b/.test(obj.dictStr)) {
      catalogId = id;
      const pagesRef = obj.dictStr.match(/\/Pages\s+(\d+)\s+\d+\s+R/);
      if (pagesRef) {
        rootPagesId = parseInt(pagesRef[1], 10);
      }
      break;
    }
  }

  if (rootPagesId === null) {
    for (const [id, obj] of objects.entries()) {
      if (/\/Type\s*\/Pages\b/.test(obj.dictStr) && !/\/Parent\s+\d+\s+\d+\s+R/.test(obj.dictStr)) {
        rootPagesId = id;
        break;
      }
    }
  }

  if (rootPagesId === null) {
    for (const [id, obj] of objects.entries()) {
      if (/\/Type\s*\/Pages\b/.test(obj.dictStr)) {
        rootPagesId = id;
        break;
      }
    }
  }

  const orderedPageIds: number[] = [];
  const visited = new Set<number>();
  let inheritedMediaBox: string | null = null;
  let inheritedResources: string | null = null;

  function traversePagesNode(nodeId: number) {
    if (visited.has(nodeId)) return;
    visited.add(nodeId);
    const node = objects.get(nodeId);
    if (!node) return;

    if (/\/Type\s*\/Pages\b/.test(node.dictStr)) {
      const mbMatch = node.dictStr.match(/\/MediaBox\s*(\[[^\]]*\])/);
      if (mbMatch && !inheritedMediaBox) {
        inheritedMediaBox = mbMatch[1];
      }
      const resRefMatch = node.dictStr.match(/\/Resources\s+(\d+\s+\d+\s+R)/);
      if (resRefMatch && !inheritedResources) {
        inheritedResources = resRefMatch[1];
      }

      const kidsMatch = node.dictStr.match(/\/Kids\s*\[([\s\S]*?)\]/);
      if (kidsMatch) {
        const refRegex = /(\d+)\s+\d+\s+R/g;
        let refMatch: RegExpExecArray | null;
        while ((refMatch = refRegex.exec(kidsMatch[1])) !== null) {
          traversePagesNode(parseInt(refMatch[1], 10));
        }
      }
      return;
    }

    if (/\/Type\s*\/Page\b(?!s)/.test(node.dictStr)) {
      orderedPageIds.push(nodeId);
    }
  }

  if (rootPagesId !== null) {
    traversePagesNode(rootPagesId);
  }

  // Fallback: Falls /Kids nicht alle /Type /Page-Objekte geliefert hat, in Dateireihenfolge ergänzen
  for (const [id, obj] of objects.entries()) {
    if (/\/Type\s*\/Page\b(?!s)/.test(obj.dictStr) && !orderedPageIds.includes(id)) {
      orderedPageIds.push(id);
    }
  }

  // Fallback für minimale Dummy-PDFs, die nur /Count N angeben
  let fallbackCount = orderedPageIds.length;
  if (fallbackCount === 0) {
    let maxCount = 0;
    const countRegex = /\/Count\s+(\d+)/g;
    let cMatch: RegExpExecArray | null;
    while ((cMatch = countRegex.exec(raw)) !== null) {
      const val = parseInt(cMatch[1], 10);
      if (Number.isFinite(val) && val > maxCount) {
        maxCount = val;
      }
    }
    fallbackCount = maxCount > 0 ? maxCount : 1;
  }

  return {
    isPdf: true,
    objects,
    catalogId,
    rootPagesId,
    orderedPageIds,
    fallbackCount,
    inheritedMediaBox,
    inheritedResources,
  };
}

/**
 * Erzeugt ein standardkonformes, mehrseitiges PDF-Dokument (z. B. für Tests oder Fallback-Seiten).
 */
export function createMultiPagePdf(
  pagesInput: Array<{ label?: string; width?: number; height?: number }> | number
): Uint8Array {
  const pageConfigs =
    typeof pagesInput === 'number'
      ? Array.from({ length: Math.max(1, pagesInput) }, (_, idx) => ({
          label: `Pruefungsseite ${idx + 1}`,
          width: 595,
          height: 842,
        }))
      : pagesInput.length > 0
        ? pagesInput
        : [{ label: 'Pruefungsseite 1', width: 595, height: 842 }];

  // Object 1: Catalog, Object 2: Pages, Object 3: Font
  // Pro Seite i (0..N-1): Page-Objekt = 4 + i * 2, Content-Stream-Objekt = 5 + i * 2
  const objects: { id: number; body: string }[] = [];
  const pageObjIds = pageConfigs.map((_, idx) => 4 + idx * 2);

  objects.push({
    id: 1,
    body: '<< /Type /Catalog /Pages 2 0 R >>',
  });
  objects.push({
    id: 2,
    body: `<< /Type /Pages /Count ${pageConfigs.length} /Kids [ ${pageObjIds.map((id) => `${id} 0 R`).join(' ')} ] >>`,
  });
  objects.push({
    id: 3,
    body: '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  });

  pageConfigs.forEach((cfg, idx) => {
    const pageObjId = 4 + idx * 2;
    const contentObjId = 5 + idx * 2;
    const width = cfg.width && cfg.width > 0 ? cfg.width : 595;
    const height = cfg.height && cfg.height > 0 ? cfg.height : 842;
    const safeLabel = (cfg.label || `Seite ${idx + 1}`).replace(/[()\\]/g, '');
    const streamContent = `BT /F1 14 Tf 50 ${height - 70} Td (${safeLabel}) Tj ET`;

    objects.push({
      id: pageObjId,
      body: `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width} ${height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjId} 0 R >>`,
    });
    objects.push({
      id: contentObjId,
      body: `<< /Length ${streamContent.length} >>\nstream\n${streamContent}\nendstream`,
    });
  });

  let pdfStr = '%PDF-1.4\n';
  const offsets = new Map<number, number>();
  let maxId = 0;

  for (const obj of objects) {
    offsets.set(obj.id, pdfStr.length);
    if (obj.id > maxId) maxId = obj.id;
    pdfStr += `${obj.id} 0 obj\n${obj.body}\nendobj\n`;
  }

  const xrefOffset = pdfStr.length;
  pdfStr += `xref\n0 ${maxId + 1}\n`;
  pdfStr += '0000000000 65535 f \r\n';
  for (let id = 1; id <= maxId; id++) {
    const off = offsets.get(id);
    if (off !== undefined) {
      pdfStr += `${String(off).padStart(10, '0')} 00000 n \r\n`;
    } else {
      pdfStr += '0000000000 65535 f \r\n';
    }
  }

  pdfStr += `trailer\n<< /Size ${maxId + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return latin1ToBytes(pdfStr);
}

function extractRangeFromParsedPdf(
  parsed: InternalParsedPdf,
  originalBytes: Uint8Array,
  startPage: number,
  endPage: number
): Uint8Array {
  const totalPages =
    parsed.orderedPageIds.length > 0 ? parsed.orderedPageIds.length : parsed.fallbackCount;
  const clampedStart = Math.max(1, Math.min(totalPages, Math.floor(startPage)));
  const clampedEnd = Math.max(clampedStart, Math.min(totalPages, Math.floor(endPage)));

  // Falls das PDF nur 1 Seite hat und genau diese angefragt wird, Originalbytes unverändert zurückgeben
  if (totalPages === 1 && clampedStart === 1 && clampedEnd === 1) {
    return originalBytes;
  }

  // Fallback für synthetische Minimal-PDFs ohne eigene /Type /Page-Objekte
  if (parsed.orderedPageIds.length === 0) {
    const count = clampedEnd - clampedStart + 1;
    return createMultiPagePdf(
      Array.from({ length: count }, (_, idx) => ({
        label: `Seite ${clampedStart + idx}`,
      }))
    );
  }

  const selectedPageIds = parsed.orderedPageIds.slice(clampedStart - 1, clampedEnd);
  const selectedPageSet = new Set<number>(selectedPageIds);
  const droppedPageSet = new Set<number>(
    parsed.orderedPageIds.filter((id) => !selectedPageSet.has(id))
  );

  // Alle /Type /Pages-Knoten ausser rootPagesId werden durch den abgeflachten Root-Knoten ersetzt
  let maxExistingId = 0;
  for (const id of parsed.objects.keys()) {
    if (id > maxExistingId) maxExistingId = id;
  }

  const rootPagesId = parsed.rootPagesId ?? maxExistingId + 1;
  const catalogId = parsed.catalogId ?? maxExistingId + 2;

  const droppedPagesTreeNodes = new Set<number>();
  for (const [id, obj] of parsed.objects.entries()) {
    if (id !== rootPagesId && /\/Type\s*\/Pages\b/.test(obj.dictStr)) {
      droppedPagesTreeNodes.add(id);
    }
  }

  const rewrittenBodies = new Map<number, Uint8Array>();

  // 1. Root /Pages-Objekt auf die ausgewählten Seiten umschreiben
  const kidsArrayStr = selectedPageIds.map((id) => `${id} 0 R`).join(' ');
  const mediaBoxAttr = parsed.inheritedMediaBox ? ` /MediaBox ${parsed.inheritedMediaBox}` : '';
  const resourcesAttr = parsed.inheritedResources ? ` /Resources ${parsed.inheritedResources}` : '';
  const newPagesBody = `\n<< /Type /Pages /Count ${selectedPageIds.length} /Kids [ ${kidsArrayStr} ]${mediaBoxAttr}${resourcesAttr} >>\n`;
  rewrittenBodies.set(rootPagesId, latin1ToBytes(newPagesBody));

  // 2. Catalog sicherstellen
  if (!parsed.objects.has(catalogId)) {
    rewrittenBodies.set(
      catalogId,
      latin1ToBytes(`\n<< /Type /Catalog /Pages ${rootPagesId} 0 R >>\n`)
    );
  }

  // 3. /Parent in jeder ausgewählten /Page auf rootPagesId aktualisieren
  for (const pageId of selectedPageIds) {
    const pageObj = parsed.objects.get(pageId);
    if (!pageObj) continue;
    const streamIdx = pageObj.bodyStr.search(/stream\r?\n/);
    let updatedDict = pageObj.dictStr;
    if (/\/Parent\s+\d+\s+\d+\s+R/.test(updatedDict)) {
      updatedDict = updatedDict.replace(/\/Parent\s+\d+\s+\d+\s+R/, `/Parent ${rootPagesId} 0 R`);
    } else {
      updatedDict = updatedDict.replace(
        /\/Type\s*\/Page\b/,
        `/Type /Page /Parent ${rootPagesId} 0 R`
      );
    }

    if (streamIdx === -1) {
      rewrittenBodies.set(pageId, latin1ToBytes(updatedDict));
    } else {
      const dictBytes = latin1ToBytes(updatedDict);
      const streamAndAfterBytes = pageObj.bodyBytes.subarray(streamIdx);
      rewrittenBodies.set(pageId, concatUint8Arrays([dictBytes, streamAndAfterBytes]));
    }
  }

  // 4. Erreichbarkeits-Traversierung ab Catalog, rootPagesId und ausgewählten Seiten
  const keptObjectIds = new Set<number>([catalogId, rootPagesId, ...selectedPageIds]);
  const queue: number[] = [catalogId, rootPagesId, ...selectedPageIds];

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (currentId === rootPagesId) continue;

    const obj = parsed.objects.get(currentId);
    if (!obj) continue;

    const refRegex = /(\d+)\s+\d+\s+R/g;
    let refMatch: RegExpExecArray | null;
    while ((refMatch = refRegex.exec(obj.dictStr)) !== null) {
      const targetId = parseInt(refMatch[1], 10);
      if (droppedPageSet.has(targetId) || droppedPagesTreeNodes.has(targetId)) {
        continue;
      }
      if (parsed.objects.has(targetId) && !keptObjectIds.has(targetId)) {
        keptObjectIds.add(targetId);
        queue.push(targetId);
      }
    }
  }

  const sortedKeptIds = Array.from(keptObjectIds).sort((a, b) => a - b);
  const chunks: Uint8Array[] = [];
  let currentOffset = 0;

  const pushStr = (s: string) => {
    const b = latin1ToBytes(s);
    chunks.push(b);
    currentOffset += b.length;
  };

  const pushBytes = (b: Uint8Array) => {
    chunks.push(b);
    currentOffset += b.length;
  };

  pushStr('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');

  const offsets = new Map<number, number>();
  let maxOutId = 0;

  for (const objId of sortedKeptIds) {
    const bodyBytes = rewrittenBodies.get(objId) ?? parsed.objects.get(objId)?.bodyBytes;
    if (!bodyBytes) continue;

    offsets.set(objId, currentOffset);
    if (objId > maxOutId) maxOutId = objId;

    pushStr(`${objId} 0 obj`);
    if (bodyBytes.length === 0 || (bodyBytes[0] !== 0x0a && bodyBytes[0] !== 0x0d)) {
      pushStr('\n');
    }
    pushBytes(bodyBytes);
    if (
      bodyBytes.length === 0 ||
      (bodyBytes[bodyBytes.length - 1] !== 0x0a && bodyBytes[bodyBytes.length - 1] !== 0x0d)
    ) {
      pushStr('\n');
    }
    pushStr('endobj\n');
  }

  const xrefOffset = currentOffset;
  pushStr(`xref\n0 ${maxOutId + 1}\n`);
  pushStr('0000000000 65535 f \r\n');
  for (let id = 1; id <= maxOutId; id++) {
    const off = offsets.get(id);
    if (off !== undefined) {
      pushStr(`${String(off).padStart(10, '0')} 00000 n \r\n`);
    } else {
      pushStr('0000000000 65535 f \r\n');
    }
  }

  pushStr(
    `trailer\n<< /Size ${maxOutId + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  );

  return concatUint8Arrays(chunks);
}

/**
 * Extrahiert einen 1-basierten Seitenbereich [startPage..endPage] als eigenständiges PDF.
 */
export function extractPdfPageRange(
  pdfInput: Uint8Array | ArrayBuffer,
  startPage: number,
  endPage: number
): Uint8Array {
  const bytes = toUint8Array(pdfInput);
  const parsed = parsePdfStructure(bytes);
  if (!parsed.isPdf) {
    throw new Error('Ungültiges PDF-Dokument.');
  }
  return extractRangeFromParsedPdf(parsed, bytes, startPage, endPage);
}

/**
 * Inspiziert ein PDF lokal (ohne KI-Aufrufe) und liefert Seitenanzahl sowie
 * für jede Seite ein 1-seitiges Vorschau-PDF für die Seitenübersicht (Thumbnails).
 */
export function inspectPdfBytes(pdfInput: Uint8Array | ArrayBuffer): PdfInspectionResult {
  const bytes = toUint8Array(pdfInput);
  const parsed = parsePdfStructure(bytes);
  if (!parsed.isPdf) {
    return { isPdf: false, pageCount: 0, pages: [] };
  }

  const totalPages =
    parsed.orderedPageIds.length > 0 ? parsed.orderedPageIds.length : parsed.fallbackCount;

  const inheritedDims = parsed.inheritedMediaBox
    ? parseMediaBoxDimensions(`/MediaBox ${parsed.inheritedMediaBox}`)
    : null;

  const pages: PdfPageInfo[] = [];
  for (let i = 0; i < totalPages; i++) {
    const pageNumber = i + 1;
    const pageObjId = parsed.orderedPageIds[i];
    const pageObj = pageObjId !== undefined ? parsed.objects.get(pageObjId) : undefined;
    const dims = (pageObj ? parseMediaBoxDimensions(pageObj.dictStr) : null) ||
      inheritedDims || { width: 595, height: 842 };

    const singlePagePdfBytes =
      totalPages === 1 ? bytes : extractRangeFromParsedPdf(parsed, bytes, pageNumber, pageNumber);

    pages.push({
      pageNumber,
      width: dims.width,
      height: dims.height,
      singlePagePdfBytes,
    });
  }

  return {
    isPdf: true,
    pageCount: totalPages,
    pages,
  };
}

function stripPdfExtension(fileName?: string): string {
  const clean = (fileName || 'klassensatz.pdf').trim();
  return clean.replace(/\.pdf$/i, '') || 'klassensatz';
}

/**
 * Zerlegt ein mehrseitiges PDF anhand der manuell markierten Startseiten in
 * einzelne Schülerarbeiten (jeweils mit ihrem gruppierten Seitenbereich).
 */
export function splitPdfByStartPages(
  pdfInput: Uint8Array | ArrayBuffer,
  startPages: Iterable<number>,
  originalFileName = 'klassensatz.pdf'
): SplitPdfWork[] {
  const bytes = toUint8Array(pdfInput);
  const parsed = parsePdfStructure(bytes);
  if (!parsed.isPdf) {
    throw new Error('Ungültiges PDF-Dokument.');
  }

  const totalPages =
    parsed.orderedPageIds.length > 0 ? parsed.orderedPageIds.length : parsed.fallbackCount;
  const segments = computeSegmentsFromStartPages(totalPages, startPages);
  const baseName = stripPdfExtension(originalFileName);

  return segments.map((seg) => {
    const pdfBytes =
      segments.length === 1 && seg.startPage === 1 && seg.endPage === totalPages
        ? bytes
        : extractRangeFromParsedPdf(parsed, bytes, seg.startPage, seg.endPage);

    const rangeSuffix =
      seg.startPage === seg.endPage ? `S${seg.startPage}` : `S${seg.startPage}-${seg.endPage}`;
    const fileName =
      segments.length === 1 && totalPages === 1
        ? `${baseName}.pdf`
        : `${baseName}_Arbeit-${seg.workIndex}_${rangeSuffix}.pdf`;

    return {
      ...seg,
      fileName,
      pdfBytes,
    };
  });
}

/**
 * Zerlegt ein Browser-`File`-Objekt anhand der Startseiten-Markierungen in einzelne PDF-`File`-Objekte.
 */
export async function splitPdfFileToFiles(
  file: File,
  startPages: Iterable<number>
): Promise<{ works: SplitPdfWork[]; files: File[] }> {
  const arrayBuffer = await file.arrayBuffer();
  const works = splitPdfByStartPages(arrayBuffer, startPages, file.name);
  const files = works.map((work) => {
    const copy = new Uint8Array(work.pdfBytes.byteLength);
    copy.set(work.pdfBytes);
    return new File([copy.buffer], work.fileName, {
      type: 'application/pdf',
      lastModified: Date.now(),
    });
  });
  return { works, files };
}

export interface SiblingSubmissionCandidate {
  id: string;
  examId: string;
  studentId?: string | null;
  targetStudentId?: string | null;
  extractedStudentName?: string | null;
  status?: string;
  earnedPoints?: number;
  gradeRounded?: string;
}

/**
 * Löst Namens-Vorschläge für eine Arbeit gegen die Klassenliste und Sibling-Arbeiten auf (Issue #83 Kriterium 3):
 * - Nutzt `matchStudentByNameWithConfidence` (exact/normalized Match, Teil-/Token-Match, Unsicherheits-Flags)
 *   sowie die Sibling-Logik.
 * - Gibt `suggestedStudentId` zum Vorbefüllen zurück, übernimmt die Zuordnung aber NIEMALS automatisch
 *   ohne Bestätigung (`studentId` bleibt `null`, Status bleibt "Zuordnung ausstehend").
 */
export function resolveUnconfirmedStudentSuggestion(params: {
  extractedStudentName?: string | null;
  isAiNameUncertain?: boolean;
  classStudents: { id: string; name: string }[];
  siblingSubmissions?: SiblingSubmissionCandidate[];
  currentSubmission?: {
    id: string;
    examId: string;
    status?: string;
    earnedPoints?: number;
    gradeRounded?: string;
  };
}): {
  studentId: null;
  suggestedStudentId: string | null;
  isStudentMatchUncertain: true;
  confidence: 'HIGH' | 'LOW' | 'NONE';
} {
  const extracted = (params.extractedStudentName || '').trim();
  const matchResult = matchStudentByNameWithConfidence(
    extracted,
    params.classStudents,
    Boolean(params.isAiNameUncertain)
  );

  let suggestedStudentId = matchResult.suggestedStudentId;

  if (!suggestedStudentId && params.currentSubmission && params.siblingSubmissions) {
    const normExtracted = (s?: string | null) => (s || '').trim().toLowerCase();
    const subNormName = normExtracted(extracted);
    const cur = params.currentSubmission;

    const matchingSibling = params.siblingSubmissions.find((other) => {
      if (other.id === cur.id || other.examId !== cur.examId) return false;
      const otherStudentId = other.studentId || other.targetStudentId;
      if (!otherStudentId) return false;
      if (subNormName && normExtracted(other.extractedStudentName) === subNormName) {
        return true;
      }
      if (
        cur.status === 'COMPLETED' &&
        other.status === 'COMPLETED' &&
        typeof other.earnedPoints === 'number' &&
        typeof cur.earnedPoints === 'number' &&
        Math.abs(other.earnedPoints - cur.earnedPoints) < 0.01 &&
        other.gradeRounded === cur.gradeRounded &&
        normExtracted(other.extractedStudentName) === subNormName
      ) {
        return true;
      }
      return false;
    });

    if (matchingSibling) {
      suggestedStudentId = matchingSibling.studentId || matchingSibling.targetStudentId || null;
    } else if (params.classStudents.length === 1) {
      suggestedStudentId = params.classStudents[0].id;
    }
  }

  return {
    studentId: null,
    suggestedStudentId,
    isStudentMatchUncertain: true,
    confidence: matchResult.confidence,
  };
}
