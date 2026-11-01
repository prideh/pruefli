import { SignJWT, jwtVerify } from 'jose';

function getSecretKey(): Uint8Array {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('FATAL: JWT_SECRET environment variable must be set in production!');
    }
    return new TextEncoder().encode('grade-ai-dev-secret-key-safe-fallback');
  }
  return new TextEncoder().encode(secret);
}

/**
 * Signs a professional JSON Web Token (JWT) with the teacher's ID.
 * @param payload Payload containing userId
 * @param expiry Duration of validity (e.g. '7d')
 * @returns A promise resolving to the signed compact JWT string.
 */
export async function signJWT(payload: { userId: string }, expiry = '7d'): Promise<string> {
  const key = getSecretKey();
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiry)
    .sign(key);
}

/**
 * Verifies a JSON Web Token (JWT) and extracts the payload.
 * @param token The signed compact JWT string
 * @returns The payload if valid, otherwise null.
 */
export async function verifyJWT(
  token: string | undefined
): Promise<{ userId: string; exp?: number; iat?: number } | null> {
  if (!token) return null;
  try {
    const key = getSecretKey();
    const { payload } = await jwtVerify(token, key, {
      algorithms: ['HS256'],
    });
    if (payload.purpose && payload.purpose !== 'session') {
      return null;
    }
    return payload as { userId: string; exp?: number; iat?: number };
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
