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

export interface PdfTextRun {
  text: string;
  /** X-Koordinate in PDF-Punkten (0 = linker Rand) */
  x: number;
  /** Y-Koordinate in PDF-Punkten (0 = unterer Rand, height = oberer Rand) */
  y: number;
  /** Schriftgroesse in PDF-Punkten */
  fontSize: number;
}

export interface PdfRectVisual {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface PdfLineVisual {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export interface PdfPageVisuals {
  pageNumber: number;
  width: number;
  height: number;
  textRuns: PdfTextRun[];
  rects: PdfRectVisual[];
  lines: PdfLineVisual[];
  embeddedJpegDataUrl: string | null;
  extractedTextPreview: string;
}

export interface PdfPageInfo {
  /** 1-basierte Seitennummer (1..N) */
  pageNumber: number;
  /** Seitenbreite in PDF-Punkten (Standard A4: 595) */
  width: number;
  /** Seitenhoehe in PDF-Punkten (Standard A4: 842) */
  height: number;
  /** Eigenstaendiges 1-seitiges PDF fuer die lokale Weiterverarbeitung */
  singlePagePdfBytes: Uint8Array;
  /** Direkt nutzbare Bild-Data-URL (SVG/PNG) fuer das Seiten-Thumbnail (ohne PDF-iframe) */
  thumbnailDataUrl: string;
  /** Extrahierter Klartext der Seite (z. B. Name im Seitenkopf / Aufgaben) */
  extractedTextPreview: string;
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
  pagesInput: Array<{ label?: string; lines?: string[]; width?: number; height?: number }> | number
): Uint8Array {
  const pageConfigs: Array<{ label?: string; lines?: string[]; width?: number; height?: number }> =
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
    const extraLines = Array.isArray(cfg.lines)
      ? cfg.lines.map((l) => String(l || '').replace(/[()\\]/g, '')).filter((l) => l.length > 0)
      : [];
    const extraOps = extraLines.map((line) => ` 0 -22 Td /F1 12 Tf (${line}) Tj`).join('');
    const streamContent = `BT /F1 14 Tf 50 ${height - 70} Td (${safeLabel}) Tj${extraOps} ET`;

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

  if (parsed.inheritedResources) {
    const inhMatch = parsed.inheritedResources.match(/^(\d+)\s+\d+\s+R$/);
    if (inhMatch) {
      const inhId = parseInt(inhMatch[1], 10);
      if (parsed.objects.has(inhId) && !keptObjectIds.has(inhId)) {
        keptObjectIds.add(inhId);
        queue.push(inhId);
      }
    }
  }

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

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  const binary = bytesToLatin1(bytes);
  return typeof btoa === 'function' ? btoa(binary) : '';
}

function utf8ToBase64(str: string): string {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(str, 'utf8').toString('base64');
  }
  const encoded = new TextEncoder().encode(str);
  return bytesToBase64(encoded);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function decodePdfLiteralString(raw: string): string {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== '\\') {
      out += ch;
      continue;
    }
    i++;
    if (i >= raw.length) break;
    const next = raw[i];
    if (next === 'n') out += '\n';
    else if (next === 'r') out += '\r';
    else if (next === 't') out += '\t';
    else if (next === 'b') out += '\b';
    else if (next === 'f') out += '\f';
    else if (next === '(' || next === ')' || next === '\\') out += next;
    else if (next >= '0' && next <= '7') {
      let oct = next;
      if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') {
        oct += raw[++i];
        if (i + 1 < raw.length && raw[i + 1] >= '0' && raw[i + 1] <= '7') {
          oct += raw[++i];
        }
      }
      out += String.fromCharCode(parseInt(oct, 8));
    } else if (next === '\r' || next === '\n') {
      if (next === '\r' && raw[i + 1] === '\n') i++;
    } else {
      out += next;
    }
  }
  return out;
}

function decodePdfHexString(hexRaw: string): string {
  const clean = hexRaw.replace(/[^0-9a-fA-F]/g, '');
  if (!clean) return '';
  const padded = clean.length % 2 === 1 ? `${clean}0` : clean;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < padded.length; i += 2) {
    bytes[i / 2] = parseInt(padded.slice(i, i + 2), 16);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    let utf16 = '';
    for (let i = 2; i + 1 < bytes.length; i += 2) {
      utf16 += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
    }
    return utf16;
  }
  return bytesToLatin1(bytes);
}

function extractStreamPayloadBytes(obj: ParsedPdfObject): Uint8Array | null {
  const startMatch = /stream(?:\r\n|\n|\r)/.exec(obj.bodyStr);
  if (!startMatch) return null;
  const streamDataStart = startMatch.index + startMatch[0].length;
  const endMatch = obj.bodyStr.lastIndexOf('endstream');
  if (endMatch === -1 || endMatch < streamDataStart) return null;
  let streamDataEnd = endMatch;
  if (streamDataEnd > streamDataStart && obj.bodyBytes[streamDataEnd - 1] === 0x0a) {
    streamDataEnd--;
    if (streamDataEnd > streamDataStart && obj.bodyBytes[streamDataEnd - 1] === 0x0d) {
      streamDataEnd--;
    }
  } else if (streamDataEnd > streamDataStart && obj.bodyBytes[streamDataEnd - 1] === 0x0d) {
    streamDataEnd--;
  }
  return obj.bodyBytes.subarray(streamDataStart, streamDataEnd);
}

function normalizePdfFilterName(rawName: string): string {
  const clean = rawName.replace(/^\//, '').trim();
  if (clean === 'Fl') return 'FlateDecode';
  if (clean === 'A85') return 'ASCII85Decode';
  if (clean === 'AHx') return 'ASCIIHexDecode';
  if (clean === 'DCT') return 'DCTDecode';
  if (clean === 'RL') return 'RunLengthDecode';
  return clean;
}

/**
 * Liest die geordnete Filter-Pipeline eines PDF-Stream-Dictionaries aus.
 * Unterstuetzt sowohl einzelne Filter (`/Filter /FlateDecode`) als auch
 * Filter-Arrays (`/Filter [ /ASCII85Decode /FlateDecode ]`, `/Filter [ /ASCII85Decode /DCTDecode ]`).
 */
export function parsePdfFilters(dictStr: string): string[] {
  const arrayMatch = dictStr.match(/\/Filter\s*\[([\s\S]*?)\]/);
  if (arrayMatch) {
    const names: string[] = [];
    const nameRegex = /\/([^\s/[\]()<>]+)/g;
    let m: RegExpExecArray | null;
    while ((m = nameRegex.exec(arrayMatch[1])) !== null) {
      names.push(normalizePdfFilterName(m[1]));
    }
    return names;
  }
  const singleMatch = dictStr.match(/\/Filter\s*\/([^\s/[\]()<>]+)/);
  if (singleMatch) {
    return [normalizePdfFilterName(singleMatch[1])];
  }
  return [];
}

/**
 * Dekodiert Adobe/PDF ASCII85Decode-Streams (z. B. von ReportLab erzeugte Text- und Bild-Streams).
 */
export function decodeAscii85(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let start = 0;
  // Optionales <~ Praefix ueberspringen
  while (
    start < input.length &&
    (input[start] === 0x20 ||
      input[start] === 0x09 ||
      input[start] === 0x0a ||
      input[start] === 0x0d ||
      input[start] === 0x0c ||
      input[start] === 0x00)
  ) {
    start++;
  }
  if (start + 1 < input.length && input[start] === 0x3c && input[start + 1] === 0x7e) {
    start += 2;
  }

  const tuple: number[] = [];
  for (let i = start; i < input.length; i++) {
    const b = input[i];
    // Ende-Markierung ~>
    if (b === 0x7e) {
      break;
    }
    // PDF-Whitespace ignorieren
    if (b === 0x00 || b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20) {
      continue;
    }
    // 'z' steht fuer 4 Null-Bytes
    if (b === 0x7a && tuple.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    if (b >= 33 && b <= 117) {
      tuple.push(b - 33);
      if (tuple.length === 5) {
        const val =
          tuple[0] * 52200625 + tuple[1] * 614125 + tuple[2] * 7225 + tuple[3] * 85 + tuple[4];
        out.push((val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff);
        tuple.length = 0;
      }
    }
  }

  if (tuple.length >= 2) {
    const count = tuple.length;
    while (tuple.length < 5) {
      tuple.push(84); // mit 'u' (84) auffuellen
    }
    const val =
      tuple[0] * 52200625 + tuple[1] * 614125 + tuple[2] * 7225 + tuple[3] * 85 + tuple[4];
    const bytes = [(val >>> 24) & 0xff, (val >>> 16) & 0xff, (val >>> 8) & 0xff, val & 0xff];
    for (let j = 0; j < count - 1; j++) {
      out.push(bytes[j]);
    }
  }

  return new Uint8Array(out);
}

/**
 * Dekodiert PDF ASCIIHexDecode-Streams.
 */
export function decodeAsciiHex(input: Uint8Array): Uint8Array {
  const nibbles: number[] = [];
  for (let i = 0; i < input.length; i++) {
    const b = input[i];
    if (b === 0x3e) break; // '>' EOD
    if (b >= 0x30 && b <= 0x39) nibbles.push(b - 0x30);
    else if (b >= 0x41 && b <= 0x46) nibbles.push(b - 0x41 + 10);
    else if (b >= 0x61 && b <= 0x66) nibbles.push(b - 0x61 + 10);
  }
  if (nibbles.length % 2 === 1) nibbles.push(0);
  const out = new Uint8Array(nibbles.length / 2);
  for (let i = 0; i < nibbles.length; i += 2) {
    out[i / 2] = (nibbles[i] << 4) | nibbles[i + 1];
  }
  return out;
}

const FIXED_LIT_LENGTHS = (() => {
  const lengths = new Uint8Array(288);
  for (let i = 0; i <= 143; i++) lengths[i] = 8;
  for (let i = 144; i <= 255; i++) lengths[i] = 9;
  for (let i = 256; i <= 279; i++) lengths[i] = 7;
  for (let i = 280; i <= 287; i++) lengths[i] = 8;
  return lengths;
})();

const FIXED_DIST_LENGTHS = (() => {
  const lengths = new Uint8Array(32);
  lengths.fill(5);
  return lengths;
})();

const LENGTH_BASE = [
  3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
  163, 195, 227, 258,
];
const LENGTH_EXTRA = [
  0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const DIST_BASE = [
  1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049,
  3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const DIST_EXTRA = [
  0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13,
];
const CLEN_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface HuffmanTable {
  maxBits: number;
  counts: Int32Array;
  symbols: Int32Array;
}

function buildHuffmanTable(lengths: Uint8Array): HuffmanTable {
  let maxBits = 0;
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > maxBits) maxBits = lengths[i];
  }
  if (maxBits === 0) maxBits = 1;
  const counts = new Int32Array(maxBits + 1);
  for (let i = 0; i < lengths.length; i++) {
    if (lengths[i] > 0) counts[lengths[i]]++;
  }
  const offsets = new Int32Array(maxBits + 1);
  let total = 0;
  for (let bits = 1; bits <= maxBits; bits++) {
    offsets[bits] = total;
    total += counts[bits];
  }
  const symbols = new Int32Array(total);
  for (let sym = 0; sym < lengths.length; sym++) {
    const len = lengths[sym];
    if (len > 0) {
      symbols[offsets[len]++] = sym;
    }
  }
  return { maxBits, counts, symbols };
}

function inflateRawDeflateSync(data: Uint8Array, startOffset = 0): Uint8Array | null {
  let bytePos = startOffset;
  let bitBuf = 0;
  let bitCount = 0;

  const readBits = (n: number): number => {
    while (bitCount < n) {
      if (bytePos >= data.length) {
        throw new Error('Unexpected EOF in DEFLATE stream');
      }
      bitBuf |= data[bytePos++] << bitCount;
      bitCount += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCount -= n;
    return val;
  };

  const decodeSymbol = (table: HuffmanTable): number => {
    let code = 0;
    let first = 0;
    let index = 0;
    for (let len = 1; len <= table.maxBits; len++) {
      code |= readBits(1);
      const count = table.counts[len];
      if (code - count < first) {
        return table.symbols[index + (code - first)];
      }
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new Error('Invalid Huffman code');
  };

  const out: number[] = [];
  let bfinal = 0;

  try {
    do {
      bfinal = readBits(1);
      const btype = readBits(2);

      if (btype === 0) {
        // Uncompressed block
        bitBuf = 0;
        bitCount = 0;
        if (bytePos + 4 > data.length) return null;
        const len = data[bytePos] | (data[bytePos + 1] << 8);
        bytePos += 4;
        if (bytePos + len > data.length) return null;
        for (let i = 0; i < len; i++) {
          out.push(data[bytePos++]);
        }
      } else if (btype === 1 || btype === 2) {
        let litTable: HuffmanTable;
        let distTable: HuffmanTable;

        if (btype === 1) {
          litTable = buildHuffmanTable(FIXED_LIT_LENGTHS);
          distTable = buildHuffmanTable(FIXED_DIST_LENGTHS);
        } else {
          const hlit = readBits(5) + 257;
          const hdist = readBits(5) + 1;
          const hclen = readBits(4) + 4;
          const clenLengths = new Uint8Array(19);
          for (let i = 0; i < hclen; i++) {
            clenLengths[CLEN_ORDER[i]] = readBits(3);
          }
          const clenTable = buildHuffmanTable(clenLengths);
          const allLengths = new Uint8Array(hlit + hdist);
          let idx = 0;
          while (idx < hlit + hdist) {
            const sym = decodeSymbol(clenTable);
            if (sym < 16) {
              allLengths[idx++] = sym;
            } else if (sym === 16) {
              const prev = idx > 0 ? allLengths[idx - 1] : 0;
              const repeat = readBits(2) + 3;
              for (let r = 0; r < repeat && idx < allLengths.length; r++) {
                allLengths[idx++] = prev;
              }
            } else if (sym === 17) {
              const repeat = readBits(3) + 3;
              for (let r = 0; r < repeat && idx < allLengths.length; r++) {
                allLengths[idx++] = 0;
              }
            } else if (sym === 18) {
              const repeat = readBits(7) + 11;
              for (let r = 0; r < repeat && idx < allLengths.length; r++) {
                allLengths[idx++] = 0;
              }
            }
          }
          litTable = buildHuffmanTable(allLengths.subarray(0, hlit));
          distTable = buildHuffmanTable(allLengths.subarray(hlit));
        }

        while (true) {
          const sym = decodeSymbol(litTable);
          if (sym < 256) {
            out.push(sym);
          } else if (sym === 256) {
            break;
          } else {
            const lenIdx = sym - 257;
            if (lenIdx < 0 || lenIdx >= LENGTH_BASE.length) return null;
            const length = LENGTH_BASE[lenIdx] + readBits(LENGTH_EXTRA[lenIdx]);
            const distSym = decodeSymbol(distTable);
            if (distSym < 0 || distSym >= DIST_BASE.length) return null;
            const dist = DIST_BASE[distSym] + readBits(DIST_EXTRA[distSym]);
            const startCopy = out.length - dist;
            if (startCopy < 0) return null;
            for (let i = 0; i < length; i++) {
              out.push(out[startCopy + i]);
            }
          }
        }
      } else {
        return null;
      }
    } while (bfinal === 0);

    return new Uint8Array(out);
  } catch {
    return out.length > 0 ? new Uint8Array(out) : null;
  }
}

function applyPngPredictorIfNeeded(raw: Uint8Array, dictStr?: string): Uint8Array {
  if (!dictStr) return raw;
  const predMatch = dictStr.match(/\/Predictor\s+(\d+)/);
  if (!predMatch) return raw;
  const predictor = parseInt(predMatch[1], 10);
  if (predictor < 10) return raw;

  const colMatch = dictStr.match(/\/Columns\s+(\d+)/);
  const colorsMatch = dictStr.match(/\/Colors\s+(\d+)/);
  const bpcMatch = dictStr.match(/\/BitsPerComponent\s+(\d+)/);
  const columns = colMatch ? parseInt(colMatch[1], 10) : 1;
  const colors = colorsMatch ? parseInt(colorsMatch[1], 10) : 1;
  const bpc = bpcMatch ? parseInt(bpcMatch[1], 10) : 8;
  const bytesPerPixel = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowBytes = Math.max(1, Math.ceil((columns * colors * bpc) / 8));
  const stride = rowBytes + 1;
  if (raw.length < stride) return raw;

  const rows = Math.floor(raw.length / stride);
  const out = new Uint8Array(rows * rowBytes);
  for (let r = 0; r < rows; r++) {
    const filterType = raw[r * stride];
    const srcStart = r * stride + 1;
    const dstStart = r * rowBytes;
    const prevStart = (r - 1) * rowBytes;

    for (let i = 0; i < rowBytes; i++) {
      const x = raw[srcStart + i];
      const a = i >= bytesPerPixel ? out[dstStart + i - bytesPerPixel] : 0;
      const b = r > 0 ? out[prevStart + i] : 0;
      const c = r > 0 && i >= bytesPerPixel ? out[prevStart + i - bytesPerPixel] : 0;
      if (filterType === 1) {
        out[dstStart + i] = (x + a) & 0xff;
      } else if (filterType === 2) {
        out[dstStart + i] = (x + b) & 0xff;
      } else if (filterType === 3) {
        out[dstStart + i] = (x + ((a + b) >>> 1)) & 0xff;
      } else if (filterType === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
        out[dstStart + i] = (x + pr) & 0xff;
      } else {
        out[dstStart + i] = x;
      }
    }
  }
  return out;
}

/**
 * Dekomprimiert einen zlib- oder raw-DEFLATE-Stream synchron im Browser und in Node.
 */
export function inflateFlateSync(payload: Uint8Array, dictStr?: string): Uint8Array | null {
  if (payload.length === 0) return null;
  // Pruefe auf RFC 1950 2-Byte-zlib-Header (z. B. 0x78 0x9C, 0x78 0x01, 0x78 0xDA)
  const hasZlibHeader =
    payload.length > 2 &&
    (payload[0] & 0x0f) === 8 &&
    payload[0] >>> 4 <= 7 &&
    ((payload[0] << 8) + payload[1]) % 31 === 0;

  if (hasZlibHeader) {
    const fdict = (payload[1] & 0x20) !== 0;
    const offset = fdict ? 6 : 2;
    const inflated = inflateRawDeflateSync(payload, offset);
    if (inflated) {
      return applyPngPredictorIfNeeded(inflated, dictStr);
    }
  }

  const rawInflated = inflateRawDeflateSync(payload, 0);
  if (rawInflated) {
    return applyPngPredictorIfNeeded(rawInflated, dictStr);
  }
  return null;
}

async function decompressFlateBytesAsync(
  payload: Uint8Array,
  dictStr?: string
): Promise<Uint8Array | null> {
  const syncResult = inflateFlateSync(payload, dictStr);
  if (syncResult && syncResult.length > 0) {
    return syncResult;
  }
  if (typeof DecompressionStream === 'undefined') {
    return null;
  }
  for (const format of ['deflate', 'deflate-raw'] as const) {
    try {
      const ds = new DecompressionStream(format);
      const writer = ds.writable.getWriter();
      const copy = new Uint8Array(payload.byteLength);
      copy.set(payload);
      await writer.write(copy);
      await writer.close();
      const response = new Response(ds.readable);
      const ab = await response.arrayBuffer();
      return applyPngPredictorIfNeeded(new Uint8Array(ab), dictStr);
    } catch {
      // Naechstes Format versuchen
    }
  }
  return null;
}

/**
 * Fuehrt die Filter-Kette eines PDF-Streams der Reihe nach aus (synchron).
 * Wenn `stopBeforeFilter` angegeben ist (z. B. `'DCTDecode'`), stoppt die Dekodierung
 * unmittelbar vor diesem Filter und gibt die bis dahin entpackten Bytes (z. B. das JPEG) zurueck.
 */
function decodePdfFilterPipelineSync(
  payload: Uint8Array,
  dictStr: string,
  stopBeforeFilter?: string
): { bytes: Uint8Array; stoppedAt: string | null } | null {
  const filters = parsePdfFilters(dictStr);
  let current = payload;

  for (const filter of filters) {
    if (stopBeforeFilter && filter === stopBeforeFilter) {
      return { bytes: current, stoppedAt: filter };
    }
    if (filter === 'ASCII85Decode') {
      current = decodeAscii85(current);
    } else if (filter === 'ASCIIHexDecode') {
      current = decodeAsciiHex(current);
    } else if (filter === 'FlateDecode') {
      const inflated = inflateFlateSync(current, dictStr);
      if (!inflated) return null;
      current = inflated;
    } else if (filter === 'DCTDecode') {
      return { bytes: current, stoppedAt: 'DCTDecode' };
    } else {
      return null;
    }
  }

  return { bytes: current, stoppedAt: null };
}

async function decodePdfFilterPipelineAsync(
  payload: Uint8Array,
  dictStr: string,
  stopBeforeFilter?: string
): Promise<{ bytes: Uint8Array; stoppedAt: string | null } | null> {
  const syncRes = decodePdfFilterPipelineSync(payload, dictStr, stopBeforeFilter);
  if (syncRes) return syncRes;

  const filters = parsePdfFilters(dictStr);
  let current = payload;

  for (const filter of filters) {
    if (stopBeforeFilter && filter === stopBeforeFilter) {
      return { bytes: current, stoppedAt: filter };
    }
    if (filter === 'ASCII85Decode') {
      current = decodeAscii85(current);
    } else if (filter === 'ASCIIHexDecode') {
      current = decodeAsciiHex(current);
    } else if (filter === 'FlateDecode') {
      const inflated = await decompressFlateBytesAsync(current, dictStr);
      if (!inflated) return null;
      current = inflated;
    } else if (filter === 'DCTDecode') {
      return { bytes: current, stoppedAt: 'DCTDecode' };
    } else {
      return null;
    }
  }

  return { bytes: current, stoppedAt: null };
}

/**
 * Kodiert rohe RGB- oder Graustufen-Pixeldaten (aus einem FlateDecode-Bild-XObject)
 * als standardkonforme 24-Bit-BMP-Data-URL, damit auch nicht-JPEG-Scan-Bilder im `<img>` rendern.
 */
function encodeRawPixelsToBmpDataUrl(
  width: number,
  height: number,
  pixels: Uint8Array,
  channels: 1 | 3 | 4
): string | null {
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;
  const rowStride = (width * 3 + 3) & ~3;
  const pixelArraySize = rowStride * height;
  const fileSize = 54 + pixelArraySize;
  const bmp = new Uint8Array(fileSize);
  const view = new DataView(bmp.buffer);

  // BITMAPFILEHEADER (14 Bytes)
  bmp[0] = 0x42; // 'B'
  bmp[1] = 0x4d; // 'M'
  view.setUint32(2, fileSize, true);
  view.setUint32(10, 54, true);

  // BITMAPINFOHEADER (40 Bytes, top-down negative height)
  view.setUint32(14, 40, true);
  view.setInt32(18, width, true);
  view.setInt32(22, -height, true);
  view.setUint16(26, 1, true);
  view.setUint16(28, 24, true);
  view.setUint32(34, pixelArraySize, true);

  let srcIdx = 0;
  for (let y = 0; y < height; y++) {
    let dstIdx = 54 + y * rowStride;
    for (let x = 0; x < width; x++) {
      if (channels === 1) {
        const g = srcIdx < pixels.length ? pixels[srcIdx++] : 255;
        bmp[dstIdx] = g;
        bmp[dstIdx + 1] = g;
        bmp[dstIdx + 2] = g;
      } else if (channels === 3) {
        const r = srcIdx < pixels.length ? pixels[srcIdx++] : 255;
        const g = srcIdx < pixels.length ? pixels[srcIdx++] : 255;
        const b = srcIdx < pixels.length ? pixels[srcIdx++] : 255;
        bmp[dstIdx] = b;
        bmp[dstIdx + 1] = g;
        bmp[dstIdx + 2] = r;
      } else {
        const c = srcIdx < pixels.length ? pixels[srcIdx++] : 0;
        const m = srcIdx < pixels.length ? pixels[srcIdx++] : 0;
        const yk = srcIdx < pixels.length ? pixels[srcIdx++] : 0;
        const k = srcIdx < pixels.length ? pixels[srcIdx++] : 0;
        const r = Math.max(0, Math.min(255, 255 - Math.min(255, c + k)));
        const g = Math.max(0, Math.min(255, 255 - Math.min(255, m + k)));
        const b = Math.max(0, Math.min(255, 255 - Math.min(255, yk + k)));
        bmp[dstIdx] = b;
        bmp[dstIdx + 1] = g;
        bmp[dstIdx + 2] = r;
      }
      dstIdx += 3;
    }
  }

  return `data:image/bmp;base64,${bytesToBase64(bmp)}`;
}

function extractImageDataUrlFromPdfObjectSync(
  obj: ParsedPdfObject,
  payload: Uint8Array
): string | null {
  const filters = parsePdfFilters(obj.dictStr);
  // 1. DCTDecode (auch in Filter-Arrays wie /Filter [ /ASCII85Decode /DCTDecode ])
  if (filters.includes('DCTDecode')) {
    const decoded = decodePdfFilterPipelineSync(payload, obj.dictStr, 'DCTDecode');
    if (decoded && decoded.bytes.length > 4) {
      return `data:image/jpeg;base64,${bytesToBase64(decoded.bytes)}`;
    }
  }
  // 2. Direkter JPEG-Magic-Header (0xFF 0xD8 0xFF)
  if (payload.length > 4 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff) {
    return `data:image/jpeg;base64,${bytesToBase64(payload)}`;
  }
  // 3. FlateDecode / ASCII85Decode / Rohpixel-Rasterbild (/Subtype /Image)
  if (/\/Subtype\s*\/Image\b/.test(obj.dictStr)) {
    const decoded = decodePdfFilterPipelineSync(payload, obj.dictStr);
    if (decoded && decoded.bytes.length > 0) {
      if (
        decoded.bytes.length > 4 &&
        decoded.bytes[0] === 0xff &&
        decoded.bytes[1] === 0xd8 &&
        decoded.bytes[2] === 0xff
      ) {
        return `data:image/jpeg;base64,${bytesToBase64(decoded.bytes)}`;
      }
      const wMatch = obj.dictStr.match(/\/Width\s+(\d+)/);
      const hMatch = obj.dictStr.match(/\/Height\s+(\d+)/);
      if (wMatch && hMatch) {
        const w = parseInt(wMatch[1], 10);
        const h = parseInt(hMatch[1], 10);
        const isGray = /\/ColorSpace\s*\/DeviceGray\b/.test(obj.dictStr);
        const isCmyk = /\/ColorSpace\s*\/DeviceCMYK\b/.test(obj.dictStr);
        const channels: 1 | 3 | 4 = isGray ? 1 : isCmyk ? 4 : 3;
        return encodeRawPixelsToBmpDataUrl(w, h, decoded.bytes, channels);
      }
    }
  }
  return null;
}

function parseTjArrayToken(arrayBody: string): string {
  let out = '';
  const tokenRegex = /\((?:\\.|[^\\()])*\)|<[0-9a-fA-F\s]+>|(-?\d+(?:\.\d+)?)/g;
  let m: RegExpExecArray | null;
  while ((m = tokenRegex.exec(arrayBody)) !== null) {
    const tok = m[0];
    if (tok.startsWith('(') && tok.endsWith(')')) {
      out += decodePdfLiteralString(tok.slice(1, -1));
    } else if (tok.startsWith('<') && tok.endsWith('>')) {
      out += decodePdfHexString(tok.slice(1, -1));
    } else if (m[1] !== undefined) {
      const kern = parseFloat(m[1]);
      if (Number.isFinite(kern) && kern < -120 && !out.endsWith(' ')) {
        out += ' ';
      }
    }
  }
  return out;
}

function parseContentStreamIntoVisuals(
  streamText: string,
  pageWidth: number,
  pageHeight: number,
  textRuns: PdfTextRun[],
  rects: PdfRectVisual[],
  lines: PdfLineVisual[]
) {
  // 1. Vektor-Rechtecke (x y w h re) und Linien (x1 y1 m x2 y2 l)
  const rectRegex =
    /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+re(?=\s|[()/[\]<>]|$)/g;
  let rm: RegExpExecArray | null;
  while ((rm = rectRegex.exec(streamText)) !== null) {
    const rx = parseFloat(rm[1]);
    const ry = parseFloat(rm[2]);
    const rw = parseFloat(rm[3]);
    const rh = parseFloat(rm[4]);
    if (
      Number.isFinite(rx) &&
      Number.isFinite(ry) &&
      Number.isFinite(rw) &&
      Number.isFinite(rh) &&
      Math.abs(rw) > 2 &&
      Math.abs(rh) > 0.5 &&
      !(Math.abs(rw - pageWidth) < 8 && Math.abs(rh - pageHeight) < 8)
    ) {
      rects.push({ x: rx, y: ry, width: rw, height: rh });
    }
  }

  const lineRegex =
    /(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+m\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+l(?=\s|[()/[\]<>]|$)/g;
  let lm: RegExpExecArray | null;
  while ((lm = lineRegex.exec(streamText)) !== null) {
    const x1 = parseFloat(lm[1]);
    const y1 = parseFloat(lm[2]);
    const x2 = parseFloat(lm[3]);
    const y2 = parseFloat(lm[4]);
    if ([x1, y1, x2, y2].every((v) => Number.isFinite(v))) {
      lines.push({ x1, y1, x2, y2 });
    }
  }

  // 2. Text-Bloecke (BT ... ET). FontSize (Tf) und Leading (TL) gehoeren in PDF zum Graphics State
  // und bleiben ueber mehrere BT..ET-Bloecke hinweg erhalten (wichtig fuer ReportLab!).
  let fontSize = 12;
  let leading = 14.4;

  const btRegex = /\bBT\b([\s\S]*?)\bET\b/g;
  let btm: RegExpExecArray | null;
  let foundBtBlock = false;

  const processTextBlock = (block: string, defaultYStart: number) => {
    let matrixScale = 1;
    let lineX = 48;
    let lineY = defaultYStart;
    let curX = lineX;
    let curY = lineY;
    let hasExplicitPos = false;

    const opRegex =
      /\/[^\s/[\]()<>]+\s+(-?\d+(?:\.\d+)?)\s+Tf(?=\s|[()/[\]<>]|$)|(-?\d+(?:\.\d+)?)\s+TL(?=\s|[()/[\]<>]|$)|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(Td|TD)(?=\s|[()/[\]<>]|$)|(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s+Tm(?=\s|[()/[\]<>]|$)|(?:^|\s)T\*(?=\s|[()/[\]<>]|$)|\(((?:\\.|[^\\()])*)\)\s*(Tj|'|")(?=\s|[()/[\]<>]|$)|<([0-9a-fA-F\s]+)>\s*Tj(?=\s|[()/[\]<>]|$)|\[([\s\S]*?)\]\s*TJ(?=\s|[()/[\]<>]|$)/g;

    let op: RegExpExecArray | null;
    while ((op = opRegex.exec(block)) !== null) {
      if (op[1] !== undefined) {
        const fs = Math.abs(parseFloat(op[1]));
        if (Number.isFinite(fs) && fs > 0) {
          fontSize = fs;
        }
      } else if (op[2] !== undefined) {
        const tl = Math.abs(parseFloat(op[2]));
        if (Number.isFinite(tl) && tl > 0) leading = tl;
      } else if (op[3] !== undefined && op[4] !== undefined && op[5] !== undefined) {
        const tx = parseFloat(op[3]);
        const ty = parseFloat(op[4]);
        if (!hasExplicitPos) {
          lineX = tx;
          lineY = ty;
          hasExplicitPos = true;
        } else {
          lineX += tx * matrixScale;
          lineY += ty * matrixScale;
        }
        if (op[5] === 'TD' && ty !== 0) {
          leading = Math.abs(ty);
        }
        curX = lineX;
        curY = lineY;
      } else if (
        op[6] !== undefined &&
        op[7] !== undefined &&
        op[8] !== undefined &&
        op[9] !== undefined &&
        op[10] !== undefined &&
        op[11] !== undefined
      ) {
        const a = parseFloat(op[6]);
        const b = parseFloat(op[7]);
        const c = parseFloat(op[8]);
        const d = parseFloat(op[9]);
        const e = parseFloat(op[10]);
        const f = parseFloat(op[11]);
        const scaleCandidate = Math.hypot(b, d) || Math.hypot(a, c) || 1;
        matrixScale = scaleCandidate > 0 ? scaleCandidate : 1;
        lineX = e;
        lineY = f;
        curX = e;
        curY = f;
        hasExplicitPos = true;
      } else if (op[0].trim() === 'T*') {
        lineY -= leading * matrixScale;
        curX = lineX;
        curY = lineY;
      } else if (op[12] !== undefined) {
        if (op[13] === "'" || op[13] === '"') {
          lineY -= leading * matrixScale;
          curX = lineX;
          curY = lineY;
        }
        const decoded = decodePdfLiteralString(op[12]).trim();
        const effSize = Math.max(8, Math.min(36, fontSize * matrixScale));
        if (decoded) {
          textRuns.push({
            text: decoded,
            x: Math.max(16, Math.min(pageWidth - 24, curX)),
            y: Math.max(16, Math.min(pageHeight - 16, curY)),
            fontSize: effSize,
          });
          curX += decoded.length * effSize * 0.52;
        }
      } else if (op[14] !== undefined) {
        const decoded = decodePdfHexString(op[14]).trim();
        const effSize = Math.max(8, Math.min(36, fontSize * matrixScale));
        if (decoded) {
          textRuns.push({
            text: decoded,
            x: Math.max(16, Math.min(pageWidth - 24, curX)),
            y: Math.max(16, Math.min(pageHeight - 16, curY)),
            fontSize: effSize,
          });
          curX += decoded.length * effSize * 0.52;
        }
      } else if (op[15] !== undefined) {
        const decoded = parseTjArrayToken(op[15]).trim();
        const effSize = Math.max(8, Math.min(36, fontSize * matrixScale));
        if (decoded) {
          textRuns.push({
            text: decoded,
            x: Math.max(16, Math.min(pageWidth - 24, curX)),
            y: Math.max(16, Math.min(pageHeight - 16, curY)),
            fontSize: effSize,
          });
          curX += decoded.length * effSize * 0.52;
        }
      }
    }
  };

  let btIndex = 0;
  while ((btm = btRegex.exec(streamText)) !== null) {
    foundBtBlock = true;
    processTextBlock(btm[1], Math.max(120, pageHeight - 70 - btIndex * 24));
    btIndex++;
  }

  if (!foundBtBlock) {
    processTextBlock(streamText, pageHeight - 70);
  }
}

function isNonContentStreamObject(dictStr: string): boolean {
  return (
    /\/Type\s*\/(?:Metadata|XRef|ObjStm)\b/.test(dictStr) ||
    /\/Subtype\s*\/(?:XML|Type1C|CIDFontType0C|OpenType)\b/.test(dictStr) ||
    /\/Length1\s+\d+/.test(dictStr)
  );
}

function collectPageVisualsFromObjects(
  parsed: InternalParsedPdf,
  pageNumber: number,
  width: number,
  height: number,
  asyncDecodedStreams?: Map<number, string>
): PdfPageVisuals {
  const textRuns: PdfTextRun[] = [];
  const rects: PdfRectVisual[] = [];
  const lines: PdfLineVisual[] = [];
  let embeddedJpegDataUrl: string | null = null;

  for (const [objId, obj] of parsed.objects.entries()) {
    const payload = extractStreamPayloadBytes(obj);
    if (!payload || payload.length === 0) continue;

    const filters = parsePdfFilters(obj.dictStr);
    const isImageObj =
      /\/Subtype\s*\/Image\b/.test(obj.dictStr) ||
      filters.includes('DCTDecode') ||
      (payload.length > 4 && payload[0] === 0xff && payload[1] === 0xd8 && payload[2] === 0xff);

    if (isImageObj) {
      if (!embeddedJpegDataUrl) {
        embeddedJpegDataUrl = extractImageDataUrlFromPdfObjectSync(obj, payload);
      }
      continue;
    }

    if (isNonContentStreamObject(obj.dictStr)) {
      continue;
    }

    const preDecoded = asyncDecodedStreams?.get(objId);
    if (preDecoded !== undefined) {
      parseContentStreamIntoVisuals(preDecoded, width, height, textRuns, rects, lines);
      continue;
    }

    const decoded = decodePdfFilterPipelineSync(payload, obj.dictStr);
    if (decoded && decoded.bytes.length > 0) {
      const streamText = bytesToLatin1(decoded.bytes);
      parseContentStreamIntoVisuals(streamText, width, height, textRuns, rects, lines);
    }
  }

  const extractedTextPreview = textRuns
    .map((r) => r.text)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    pageNumber,
    width,
    height,
    textRuns,
    rects,
    lines,
    embeddedJpegDataUrl,
    extractedTextPreview,
  };
}

/**
 * Extrahiert synchron die visuellen Seiteninhalte (Textlaeufe, Vektoren, eingebettete Scan-Bilder)
 * inkl. Filter-Arrays (/ASCII85Decode, /FlateDecode, /DCTDecode) fuer das lokale Thumbnail-Rendering.
 */
export function extractPdfPageVisuals(
  singlePagePdfInput: Uint8Array | ArrayBuffer,
  pageNumber = 1,
  defaultWidth = 595,
  defaultHeight = 842
): PdfPageVisuals {
  const bytes = toUint8Array(singlePagePdfInput);
  const parsed = parsePdfStructure(bytes);
  if (!parsed.isPdf) {
    return {
      pageNumber,
      width: defaultWidth,
      height: defaultHeight,
      textRuns: [],
      rects: [],
      lines: [],
      embeddedJpegDataUrl: null,
      extractedTextPreview: '',
    };
  }
  return collectPageVisualsFromObjects(parsed, pageNumber, defaultWidth, defaultHeight);
}

/**
 * Extrahiert asynchron die visuellen Seiteninhalte inklusive aller Filter-Arrays.
 */
export async function extractPdfPageVisualsAsync(
  singlePagePdfInput: Uint8Array | ArrayBuffer,
  pageNumber = 1,
  defaultWidth = 595,
  defaultHeight = 842
): Promise<PdfPageVisuals> {
  const bytes = toUint8Array(singlePagePdfInput);
  const parsed = parsePdfStructure(bytes);
  if (!parsed.isPdf) {
    return {
      pageNumber,
      width: defaultWidth,
      height: defaultHeight,
      textRuns: [],
      rects: [],
      lines: [],
      embeddedJpegDataUrl: null,
      extractedTextPreview: '',
    };
  }

  const decompressedStreams = new Map<number, string>();
  for (const [objId, obj] of parsed.objects.entries()) {
    const filters = parsePdfFilters(obj.dictStr);
    if (filters.length === 0) continue;
    if (/\/Subtype\s*\/Image\b/.test(obj.dictStr) || filters.includes('DCTDecode')) continue;
    if (isNonContentStreamObject(obj.dictStr)) continue;
    const payload = extractStreamPayloadBytes(obj);
    if (!payload || payload.length === 0) continue;
    const decoded = await decodePdfFilterPipelineAsync(payload, obj.dictStr);
    if (decoded && decoded.bytes.length > 0) {
      decompressedStreams.set(objId, bytesToLatin1(decoded.bytes));
    }
  }

  return collectPageVisualsFromObjects(
    parsed,
    pageNumber,
    defaultWidth,
    defaultHeight,
    decompressedStreams
  );
}

/**
 * Erzeugt eine direkt im `<img src={...} />` darstellbare SVG-Data-URL mit dem gerenderten
 * Seiteninhalt (Textlaeufe, Name im Kopf, Aufgabenzeilen, Vektoren oder Scan-Bild).
 */
export function renderPdfPageThumbnailSvgDataUrl(visuals: PdfPageVisuals): string {
  const w = visuals.width > 0 ? visuals.width : 595;
  const h = visuals.height > 0 ? visuals.height : 842;

  const parts: string[] = [];
  parts.push(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">`
  );
  // Papier-Hintergrund
  parts.push(`<rect x="0" y="0" width="${w}" height="${h}" fill="#ffffff" />`);
  // Dezente Kopfzeilen-Markierung wie auf einem Pruefungsbogen
  parts.push(`<rect x="36" y="24" width="${w - 72}" height="3" rx="1.5" fill="#e2e8f0" />`);

  if (visuals.embeddedJpegDataUrl) {
    parts.push(
      `<image href="${visuals.embeddedJpegDataUrl}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid meet" />`
    );
  }

  // Vektor-Rechtecke und Tabellenlinien
  for (const r of visuals.rects.slice(0, 80)) {
    const rx = Math.min(r.x, r.x + r.width);
    const rw = Math.abs(r.width);
    const rh = Math.abs(r.height);
    const topY = Math.max(0, Math.min(h - rh, h - Math.max(r.y, r.y + r.height)));
    parts.push(
      `<rect x="${rx.toFixed(1)}" y="${topY.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" fill="none" stroke="#94a3b8" stroke-width="1.2" />`
    );
  }

  for (const l of visuals.lines.slice(0, 100)) {
    const y1 = Math.max(0, Math.min(h, h - l.y1));
    const y2 = Math.max(0, Math.min(h, h - l.y2));
    parts.push(
      `<line x1="${l.x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${l.x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="#94a3b8" stroke-width="1.2" />`
    );
  }

  if (visuals.textRuns.length > 0) {
    const sortedRuns = [...visuals.textRuns].sort((a, b) => b.y - a.y || a.x - b.x);

    sortedRuns.slice(0, 60).forEach((run, idx) => {
      const rawTopY = h - run.y;
      const topY = Math.max(36, Math.min(h - 28, rawTopY));
      const x = Math.max(32, Math.min(w - 48, run.x));
      const displayFontSize = Math.max(16, Math.min(28, run.fontSize * 1.35));
      const isHeaderLine = idx === 0 || topY <= 110;
      const fontWeight = isHeaderLine ? 700 : 500;
      const fill = isHeaderLine ? '#0f172a' : '#1e293b';
      parts.push(
        `<text x="${x.toFixed(1)}" y="${topY.toFixed(1)}" font-family="system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" font-size="${displayFontSize.toFixed(1)}" font-weight="${fontWeight}" fill="${fill}">${escapeXml(run.text)}</text>`
      );
    });
  } else if (!visuals.embeddedJpegDataUrl) {
    // Fallback-Blattdarstellung fuer komplett leere Seiten ohne Text-/Bild-Streams
    parts.push(
      `<rect x="36" y="48" width="${w - 72}" height="54" rx="6" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.2" />`
    );
    parts.push(
      `<text x="52" y="82" font-family="system-ui, -apple-system, sans-serif" font-size="24" font-weight="700" fill="#0f172a">Blatt ${visuals.pageNumber}</text>`
    );
  }

  // Fusszeile mit Seitenzahl
  parts.push(
    `<text x="${(w / 2).toFixed(1)}" y="${(h - 22).toFixed(1)}" text-anchor="middle" font-family="system-ui, -apple-system, sans-serif" font-size="16" font-weight="600" fill="#64748b">Seite ${visuals.pageNumber}</text>`
  );
  parts.push('</svg>');

  const svgString = parts.join('');
  return `data:image/svg+xml;base64,${utf8ToBase64(svgString)}`;
}

/**
 * Rasterisiert eine PDF-Seite clientseitig auf ein HTML5 `<canvas>` (PNG-Data-URL) bzw.
 * liefert in Umgebungen ohne 2D-Canvas-Kontext die gerenderte SVG-Data-URL zurueck.
 */
export async function rasterizePdfPageToDataUrl(page: PdfPageInfo): Promise<string> {
  const visuals = await extractPdfPageVisualsAsync(
    page.singlePagePdfBytes,
    page.pageNumber,
    page.width,
    page.height
  );
  const svgFallbackUrl = renderPdfPageThumbnailSvgDataUrl(visuals);

  if (typeof document === 'undefined') {
    return svgFallbackUrl;
  }

  try {
    const canvas = document.createElement('canvas');
    const targetWidth = 420;
    const w = visuals.width > 0 ? visuals.width : 595;
    const h = visuals.height > 0 ? visuals.height : 842;
    const targetHeight = Math.max(280, Math.round(targetWidth * (h / w)));
    canvas.width = targetWidth;
    canvas.height = targetHeight;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return svgFallbackUrl;
    }

    const scaleX = targetWidth / w;
    const scaleY = targetHeight / h;

    // 1. Weisser Papierhintergrund
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    // 2. Falls ein eingebettetes Scan-JPEG vorliegt, auf das Canvas zeichnen
    if (visuals.embeddedJpegDataUrl && typeof Image !== 'undefined') {
      await new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          try {
            ctx.drawImage(img, 0, 0, targetWidth, targetHeight);
          } catch {
            // Ignoriere Draw-Fehler
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = visuals.embeddedJpegDataUrl!;
      });
    }

    // 3. Kopfbalken & Vektor-Linien/Rechtecke
    ctx.fillStyle = '#e2e8f0';
    ctx.fillRect(36 * scaleX, 24 * scaleY, (w - 72) * scaleX, 3 * scaleY);

    ctx.strokeStyle = '#cbd5e1';
    ctx.lineWidth = 1;
    for (const r of visuals.rects.slice(0, 60)) {
      const rx = Math.min(r.x, r.x + r.width) * scaleX;
      const rw = Math.abs(r.width) * scaleX;
      const rh = Math.abs(r.height) * scaleY;
      const topY =
        Math.max(0, Math.min(h - Math.abs(r.height), h - Math.max(r.y, r.y + r.height))) * scaleY;
      ctx.strokeRect(rx, topY, rw, rh);
    }
    for (const l of visuals.lines.slice(0, 80)) {
      ctx.beginPath();
      ctx.moveTo(l.x1 * scaleX, (h - l.y1) * scaleY);
      ctx.lineTo(l.x2 * scaleX, (h - l.y2) * scaleY);
      ctx.stroke();
    }

    // 4. Textlaeufe (Schuelername, Seitenkopf, Aufgaben) klar lesbar zeichnen
    if (visuals.textRuns.length > 0) {
      const sortedRuns = [...visuals.textRuns].sort((a, b) => b.y - a.y || a.x - b.x);

      sortedRuns.slice(0, 60).forEach((run, idx) => {
        const rawTopY = h - run.y;
        const clampedTopY = Math.max(36, Math.min(h - 28, rawTopY));
        const pxX = Math.max(24 * scaleX, Math.min((w - 48) * scaleX, run.x * scaleX));
        const pxY = clampedTopY * scaleY;
        const isHeaderLine = idx === 0 || clampedTopY <= 110;
        const pxFontSize = Math.max(12, Math.min(20, Math.round(run.fontSize * scaleX * 1.35)));
        ctx.font = `${isHeaderLine ? 700 : 500} ${pxFontSize}px system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
        ctx.fillStyle = isHeaderLine ? '#0f172a' : '#1e293b';
        ctx.fillText(run.text, pxX, pxY, targetWidth - pxX - 12);
      });
    } else if (!visuals.embeddedJpegDataUrl) {
      ctx.fillStyle = '#f8fafc';
      ctx.fillRect(28 * scaleX, 42 * scaleY, (w - 56) * scaleX, 52 * scaleY);
      ctx.strokeStyle = '#cbd5e1';
      ctx.strokeRect(28 * scaleX, 42 * scaleY, (w - 56) * scaleX, 52 * scaleY);
      ctx.font = '700 16px system-ui, -apple-system, sans-serif';
      ctx.fillStyle = '#0f172a';
      ctx.fillText(`Blatt ${visuals.pageNumber}`, 42 * scaleX, 74 * scaleY);
      ctx.fillStyle = '#e2e8f0';
      for (let lineIdx = 0; lineIdx < 6; lineIdx++) {
        const lineY = (145 + lineIdx * 44) * scaleY;
        const lineW = (lineIdx % 2 === 0 ? w - 96 : w - 150) * scaleX;
        ctx.fillRect(42 * scaleX, lineY, lineW, 6 * scaleY);
      }
    }

    // 5. Fusszeile
    ctx.font = '600 11px system-ui, -apple-system, sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.textAlign = 'center';
    ctx.fillText(`Seite ${visuals.pageNumber}`, targetWidth / 2, targetHeight - 10);

    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl && dataUrl.startsWith('data:image/png')) {
      return dataUrl;
    }
  } catch {
    // Fallback auf SVG-Data-URL
  }

  return svgFallbackUrl;
}

/**
 * Inspiziert ein PDF lokal (ohne KI-Aufrufe) und liefert Seitenanzahl sowie
 * fuer jede Seite ein 1-seitiges Vorschau-PDF und ein direkt darstellbares Thumbnail-Bild.
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

    const visuals = extractPdfPageVisuals(singlePagePdfBytes, pageNumber, dims.width, dims.height);
    const thumbnailDataUrl = renderPdfPageThumbnailSvgDataUrl(visuals);

    pages.push({
      pageNumber,
      width: dims.width,
      height: dims.height,
      singlePagePdfBytes,
      thumbnailDataUrl,
      extractedTextPreview: visuals.extractedTextPreview,
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
