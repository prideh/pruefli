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
import { setCachedTeacher } from '@/lib/sessionCache';
import SocialLoginButtons from '@/components/SocialLoginButtons';

function getInitialLoginError(): string {
  if (typeof window === 'undefined') return '';
  const params = new URLSearchParams(window.location.search);
  const urlError = params.get('error');
  if (!urlError) return '';
  switch (urlError) {
    case 'oauth_cancelled':
      return 'Die Anmeldung über den Anbieter wurde abgebrochen.';
    case 'provider_not_configured':
      return 'Dieser Social-Login-Anbieter ist noch nicht eingerichtet.';
    case 'invalid_state':
      return 'Die Sitzung ist abgelaufen. Bitte versuche es erneut.';
    case 'link_token_expired':
      return 'Der Verknüpfungs-Link ist abgelaufen oder ungültig.';
    case 'oauth_exchange_failed':
      return 'Anmeldung beim Anbieter fehlgeschlagen. Bitte versuche es später erneut.';
    default:
      return '';
  }
}

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(getInitialLoginError);

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
    if (!email || !password) {
      setError('Bitte gib deine E-Mail und dein Passwort ein.');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || 'Login fehlgeschlagen');
      }

      if (result.teacher) {
        setCachedTeacher(result.teacher);
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

        {/* Login Card */}
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
                Willkommen zurück!
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                Melde dich an, um auf deine Klassen und Arbeiten zuzugreifen.
              </Typography>
            </Box>

            {error && (
              <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
                {error}
              </Alert>
            )}

            <form onSubmit={handleSubmit}>
              <Stack spacing={2.5}>
                {/* Email Field */}
                <TextField
                  label="E-Mail-Adresse"
                  type="email"
                  fullWidth
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

                <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: -1 }}>
                  <Link
                    href="/forgot-password"
                    style={{
                      color: '#1b77d1',
                      fontSize: '0.85rem',
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    Passwort vergessen?
                  </Link>
                </Box>

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
                  {loading ? <CircularProgress size={24} sx={{ color: '#ffffff' }} /> : 'Anmelden'}
                </Button>
              </Stack>
            </form>

            <SocialLoginButtons labelPrefix="anmelden" />

            <Box sx={{ mt: 3, textAlign: 'center' }}>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
                Noch keinen Account?{' '}
                <Link
                  href="/register"
                  style={{ color: '#1b77d1', fontWeight: 600, textDecoration: 'none' }}
                >
                  Jetzt registrieren
                </Link>
              </Typography>
              <Typography
                variant="caption"
                sx={{ color: 'text.secondary', display: 'block', mt: 2 }}
              >
                <Link
                  href="/privacy"
                  style={{ color: '#64748b', textDecoration: 'none', fontWeight: 500 }}
                >
                  Datenschutzerklärung
                </Link>
              </Typography>
            </Box>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
