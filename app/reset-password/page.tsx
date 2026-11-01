'use client';

import * as React from 'react';
import { useState, Suspense } from 'react';
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
  TextField,
  CircularProgress,
  Alert,
  InputAdornment,
  IconButton,
} from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import LockIcon from '@mui/icons-material/Lock';
import Visibility from '@mui/icons-material/Visibility';
import VisibilityOff from '@mui/icons-material/VisibilityOff';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';

function ResetPasswordContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(
    !token ? 'Kein gültiger Token im Link gefunden. Bitte fordere einen neuen Link an.' : null
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!token) {
      setError('Ungültiger Link.');
      return;
    }

    if (!password || password.length < 6) {
      setError('Das Passwort muss mindestens 6 Zeichen lang sein.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Die eingegebenen Passwörter stimmen nicht überein.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Passwort konnte nicht zurückgesetzt werden.');
      }

      setSuccess(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ein unerwarteter Fehler ist aufgetreten.');
    } finally {
      setLoading(false);
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
      }}
    >
      <CardContent sx={{ padding: '40px' }}>
        <Box sx={{ mb: 3, textAlign: 'center' }}>
          <Typography variant="h5" component="h1" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
            Neues Passwort festlegen
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 500 }}>
            Wähle ein sicheres Passwort mit mindestens 6 Zeichen.
          </Typography>
        </Box>

        {error && (
          <Alert severity="error" sx={{ mb: 3, borderRadius: '10px' }}>
            {error}
          </Alert>
        )}

        {success ? (
          <Stack spacing={3} sx={{ textAlign: 'center', py: 2, alignItems: 'center' }}>
            <CheckCircleIcon sx={{ fontSize: '3.5rem', color: '#16a34a' }} />
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>
              Passwort erfolgreich geändert!
            </Typography>
            <Typography variant="body2" sx={{ color: '#64748b', maxWidth: 400, lineHeight: 1.6 }}>
              Du kannst dich jetzt mit deinem neuen Passwort bei prüefli anmelden.
            </Typography>
            <Link
              href="/login"
              passHref
              style={{ textDecoration: 'none', width: '100%', maxWidth: 260 }}
            >
              <Button
                variant="contained"
                fullWidth
                sx={{
                  padding: '12px',
                  borderRadius: '10px',
                  fontWeight: 700,
                  textTransform: 'none',
                  backgroundColor: '#1b77d1',
                  '&:hover': { backgroundColor: '#1565c0' },
                }}
              >
                Zur Anmeldung
              </Button>
            </Link>
          </Stack>
        ) : (
          <form onSubmit={handleSubmit}>
            <Stack spacing={2.5}>
              <TextField
                label="Neues Passwort"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                required
                variant="outlined"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mindestens 6 Zeichen"
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
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '10px' } }}
              />

              <TextField
                label="Passwort wiederholen"
                type={showPassword ? 'text' : 'password'}
                fullWidth
                required
                variant="outlined"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Passwort bestätigen"
                slotProps={{
                  input: {
                    startAdornment: (
                      <InputAdornment position="start">
                        <LockIcon sx={{ color: 'text.secondary', fontSize: '1.2rem' }} />
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
                disabled={loading || !token}
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
                  'Passwort speichern'
                )}
              </Button>

              <Box sx={{ textAlign: 'center', mt: 2 }}>
                <Link
                  href="/login"
                  style={{
                    color: '#64748b',
                    textDecoration: 'none',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}
                >
                  Abbrechen und zur Anmeldung
                </Link>
              </Box>
            </Stack>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export default function ResetPasswordPage() {
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
          <ResetPasswordContent />
        </Suspense>
      </Container>
    </Box>
  );
}
