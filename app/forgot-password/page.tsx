'use client';

import * as React from 'react';
import { useState } from 'react';
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
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import EmailIcon from '@mui/icons-material/Email';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitResult, setSubmitResult] = useState<{
    sent: boolean;
    liveSendingEnabled: boolean;
    message: string;
  } | null>(null);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !email.includes('@')) {
      setError('Bitte gib eine gültige E-Mail-Adresse ein.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase() }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Anfrage konnte nicht verarbeitet werden.');
      }

      const liveSending =
        data.liveSendingEnabled !== false && !data.simulated && data.sent !== false;
      setSubmitResult({
        sent: liveSending,
        liveSendingEnabled: liveSending,
        message:
          data.message ||
          (liveSending
            ? 'Falls ein Konto mit dieser E-Mail-Adresse existiert, wurde eine E-Mail mit einem Link zum Zurücksetzen des Passworts versendet.'
            : 'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine E-Mail zum Zurücksetzen des Passworts versendet.'),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setLoading(false);
    }
  };

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

        <Card
          sx={{
            borderRadius: '16px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            overflow: 'hidden',
          }}
        >
          <CardContent sx={{ padding: '40px' }}>
            <Box sx={{ mb: 3, textAlign: 'center' }}>
              <Typography
                variant="h5"
                component="h1"
                sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}
              >
                Passwort vergessen?
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                Gib deine registrierte E-Mail-Adresse ein. Wir senden dir einen sicheren Link zum
                Zurücksetzen.
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
                {error}
              </Alert>
            )}

            {submitResult ? (
              <Stack spacing={3} sx={{ textAlign: 'center', py: 2 }}>
                <Alert
                  severity={submitResult.liveSendingEnabled ? 'success' : 'warning'}
                  sx={{ borderRadius: '10px', textAlign: 'left' }}
                >
                  {submitResult.message}
                </Alert>
                {submitResult.liveSendingEnabled ? (
                  <Typography variant="body2" sx={{ color: '#64748b', lineHeight: 1.6 }}>
                    Bitte prüfe dein E-Mail-Postfach. Der Link ist <strong>1 Stunde gültig</strong>.
                  </Typography>
                ) : (
                  <Typography variant="body2" sx={{ color: '#64748b', lineHeight: 1.6 }}>
                    In dieser Umgebung ist der Live-E-Mail-Versand deaktiviert (Mock-Transport). Es
                    können derzeit keine E-Mails zugestellt werden.
                  </Typography>
                )}
                <Link href="/login" passHref style={{ textDecoration: 'none' }}>
                  <Button
                    variant="outlined"
                    startIcon={<ArrowBackIcon />}
                    sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                  >
                    Zurück zur Anmeldung
                  </Button>
                </Link>
              </Stack>
            ) : (
              <form onSubmit={handleSubmit}>
                <Stack spacing={2.5}>
                  <TextField
                    label="E-Mail-Adresse"
                    type="email"
                    fullWidth
                    required
                    variant="outlined"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="name@schule.ch"
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <EmailIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
                          </InputAdornment>
                        ),
                      },
                    }}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
                  />

                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    disabled={loading}
                    sx={{
                      padding: '12px',
                      borderRadius: '10px',
                      fontSize: '1rem',
                      fontWeight: 700,
                      textTransform: 'none',
                      backgroundColor: '#1b77d1',
                      boxShadow: '0 4px 12px rgba(27, 119, 209, 0.25)',
                      '&:hover': { backgroundColor: '#1565c0' },
                      mt: 1,
                    }}
                  >
                    {loading ? (
                      <CircularProgress size={24} sx={{ color: '#ffffff' }} />
                    ) : (
                      'Link zum Zurücksetzen senden'
                    )}
                  </Button>

                  <Box sx={{ textAlign: 'center', mt: 2 }}>
                    <Link
                      href="/login"
                      style={{
                        color: '#1b77d1',
                        fontWeight: 600,
                        textDecoration: 'none',
                        fontSize: '0.9rem',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '6px',
                      }}
                    >
                      <ArrowBackIcon sx={{ fontSize: '1rem' }} /> Zurück zur Anmeldung
                    </Link>
                  </Box>
                </Stack>
              </form>
            )}
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
