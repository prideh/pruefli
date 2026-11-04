'use client';

import React, { useState, useSyncExternalStore } from 'react';
import { Alert, Box, Button, Stack, Typography } from '@mui/material';
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
          message: data.error || 'Bitte warte kurz vor dem nächsten Versand.',
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
          alignItems: 'flex-start',
          px: { xs: 1.5, sm: 2 },
          '& .MuiAlert-icon': {
            mr: { xs: 1.25, sm: 1.5 },
          },
          '& .MuiAlert-message': {
            width: '100%',
            minWidth: 0,
            flex: 1,
          },
        }}
      >
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          sx={{
            alignItems: { xs: 'stretch', sm: 'flex-start', md: 'center' },
            justifyContent: 'space-between',
            width: '100%',
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0, width: '100%' }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              E-Mail-Bestätigung für KI-Funktionen erforderlich
            </Typography>
            <Typography variant="body2" sx={{ mt: 0.25, overflowWrap: 'break-word' }}>
              {compact ? (
                <>
                  Für diese KI-Funktion ({featureLabel}) musst du zuerst deine E-Mail-Adresse (
                  <strong>{teacher.email}</strong>) bestätigen. Bitte klicke auf den Link in deiner
                  Bestätigungs-E-Mail.
                </>
              ) : (
                <>
                  Klassen, Schülerinnen und Schüler sowie manuelle Prüfungen kannst du bereits frei
                  einrichten. Kostenpflichtige KI-Funktionen ({featureLabel}) werden freigeschaltet,
                  sobald du deine E-Mail-Adresse (<strong>{teacher.email}</strong>) über den
                  Bestätigungslink in deinem Postfach bestätigt hast.
                </>
              )}
            </Typography>
          </Box>
          <Button
            color="inherit"
            size="small"
            variant="outlined"
            disabled={resending}
            onClick={handleResendVerification}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              fontSize: { xs: '0.8rem', sm: '0.8125rem' },
              lineHeight: 1.3,
              py: { xs: 0.75, sm: 0.5 },
              px: 1.5,
              whiteSpace: { xs: 'normal', sm: 'nowrap' },
              flexShrink: 0,
              width: { xs: '100%', sm: 'auto' },
              alignSelf: { xs: 'stretch', sm: 'flex-start', md: 'center' },
            }}
          >
            {resending ? 'Wird gesendet...' : 'Bestätigungs-E-Mail erneut senden'}
          </Button>
        </Stack>
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
