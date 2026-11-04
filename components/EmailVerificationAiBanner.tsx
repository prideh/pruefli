'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material/styles';
import {
  getCachedTeacher,
  setCachedTeacher,
  subscribeTeacherSession,
  type TeacherSession,
} from '@/lib/sessionCache';

const getServerSnapshot = (): TeacherSession | null => null;

export function useTeacherSession(): {
  teacher: TeacherSession | null;
  isUnverified: boolean;
} {
  const teacher = useSyncExternalStore(
    subscribeTeacherSession,
    getCachedTeacher,
    getServerSnapshot
  );

  return {
    teacher,
    isUnverified: Boolean(teacher && teacher.isEmailVerified === false),
  };
}

interface EmailVerificationAiBannerProps {
  featureLabel?: string;
  compact?: boolean;
  sx?: SxProps<Theme>;
}

export default function EmailVerificationAiBanner({
  featureLabel = 'KI-Korrekturen und die KI-Prüfungserstellung',
  compact = false,
  sx,
}: EmailVerificationAiBannerProps) {
  const { teacher, isUnverified } = useTeacherSession();
  const [resending, setResending] = useState(false);
  const [feedback, setFeedback] = useState<{
    message: string;
    severity: 'success' | 'info' | 'warning';
  } | null>(null);

  if (!isUnverified || !teacher) {
    return null;
  }

  const handleResendVerification = async () => {
    setResending(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/auth/resend-verification', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        if (data.alreadyVerified) {
          setCachedTeacher({
            ...teacher,
            isEmailVerified: true,
            emailVerificationRequired: false,
          });
        } else {
          setFeedback({
            message: data.message || 'Bestätigungs-E-Mail wurde erneut gesendet.',
            severity: 'success',
          });
        }
      } else {
        setFeedback({
          message: data.error || 'Bitte warten Sie kurz vor dem nächsten Versand.',
          severity: 'warning',
        });
      }
    } catch {
      setFeedback({
        message: 'Verbindungsfehler beim Senden der Bestätigungs-E-Mail.',
        severity: 'warning',
      });
    } finally {
      setResending(false);
    }
  };

  return (
    <Box sx={sx}>
      <Alert
        severity="warning"
        data-testid="paid-ai-verification-banner"
        sx={{
          borderRadius: 2,
          alignItems: 'center',
          '& .MuiAlert-message': { width: '100%' },
        }}
        action={
          <Button
            color="inherit"
            size="small"
            variant="outlined"
            disabled={resending}
            onClick={handleResendVerification}
            sx={{ fontWeight: 700, whiteSpace: 'nowrap', alignSelf: 'center' }}
          >
            {resending ? 'Wird gesendet...' : 'Bestätigungs-E-Mail erneut senden'}
          </Button>
        }
      >
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          E-Mail-Bestätigung für KI-Funktionen erforderlich
        </Typography>
        <Typography variant="body2" sx={{ mt: 0.25 }}>
          {compact ? (
            <>
              {featureLabel} sind erst nach Bestätigung Ihrer E-Mail-Adresse (
              <strong>{teacher.email}</strong>) verfügbar. Bitte klicken Sie auf den Link in Ihrer
              Bestätigungs-E-Mail.
            </>
          ) : (
            <>
              Klassen, Schülerinnen und Schüler sowie manuelle Prüfungen können Sie bereits frei
              einrichten. {featureLabel} lösen kostenpflichtige KI-Aufrufe aus und werden
              freigeschaltet, sobald Sie Ihre E-Mail-Adresse (<strong>{teacher.email}</strong>) über
              den Bestätigungslink in Ihrem Postfach bestätigt haben.
            </>
          )}
        </Typography>
      </Alert>
      {feedback && (
        <Alert
          severity={feedback.severity}
          onClose={() => setFeedback(null)}
          sx={{ mt: 1, borderRadius: 2 }}
        >
          {feedback.message}
        </Alert>
      )}
    </Box>
  );
}
