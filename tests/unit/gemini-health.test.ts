import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  checkGeminiHealth,
  categorizeGeminiError,
  isDuplicateSubmissionErrorMessage,
  GEMINI_HEALTH_TIMEOUT_MS,
} from '@/lib/gemini';
import { GET } from '@/app/api/health/gemini/route';
import * as sessionModule from '@/lib/session';

const mockCountTokens = vi.fn();

vi.mock('@google/genai', () => {
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        countTokens: mockCountTokens,
      },
    })),
    Type: {
      OBJECT: 'OBJECT',
      STRING: 'STRING',
      BOOLEAN: 'BOOLEAN',
      NUMBER: 'NUMBER',
      ARRAY: 'ARRAY',
      INTEGER: 'INTEGER',
    },
    ThinkingLevel: {
      LOW: 'LOW',
      HIGH: 'HIGH',
    },
  };
});

vi.mock('@/lib/session', () => ({
  getSession: vi.fn(),
}));

describe('Gemini Health Check & Error Categorization (/api/health/gemini)', () => {
  const originalEnvKey = process.env.GEMINI_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.GEMINI_API_KEY = 'test-api-key';
  });

  afterEach(() => {
    process.env.GEMINI_API_KEY = originalEnvKey;
  });

  it('has a default probe timeout of 15 seconds (15_000 ms)', () => {
    expect(GEMINI_HEALTH_TIMEOUT_MS).toBe(15_000);
  });

  it('returns ok: true with latencyMs and no errorCategory on successful countTokens', async () => {
    mockCountTokens.mockResolvedValueOnce({ totalTokens: 1 });

    const result = await checkGeminiHealth('valid-key');

    expect(result.ok).toBe(true);
    expect(typeof result.latencyMs).toBe('number');
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
    expect(result.errorCategory).toBeUndefined();
    expect(mockCountTokens).toHaveBeenCalledWith(
      expect.objectContaining({
        model: 'gemini-3.8-flash',
        contents: 'health-check',
      })
    );
  });

  it('categorizes client timeout / AbortError as TIMEOUT', async () => {
    const timeoutError = new Error('The operation was aborted due to timeout');
    timeoutError.name = 'AbortError';
    mockCountTokens.mockRejectedValueOnce(timeoutError);

    const result = await checkGeminiHealth('valid-key');

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('TIMEOUT');
    expect(typeof result.latencyMs).toBe('number');
  });

  it('categorizes undici HeadersTimeoutError (UND_ERR_HEADERS_TIMEOUT) as TIMEOUT', async () => {
    const undiciError = new Error('Headers Timeout Error');
    (undiciError as unknown as { code: string }).code = 'UND_ERR_HEADERS_TIMEOUT';
    mockCountTokens.mockRejectedValueOnce(undiciError);

    const result = await checkGeminiHealth('valid-key');

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('TIMEOUT');
  });

  it('categorizes network connection errors (ECONNREFUSED, fetch failed) as NETWORK', async () => {
    const networkError = new Error('fetch failed: connect ECONNREFUSED 142.250.180.106:443');
    mockCountTokens.mockRejectedValueOnce(networkError);

    const result = await checkGeminiHealth('valid-key');

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('NETWORK');
  });

  it('categorizes upstream server 503 or overload errors as UPSTREAM_SERVICE', async () => {
    const upstreamError = new Error(
      '503 Service Unavailable: The model is overloaded. Please try again later.'
    );
    mockCountTokens.mockRejectedValueOnce(upstreamError);

    const result = await checkGeminiHealth('valid-key');

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('UPSTREAM_SERVICE');
  });

  it('categorizes quota exhaustion or 429 errors as RATE_LIMIT', async () => {
    const rateLimitError = new Error('429 Resource Exhausted: quota exceeded for quota metric');
    mockCountTokens.mockRejectedValueOnce(rateLimitError);

    const result = await checkGeminiHealth('valid-key');

    expect(result.ok).toBe(false);
    expect(result.errorCategory).toBe('RATE_LIMIT');
  });

  it('returns ok: false and UNKNOWN error category when GEMINI_API_KEY is not configured', async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await checkGeminiHealth();

    expect(result.ok).toBe(false);
    expect(result.latencyMs).toBe(0);
    expect(result.errorCategory).toBe('UNKNOWN');
    expect(mockCountTokens).not.toHaveBeenCalled();
  });

  it('never leaks internal provider details, URLs, keys, or stack traces in the returned result', async () => {
    const sensitiveError = new Error(
      'Failed request to https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:countTokens?key=AIzaSySecretKey'
    );
    mockCountTokens.mockRejectedValueOnce(sensitiveError);

    const result = await checkGeminiHealth('AIzaSySecretKey');

    // Strict property checks
    const keys = Object.keys(result);
    expect(keys).toEqual(expect.arrayContaining(['ok', 'latencyMs', 'errorCategory']));
    expect(keys).not.toContain('key');
    expect(keys).not.toContain('apiKey');
    expect(keys).not.toContain('url');
    expect(keys).not.toContain('model');
    expect(keys).not.toContain('modelName');
    expect(keys).not.toContain('technicalDetails');
    expect(keys).not.toContain('userMessage');

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('AIzaSySecretKey');
    expect(serialized).not.toContain('googleapis.com');
    expect(serialized).not.toContain('gemini-3.8-flash');
  });

  describe('GET /api/health/gemini Route Authentication & Responses', () => {
    it('rejects unauthenticated requests with HTTP 401', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce(null);

      const response = await GET();

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data).toEqual({ error: 'Nicht autorisiert.' });
      expect(mockCountTokens).not.toHaveBeenCalled();
    });

    it('allows authenticated teachers and returns health check JSON with HTTP 200', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce({ userId: 'teacher-123' });
      mockCountTokens.mockResolvedValueOnce({ totalTokens: 1 });

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(true);
      expect(typeof data.latencyMs).toBe('number');
      expect(data.errorCategory).toBeUndefined();
    });

    it('returns error category with HTTP 200 for authenticated teachers when Gemini fails', async () => {
      vi.mocked(sessionModule.getSession).mockResolvedValueOnce({ userId: 'teacher-123' });
      const timeoutError = new Error('Request headers timeout UND_ERR_HEADERS_TIMEOUT');
      mockCountTokens.mockRejectedValueOnce(timeoutError);

      const response = await GET();

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data.ok).toBe(false);
      expect(typeof data.latencyMs).toBe('number');
      expect(data.errorCategory).toBe('TIMEOUT');
    });
  });

  describe('Duplicate Submission Background Error Categorization (DUPLICATE_SUBMISSION)', () => {
    it('categorizes background duplicate student error as DUPLICATE_SUBMISSION and preserves actionable replace message', () => {
      const dupErr = new Error(
        'Für Schüler/in "Anna Beispiel" existiert bereits eine Korrektur. Klicke auf \'Korrektur ersetzen\', um sie zu überschreiben.'
      );

      const categorized = categorizeGeminiError(dupErr);

      expect(categorized.category).toBe('DUPLICATE_SUBMISSION');
      expect(categorized.userMessage).toBe(
        'Für Schüler/in "Anna Beispiel" existiert bereits eine Korrektur. Klicke auf \'Korrektur ersetzen\', um sie zu überschreiben.'
      );
      expect(categorized.userMessage).toContain('Korrektur ersetzen');
      expect(categorized.userMessage).not.toContain('Ein unerwarteter Fehler');
      expect(categorized.userMessage).not.toContain('\u00df');
      expect(isDuplicateSubmissionErrorMessage(categorized.userMessage)).toBe(true);
    });

    it('prioritizes DUPLICATE_SUBMISSION even if student or context string contains status-like numbers (e.g. 500)', () => {
      const dupErr = new Error(
        'Für Schüler/in "Klasse 500 Anna" existiert bereits eine Korrektur. Klicke auf \'Korrektur ersetzen\', um sie zu überschreiben.'
      );

      const categorized = categorizeGeminiError(dupErr);

      expect(categorized.category).toBe('DUPLICATE_SUBMISSION');
      expect(categorized.userMessage).toContain('Klasse 500 Anna');
      expect(categorized.userMessage).toContain('Korrektur ersetzen');
    });

    it('normalizes any Eszett to Swiss German "ss" in duplicate error messages', () => {
      const dupErr = new Error(
        'Für Schüler/in "Lukas Gro\u00df" existiert bereits eine Korrektur. Klicke auf \'Korrektur ersetzen\', um sie zu überschreiben.'
      );

      const categorized = categorizeGeminiError(dupErr);

      expect(categorized.category).toBe('DUPLICATE_SUBMISSION');
      expect(categorized.userMessage).toContain('Lukas Gross');
      expect(categorized.userMessage).not.toContain('\u00df');
    });
  });
});
