'use client';

import * as React from 'react';
import { useState, useEffect, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Container,
  Typography,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  CircularProgress,
  Alert,
  InputAdornment,
  IconButton,
  Divider,
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import LockIcon from '@mui/icons-material/Lock';
import MarkEmailReadIcon from '@mui/icons-material/MarkEmailRead';
import SecurityIcon from '@mui/icons-material/Security';
import { setCachedTeacher } from '@/lib/sessionCache';

function LinkAccountContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get('token') || '';

  const [loadingInfo, setLoadingInfo] = useState(() => Boolean(token));
  const [infoError, setInfoError] = useState(() =>
    !token ? 'Kein gültiger Verknüpfungs-Token angegeben.' : ''
  );
  const [linkInfo, setLinkInfo] = useState<{
    email: string;
    name: string;
    provider: string;
    providerDisplayName: string;
    hasPassword: boolean;
  } | null>(null);

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordError, setPasswordError] = useState('');

  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMessage, setEmailMessage] = useState('');
  const [emailError, setEmailError] = useState('');

  useEffect(() => {
    if (!token) {
      return;
    }

    const controller = new AbortController();
    fetch(`/api/auth/oauth/link-info?token=${encodeURIComponent(token)}`, {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          throw new Error(data.error || 'Ungültige Verknüpfungs-Anfrage.');
        }
        setLinkInfo(data);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setInfoError(
            err instanceof Error ? err.message : 'Fehler beim Laden der Verknüpfungsinformationen.'
          );
        }
      })
      .finally(() => {
        setLoadingInfo(false);
      });

    return () => {
      controller.abort();
    };
  }, [token]);

  const handlePasswordSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) {
      setPasswordError('Bitte gib dein Passwort ein.');
      return;
    }

    setPasswordLoading(true);
    setPasswordError('');

    try {
      const res = await fetch('/api/auth/oauth/link-confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Verknüpfung fehlgeschlagen.');
      }

      if (result.teacher) {
        setCachedTeacher(result.teacher);
      }
      router.refresh();
      router.replace('/dashboard');
    } catch (err) {
      setPasswordError(
        err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.'
      );
      setPasswordLoading(false);
    }
  };

  const handleSendEmailLink = async () => {
    setEmailLoading(true);
    setEmailError('');
    setEmailMessage('');

    try {
      const res = await fetch('/api/auth/oauth/link-send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });

      const result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || 'Fehler beim Senden der Bestätigungs-E-Mail.');
      }

      if (
        result.liveSendingEnabled === false ||
        result.simulated === true ||
        result.sent === false
      ) {
        setEmailError(
          result.message ||
            'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine Bestätigungs-E-Mail versendet.'
        );
        return;
      }

      setEmailMessage(result.message || 'Bestätigungs-Link wurde gesendet.');
    } catch (err) {
      setEmailError(err instanceof Error ? err.message : 'E-Mail konnte nicht gesendet werden.');
    } finally {
      setEmailLoading(false);
    }
  };

  if (loadingInfo) {
    return (
      <Box sx={{ textAlign: 'center', py: 8 }}>
        <CircularProgress size={36} sx={{ color: '#1b77d1', mb: 2 }} />
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Verknüpfungsinformationen werden geprüft...
        </Typography>
      </Box>
    );
  }

  if (infoError || !linkInfo) {
    return (
      <Card
        sx={{
          borderRadius: '16px',
          boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
          border: '1px solid #e2e8f0',
          backgroundColor: '#ffffff',
          p: 4,
          textAlign: 'center',
        }}
      >
        <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
          {infoError || 'Ungültige oder abgelaufene Verknüpfungs-Anfrage.'}
        </Alert>
        <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
          Die Sitzung ist aus Sicherheitsgründen nach 15 Minuten abgelaufen oder wurde bereits
          verwendet.
        </Typography>
        <Link href="/login" passHref style={{ textDecoration: 'none' }}>
          <Button
            variant="contained"
            sx={{
              backgroundColor: '#1b77d1',
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '8px',
              p: '10px 20px',
            }}
          >
            Zurück zur Anmeldung
          </Button>
        </Link>
      </Card>
    );
  }

  return (
    <Card
      sx={{
        borderRadius: '16px',
        boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
        border: '1px solid #e2e8f0',
        backgroundColor: '#ffffff',
        overflow: 'hidden',
      }}
    >
      <CardContent sx={{ padding: { xs: '28px', sm: '40px' } }}>
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Box
            sx={{
              display: 'inline-flex',
              p: 1.5,
              borderRadius: '12px',
              backgroundColor: '#f0fdf4',
              color: '#16a34a',
              mb: 2,
            }}
          >
            <SecurityIcon sx={{ fontSize: '2rem' }} />
          </Box>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
            Konto-Inhaberschaft bestätigen
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: 'text.secondary', fontWeight: 500, lineHeight: 1.6 }}
          >
            Ein prüefli-Konto mit der E-Mail-Adresse <strong>{linkInfo.email}</strong> existiert
            bereits. Zum Schutz deines Kontos ist ein Inhaberschafts-Nachweis erforderlich, um die
            Verknüpfung mit deinem <strong>{linkInfo.providerDisplayName}</strong>-Konto
            abzuschliessen.
          </Typography>
        </Box>

        {/* Option A: Password verification */}
        {linkInfo.hasPassword && (
          <Box sx={{ mb: 4 }}>
            <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0f172a', mb: 1.5 }}>
              Option 1: Mit bestehendem Passwort bestätigen
            </Typography>

            {passwordError && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>
                {passwordError}
              </Alert>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <Stack spacing={2}>
                <TextField
                  label="Bestehendes prüefli-Passwort"
                  type={showPassword ? 'text' : 'password'}
                  fullWidth
                  variant="outlined"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <LockIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            onClick={() => setShowPassword(!showPassword)}
                            edge="end"
                            size="small"
                          >
                            {showPassword ? <VisibilityOff /> : <Visibility />}
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '10px',
                    },
                  }}
                />

                <Button
                  type="submit"
                  variant="contained"
                  fullWidth
                  disabled={passwordLoading}
                  sx={{
                    padding: '12px',
                    borderRadius: '10px',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    textTransform: 'none',
                    backgroundColor: '#1b77d1',
                    boxShadow: '0 4px 12px rgba(27, 119, 209, 0.25)',
                    '&:hover': {
                      backgroundColor: '#1565c0',
                    },
                  }}
                >
                  {passwordLoading ? (
                    <CircularProgress size={24} sx={{ color: '#ffffff' }} />
                  ) : (
                    `Mit Passwort verknüpfen & anmelden`
                  )}
                </Button>
              </Stack>
            </form>
          </Box>
        )}

        {linkInfo.hasPassword && (
          <Divider sx={{ my: 3, fontSize: '0.8rem', color: '#94a3b8', textTransform: 'uppercase' }}>
            ODER
          </Divider>
        )}

        {/* Option B: Email confirmation link */}
        <Box>
          <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0f172a', mb: 1.5 }}>
            {linkInfo.hasPassword ? 'Option 2: ' : ''}Bestätigungs-Link per E-Mail anfordern
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 2, lineHeight: 1.6 }}>
            Wir senden dir einen sicheren 24-Stunden-Bestätigungslink an deine hinterlegte
            E-Mail-Adresse.
          </Typography>

          {emailMessage && (
            <Alert severity="success" sx={{ mb: 2, borderRadius: '10px' }}>
              {emailMessage}
            </Alert>
          )}

          {emailError && (
            <Alert severity="error" sx={{ mb: 2, borderRadius: '10px' }}>
              {emailError}
            </Alert>
          )}

          <Button
            onClick={handleSendEmailLink}
            variant="outlined"
            fullWidth
            disabled={emailLoading}
            startIcon={<MarkEmailReadIcon />}
            sx={{
              padding: '12px',
              borderRadius: '10px',
              fontSize: '0.95rem',
              fontWeight: 700,
              textTransform: 'none',
              borderColor: '#cbd5e1',
              color: '#334155',
              '&:hover': {
                borderColor: '#1b77d1',
                backgroundColor: 'rgba(27, 119, 209, 0.04)',
              },
            }}
          >
            {emailLoading ? (
              <CircularProgress size={24} sx={{ color: '#1b77d1' }} />
            ) : (
              'Bestätigungs-Link per E-Mail senden'
            )}
          </Button>
        </Box>

        <Box sx={{ mt: 4, textAlign: 'center' }}>
          <Link
            href="/login"
            style={{ color: '#64748b', fontSize: '0.85rem', textDecoration: 'none' }}
          >
            Abbrechen und zur Anmeldung zurückkehren
          </Link>
        </Box>
      </CardContent>
    </Card>
  );
}

export default function LinkAccountPage() {
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
        {/* Logo and Brand */}
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
            sx={{
              fontWeight: 900,
              letterSpacing: '-0.03em',
              color: '#0f172a',
            }}
          >
            prüefli
          </Typography>
        </Stack>

        <Suspense
          fallback={
            <Box sx={{ textAlign: 'center', py: 8 }}>
              <CircularProgress size={36} sx={{ color: '#1b77d1' }} />
            </Box>
          }
        >
          <LinkAccountContent />
        </Suspense>
      </Container>
    </Box>
  );
}
