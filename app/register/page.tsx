'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
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
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import EmailIcon from '@mui/icons-material/Email';
import LockIcon from '@mui/icons-material/Lock';
import PersonIcon from '@mui/icons-material/Person';
import { setCachedTeacher } from '@/lib/sessionCache';
import SocialLoginButtons from '@/components/SocialLoginButtons';

export default function RegisterPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Proactively check if already logged in
  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/me', { signal: controller.signal })
      .then((res) => {
        if (res.ok) {
          router.replace('/dashboard');
        }
      })
      .catch(() => {});

    return () => {
      controller.abort();
    };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !password) {
      setError('Bitte fülle alle Felder aus.');
      return;
    }

    if (password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, email, password }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Registrierung fehlgeschlagen');
      }

      if (result.teacher) {
        setCachedTeacher({
          ...result.teacher,
          isEmailVerified: false,
          emailVerificationRequired: Boolean(result.emailVerificationRequired),
          liveSendingEnabled:
            typeof result.liveSendingEnabled === 'boolean'
              ? result.liveSendingEnabled
              : result.emailVerification?.liveSendingEnabled,
        });
      }
      router.refresh();
      router.replace('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.');
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

        {/* Register Card */}
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
                Registrieren
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                Erstelle deinen kostenlosen Lehrer-Account in wenigen Sekunden.
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack spacing={2.5}>
                {/* Full Name */}
                <TextField
                  label="Vollständiger Name"
                  type="text"
                  fullWidth
                  variant="outlined"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Frau Meier"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <PersonIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
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

                {/* Email Field */}
                <TextField
                  label="E-Mail-Adresse"
                  type="email"
                  fullWidth
                  variant="outlined"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="lehrer@schule.ch"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <EmailIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
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

                {/* Password Field */}
                <TextField
                  label="Passwort"
                  type={showPassword ? 'text' : 'password'}
                  fullWidth
                  variant="outlined"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  helperText="Mindestens 6 Zeichen erforderlich (mindestens 8 Zeichen empfohlen)"
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

                {/* Submit Button */}
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
                    '&:hover': {
                      backgroundColor: '#1565c0',
                    },
                    mt: 1,
                  }}
                >
                  {loading ? (
                    <CircularProgress size={24} sx={{ color: '#ffffff' }} />
                  ) : (
                    'Account erstellen'
                  )}
                </Button>

                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    textAlign: 'center',
                    display: 'block',
                    mt: 1,
                    lineHeight: 1.5,
                  }}
                >
                  Mit der Registrierung akzeptieren Sie unsere{' '}
                  <Link
                    href="/privacy"
                    style={{
                      color: '#1b77d1',
                      fontWeight: 600,
                      textDecoration: 'underline',
                    }}
                  >
                    Datenschutzerklärung
                  </Link>
                  .
                </Typography>
              </Stack>
            </form>

            <SocialLoginButtons labelPrefix="registrieren" />

            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                Bereits registriert?{' '}
                <Link
                  href="/login"
                  style={{ color: '#1b77d1', fontWeight: 600, textDecoration: 'none' }}
                >
                  Jetzt anmelden
                </Link>
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
