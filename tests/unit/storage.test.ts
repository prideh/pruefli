import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import path from 'path';
import fs from 'fs/promises';
import { existsSync } from 'fs';
import {
  normalizeStorageKey,
  resolveMimeType,
  FilesystemStorageAdapter,
  S3StorageAdapter,
  getStorageAdapter,
  getActiveStorageDriverName,
  logActiveStorageDriver,
  resetStorageDriverLogForTests,
  type StorageAdapter,
} from '@/lib/storage';
import { GET, HEAD } from '@/app/uploads/[...file]/route';
import * as sessionModule from '@/lib/session';
import { db } from '@/lib/db';

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  db: {
    submission: {
      findFirst: vi.fn(),
    },
  },
}));

describe('Storage System (lib/storage.ts)', () => {
  const originalEnv = { ...process.env };
  const testStorageDir = path.join(process.cwd(), 'tmp-test-storage');

  beforeEach(async () => {
    process.env = { ...originalEnv };
    delete process.env.S3_BUCKET;
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_SECRET_ACCESS_KEY;
    delete process.env.STORAGE_DRIVER;
    delete process.env.STORAGE_LOCAL_DIR;
    delete process.env.S3_ENDPOINT;
    delete process.env.S3_REGION;
    delete process.env.S3_FORCE_PATH_STYLE;
    resetStorageDriverLogForTests();
    await fs.mkdir(testStorageDir, { recursive: true });
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    if (existsSync(testStorageDir)) {
      await fs.rm(testStorageDir, { recursive: true, force: true });
    }
  });

  describe('normalizeStorageKey & resolveMimeType', () => {
    it('normalisiert verschiedene Pfadvarianten einheitlich', () => {
      expect(normalizeStorageKey('/uploads/test.pdf')).toBe('test.pdf');
      expect(normalizeStorageKey('uploads/test.pdf')).toBe('test.pdf');
      expect(normalizeStorageKey('test.pdf')).toBe('test.pdf');
      expect(normalizeStorageKey('/uploads/subfolder/test.png')).toBe('subfolder/test.png');
      expect(normalizeStorageKey('\\uploads\\test.jpg')).toBe('test.jpg');
      expect(normalizeStorageKey('')).toBe('');
    });

    it('erkennt gaengige MIME-Types zuverlaessig', () => {
      expect(resolveMimeType('scan.pdf')).toBe('application/pdf');
      expect(resolveMimeType('image.png')).toBe('image/png');
      expect(resolveMimeType('photo.jpg')).toBe('image/jpeg');
      expect(resolveMimeType('photo.jpeg')).toBe('image/jpeg');
      expect(resolveMimeType('graphic.webp')).toBe('image/webp');
      expect(resolveMimeType('unknown.xyz')).toBe('application/octet-stream');
    });
  });

  describe('FilesystemStorageAdapter', () => {
    it('schreibt, liest, prueft und loescht Dateien im Speicherverzeichnis', async () => {
      const adapter = new FilesystemStorageAdapter(testStorageDir);
      const testBuffer = Buffer.from('PDF_TEST_INHALT');
      const filename = 'arbeitsblatt.pdf';

      const savedUrl = await adapter.write(filename, testBuffer, 'application/pdf');
      expect(savedUrl).toBe('/uploads/arbeitsblatt.pdf');

      const exists = await adapter.exists(filename);
      expect(exists).toBe(true);

      const fileData = await adapter.read(filename);
      expect(fileData).not.toBeNull();
      expect(fileData?.buffer.toString()).toBe('PDF_TEST_INHALT');
      expect(fileData?.contentType).toBe('application/pdf');

      const deleted = await adapter.delete(filename);
      expect(deleted).toBe(true);
      expect(await adapter.exists(filename)).toBe(false);
      expect(await adapter.read(filename)).toBeNull();
    });

    it('gibt false zurueck wenn nicht existierende Datei geloescht wird', async () => {
      const adapter = new FilesystemStorageAdapter(testStorageDir);
      const deleted = await adapter.delete('nicht_vorhanden.pdf');
      expect(deleted).toBe(false);
    });
  });

  describe('S3StorageAdapter (SigV4 & S3-Kompatibilitaet)', () => {
    const s3Config = {
      bucket: 'grade-ai-test-bucket',
      endpoint: 'https://test-account.r2.cloudflarestorage.com',
      region: 'auto',
      accessKeyId: 'TEST_KEY_ID',
      secretAccessKey: 'TEST_SECRET_KEY_12345',
      forcePathStyle: true,
    };

    it('generiert korrekte AWS SigV4 Header und sendet PUT-Request beim Schreiben', async () => {
      const adapter = new S3StorageAdapter(s3Config);
      const testData = Buffer.from('TEST_SCAN_BYTES');

      let interceptedUrl = '';
      let interceptedHeaders: Record<string, string> = {};
      let interceptedMethod = '';

      vi.spyOn(global, 'fetch').mockImplementation(async (url, init) => {
        interceptedUrl = String(url);
        interceptedMethod = init?.method || '';
        interceptedHeaders = (init?.headers || {}) as Record<string, string>;
        return new Response(null, { status: 200 });
      });

      const resUrl = await adapter.write('student_scan.pdf', testData, 'application/pdf');

      expect(resUrl).toBe('/uploads/student_scan.pdf');
      expect(interceptedMethod).toBe('PUT');
      expect(interceptedUrl).toBe(
        'https://test-account.r2.cloudflarestorage.com/grade-ai-test-bucket/student_scan.pdf'
      );
      expect(interceptedHeaders['content-type']).toBe('application/pdf');
      expect(interceptedHeaders['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);

      const auth = interceptedHeaders['Authorization'] || interceptedHeaders['authorization'] || '';
      expect(auth).toContain('AWS4-HMAC-SHA256');
      expect(auth).toContain('Credential=TEST_KEY_ID/');
      expect(auth).toContain('SignedHeaders=');
      expect(auth).toContain('Signature=');
    });

    it('liest Dateien ueber GET und liefert Buffer zurueck', async () => {
      const adapter = new S3StorageAdapter(s3Config);
      const responseData = Buffer.from('EMPFANGENE_BYTES');

      vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response(responseData, {
          status: 200,
          headers: { 'content-type': 'application/pdf' },
        })
      );

      const result = await adapter.read('schueler.pdf');
      expect(result).not.toBeNull();
      expect(result?.buffer.toString()).toBe('EMPFANGENE_BYTES');
      expect(result?.contentType).toBe('application/pdf');
    });

    it('liefert null zurueck wenn S3 ein 404 meldet', async () => {
      const adapter = new S3StorageAdapter(s3Config);
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

      const result = await adapter.read('unbekannt.pdf');
      expect(result).toBeNull();
    });

    it('prueft Existenz ueber HEAD-Request', async () => {
      const adapter = new S3StorageAdapter(s3Config);
      const fetchSpy = vi
        .spyOn(global, 'fetch')
        .mockResolvedValue(new Response(null, { status: 200 }));

      const exists = await adapter.exists('datei.png');
      expect(exists).toBe(true);
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining('datei.png'),
        expect.objectContaining({ method: 'HEAD' })
      );
    });

    it('loescht Dateien ueber DELETE-Request', async () => {
      const adapter = new S3StorageAdapter(s3Config);
      vi.spyOn(global, 'fetch').mockResolvedValue(new Response(null, { status: 204 }));

      const deleted = await adapter.delete('datei.png');
      expect(deleted).toBe(true);
    });

    it('unterstuetzt benutzerdefinierte S3-Endpoints wie Cloudflare R2 und Backblaze B2', async () => {
      const r2Config = {
        bucket: 'grade-ai-r2-scans',
        endpoint: 'https://test-account-id.r2.cloudflarestorage.com',
        region: 'auto',
        accessKeyId: 'R2_KEY_ID',
        secretAccessKey: 'R2_SECRET_KEY',
        forcePathStyle: true,
      };

      const adapter = new S3StorageAdapter(r2Config);
      const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
        new Response('R2_TEST_DATA', {
          status: 200,
          headers: { 'content-type': 'image/png' },
        })
      );

      const result = await adapter.read('student-scan.png');
      expect(result).not.toBeNull();
      expect(result?.buffer.toString()).toBe('R2_TEST_DATA');

      // Pruefe, dass der R2-Endpoint korrekt mit Pfad-Style aufgerufen wurde
      expect(fetchSpy).toHaveBeenCalledWith(
        'https://test-account-id.r2.cloudflarestorage.com/grade-ai-r2-scans/student-scan.png',
        expect.objectContaining({
          method: 'GET',
          headers: expect.objectContaining({
            host: 'test-account-id.r2.cloudflarestorage.com',
            Authorization: expect.stringContaining('AWS4-HMAC-SHA256'),
          }),
        })
      );
    });
  });

  describe('getStorageAdapter Factory & Treiber-Erkennung', () => {
    it('liefert FilesystemStorageAdapter wenn keine S3-Variablen gesetzt sind', () => {
      const adapter = getStorageAdapter();
      expect(adapter).toBeInstanceOf(FilesystemStorageAdapter);
      expect(getActiveStorageDriverName()).toBe('filesystem');
    });

    it('liefert S3StorageAdapter wenn S3-Umgebungsvariablen vorhanden sind', () => {
      process.env.S3_BUCKET = 'schul-scans';
      process.env.S3_ACCESS_KEY_ID = 'KEY123';
      process.env.S3_SECRET_ACCESS_KEY = 'SECRET123';

      const adapter = getStorageAdapter();
      expect(adapter).toBeInstanceOf(S3StorageAdapter);
      expect(getActiveStorageDriverName()).toBe('s3');
    });

    it('priorisiert STORAGE_DRIVER=s3', () => {
      process.env.STORAGE_DRIVER = 's3';
      process.env.S3_BUCKET = 'schul-scans';
      process.env.S3_ACCESS_KEY_ID = 'KEY123';
      process.env.S3_SECRET_ACCESS_KEY = 'SECRET123';

      expect(getActiveStorageDriverName()).toBe('s3');
    });

    it('nutzt STORAGE_LOCAL_DIR fuer FilesystemStorageAdapter wenn gesetzt', () => {
      process.env.STORAGE_LOCAL_DIR = '/var/data/custom-uploads';
      const adapter = getStorageAdapter();
      expect(adapter).toBeInstanceOf(FilesystemStorageAdapter);
      expect(getActiveStorageDriverName()).toBe('filesystem');
    });

    it('gibt informatives Start-Log fuer S3 aus', () => {
      process.env.S3_BUCKET = 'grade-ai-bucket';
      process.env.S3_ACCESS_KEY_ID = 'KEY123';
      process.env.S3_SECRET_ACCESS_KEY = 'SECRET123';
      process.env.S3_ENDPOINT = 'https://r2.example.com';

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      logActiveStorageDriver();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('[Storage] Aktiver Storage-Treiber: S3')
      );
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('grade-ai-bucket'));
    });

    it('gibt eine deutliche Warnung aus wenn Filesystem in Produktion ohne Persistent Disk laeuft', () => {
      delete process.env.STORAGE_LOCAL_DIR;

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      logActiveStorageDriver(true);

      expect(warnSpy).toHaveBeenCalledWith(
        expect.stringContaining(
          '[Storage] WARNUNG: FilesystemStorageAdapter laeuft auf ephemerem Dateisystem in Produktion!'
        )
      );
    });
  });
});

describe('Scan Access Control Route (app/uploads/[...file]/route.ts)', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('lehnt Path-Traversal Versuche mit 400 ab', async () => {
    const req = new Request('http://localhost:3000/uploads/../secret.txt');
    const res = await GET(req, { params: Promise.resolve({ file: ['..', 'secret.txt'] }) });

    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe('Ungueltiger Pfad.');
  });

  it('blockiert nicht authentifizierte Anfragen mit 401', async () => {
    vi.mocked(sessionModule.getSession).mockResolvedValue(null);

    const req = new Request('http://localhost:3000/uploads/scan-123.pdf');
    const res = await GET(req, { params: Promise.resolve({ file: ['scan-123.pdf'] }) });

    expect(res.status).toBe(401);
    const data = await res.json();
    expect(data.error).toBe('Nicht autorisiert.');
  });

  it('gibt 404 zurueck wenn Datei keinem Submission-Datensatz zugeordnet ist', async () => {
    vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-1' });
    vi.mocked(db.submission.findFirst).mockResolvedValue(null);

    const req = new Request('http://localhost:3000/uploads/unbekannt.pdf');
    const res = await GET(req, { params: Promise.resolve({ file: ['unbekannt.pdf'] }) });

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toBe('Scan nicht gefunden.');
  });

  it('gibt 403 zurueck wenn der Scan einer anderen Lehrperson gehoert', async () => {
    vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-1' });
    vi.mocked(db.submission.findFirst).mockResolvedValue({
      id: 'sub-1',
      studentExamUrl: '/uploads/fremder-scan.pdf',
      exam: {
        class: {
          teacherId: 'anderer-lehrer-2',
        },
      },
    } as unknown as Awaited<ReturnType<typeof db.submission.findFirst>>);

    const req = new Request('http://localhost:3000/uploads/fremder-scan.pdf');
    const res = await GET(req, { params: Promise.resolve({ file: ['fremder-scan.pdf'] }) });

    expect(res.status).toBe(403);
    const data = await res.json();
    expect(data.error).toBe('Keine Berechtigung fuer diesen Scan.');
  });

  it('liefert 200 mit privaten Sicherheitsheadern fuer autorisierte Lehrperson', async () => {
    vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-1' });
    vi.mocked(db.submission.findFirst).mockResolvedValue({
      id: 'sub-1',
      studentExamUrl: '/uploads/eigener-scan.pdf',
      exam: {
        class: {
          teacherId: 'lehrer-1',
        },
      },
    } as unknown as Awaited<ReturnType<typeof db.submission.findFirst>>);

    const testBytes = Buffer.from('PDF_SCAN_DATEN');
    const mockStorage = {
      read: vi.fn().mockResolvedValue({ buffer: testBytes, contentType: 'application/pdf' }),
      write: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn(),
      getUrl: vi.fn(),
    };

    // Temporaer mocken
    const storageModule = await import('@/lib/storage');
    vi.spyOn(storageModule, 'getStorageAdapter').mockReturnValue(
      mockStorage as unknown as StorageAdapter
    );

    const req = new Request('http://localhost:3000/uploads/eigener-scan.pdf');
    const res = await GET(req, { params: Promise.resolve({ file: ['eigener-scan.pdf'] }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('application/pdf');
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');

    const bodyBuffer = Buffer.from(await res.arrayBuffer());
    expect(bodyBuffer.toString()).toBe('PDF_SCAN_DATEN');
  });

  it('unterstuetzt HEAD-Anfragen fuer Metadatenpruefung', async () => {
    vi.mocked(sessionModule.getSession).mockResolvedValue({ userId: 'lehrer-1' });
    vi.mocked(db.submission.findFirst).mockResolvedValue({
      id: 'sub-1',
      studentExamUrl: '/uploads/eigener-scan.pdf',
      exam: {
        class: {
          teacherId: 'lehrer-1',
        },
      },
    } as unknown as Awaited<ReturnType<typeof db.submission.findFirst>>);

    const mockStorage = {
      read: vi.fn(),
      write: vi.fn(),
      delete: vi.fn(),
      exists: vi.fn().mockResolvedValue(true),
      getUrl: vi.fn(),
    };
    const storageModule = await import('@/lib/storage');
    vi.spyOn(storageModule, 'getStorageAdapter').mockReturnValue(
      mockStorage as unknown as StorageAdapter
    );

    const req = new Request('http://localhost:3000/uploads/eigener-scan.pdf');
    const res = await HEAD(req, { params: Promise.resolve({ file: ['eigener-scan.pdf'] }) });

    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('private, no-store');
    expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
  });
});

describe('Schweizer Rechtschreibung (kein Eszett)', () => {
  it('enthaelt kein Eszett in den neuen Quellcode-Dateien', async () => {
    const eszett = String.fromCharCode(0xdf);
    const filesToCheck = [
      path.resolve(__dirname, '../../lib/storage.ts'),
      path.resolve(__dirname, '../../app/uploads/[...file]/route.ts'),
      path.resolve(__dirname, '../../proxy.ts'),
      path.resolve(__dirname, './storage.test.ts'),
      path.resolve(__dirname, './proxy.test.ts'),
      path.resolve(__dirname, '../../docs/RENDER_DEPLOY_STORAGE.md'),
    ];

    for (const f of filesToCheck) {
      const content = await fs.readFile(f, 'utf-8');
      expect(content).not.toContain(eszett);
    }
  });
});
