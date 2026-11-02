import { SignJWT, jwtVerify } from 'jose';

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable must be set in production!');
    }
    return new TextEncoder().encode('pruefli-dev-secret-key-safe-fallback');
  }
  return new TextEncoder().encode(secret);
}

export interface SessionJWTPayload {
  userId: string;
  sessionId?: string;
  tokenVersion?: number;
  purpose?: 'session';
  exp?: number;
  iat?: number;
}

/**
 * Signs a professional JSON Web Token (JWT) with the teacher's ID and optional session metadata.
 * @param payload Payload containing userId and optional sessionId / tokenVersion
 * @param expiry Duration of validity (e.g. '7d') or unix timestamp / Date
 * @returns A promise resolving to the signed compact JWT string.
 */
export async function signJWT(
  payload: {
    userId: string;
    sessionId?: string;
    tokenVersion?: number;
    purpose?: 'session';
  },
  expiry: string | number | Date = '7d',
  issuedAt?: Date
): Promise<string> {
  const key = getSecretKey();
  const jwtPayload: Record<string, unknown> = {
    userId: payload.userId,
    purpose: payload.purpose ?? 'session',
  };
  if (payload.sessionId) {
    jwtPayload.sessionId = payload.sessionId;
  }
  if (typeof payload.tokenVersion === 'number') {
    jwtPayload.tokenVersion = payload.tokenVersion;
  }
  const builder = new SignJWT(jwtPayload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt(issuedAt ? Math.floor(issuedAt.getTime() / 1000) : undefined)
    .setExpirationTime(expiry);
  return builder.sign(key);
}

/**
 * Verifies a JSON Web Token (JWT) and extracts the session payload.
 * Rejects any non-session purpose tokens (e.g. mobile_relay, email_verification, password_reset, oauth_*).
 * @param token The signed compact JWT string
 * @param currentDate Optional reference date for expiration checks (used in deterministic lifecycle tests)
 * @returns The payload if valid, otherwise null.
 */
export async function verifyJWT(
  token: string | undefined,
  currentDate?: Date
): Promise<SessionJWTPayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
      ...(currentDate ? { currentDate } : {}),
    });
    if (payload.purpose && payload.purpose !== 'session') {
      return null;
    }
    if (typeof payload.userId !== 'string' || !payload.userId) {
      return null;
    }
    return payload as unknown as SessionJWTPayload;
  } catch (error) {
    // Suppress console spam on expired/empty tokens but capture signature errors
    if (error instanceof Error && !error.message.includes('expired')) {
      console.error('JWT signature verification failed:', error.message);
    }
    return null;
  }
}

export interface MobileRelayPayload {
  purpose: 'mobile_relay';
  teacherId: string;
  sessionId?: string | null;
  targetMode?: string | null;
  classId?: string | null;
  examId?: string | null;
  studentId?: string | null;
  submissionId?: string | null;
  exp?: number;
  iat?: number;
}

/**
 * Signs a short-lived QR Mobile Camera Relay token (default 2 hours).
 */
export async function signMobileRelayToken(
  payload: {
    teacherId: string;
    sessionId?: string | null;
    targetMode?: string | null;
    classId?: string | null;
    examId?: string | null;
    studentId?: string | null;
    submissionId?: string | null;
  },
  expiry = '2h'
): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    purpose: 'mobile_relay',
    teacherId: payload.teacherId,
    sessionId: payload.sessionId || null,
    targetMode: payload.targetMode || 'SUBMISSION',
    classId: payload.classId || null,
    examId: payload.examId || null,
    studentId: payload.studentId || null,
    submissionId: payload.submissionId || null,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies a QR Mobile Camera Relay token.
 */
export async function verifyMobileRelayToken(
  token: string | undefined | null
): Promise<MobileRelayPayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (payload.purpose !== 'mobile_relay' || typeof payload.teacherId !== 'string') {
      return null;
    }
    return payload as unknown as MobileRelayPayload;
  } catch {
    return null;
  }
}

export interface EmailVerificationPayload {
  purpose: 'email_verification';
  teacherId: string;
  email: string;
  exp?: number;
  iat?: number;
}

/**
 * Signs a 24-hour token for email verification.
 */
export async function signEmailVerificationToken(
  payload: { teacherId: string; email: string },
  expiry = '24h'
): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    purpose: 'email_verification',
    teacherId: payload.teacherId,
    email: payload.email.toLowerCase(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies an email verification token.
 */
export async function verifyEmailVerificationToken(
  token: string | undefined | null
): Promise<EmailVerificationPayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (payload.purpose !== 'email_verification' || typeof payload.teacherId !== 'string') {
      return null;
    }
    return payload as unknown as EmailVerificationPayload;
  } catch {
    return null;
  }
}

export interface PasswordResetPayload {
  purpose: 'password_reset';
  teacherId: string;
  email: string;
  pwdHashPrefix: string;
  exp?: number;
  iat?: number;
}

/**
 * Signs a 1-hour token for password reset.
 */
export async function signPasswordResetToken(
  payload: { teacherId: string; email: string; pwdHashPrefix: string },
  expiry = '1h'
): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    purpose: 'password_reset',
    teacherId: payload.teacherId,
    email: payload.email.toLowerCase(),
    pwdHashPrefix: payload.pwdHashPrefix,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies a password reset token.
 */
export async function verifyPasswordResetToken(
  token: string | undefined | null
): Promise<PasswordResetPayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (payload.purpose !== 'password_reset' || typeof payload.teacherId !== 'string') {
      return null;
    }
    return payload as unknown as PasswordResetPayload;
  } catch {
    return null;
  }
}

export interface OAuthStatePayload {
  purpose: 'oauth_state';
  provider: 'google' | 'microsoft';
  action: 'login' | 'link';
  teacherId?: string | null;
  nonce: string;
  exp?: number;
  iat?: number;
}

/**
 * Signs a short-lived 15-minute token for OAuth state and CSRF verification.
 */
export async function signOAuthStateToken(
  payload: {
    provider: 'google' | 'microsoft';
    action?: 'login' | 'link';
    teacherId?: string | null;
    nonce: string;
  },
  expiry = '15m'
): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    purpose: 'oauth_state',
    provider: payload.provider,
    action: payload.action || 'login',
    teacherId: payload.teacherId || null,
    nonce: payload.nonce,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies an OAuth state CSRF token.
 */
export async function verifyOAuthStateToken(
  token: string | undefined | null
): Promise<OAuthStatePayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (
      payload.purpose !== 'oauth_state' ||
      (payload.provider !== 'google' && payload.provider !== 'microsoft') ||
      typeof payload.nonce !== 'string'
    ) {
      return null;
    }
    return payload as unknown as OAuthStatePayload;
  } catch {
    return null;
  }
}

export interface OAuthPendingLinkPayload {
  purpose: 'oauth_pending_link';
  provider: 'google' | 'microsoft';
  providerAccountId: string;
  providerEmail: string;
  providerName?: string | null;
  existingTeacherId: string;
  existingTeacherEmail: string;
  exp?: number;
  iat?: number;
}

/**
 * Signs a short-lived 15-minute token for pending account linking that requires ownership proof.
 */
export async function signOAuthPendingLinkToken(
  payload: {
    provider: 'google' | 'microsoft';
    providerAccountId: string;
    providerEmail: string;
    providerName?: string | null;
    existingTeacherId: string;
    existingTeacherEmail: string;
  },
  expiry = '15m'
): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    purpose: 'oauth_pending_link',
    provider: payload.provider,
    providerAccountId: payload.providerAccountId,
    providerEmail: payload.providerEmail.toLowerCase(),
    providerName: payload.providerName || null,
    existingTeacherId: payload.existingTeacherId,
    existingTeacherEmail: payload.existingTeacherEmail.toLowerCase(),
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies a pending account linking token.
 */
export async function verifyOAuthPendingLinkToken(
  token: string | undefined | null
): Promise<OAuthPendingLinkPayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (
      payload.purpose !== 'oauth_pending_link' ||
      (payload.provider !== 'google' && payload.provider !== 'microsoft') ||
      typeof payload.existingTeacherId !== 'string' ||
      typeof payload.providerAccountId !== 'string'
    ) {
      return null;
    }
    return payload as unknown as OAuthPendingLinkPayload;
  } catch {
    return null;
  }
}

export interface OAuthConfirmLinkEmailPayload {
  purpose: 'oauth_confirm_link_email';
  provider: 'google' | 'microsoft';
  providerAccountId: string;
  providerEmail: string;
  teacherId: string;
  exp?: number;
  iat?: number;
}

/**
 * Signs a 24-hour token for confirming account linking via email.
 */
export async function signOAuthConfirmLinkEmailToken(
  payload: {
    provider: 'google' | 'microsoft';
    providerAccountId: string;
    providerEmail: string;
    teacherId: string;
  },
  expiry = '24h'
): Promise<string> {
  const key = getSecretKey();
  return new SignJWT({
    purpose: 'oauth_confirm_link_email',
    provider: payload.provider,
    providerAccountId: payload.providerAccountId,
    providerEmail: payload.providerEmail.toLowerCase(),
    teacherId: payload.teacherId,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies an email confirmation token for account linking.
 */
export async function verifyOAuthConfirmLinkEmailToken(
  token: string | undefined | null
): Promise<OAuthConfirmLinkEmailPayload | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (
      payload.purpose !== 'oauth_confirm_link_email' ||
      (payload.provider !== 'google' && payload.provider !== 'microsoft') ||
      typeof payload.teacherId !== 'string' ||
      typeof payload.providerAccountId !== 'string'
    ) {
      return null;
    }
    return payload as unknown as OAuthConfirmLinkEmailPayload;
  } catch {
    return null;
  }
}
