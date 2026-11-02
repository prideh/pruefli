import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NextRequest } from 'next/server';
import fs from 'fs';
import path from 'path';
import {
  createSession,
  createSessionRecord,
  getSession,
  getSessionRecordById,
  getStoredSessionCount,
  verifySessionToken,
  revokeSessionById,
  revokeSessionToken,
  revokeAllTeacherSessions,
  deleteSession,
  cleanupExpiredAndRevokedSessions,
  getSessionLifecycleConfig,
  resetSessionStoreForTests,
  isSafeReturnUrl,
  resolveSafeReturnUrl,
  buildLoginRedirectUrl,
  saveCorrectionDraft,
  loadCorrectionDraft,
  clearCorrectionDraft,
} from '@/lib/session';
import {
  signJWT,
  verifyJWT,
  signMobileRelayToken,
  verifyMobileRelayToken,
  signEmailVerificationToken,
  verifyEmailVerificationToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  signOAuthStateToken,
  verifyOAuthStateToken,
  signOAuthPendingLinkToken,
  verifyOAuthPendingLinkToken,
  signOAuthConfirmLinkEmailToken,
  verifyOAuthConfirmLinkEmailToken,
} from '@/lib/jwt';
import { proxy } from '@/proxy';
import { POST as logoutPost } from '@/app/api/auth/logout/route';

describe('Professioneller Session-Lebenszyklus (Issue #86)', () => {
  beforeEach(() => {
    resetSessionStoreForTests();
    clearCorrectionDraft();
    vi.restoreAllMocks();
  });

  describe('1. Server-seitige Session-Repraesentation & Widerruf', () => {
    it('erzeugt bei Login einen serverseitigen Session-Eintrag und weist widerrufene Sessions sofort ab', async () => {
      const now = new Date('2026-05-01T08:00:00.000Z');
      const { sessionId, token, expiresAt } = await createSession('teacher-101', {
        now,
        userAgent: 'Mozilla/5.0 TestBrowser',
      });

      expect(sessionId).toMatch(/^sess_/);
      expect(expiresAt.getTime() - now.getTime()).toBe(7 * 24 * 60 * 60 * 1000);

      const record = await getSessionRecordById(sessionId);
      expect(record).not.toBeNull();
      expect(record?.teacherId).toBe('teacher-101');
      expect(record?.revokedAt).toBeNull();
      expect(record?.userAgent).toBe('Mozilla/5.0 TestBrowser');

      // Gültige Session wird akzeptiert
      const verified = await verifySessionToken(token, { now });
      expect(verified).not.toBeNull();
      expect(verified?.userId).toBe('teacher-101');
      expect(verified?.sessionId).toBe(sessionId);

      // Serverseitiger Widerruf macht das kryptografisch noch gültige Token sofort ungültig
      const revoked = await revokeSessionById(sessionId, new Date('2026-05-01T08:05:00.000Z'));
      expect(revoked).toBe(true);

      const afterRevoke = await verifySessionToken(token, {
        now: new Date('2026-05-01T08:06:00.000Z'),
      });
      expect(afterRevoke).toBeNull();
    });

    it('weist moderne Session-Tokens ab, deren serverseitiger Session-Eintrag nicht existiert', async () => {
      const now = new Date('2026-05-01T08:00:00.000Z');
      const orphanToken = await signJWT(
        {
          userId: 'teacher-ghost',
          sessionId: 'sess_nonexistent_12345',
          tokenVersion: 1,
          purpose: 'session',
        },
        '7d',
        now
      );

      const result = await verifySessionToken(orphanToken, { now });
      expect(result).toBeNull();
    });
  });

  describe('2. Gedrosseltes Sliding Renewal, Parallel-Sicherheit & Replay-Schutz', () => {
    it('verlaengert aktive Sessions gedrosselt und weist alte Tokens nach Renewal ab (Replay-Schutz)', async () => {
      const t0 = new Date('2026-05-01T08:00:00.000Z');
      const customConfig = {
        slidingWindowSeconds: 48 * 3600, // 2 Tage Sliding-Fenster
        inactivityTimeoutSeconds: 48 * 3600,
        absoluteMaxSeconds: 7 * 24 * 3600, // 7 Tage absolutes Maximum
        renewalThrottleSeconds: 12 * 3600, // 12h Drosselung
      };

      const { session, token: initialToken } = await createSessionRecord('teacher-slide', {
        now: t0,
        config: customConfig,
      });

      // Nach 2 Stunden (< 12h Throttle): kein Renewal, kein neues Token
      const t2h = new Date(t0.getTime() + 2 * 3600 * 1000);
      const checkEarly = await verifySessionToken(initialToken, {
        now: t2h,
        config: customConfig,
      });
      expect(checkEarly).not.toBeNull();
      expect(checkEarly?.renewed).toBe(false);
      expect(checkEarly?.tokenVersion).toBe(1);

      // Nach 14 Stunden (>= 12h Throttle): gedrosseltes Sliding Renewal greift
      const t14h = new Date(t0.getTime() + 14 * 3600 * 1000);
      const checkRenewed = await verifySessionToken(initialToken, {
        now: t14h,
        config: customConfig,
      });
      expect(checkRenewed).not.toBeNull();
      expect(checkRenewed?.renewed).toBe(true);
      expect(checkRenewed?.tokenVersion).toBe(2);
      expect(checkRenewed?.renewedToken).toBeDefined();
      expect(checkRenewed?.expiresAt.getTime()).toBe(t14h.getTime() + 48 * 3600 * 1000);
      expect(session.tokenVersion).toBe(2);

      // Replay des alten Tokens (v1) nach erfolgtem Renewal (auf v2) wird strikt abgewiesen
      const replayAttempt = await verifySessionToken(initialToken, {
        now: new Date(t14h.getTime() + 1000),
        config: customConfig,
      });
      expect(replayAttempt).toBeNull();

      // Das neue Token (v2) hingegen ist gültig
      const validNewToken = await verifySessionToken(checkRenewed!.renewedToken!, {
        now: new Date(t14h.getTime() + 1000),
        config: customConfig,
      });
      expect(validNewToken).not.toBeNull();
      expect(validNewToken?.tokenVersion).toBe(2);
    });

    it('koordiniert parallele Requests derselben Session bei einem Renewal ohne Race-Condition', async () => {
      const t0 = new Date('2026-05-01T08:00:00.000Z');
      const { token } = await createSessionRecord('teacher-parallel', { now: t0 });

      // 25 Stunden später (> 24h Standard-Throttle): 5 parallele Requests treffen gleichzeitig ein
      const t25h = new Date(t0.getTime() + 25 * 3600 * 1000);
      const parallelResults = await Promise.all([
        verifySessionToken(token, { now: t25h }),
        verifySessionToken(token, { now: t25h }),
        verifySessionToken(token, { now: t25h }),
        verifySessionToken(token, { now: t25h }),
        verifySessionToken(token, { now: t25h }),
      ]);

      for (const res of parallelResults) {
        expect(res).not.toBeNull();
        expect(res?.renewed).toBe(true);
        expect(res?.tokenVersion).toBe(2);
        expect(res?.renewedToken).toBe(parallelResults[0]?.renewedToken);
      }

      // Nach Abschluss des parallelen Renewals ist das alte Token (v1) ungültig
      const postRaceReplay = await verifySessionToken(token, {
        now: new Date(t25h.getTime() + 500),
      });
      expect(postRaceReplay).toBeNull();
    });

    it('wendet Sliding Renewal auch im regulaeren API-Verkehr via getSession() an', async () => {
      const t0 = new Date('2026-05-01T08:00:00.000Z');
      await createSession('teacher-api', { now: t0 });

      const t26h = new Date(t0.getTime() + 26 * 3600 * 1000);
      const apiSession = await getSession({ now: t26h });
      expect(apiSession).not.toBeNull();
      expect(apiSession?.userId).toBe('teacher-api');
      expect(apiSession?.renewed).toBe(true);
      expect(apiSession?.tokenVersion).toBe(2);
    });
  });

  describe('3. Inaktivitaetslimit & absolute Maximaldauer (Standard: 7 Tage)', () => {
    it('verlaengert unter dem 7-Tage-Default eine Session niemals ueber 7 Tage ab Erstellung (createdAt) hinaus', async () => {
      const cfg = getSessionLifecycleConfig();
      expect(cfg.slidingWindowSeconds).toBe(7 * 24 * 3600);
      expect(cfg.inactivityTimeoutSeconds).toBe(7 * 24 * 3600);
      expect(cfg.absoluteMaxSeconds).toBe(7 * 24 * 3600);

      const t0 = new Date('2026-05-01T08:00:00.000Z');
      const { token: tDay0 } = await createSessionRecord('teacher-7d', { now: t0 });

      // Aktivität an Tag 3: Renewal rotiert Token, aber expiresAt bleibt auf t0 + 7 Tage gedeckelt
      const tDay3 = new Date(t0.getTime() + 3 * 24 * 3600 * 1000);
      const renewedDay3 = await verifySessionToken(tDay0, { now: tDay3 });
      expect(renewedDay3).not.toBeNull();
      expect(renewedDay3?.renewed).toBe(true);
      expect(renewedDay3?.expiresAt.getTime()).toBe(t0.getTime() + 7 * 24 * 3600 * 1000);

      // Aktivität an Tag 6 (12h vor absolutem Ablauf): expirableSoon ist true
      const tDay6Half = new Date(t0.getTime() + 6.5 * 24 * 3600 * 1000);
      const renewedDay6 = await verifySessionToken(renewedDay3!.renewedToken!, { now: tDay6Half });
      expect(renewedDay6).not.toBeNull();
      expect(renewedDay6?.expiringSoon).toBe(true);
      expect(renewedDay6?.expiresAt.getTime()).toBe(t0.getTime() + 7 * 24 * 3600 * 1000);

      // Exakt 7 Tage nach Erstellung (t0 + 7d): Session ist abgelaufen, Neuanmeldung erforderlich
      const tDay7 = new Date(t0.getTime() + 7 * 24 * 3600 * 1000);
      const expiredAtAbsoluteMax = await verifySessionToken(
        renewedDay6?.renewedToken || renewedDay3!.renewedToken!,
        { now: tDay7 }
      );
      expect(expiredAtAbsoluteMax).toBeNull();
    });

    it('erzwingt das Inaktivitaetslimit, wenn innerhalb des Inaktivitaetsfensters keine Nutzung erfolgt', async () => {
      const t0 = new Date('2026-05-01T08:00:00.000Z');
      const customConfig = {
        slidingWindowSeconds: 7 * 24 * 3600,
        inactivityTimeoutSeconds: 2 * 24 * 3600, // 2 Tage max. Inaktivität
        absoluteMaxSeconds: 14 * 24 * 3600,
        renewalThrottleSeconds: 3600,
      };

      const { token } = await createSessionRecord('teacher-inactive', {
        now: t0,
        config: customConfig,
      });

      // Nach 3 Tagen ohne Aktivität (> 2 Tage Inaktivitätslimit) wird die Session abgewiesen
      const t3d = new Date(t0.getTime() + 3 * 24 * 3600 * 1000);
      const checkInactive = await verifySessionToken(token, {
        now: t3d,
        config: customConfig,
      });
      expect(checkInactive).toBeNull();
    });
  });

  describe('4. Kontrollierter Ablauf, Return-URL & Schutz ungespeicherter Korrekturarbeit', () => {
    it('validiert Return-URLs strikt gegen Open-Redirects und baut sichere Login-Weiterleitungen', () => {
      expect(isSafeReturnUrl('/correct/sub-123')).toBe(true);
      expect(isSafeReturnUrl('/exams/ex-1?tab=overview')).toBe(true);

      // Unsichere oder externe Ziele werden abgewiesen
      expect(isSafeReturnUrl('https://evil.example.com/phish')).toBe(false);
      expect(isSafeReturnUrl('//evil.example.com')).toBe(false);
      expect(isSafeReturnUrl('/\\evil.example.com')).toBe(false);
      expect(isSafeReturnUrl('javascript:alert(1)')).toBe(false);
      expect(isSafeReturnUrl('/login')).toBe(false);
      expect(isSafeReturnUrl('/register')).toBe(false);

      expect(resolveSafeReturnUrl('https://evil.example.com')).toBe('/dashboard');
      expect(resolveSafeReturnUrl('/correct/abc-99')).toBe('/correct/abc-99');

      expect(buildLoginRedirectUrl('/dashboard')).toBe('/login');
      expect(buildLoginRedirectUrl('/correct/sub-42', 'expired')).toBe(
        '/login?returnTo=%2Fcorrect%2Fsub-42&reason=expired'
      );
    });

    it('leitet in proxy.ts bei abgelaufener/widerrufener Session auf /login inklusive sicherer returnTo-URL weiter', async () => {
      const req = new NextRequest('http://localhost:3000/correct/sub-777');
      const res = await proxy(req);
      expect(res.status).toBe(307);
      expect(res.headers.get('location')).toBe(
        'http://localhost:3000/login?returnTo=%2Fcorrect%2Fsub-777'
      );
    });

    it('sichert und restauriert ungespeicherte Korrektur-Entwuerfe bei Session-Ablauf im Correction Workspace', () => {
      const sampleTasks = [
        {
          aufgabe: '1a',
          titel: 'Bruchrechnen',
          erzieltePunkte: 3.5,
          maximalPunkte: 4,
          lehrerKommentar: 'Zwischenschritt fast richtig',
        },
      ];
      const sampleFeedback = {
        hilfreicherTipp: 'Hauptnenner prüfen',
        uebungsEmpfehlung: 'Kapitel 3',
      };

      const saved = saveCorrectionDraft('sub-86', {
        aufgaben: sampleTasks,
        schuelerFeedback: sampleFeedback,
      });
      expect(saved).toBe(true);

      const loaded = loadCorrectionDraft('sub-86');
      expect(loaded).not.toBeNull();
      expect(loaded?.submissionId).toBe('sub-86');
      expect(loaded?.aufgaben).toEqual(sampleTasks);
      expect(loaded?.schuelerFeedback).toEqual(sampleFeedback);

      clearCorrectionDraft('sub-86');
      expect(loadCorrectionDraft('sub-86')).toBeNull();
    });
  });

  describe('5. Expliziter Logout & Widerruf bei Passwort-Reset', () => {
    it('widerruft beim Logout die Session serverseitig und loescht das Cookie', async () => {
      const { sessionId, token } = await createSession('teacher-logout');
      expect(await verifySessionToken(token)).not.toBeNull();

      const res = await logoutPost();
      expect(res.status).toBe(200);

      // Selbst wenn das alte Token erneut gesendet wird, ist es serverseitig widerrufen
      expect(await verifySessionToken(token)).toBeNull();
      const record = await getSessionRecordById(sessionId);
      expect(record?.revokedAt).not.toBeNull();

      // Direkter Aufruf von deleteSession({ allSessions: true }) funktioniert ebenfalls fehlerfrei
      await deleteSession({ allSessions: true });
    });

    it('widerruft bei Passwort-Aenderung / revokeAllTeacherSessions alle aktiven Sessions der Lehrperson', async () => {
      const now = new Date('2026-05-01T08:00:00.000Z');
      const s1 = await createSessionRecord('teacher-pw-reset', { now });
      const s2 = await createSessionRecord('teacher-pw-reset', { now });
      const otherTeacher = await createSessionRecord('teacher-other', { now });

      const revokedCount = await revokeAllTeacherSessions(
        'teacher-pw-reset',
        new Date('2026-05-01T09:00:00.000Z')
      );
      expect(revokedCount).toBe(2);

      // Beide Sessions der betroffenen Lehrperson sind sofort ungültig
      expect(
        await verifySessionToken(s1.token, { now: new Date('2026-05-01T09:01:00.000Z') })
      ).toBeNull();
      expect(
        await verifySessionToken(s2.token, { now: new Date('2026-05-01T09:01:00.000Z') })
      ).toBeNull();

      // Andere Lehrperson bleibt unberührt
      expect(
        await verifySessionToken(otherTeacher.token, { now: new Date('2026-05-01T09:01:00.000Z') })
      ).not.toBeNull();
    });
  });

  describe('6. Strikte Zweck-Trennung zu Kurzzeit-Tokens', () => {
    it('akzeptiert Kurzzeit-Tokens (Relay, E-Mail-Verifikation, Passwort-Reset, OAuth) niemals als Session', async () => {
      const relayToken = await signMobileRelayToken({ teacherId: 'teacher-1' });
      const verifyEmailToken = await signEmailVerificationToken({
        teacherId: 'teacher-1',
        email: 't@schule.ch',
      });
      const resetPwToken = await signPasswordResetToken({
        teacherId: 'teacher-1',
        email: 't@schule.ch',
        pwdHashPrefix: 'abcdef12',
      });
      const oauthStateToken = await signOAuthStateToken({
        provider: 'google',
        nonce: 'nonce-123',
      });
      const oauthPendingToken = await signOAuthPendingLinkToken({
        provider: 'google',
        providerAccountId: 'g-1',
        providerEmail: 't@schule.ch',
        existingTeacherId: 'teacher-1',
        existingTeacherEmail: 't@schule.ch',
      });
      const oauthConfirmToken = await signOAuthConfirmLinkEmailToken({
        provider: 'google',
        providerAccountId: 'g-1',
        providerEmail: 't@schule.ch',
        teacherId: 'teacher-1',
      });

      for (const nonSessionToken of [
        relayToken,
        verifyEmailToken,
        resetPwToken,
        oauthStateToken,
        oauthPendingToken,
        oauthConfirmToken,
      ]) {
        expect(await verifyJWT(nonSessionToken)).toBeNull();
        expect(await verifySessionToken(nonSessionToken)).toBeNull();
      }

      // Umgekehrt darf ein Session-Token niemals als Kurzzeit-Token akzeptiert werden
      const { token: sessionToken } = await createSessionRecord('teacher-1');
      expect(await verifyMobileRelayToken(sessionToken)).toBeNull();
      expect(await verifyEmailVerificationToken(sessionToken)).toBeNull();
      expect(await verifyPasswordResetToken(sessionToken)).toBeNull();
      expect(await verifyOAuthStateToken(sessionToken)).toBeNull();
      expect(await verifyOAuthPendingLinkToken(sessionToken)).toBeNull();
      expect(await verifyOAuthConfirmLinkEmailToken(sessionToken)).toBeNull();
    });
  });

  describe('7. Migration bestehender Sessions ohne Widerrufsluecke (Option b)', () => {
    it('ueberfuehrt Legacy-Tokens ohne sessionId bei erster Pruefung in eine widerrufbare Server-Session', async () => {
      const legacyToken = await signJWT({ userId: 'teacher-legacy' }, '7d');

      // Erste Prüfung konvertiert das Legacy-Token deterministisch in eine verwaltete Session
      const firstCheck = await verifySessionToken(legacyToken);
      expect(firstCheck).not.toBeNull();
      expect(firstCheck?.userId).toBe('teacher-legacy');
      expect(firstCheck?.isLegacyConverted).toBe(true);
      expect(firstCheck?.sessionId).toMatch(/^legacy_/);

      // Keine Widerrufslücke: Widerruf des Legacy-Tokens greift sofort
      await revokeSessionToken(legacyToken);
      const afterRevoke = await verifySessionToken(legacyToken);
      expect(afterRevoke).toBeNull();
    });
  });

  describe('8. Bereinigung (Lazy Cleanup) abgelaufener und widerrufener Sessions', () => {
    it('entfernt abgelaufene und widerrufene Sessions zuverlaessig und verhindert deren Wiederverwendung', async () => {
      const t0 = new Date('2026-05-01T08:00:00.000Z');
      const active = await createSessionRecord('teacher-active', {
        now: new Date(t0.getTime() + 5 * 24 * 3600 * 1000),
      });
      const expired = await createSessionRecord('teacher-expired', { now: t0 });
      const revoked = await createSessionRecord('teacher-revoked', {
        now: new Date(t0.getTime() + 5 * 24 * 3600 * 1000),
      });
      await revokeSessionById(revoked.session.id, new Date(t0.getTime() + 5 * 24 * 3600 * 1000));

      expect(getStoredSessionCount()).toBe(3);

      // Cleanup an Tag 8 (expired ist abgelaufen, revoked ist widerrufen, active ist noch gültig)
      const cleanupTime = new Date(t0.getTime() + 8 * 24 * 3600 * 1000);
      const { deletedCount } = await cleanupExpiredAndRevokedSessions(cleanupTime);
      expect(deletedCount).toBe(2);
      expect(getStoredSessionCount()).toBe(1);

      expect(await verifySessionToken(expired.token, { now: cleanupTime })).toBeNull();
      expect(await verifySessionToken(revoked.token, { now: cleanupTime })).toBeNull();
      expect(await verifySessionToken(active.token, { now: cleanupTime })).not.toBeNull();
    });
  });

  describe('9. Schweizer Rechtschreibung (kein Eszett)', () => {
    it('enthaelt kein Eszett in allen geaenderten und neuen Session-Dateien', () => {
      const files = [
        '../../lib/jwt.ts',
        '../../lib/session.ts',
        '../../lib/sessionCache.ts',
        '../../proxy.ts',
        '../../app/api/auth/me/route.ts',
        '../../app/api/auth/logout/route.ts',
        '../../app/api/auth/reset-password/route.ts',
        '../../app/login/page.tsx',
        '../../components/DashboardLayout.tsx',
        '../../app/correct/[id]/page.tsx',
      ];
      for (const rel of files) {
        const content = fs.readFileSync(path.resolve(__dirname, rel), 'utf-8');
        expect(content, `Datei ${rel} enthaelt Eszett`).not.toContain('\u00DF');
      }
    });
  });
});
