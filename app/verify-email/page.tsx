'use client';

import * as React from 'react';
import { useState, useEffect, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  Stack,
  CircularProgress,
  Alert,
  TextField,
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';

function VerifyEmailContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [loading, setLoading] = useState(Boolean(token));
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(
    token ? null : 'Kein Verifizierungs-Token im Link gefunden.'
  );

  // Resend state if token is missing or expired
  const [resendEmail, setResendEmail] = useState('');
  const [resending, setResending] = useState(false);
  const [resendMessage, setResendMessage] = useState<string | null>(null);
  const [resendError, setResendError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      return;
    }

    let isMounted = true;

    async function verify() {
      try {
        const res = await fetch('/api/auth/verify-email', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });

        const data = await res.json();
        if (!isMounted) return;

        if (res.ok && data.success) {
          setSuccess(true);
          setError(null);
        } else {
          setError(data.error || 'Die E-Mail-Adresse konnte nicht bestätigt werden.');
        }
      } catch (err) {
        if (!isMounted) return;
        setError(err instanceof Error ? err.message : 'Verbindungsfehler bei der Bestätigung.');
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    }

    verify();

    return () => {
      isMounted = false;
    };
  }, [token]);

  const handleResend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resendEmail || !resendEmail.includes('@')) {
      setResendError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }

    setResending(true);
    setResendError(null);
    setResendMessage(null);

    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: resendEmail.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (res.ok && data.success) {
        setResendMessage(data.message || 'Neuer Bestätigungs-Link wurde gesendet.');
      } else {
        setResendError(data.error || 'Link konnte nicht gesendet werden.');
      }
    } catch (err) {
      setResendError(err instanceof Error ? err.message : 'Verbindungsfehler.');
    } finally {
      setResending(false);
    }
  };

  return (
    <Card
      sx={{
        borderRadius: '16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #e2e8f0',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
        textAlign: 'center',
      }}
    >
      <CardContent sx={{ padding: '40px' }}>
        {loading && (
          <Stack spacing={2.5} sx={{ alignItems: 'center', py: 4 }}>
            <CircularProgress size={36} sx={{ color: '#1b77d1' }} />
            <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
              E-Mail-Adresse wird bestätigt...
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              Bitte einen Moment Geduld, wir aktivieren dein Konto.
            </Typography>
          </Stack>
        )}

        {!loading && success && (
          <Stack spacing={2.5} sx={{ alignItems: 'center', py: 2 }}>
            <CheckCircleIcon sx={{ fontSize: '3.5rem', color: '#16a34a' }} />
            <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
              E-Mail-Adresse erfolgreich bestätigt!
            </Typography>
            <Typography variant="body1" sx={{ color: '#475569', maxWidth: 440, lineHeight: 1.6 }}>
              Dein prüefli-Konto ist jetzt vollständig aktiviert. Du kannst nun alle Funktionen
              uneingeschränkt nutzen.
            </Typography>
            <Link
              href="/dashboard"
              passHref
              style={{ textDecoration: 'none', width: '100%', maxWidth: 280, marginTop: 16 }}
            >
              <Button
                variant="contained"
                fullWidth
                sx={{
                  padding: '12px',
                  borderRadius: '10px',
                  fontSize: '1rem',
                  fontWeight: 700,
                  textTransform: 'none',
                  backgroundColor: '#1b77d1',
                  '&:hover': { backgroundColor: '#1565c0' },
                }}
              >
                Weiter zum Dashboard
              </Button>
            </Link>
          </Stack>
        )}

        {!loading && error && (
          <Stack spacing={3} sx={{ alignItems: 'center' }}>
            <ErrorIcon sx={{ fontSize: '3.5rem', color: '#dc2626' }} />
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
                Bestätigung fehlgeschlagen
              </Typography>
              <Typography variant="body2" sx={{ color: '#64748b', maxWidth: 440 }}>
                {error}
              </Typography>
            </Box>

            {resendMessage && (
              <Alert severity="success" sx={{ width: '100%', borderRadius: '10px' }}>
                {resendMessage}
              </Alert>
            )}
            {resendError && (
              <Alert severity="error" sx={{ width: '100%', borderRadius: '10px' }}>
                {resendError}
              </Alert>
            )}

            <Box component="form" onSubmit={handleResend} sx={{ width: '100%', mt: 1 }}>
              <Typography
                variant="subtitle2"
                sx={{ fontWeight: 700, mb: 1.5, textAlign: 'left', color: '#0f172a' }}
              >
                Neuen Bestätigungs-Link anfordern:
              </Typography>
              <Stack direction="row" spacing={1.5}>
                <TextField
                  size="small"
                  type="email"
                  fullWidth
                  placeholder="name@schule.ch"
                  value={resendEmail}
                  onChange={(e) => setResendEmail(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />
                <Button
                  type="submit"
                  variant="contained"
                  disabled={resending}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#0f172a',
                    borderRadius: '8px',
                    whiteSpace: 'nowrap',
                    px: 2.5,
                  }}
                >
                  {resending ? <CircularProgress size={20} color="inherit" /> : 'Senden'}
                </Button>
              </Stack>
            </Box>

            <Link
              href="/login"
              style={{
                color: '#1b77d1',
                textDecoration: 'none',
                fontWeight: 650,
                fontSize: '0.9rem',
              }}
            >
              Zurück zur Anmeldung
            </Link>
          </Stack>
        )}
      </CardContent>
    </Card>
  );
}

export default function VerifyEmailPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px',
      }}
    >
      <Container maxWidth="sm">
        {/* Brand Header */}
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ justifyContent: 'center', alignItems: 'center', mb: 4 }}
        >
          <Box
            sx={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: '#1b77d1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px rgba(27, 119, 209, 0.3)',
            }}
          >
            <SchoolIcon sx={{ color: 'white', fontSize: '1.4rem' }} />
          </Box>
          <Typography
            variant="h4"
            component="span"
            sx={{ fontWeight: 900, letterSpacing: '-0.03em', color: '#0f172a' }}
          >
            prüefli
          </Typography>
        </Stack>

        <Suspense
          fallback={
            <Card sx={{ p: 5, textAlign: 'center', borderRadius: '16px' }}>
              <CircularProgress size={32} />
            </Card>
          }
        >
          <VerifyEmailContent />
        </Suspense>
      </Container>
    </Box>
  );
}
