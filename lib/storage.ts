import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export interface StorageFile {
  buffer: Buffer;
  contentType: string;
}

export interface StorageAdapter {
  write(key: string, data: Buffer, contentType?: string): Promise<string>;
  read(key: string): Promise<StorageFile | null>;
  delete(key: string): Promise<boolean>;
  exists(key: string): Promise<boolean>;
  getUrl(key: string): string;
}

export interface S3Config {
  bucket: string;
  endpoint?: string;
  region?: string;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle?: boolean;
}

/**
 * Normalisiert Dateipfade oder URLs auf einen konsistenten Storage-Key ohne fuehrende Slashes.
 */
export function normalizeStorageKey(raw: string): string {
  if (!raw) return '';
  return raw
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
    .replace(/^uploads\//, '')
    .trim();
}

/**
 * Ermittelt den passenden MIME-Type anhand der Dateiendung.
 */
export function resolveMimeType(keyOrExt: string): string {
  const ext = (keyOrExt.split('.').pop() || '').toLowerCase();
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'webp':
      return 'image/webp';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    default:
      return 'application/octet-stream';
  }
}

/**
 * Lokaler Filesystem-Storage fuer Entwicklungsumgebungen.
 * Schreibt standardmaessig nach /storage/uploads (ausserhalb von /public)
 * und bietet Rueckfall-Kompatibilitaet fuer Altdaten in /public/uploads.
 */
export class FilesystemStorageAdapter implements StorageAdapter {
  private baseDir: string;
  private legacyDir: string;

  constructor(baseDir?: string) {
    this.baseDir =
      baseDir ||
      process.env.STORAGE_LOCAL_DIR ||
      path.join(/*turbopackIgnore: true*/ process.cwd(), 'storage', 'uploads');
    this.legacyDir = path.join(/*turbopackIgnore: true*/ process.cwd(), 'public', 'uploads');
  }

  getUrl(key: string): string {
    const cleanKey = normalizeStorageKey(key);
    return `/uploads/${cleanKey}`;
  }

  async write(key: string, data: Buffer, _contentType?: string): Promise<string> {
    const cleanKey = normalizeStorageKey(key);
    await fs.mkdir(this.baseDir, { recursive: true });
    const targetPath = path.join(this.baseDir, cleanKey);
    await fs.writeFile(targetPath, data);
    return this.getUrl(cleanKey);
  }

  async read(key: string): Promise<StorageFile | null> {
    const cleanKey = normalizeStorageKey(key);
    const targetPath = path.join(this.baseDir, cleanKey);
    let resolvedPath: string | null = null;

    if (existsSync(targetPath)) {
      resolvedPath = targetPath;
    } else {
      const legacyPath = path.join(this.legacyDir, cleanKey);
      if (existsSync(legacyPath)) {
        resolvedPath = legacyPath;
      }
    }

    if (!resolvedPath) {
      return null;
    }

    const buffer = await fs.readFile(resolvedPath);
    const contentType = resolveMimeType(cleanKey);
    return { buffer, contentType };
  }

  async delete(key: string): Promise<boolean> {
    const cleanKey = normalizeStorageKey(key);
    let deleted = false;
    const targetPath = path.join(this.baseDir, cleanKey);
    if (existsSync(targetPath)) {
      await fs.unlink(targetPath);
      deleted = true;
    }
    const legacyPath = path.join(this.legacyDir, cleanKey);
    if (existsSync(legacyPath)) {
      await fs.unlink(legacyPath);
      deleted = true;
    }
    return deleted;
  }

  async exists(key: string): Promise<boolean> {
    const cleanKey = normalizeStorageKey(key);
    const targetPath = path.join(this.baseDir, cleanKey);
    if (existsSync(targetPath)) return true;
    const legacyPath = path.join(this.legacyDir, cleanKey);
    return existsSync(legacyPath);
  }
}

/**
 * Produktions-Adapter fuer S3-kompatible Object Storages (Cloudflare R2, AWS S3, MinIO, etc.)
 * Verwendet AWS Signature Version 4 (SigV4) mit Node.js built-in Krypto-Primitiven.
 */
export class S3StorageAdapter implements StorageAdapter {
  private config: S3Config;

  constructor(config: S3Config) {
    this.config = config;
  }

  getUrl(key: string): string {
    const cleanKey = normalizeStorageKey(key);
    return `/uploads/${cleanKey}`;
  }

  private getRequestDetails(method: string, key: string, payload?: Buffer, contentType?: string) {
    const cleanKey = normalizeStorageKey(key);
    const region = this.config.region || 'auto';
    const service = 's3';
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    let host: string;
    let uri: string;
    let fullUrl: string;

    const baseEndpoint = this.config.endpoint
      ? this.config.endpoint.replace(/\/+$/, '')
      : `https://s3.${region}.amazonaws.com`;

    const parsedEndpoint = new URL(baseEndpoint);
    const usePathStyle = this.config.forcePathStyle ?? true;

    if (usePathStyle) {
      host = parsedEndpoint.host;
      uri = `/${this.config.bucket}/${encodeURIComponent(cleanKey).replace(/%2F/g, '/')}`;
      fullUrl = `${parsedEndpoint.origin}${uri}`;
    } else {
      host = `${this.config.bucket}.${parsedEndpoint.host}`;
      uri = `/${encodeURIComponent(cleanKey).replace(/%2F/g, '/')}`;
      fullUrl = `${parsedEndpoint.protocol}//${host}${uri}`;
    }

    const payloadHash = crypto
      .createHash('sha256')
      .update(payload || Buffer.alloc(0))
      .digest('hex');

    const headers: Record<string, string> = {
      host,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
    };

    if (contentType) {
      headers['content-type'] = contentType;
    }

    const headerKeys = Object.keys(headers).sort();
    const canonicalHeaders = headerKeys
      .map((k) => `${k.toLowerCase()}:${headers[k].trim()}\n`)
      .join('');
    const signedHeaders = headerKeys.map((k) => k.toLowerCase()).join(';');

    const canonicalQuery = '';
    const canonicalRequest = [
      method,
      uri,
      canonicalQuery,
      canonicalHeaders,
      signedHeaders,
      payloadHash,
    ].join('\n');

    const hashedCanonicalRequest = crypto
      .createHash('sha256')
      .update(canonicalRequest)
      .digest('hex');

    const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      hashedCanonicalRequest,
    ].join('\n');

    const kDate = crypto
      .createHmac('sha256', 'AWS4' + this.config.secretAccessKey)
      .update(dateStamp)
      .digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update(service).digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();

    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authHeader = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
    headers['Authorization'] = authHeader;

    return { fullUrl, headers };
  }

  async write(key: string, data: Buffer, contentType?: string): Promise<string> {
    const cleanKey = normalizeStorageKey(key);
    const mime = contentType || resolveMimeType(cleanKey);
    const { fullUrl, headers } = this.getRequestDetails('PUT', cleanKey, data, mime);

    const res = await fetch(fullUrl, {
      method: 'PUT',
      headers,
      body: new Uint8Array(data),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`S3 write fehlgeschlagen [${res.status}]: ${errText || res.statusText}`);
    }

    return this.getUrl(cleanKey);
  }

  async read(key: string): Promise<StorageFile | null> {
    const cleanKey = normalizeStorageKey(key);
    const { fullUrl, headers } = this.getRequestDetails('GET', cleanKey);

    const res = await fetch(fullUrl, {
      method: 'GET',
      headers,
    });

    if (res.status === 404) {
      return null;
    }

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`S3 read fehlgeschlagen [${res.status}]: ${errText || res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuf);
    const contentType = res.headers.get('content-type') || resolveMimeType(cleanKey);

    return { buffer, contentType };
  }

  async delete(key: string): Promise<boolean> {
    const cleanKey = normalizeStorageKey(key);
    const { fullUrl, headers } = this.getRequestDetails('DELETE', cleanKey);

    const res = await fetch(fullUrl, {
      method: 'DELETE',
      headers,
    });

    if (res.status === 404) return false;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`S3 delete fehlgeschlagen [${res.status}]: ${errText || res.statusText}`);
    }
    return true;
  }

  async exists(key: string): Promise<boolean> {
    const cleanKey = normalizeStorageKey(key);
    const { fullUrl, headers } = this.getRequestDetails('HEAD', cleanKey);

    const res = await fetch(fullUrl, {
      method: 'HEAD',
      headers,
    });

    if (res.status === 200) return true;
    if (res.status === 404) return false;
    return false;
  }
}

let hasLoggedStorageDriver = false;

/**
 * Ermittelt den aktiven Treiber-Typ anhand der Umgebungsvariablen ('s3' | 'filesystem').
 */
export function getActiveStorageDriverName(): 's3' | 'filesystem' {
  const driver = process.env.STORAGE_DRIVER?.toLowerCase();
  const bucket = process.env.S3_BUCKET || '';
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    ''
  ).trim();

  const hasS3Config = Boolean(bucket && accessKeyId && secretAccessKey);
  return driver === 's3' || (!driver && hasS3Config) ? 's3' : 'filesystem';
}

/**
 * Gibt eine einmalige Start-Logzeile mit dem konfigurierten Storage-Treiber aus.
 */
export function logActiveStorageDriver(isProduction = process.env.NODE_ENV === 'production'): void {
  const driverName = getActiveStorageDriverName();
  if (driverName === 's3') {
    const bucket = process.env.S3_BUCKET || '';
    const endpoint = process.env.S3_ENDPOINT || 'default-aws';
    const region = process.env.S3_REGION || 'auto';
    console.log(
      `[Storage] Aktiver Storage-Treiber: S3 (Bucket: "${bucket}", Endpoint: "${endpoint}", Region: "${region}")`
    );
  } else {
    const localDir =
      process.env.STORAGE_LOCAL_DIR ||
      path.join(/*turbopackIgnore: true*/ process.cwd(), 'storage', 'uploads');
    const isEphemeral = isProduction && !process.env.STORAGE_LOCAL_DIR;
    if (isEphemeral) {
      console.warn(
        `[Storage] WARNUNG: FilesystemStorageAdapter laeuft auf ephemerem Dateisystem in Produktion! Uploads gehen bei Render-Neustarts/Deploys verloren. Setzen Sie S3_BUCKET oder STORAGE_LOCAL_DIR.`
      );
    } else {
      console.log(`[Storage] Aktiver Storage-Treiber: Filesystem (Verzeichnis: "${localDir}")`);
    }
  }
}

/**
 * Setzt den Logging-Status zurueck (nur fuer Unit-Tests).
 */
export function resetStorageDriverLogForTests(): void {
  hasLoggedStorageDriver = false;
}

/**
 * Liefert den gemaess Umgebungsvariablen konfigurierten Storage-Adapter zurueck.
 */
export function getStorageAdapter(): StorageAdapter {
  if (!hasLoggedStorageDriver) {
    logActiveStorageDriver();
    hasLoggedStorageDriver = true;
  }

  const driver = process.env.STORAGE_DRIVER?.toLowerCase();
  const bucket = process.env.S3_BUCKET || '';
  const accessKeyId = (process.env.S3_ACCESS_KEY_ID || process.env.AWS_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (
    process.env.S3_SECRET_ACCESS_KEY ||
    process.env.AWS_SECRET_ACCESS_KEY ||
    ''
  ).trim();

  const hasS3Config = Boolean(bucket && accessKeyId && secretAccessKey);

  if (driver === 's3' || (!driver && hasS3Config)) {
    return new S3StorageAdapter({
      bucket,
      endpoint: process.env.S3_ENDPOINT,
      region: process.env.S3_REGION || 'auto',
      accessKeyId,
      secretAccessKey,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE !== 'false',
    });
  }

  return new FilesystemStorageAdapter();
}

export const STORAGE_REF_PREFIX = '<!-- PRUEFLI_STORAGE_REF:';
const STORAGE_REF_SUFFIX = ' -->';

/**
 * Prueft, ob ein Referenztext (z. B. rubricText oder examTemplateText) ein Storage-Pointer ist.
 */
export function isStorageReferencePointer(value?: string | null): boolean {
  if (!value || typeof value !== 'string') return false;
  const trimmed = value.trim();
  return trimmed.startsWith(STORAGE_REF_PREFIX) && trimmed.endsWith(STORAGE_REF_SUFFIX);
}

/**
 * Extrahiert den Storage-Key aus einem Storage-Pointer-String.
 */
export function extractStorageReferenceKey(value?: string | null): string | null {
  if (!isStorageReferencePointer(value)) return null;
  const trimmed = (value || '').trim();
  const key = trimmed.slice(STORAGE_REF_PREFIX.length, -STORAGE_REF_SUFFIX.length).trim();
  return key || null;
}

/**
 * Lagert grosse serialisierte Referenzdokumente (Base64-JSON fuer PDF/Bilder in rubricText oder examTemplateText)
 * in den konfigurierten StorageAdapter aus und gibt einen kompakten Pointer-String zurueck.
 * Reine Text-Musterloesungen bleiben unveraendert in der Datenbankspalte.
 */
export async function offloadReferenceMaterialToStorage(
  rawText: string | null | undefined,
  options?: { minBytesThreshold?: number; adapter?: StorageAdapter }
): Promise<{ storedValue: string; storageKey: string | null }> {
  if (!rawText || typeof rawText !== 'string') {
    return { storedValue: '', storageKey: null };
  }
  const trimmed = rawText.trim();
  if (isStorageReferencePointer(trimmed)) {
    return {
      storedValue: trimmed,
      storageKey: extractStorageReferenceKey(trimmed),
    };
  }

  const threshold = options?.minBytesThreshold ?? 32_768; // 32 KB default threshold
  const isSerializedDoc =
    (trimmed.startsWith('{') && trimmed.endsWith('}') && trimmed.includes('"mimeType"')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']') && trimmed.includes('"mimeType"'));

  if (!isSerializedDoc || Buffer.byteLength(trimmed, 'utf-8') < threshold) {
    return { storedValue: rawText, storageKey: null };
  }

  const hash = crypto.createHash('sha256').update(trimmed).digest('hex');
  const storageKey = `references/ref-${hash}.json`;
  const adapter = options?.adapter || getStorageAdapter();
  await adapter.write(storageKey, Buffer.from(trimmed, 'utf-8'), 'application/json');
  return {
    storedValue: `${STORAGE_REF_PREFIX}${storageKey}${STORAGE_REF_SUFFIX}`,
    storageKey,
  };
}

/**
 * Loest einen Storage-Pointer transparent wieder zum urspruenglichen serialisierten Referenzdokument auf.
 * Falls kein Pointer vorliegt, wird der Eingabetext unveraendert zurueckgegeben.
 */
export async function resolveStoredReferenceMaterial(
  value: string | null | undefined,
  options?: { adapter?: StorageAdapter }
): Promise<string> {
  if (!value || typeof value !== 'string') return '';
  const storageKey = extractStorageReferenceKey(value);
  if (!storageKey) return value;

  try {
    const adapter = options?.adapter || getStorageAdapter();
    const file = await adapter.read(storageKey);
    if (!file) return value;
    return file.buffer.toString('utf-8');
  } catch {
    return value;
  }
}
