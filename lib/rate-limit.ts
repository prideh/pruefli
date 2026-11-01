import { NextResponse } from 'next/server';

export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
  resetMs: number;
  failedOpen?: boolean;
  quotaExceeded?: boolean;
  quotaType?: 'burst' | 'cumulative';
  quota?: {
    limit: number;
    remaining: number;
    resetMs: number;
  };
}

export interface RateLimitStore {
  consume(key: string, limit: number, windowMs: number): Promise<RateLimitResult> | RateLimitResult;
  reset(key?: string): Promise<void> | void;
}

export class InMemoryRateLimitStore implements RateLimitStore {
  private hits = new Map<string, number[]>();

  consume(key: string, limit: number, windowMs: number): RateLimitResult {
    const now = Date.now();
    const windowStart = now - windowMs;

    const existing = this.hits.get(key) || [];
    const active = existing.filter((ts) => ts > windowStart);

    if (active.length >= limit) {
      const oldest = active[0] ?? windowStart;
      const resetMs = Math.max(0, oldest + windowMs - now);
      const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));
      this.hits.set(key, active);

      return {
        allowed: false,
        limit,
        remaining: 0,
        retryAfterSeconds,
        resetMs,
      };
    }

    active.push(now);
    this.hits.set(key, active);

    const remaining = Math.max(0, limit - active.length);
    const oldest = active[0] ?? now;
    const resetMs = Math.max(0, oldest + windowMs - now);
    const retryAfterSeconds = Math.max(1, Math.ceil(resetMs / 1000));

    if (this.hits.size > 5000) {
      this.prune(now, windowMs);
    }

    return {
      allowed: true,
      limit,
      remaining,
      retryAfterSeconds,
      resetMs,
    };
  }

  reset(key?: string): void {
    if (key) {
      this.hits.delete(key);
    } else {
      this.hits.clear();
    }
  }

  private prune(now: number, windowMs: number): void {
    for (const [k, timestamps] of this.hits.entries()) {
      const valid = timestamps.filter((ts) => ts > now - windowMs);
      if (valid.length === 0) {
        this.hits.delete(k);
      } else {
        this.hits.set(k, valid);
      }
    }
  }
}

const globalForRateLimit = globalThis as unknown as {
  __gradeAiRateLimitStore?: RateLimitStore;
};

export function getRateLimitStore(): RateLimitStore {
  if (!globalForRateLimit.__gradeAiRateLimitStore) {
    globalForRateLimit.__gradeAiRateLimitStore = new InMemoryRateLimitStore();
  }
  return globalForRateLimit.__gradeAiRateLimitStore;
}

export function setRateLimitStore(store: RateLimitStore | undefined): void {
  globalForRateLimit.__gradeAiRateLimitStore = store;
}

export function resetRateLimits(key?: string): void {
  const store = getRateLimitStore();
  if (key) {
    store.reset(key);
    store.reset(`quota:${key}`);
  } else {
    store.reset();
  }
}

export function getRateLimitConfig(options?: {
  scope?: 'teacher' | 'relay' | string;
  endpoint?: string;
}): RateLimitConfig {
  let maxRequests = 60;
  let windowSeconds = 60;

  const envMax = process.env.AI_RATE_LIMIT_MAX_REQUESTS || process.env.AI_RATE_LIMIT_LIMIT;
  if (envMax && Number.isFinite(Number(envMax)) && Number(envMax) > 0) {
    maxRequests = Math.floor(Number(envMax));
  }

  const envWindow = process.env.AI_RATE_LIMIT_WINDOW_SECONDS;
  if (envWindow && Number.isFinite(Number(envWindow)) && Number(envWindow) > 0) {
    windowSeconds = Math.floor(Number(envWindow));
  } else {
    const envWindowMs = process.env.AI_RATE_LIMIT_WINDOW_MS;
    if (envWindowMs && Number.isFinite(Number(envWindowMs)) && Number(envWindowMs) > 0) {
      windowSeconds = Math.max(1, Math.floor(Number(envWindowMs) / 1000));
    }
  }

  if (options?.scope === 'relay') {
    const relayMax =
      process.env.AI_RATE_LIMIT_RELAY_MAX_REQUESTS || process.env.AI_RATE_LIMIT_RELAY_MAX;
    if (relayMax && Number.isFinite(Number(relayMax)) && Number(relayMax) > 0) {
      maxRequests = Math.floor(Number(relayMax));
    }
    const relayWindow = process.env.AI_RATE_LIMIT_RELAY_WINDOW_SECONDS;
    if (relayWindow && Number.isFinite(Number(relayWindow)) && Number(relayWindow) > 0) {
      windowSeconds = Math.floor(Number(relayWindow));
    }
  }

  if (options?.endpoint) {
    const endpointKey = options.endpoint.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const endpointMax =
      process.env[`AI_RATE_LIMIT_${endpointKey}_MAX_REQUESTS`] ||
      process.env[`AI_RATE_LIMIT_${endpointKey}_MAX`];
    if (endpointMax && Number.isFinite(Number(endpointMax)) && Number(endpointMax) > 0) {
      maxRequests = Math.floor(Number(endpointMax));
    }
  }

  return {
    maxRequests,
    windowMs: windowSeconds * 1000,
  };
}

export interface QuotaConfig {
  enabled: boolean;
  maxRequests: number;
  windowMs: number;
}

/**
 * Ermittelt die Konfiguration des kumulativen Kontingents fuer KI-Anfragen.
 *
 * Verhalten bei fehlenden Umgebungsvariablen:
 * Ist weder AI_QUOTA_MAX_REQUESTS noch AI_QUOTA_LIMIT gesetzt, ist das kumulative Kontingent
 * vollstaendig deaktiviert (enabled = false). In diesem Fall greift ausschliesslich das Burst-Limit.
 * Es gibt keine hartkodierten Budget-Zahlen ohne explizite Vorgabe.
 *
 * Konfigurationsmoeglichkeiten:
 * - AI_QUOTA_MAX_REQUESTS / AI_QUOTA_LIMIT: Maximale Anzahl kumulativer Anfragen im Zeitraum
 * - AI_QUOTA_WINDOW_SECONDS: Fensterlaenge in Sekunden (z. B. 86400 fuer 1 Tag)
 * - AI_QUOTA_WINDOW_DAYS: Fensterlaenge in Tagen (z. B. 1 fuer Tag, 30 fuer Monat)
 * - AI_QUOTA_WINDOW_HOURS: Fensterlaenge in Stunden
 * - AI_QUOTA_PERIOD: 'day' / 'daily' (86400s) oder 'month' / 'monthly' (30 * 86400s)
 * - Scope-spezifisch: AI_QUOTA_RELAY_MAX_REQUESTS / AI_QUOTA_RELAY_LIMIT
 * - Endpunkt-spezifisch: AI_QUOTA_<ENDPOINT>_MAX_REQUESTS / AI_QUOTA_<ENDPOINT>_LIMIT
 *
 * Standardfenster bei gesetztem Limit ohne Zeitfenstervorgabe: 24 Stunden (86'400 Sekunden).
 */
export function getQuotaConfig(options?: { scope?: string; endpoint?: string }): QuotaConfig {
  let enabled = false;
  let maxRequests = 0;
  let windowSeconds = 86400; // Standard: 24 Stunden (1 Tag)

  const envMax = process.env.AI_QUOTA_MAX_REQUESTS || process.env.AI_QUOTA_LIMIT;
  if (envMax && Number.isFinite(Number(envMax)) && Number(envMax) > 0) {
    enabled = true;
    maxRequests = Math.floor(Number(envMax));
  }

  if (options?.scope === 'relay') {
    const relayMax = process.env.AI_QUOTA_RELAY_MAX_REQUESTS || process.env.AI_QUOTA_RELAY_LIMIT;
    if (relayMax && Number.isFinite(Number(relayMax)) && Number(relayMax) > 0) {
      enabled = true;
      maxRequests = Math.floor(Number(relayMax));
    }
  }

  if (options?.endpoint) {
    const endpointKey = options.endpoint.toUpperCase().replace(/[^A-Z0-9]/g, '_');
    const endpointMax =
      process.env[`AI_QUOTA_${endpointKey}_MAX_REQUESTS`] ||
      process.env[`AI_QUOTA_${endpointKey}_LIMIT`];
    if (endpointMax && Number.isFinite(Number(endpointMax)) && Number(endpointMax) > 0) {
      enabled = true;
      maxRequests = Math.floor(Number(endpointMax));
    }
  }

  if (!enabled) {
    return {
      enabled: false,
      maxRequests: 0,
      windowMs: 0,
    };
  }

  const envWindowSeconds = process.env.AI_QUOTA_WINDOW_SECONDS;
  const envWindowDays = process.env.AI_QUOTA_WINDOW_DAYS;
  const envWindowHours = process.env.AI_QUOTA_WINDOW_HOURS;
  const envPeriod = (process.env.AI_QUOTA_PERIOD || '').toLowerCase().trim();

  if (
    envWindowSeconds &&
    Number.isFinite(Number(envWindowSeconds)) &&
    Number(envWindowSeconds) > 0
  ) {
    windowSeconds = Math.floor(Number(envWindowSeconds));
  } else if (envWindowDays && Number.isFinite(Number(envWindowDays)) && Number(envWindowDays) > 0) {
    windowSeconds = Math.floor(Number(envWindowDays)) * 86400;
  } else if (
    envWindowHours &&
    Number.isFinite(Number(envWindowHours)) &&
    Number(envWindowHours) > 0
  ) {
    windowSeconds = Math.floor(Number(envWindowHours)) * 3600;
  } else if (envPeriod === 'month' || envPeriod === 'monthly') {
    windowSeconds = 30 * 86400;
  } else if (envPeriod === 'day' || envPeriod === 'daily') {
    windowSeconds = 86400;
  }

  return {
    enabled: true,
    maxRequests,
    windowMs: windowSeconds * 1000,
  };
}

export interface CheckRateLimitOptions {
  identifier: string;
  scope?: 'teacher' | 'relay' | string;
  endpoint?:
    | 'correct'
    | 'generate'
    | 'regenerate-task'
    | 'mobile-relay-upload'
    | 'parse-rubric'
    | 'replace'
    | string;
  limit?: number;
  windowMs?: number;
  quotaLimit?: number;
  quotaWindowMs?: number;
  store?: RateLimitStore;
}

export async function checkAiRateLimit(options: CheckRateLimitOptions): Promise<RateLimitResult> {
  const scope = options.scope || 'teacher';
  const burstKey = `${scope}:${options.identifier}`;
  const quotaKey = `quota:${burstKey}`;

  const burstConfig = getRateLimitConfig({
    scope: options.scope,
    endpoint: options.endpoint,
  });

  const quotaConfig = getQuotaConfig({
    scope: options.scope,
    endpoint: options.endpoint,
  });

  const burstLimit = options.limit ?? burstConfig.maxRequests;
  const burstWindowMs = options.windowMs ?? burstConfig.windowMs;
  const store = options.store ?? getRateLimitStore();

  const quotaLimit = options.quotaLimit ?? (quotaConfig.enabled ? quotaConfig.maxRequests : null);
  const quotaWindowMs =
    options.quotaWindowMs ?? (quotaConfig.enabled ? quotaConfig.windowMs : null);

  try {
    // 1. Burst-Limit pruefen
    const burstResult = await store.consume(burstKey, burstLimit, burstWindowMs);
    if (!burstResult.allowed) {
      return {
        ...burstResult,
        quotaExceeded: false,
        quotaType: 'burst',
      };
    }

    // 2. Kumulatives Kontingent pruefen (falls konfiguriert)
    if (quotaLimit !== null && quotaWindowMs !== null) {
      const quotaResult = await store.consume(quotaKey, quotaLimit, quotaWindowMs);
      if (!quotaResult.allowed) {
        return {
          ...quotaResult,
          quotaExceeded: true,
          quotaType: 'cumulative',
          quota: {
            limit: quotaResult.limit,
            remaining: quotaResult.remaining,
            resetMs: quotaResult.resetMs,
          },
        };
      }

      return {
        ...burstResult,
        quotaExceeded: false,
        quotaType: 'burst',
        quota: {
          limit: quotaResult.limit,
          remaining: quotaResult.remaining,
          resetMs: quotaResult.resetMs,
        },
      };
    }

    return {
      ...burstResult,
      quotaExceeded: false,
      quotaType: 'burst',
    };
  } catch (error) {
    // Definiertes Fehlverhalten: Ein Ausfall des Limit-Speichers darf den Korrekturfluss nicht unbemerkt blockieren (geloggtes Fail-Open).
    console.error(
      `[RateLimit] Speicherfehler beim Pruefen des Ratenlimits fuer ${burstKey}. Anfrage wird zugelassen (Fail-Open):`,
      error
    );
    return {
      allowed: true,
      limit: burstLimit,
      remaining: 1,
      retryAfterSeconds: 0,
      resetMs: 0,
      failedOpen: true,
    };
  }
}

export function createRateLimitResponse(
  result: RateLimitResult,
  customMessage?: string
): NextResponse {
  let defaultMessage =
    'Ratenlimit ueberschritten. Zu viele KI-Anfragen. Bitte versuchen Sie es in Kuerze erneut.';

  if (result.quotaExceeded) {
    defaultMessage =
      'Kumulatives KI-Kontingent erreicht. Das maximale Kontingent an KI-Anfragen fuer diesen Zeitraum ist erschoepft.';
  }

  const message = customMessage || defaultMessage;

  const headers: Record<string, string> = {
    'Retry-After': String(result.retryAfterSeconds),
    'X-RateLimit-Limit': String(result.limit),
    'X-RateLimit-Remaining': String(result.remaining),
    'X-RateLimit-Reset': String(result.retryAfterSeconds),
  };

  if (result.quotaExceeded) {
    headers['X-RateLimit-Type'] = 'cumulative-quota';
  }

  return NextResponse.json(
    {
      error: message,
      retryAfter: result.retryAfterSeconds,
      ...(result.quotaExceeded ? { quotaExceeded: true } : {}),
    },
    {
      status: 429,
      headers,
    }
  );
}

export interface AuthRateLimitConfig {
  maxRequests: number;
  windowSeconds: number;
  windowMs: number;
}

export function getAuthRateLimitConfig(
  action: 'login' | 'register' | 'forgot-password' | 'reset-password' | 'resend-verification'
): AuthRateLimitConfig {
  let maxRequests = 5;
  let windowSeconds = 60;

  if (action === 'login') {
    const envMax =
      process.env.AUTH_RATE_LIMIT_LOGIN_MAX_REQUESTS || process.env.AUTH_RATE_LIMIT_MAX_REQUESTS;
    if (envMax && Number.isFinite(Number(envMax)) && Number(envMax) > 0) {
      maxRequests = Math.floor(Number(envMax));
    }
    const envWindow =
      process.env.AUTH_RATE_LIMIT_LOGIN_WINDOW_SECONDS ||
      process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS;
    if (envWindow && Number.isFinite(Number(envWindow)) && Number(envWindow) > 0) {
      windowSeconds = Math.floor(Number(envWindow));
    }
  } else if (action === 'register') {
    const envMax =
      process.env.AUTH_RATE_LIMIT_REGISTER_MAX_REQUESTS || process.env.AUTH_RATE_LIMIT_MAX_REQUESTS;
    if (envMax && Number.isFinite(Number(envMax)) && Number(envMax) > 0) {
      maxRequests = Math.floor(Number(envMax));
    }
    const envWindow =
      process.env.AUTH_RATE_LIMIT_REGISTER_WINDOW_SECONDS ||
      process.env.AUTH_RATE_LIMIT_WINDOW_SECONDS;
    if (envWindow && Number.isFinite(Number(envWindow)) && Number(envWindow) > 0) {
      windowSeconds = Math.floor(Number(envWindow));
    }
  } else if (action === 'forgot-password' || action === 'reset-password') {
    maxRequests = 5;
    windowSeconds = 60;
  } else if (action === 'resend-verification') {
    maxRequests = 3;
    windowSeconds = 60;
  }

  return {
    maxRequests,
    windowSeconds,
    windowMs: windowSeconds * 1000,
  };
}

export type AuthRateLimitAction =
  | 'login'
  | 'register'
  | 'forgot-password'
  | 'reset-password'
  | 'resend-verification';

export interface CheckAuthRateLimitOptions {
  action: AuthRateLimitAction;
  email?: string;
  ip?: string;
  limit?: number;
  windowMs?: number;
  store?: RateLimitStore;
}

export interface AuthRateLimitResult extends RateLimitResult {
  failedClosed?: boolean;
}

export function extractClientIp(request: Request): string {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const firstIp = forwarded.split(',')[0].trim();
    if (firstIp) return firstIp;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return '127.0.0.1';
}

/**
 * Prueft das Ratenlimit fuer Authentifizierungs-Endpunkte (Login & Register).
 *
 * Schutzarchitektur:
 * 1. IP-basiertes Ratenlimit verhindert Credential Stuffing und Massenregistrierungen.
 * 2. E-Mail-basiertes Ratenlimit verhindert gezielte Brute-Force-Attacken auf einzelne Konten.
 * 3. Fail-Closed Verhalten: Im Gegensatz zu KI-Korrekturen (Fail-Open) darf ein Ausfall
 *    des Limit-Speichers keine unbegrenzten Passwortversuche erlauben. Speicherfehler
 *    weisen Anfragen sicher ab (Fail-Closed).
 */
export async function checkAuthRateLimit(
  options: CheckAuthRateLimitOptions
): Promise<AuthRateLimitResult> {
  const config = getAuthRateLimitConfig(options.action);
  const limit = options.limit ?? config.maxRequests;
  const windowMs = options.windowMs ?? config.windowMs;
  const store = options.store ?? getRateLimitStore();

  const normalizedIp = (options.ip || '').trim().toLowerCase();
  const normalizedEmail = (options.email || '').trim().toLowerCase();

  try {
    // 1. IP-basiertes Ratenlimit pruefen
    if (normalizedIp) {
      const ipKey = `auth:${options.action}:ip:${normalizedIp}`;
      const ipResult = await store.consume(ipKey, limit, windowMs);
      if (!ipResult.allowed) {
        return ipResult;
      }
    }

    // 2. E-Mail-basiertes Ratenlimit pruefen
    if (normalizedEmail) {
      const emailKey = `auth:${options.action}:email:${normalizedEmail}`;
      const emailResult = await store.consume(emailKey, limit, windowMs);
      if (!emailResult.allowed) {
        return emailResult;
      }
    }

    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      retryAfterSeconds: 0,
      resetMs: 0,
    };
  } catch (error) {
    // Sicheres Verhalten (Fail-Closed): Bei Speicherfehlern keine unbegrenzten Versuche zulassen
    console.error(
      `[AuthRateLimit] Speicherfehler beim Pruefen des Auth-Limits fuer ${options.action}. Anfrage wird abgewiesen (Fail-Closed):`,
      error
    );
    return {
      allowed: false,
      limit,
      remaining: 0,
      retryAfterSeconds: config.windowSeconds,
      resetMs: config.windowMs,
      failedClosed: true,
    };
  }
}

export function createAuthRateLimitResponse(
  result: AuthRateLimitResult,
  action: AuthRateLimitAction,
  customMessage?: string
): NextResponse {
  let defaultMessage: string;
  switch (action) {
    case 'login':
      defaultMessage =
        'Zu viele Anmeldeversuche. Bitte warten Sie einen Moment, bevor Sie es erneut versuchen.';
      break;
    case 'register':
      defaultMessage =
        'Zu viele Registrierungsversuche. Bitte warten Sie einen Moment, bevor Sie es erneut versuchen.';
      break;
    case 'forgot-password':
    case 'reset-password':
      defaultMessage =
        'Zu viele Anfragen zum Zurücksetzen des Passworts. Bitte warten Sie einen Moment.';
      break;
    case 'resend-verification':
      defaultMessage =
        'Zu viele Anfragen zum erneuten Senden der Bestätigung. Bitte warten Sie einen Moment.';
      break;
    default:
      defaultMessage = 'Zu viele Anfragen. Bitte versuchen Sie es später erneut.';
      break;
  }

  if (result.failedClosed) {
    defaultMessage =
      'Authentifizierungsdienst vorübergehend nicht verfügbar. Bitte versuchen Sie es in Kürze erneut.';
  }

  const message = customMessage || defaultMessage;

  return NextResponse.json(
    {
      error: message,
      retryAfter: result.retryAfterSeconds,
    },
    {
      status: 429,
      headers: {
        'Retry-After': String(result.retryAfterSeconds),
        'X-RateLimit-Limit': String(result.limit),
        'X-RateLimit-Remaining': String(result.remaining),
        'X-RateLimit-Reset': String(result.retryAfterSeconds),
        'X-RateLimit-Type': 'auth',
      },
    }
  );
}
