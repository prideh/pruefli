import type { Metadata } from 'next';

import * as React from 'react';
import Link from 'next/link';
import {
  Box,
  Container,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Stack,
  Chip,
} from '@mui/material';
import CreateIcon from '@mui/icons-material/Create';
import FunctionsIcon from '@mui/icons-material/Functions';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SchoolIcon from '@mui/icons-material/School';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorIcon from '@mui/icons-material/Error';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { buildHomeMetadata } from '@/lib/seo-url';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { verifyJWT } from '@/lib/jwt';

export const metadata: Metadata = buildHomeMetadata();

export default async function Home() {
  const cookieStore = await cookies();
  const sessionToken = cookieStore.get('grade_ai_session')?.value;
  const payload = sessionToken ? await verifyJWT(sessionToken) : null;
  const isAuthenticated = Boolean(payload?.userId);

  if (isAuthenticated) {
    redirect('/dashboard');
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        backgroundColor: '#f8fafc',
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <Box
        component="header"
        className="no-print"
        sx={{
          padding: { xs: '16px 20px', sm: '20px 40px' },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          zIndex: 10,
        }}
      >
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Box
            sx={{
              width: '36px',
              height: '36px',
              borderRadius: '8px',
              backgroundColor: '#1b77d1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <SchoolIcon sx={{ color: 'white', fontSize: '1.2rem' }} />
          </Box>
          <Typography
            variant="h5"
            component="span"
            sx={{
              fontWeight: 800,
              letterSpacing: '-0.02em',
              color: '#0f172a',
            }}
          >
            prüefli
          </Typography>
        </Stack>

        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
          <Link href="/login" passHref style={{ textDecoration: 'none' }}>
            <Button
              variant="text"
              sx={{
                fontWeight: 650,
                color: '#334155',
                textTransform: 'none',
                fontSize: { xs: '0.875rem', sm: '0.95rem' },
                '&:hover': {
                  color: '#1b77d1',
                  backgroundColor: 'rgba(27, 119, 209, 0.04)',
                },
              }}
            >
              Login
            </Button>
          </Link>
          <Link href="/register" passHref style={{ textDecoration: 'none' }}>
            <Button
              variant="contained"
              sx={{
                fontWeight: 650,
                backgroundColor: '#1b77d1',
                color: '#ffffff',
                textTransform: 'none',
                fontSize: { xs: '0.875rem', sm: '0.95rem' },
                borderRadius: '8px',
                boxShadow: 'none',
                '&:hover': {
                  backgroundColor: '#1565c0',
                  boxShadow: '0 2px 8px rgba(27, 119, 209, 0.25)',
                },
              }}
            >
              Registrieren
            </Button>
          </Link>
        </Stack>
      </Box>

      {/* Hero section */}
      <Container
        maxWidth="lg"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: { xs: '48px 20px 36px', md: '72px 20px 48px' },
          textAlign: 'center',
          zIndex: 5,
        }}
      >
        <Typography
          variant="h2"
          component="h1"
          sx={{
            fontSize: { xs: '2.1rem', sm: '2.8rem', md: '3.6rem' },
            lineHeight: 1.2,
            marginBottom: '24px',
            fontWeight: 800,
            letterSpacing: '-0.03em',
            color: '#0f172a',
          }}
        >
          Prüfungen bewerten.
          <br />
          <Box
            component="span"
            sx={{
              color: '#1b77d1',
            }}
          >
            Mit KI-Präzision & Folgefehler-Logik.
          </Box>
        </Typography>

        <Typography
          variant="h6"
          component="p"
          sx={{
            color: '#666666',
            maxWidth: '680px',
            lineHeight: 1.6,
            marginBottom: '36px',
            fontSize: { xs: '1rem', md: '1.2rem' },
            fontWeight: 400,
          }}
        >
          Die professionelle Schweizer Prüfungs-Assistenten-Plattform, die handschriftliche Arbeiten
          liest, Teilpunkte vergibt und mathematische Folgefehler vollautomatisch berücksichtigt.
          Spare bis zu 80% deiner Korrekturzeit.
        </Typography>

        {/* Clear Primary CTA */}
        {isAuthenticated ? (
          <Stack spacing={1.5} sx={{ alignItems: 'center', width: { xs: '100%', sm: 'auto' } }}>
            <Link
              href="/dashboard"
              passHref
              style={{ textDecoration: 'none', width: '100%', maxWidth: '340px' }}
            >
              <Button
                variant="contained"
                size="large"
                endIcon={<ArrowForwardIcon />}
                sx={{
                  fontSize: '1.1rem',
                  padding: '14px 36px',
                  borderRadius: '8px',
                  width: { xs: '100%', sm: '320px' },
                  backgroundColor: '#1b77d1',
                  color: '#ffffff',
                  textTransform: 'none',
                  fontWeight: 650,
                  boxShadow: '0 2px 8px rgba(27, 119, 209, 0.2)',
                  '&:hover': {
                    backgroundColor: '#1565c0',
                    boxShadow: '0 4px 12px rgba(27, 119, 209, 0.3)',
                  },
                }}
              >
                Zum Korrektur-Workspace
              </Button>
            </Link>
            <Typography
              variant="caption"
              sx={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 500 }}
            >
              Angemeldet als Lehrperson · Direkt zu deinen Klassen & Prüfungen
            </Typography>
          </Stack>
        ) : (
          <Stack spacing={1.5} sx={{ alignItems: 'center', width: { xs: '100%', sm: 'auto' } }}>
            <Link
              href="/register"
              passHref
              style={{ textDecoration: 'none', width: '100%', maxWidth: '340px' }}
            >
              <Button
                variant="contained"
                size="large"
                endIcon={<ArrowForwardIcon />}
                sx={{
                  fontSize: '1.1rem',
                  padding: '14px 36px',
                  borderRadius: '8px',
                  width: { xs: '100%', sm: '320px' },
                  backgroundColor: '#1b77d1',
                  color: '#ffffff',
                  textTransform: 'none',
                  fontWeight: 650,
                  boxShadow: '0 2px 8px rgba(27, 119, 209, 0.2)',
                  '&:hover': {
                    backgroundColor: '#1565c0',
                    boxShadow: '0 4px 12px rgba(27, 119, 209, 0.3)',
                  },
                }}
              >
                Jetzt kostenlos starten
              </Button>
            </Link>
            <Typography
              variant="caption"
              sx={{ color: '#64748b', fontSize: '0.85rem', fontWeight: 500 }}
            >
              Bereits registriert?{' '}
              <Link
                href="/login"
                style={{
                  color: '#1b77d1',
                  fontWeight: 650,
                  textDecoration: 'none',
                }}
              >
                Login / Registrieren
              </Link>
            </Typography>
          </Stack>
        )}
      </Container>

      {/* Product Showcase Section: Beispielantwort -> Korrektur -> Feedback */}
      <Container
        maxWidth="lg"
        sx={{
          paddingBottom: { xs: '60px', md: '80px' },
          zIndex: 5,
        }}
      >
        <Card
          sx={{
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            boxShadow: '0 8px 30px rgba(15, 23, 42, 0.05)',
            backgroundColor: '#ffffff',
            overflow: 'hidden',
          }}
        >
          {/* Card Header Banner with Synthetic Data Badge */}
          <Box
            sx={{
              padding: { xs: '20px', sm: '24px 32px' },
              borderBottom: '1px solid #e2e8f0',
              backgroundColor: '#f8fafc',
              display: 'flex',
              flexDirection: { xs: 'column', sm: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              gap: 2,
            }}
          >
            <Box>
              <Typography
                variant="overline"
                sx={{
                  color: '#1b77d1',
                  fontWeight: 750,
                  letterSpacing: '0.08em',
                  fontSize: '0.75rem',
                  display: 'block',
                }}
              >
                PRAXISBEISPIEL AUS DEM WORKSPACE
              </Typography>
              <Typography
                variant="h5"
                component="h2"
                sx={{
                  color: '#0f172a',
                  fontWeight: 800,
                  letterSpacing: '-0.02em',
                  fontSize: { xs: '1.2rem', sm: '1.35rem', md: '1.5rem' },
                }}
              >
                Beispielantwort → Teilschritt-Korrektur → Feedback
              </Typography>
            </Box>

            <Chip
              label="Synthetisches Anschauungsbeispiel · Eindeutig fiktive Schülerdaten"
              size="small"
              sx={{
                backgroundColor: '#eff6ff',
                color: '#1e40af',
                border: '1px solid #bfdbfe',
                fontWeight: 650,
                fontSize: '0.75rem',
                borderRadius: '6px',
                py: 0.5,
              }}
            />
          </Box>

          {/* 3-Column Stepped Workflow */}
          <Box sx={{ padding: { xs: '20px', sm: '28px', md: '32px' } }}>
            <Grid container spacing={3}>
              {/* Column 1: Beispielantwort */}
              <Grid size={{ xs: 12, md: 4 }}>
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#fafbfc',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      padding: '16px 20px',
                      borderBottom: '1px solid #e2e8f0',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: '#e3f2fd',
                        color: '#1b77d1',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                      }}
                    >
                      1
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 750, color: '#0f172a' }}>
                        Schülerantwort
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Transkribierter Scan (fiktiv)
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      padding: '20px',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 2,
                    }}
                  >
                    <Box
                      sx={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '12px 14px',
                      }}
                    >
                      <Typography variant="caption" sx={{ color: '#64748b', fontWeight: 600 }}>
                        Aufgabe 1 (Lineare Gleichung · Max. 3.0 P.)
                      </Typography>
                      <Typography
                        variant="body2"
                        sx={{ color: '#0f172a', fontWeight: 650, mt: 0.5 }}
                      >
                        Löse die Gleichung nach x auf: 2(x + 4) = 14
                      </Typography>
                    </Box>

                    {/* Transcribed student work */}
                    <Box
                      sx={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: '8px',
                        padding: '16px',
                        fontFamily: 'monospace',
                        fontSize: '0.95rem',
                        lineHeight: 1.8,
                        color: '#1e293b',
                        boxShadow: 'inset 0 1px 3px rgba(0, 0, 0, 0.02)',
                        flex: 1,
                      }}
                    >
                      <Box sx={{ color: '#64748b', fontSize: '0.8rem', mb: 1 }}>
                        Schülerarbeit (Lukas M., Klasse 8b):
                      </Box>
                      <Box>2(x + 4) = 14</Box>
                      <Box sx={{ color: '#b91c1c', fontWeight: 700 }}>2x + 6 = 14</Box>
                      <Box>2x = 8</Box>
                      <Box sx={{ fontWeight: 700 }}>x = 4</Box>
                    </Box>

                    <Typography variant="caption" sx={{ color: '#64748b', lineHeight: 1.5 }}>
                      <strong>Befund:</strong> In Zeile 2 liegt ein Rechenfehler vor (2 · 4 = 8,
                      notiert wurde 6). Die nachfolgenden Zeilen rechnen konsequent mit dem
                      Zwischenwert 6 weiter.
                    </Typography>
                  </Box>
                </Box>
              </Grid>

              {/* Column 2: KI-Teilschritt-Korrektur */}
              <Grid size={{ xs: 12, md: 4 }}>
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#fafbfc',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      padding: '16px 20px',
                      borderBottom: '1px solid #e2e8f0',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: '#f3e8ff',
                        color: '#7c3aed',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                      }}
                    >
                      2
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 750, color: '#0f172a' }}>
                        Teilschritt-Korrektur
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Folgefehler-Erkennung & Punkte
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      padding: '20px',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.5,
                    }}
                  >
                    {/* Schritt 1: Rechenfehler */}
                    <Box
                      sx={{
                        backgroundColor: '#ffffff',
                        borderRadius: '8px',
                        border: '1px solid #fecaca',
                        borderLeft: '4px solid #ef4444',
                        padding: '12px 14px',
                      }}
                    >
                      <Stack
                        direction="row"
                        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f172a' }}>
                          Schritt 1: <code>2x + 6 = 14</code>
                        </Typography>
                        <Chip
                          label="0.0 / 1.0 P."
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.7rem',
                            fontWeight: 750,
                            backgroundColor: '#fee2e2',
                            color: '#991b1b',
                          }}
                        />
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.5 }}>
                        <ErrorIcon sx={{ fontSize: '0.85rem', color: '#dc2626' }} />
                        <Chip
                          label="Rechenfehler"
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            backgroundColor: '#fef2f2',
                            color: '#dc2626',
                            border: '1px solid #fca5a5',
                          }}
                        />
                      </Stack>
                      <Typography
                        variant="caption"
                        sx={{ color: '#64748b', display: 'block', lineHeight: 1.4 }}
                      >
                        Klammer fehlerhaft ausmultipliziert (2 · 4 = 8, Schüler notiert 6). 1.0 P.
                        Abzug.
                      </Typography>
                    </Box>

                    {/* Schritt 2: Folgefehler */}
                    <Box
                      sx={{
                        backgroundColor: '#ffffff',
                        borderRadius: '8px',
                        border: '1px solid #fde68a',
                        borderLeft: '4px solid #f59e0b',
                        padding: '12px 14px',
                      }}
                    >
                      <Stack
                        direction="row"
                        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f172a' }}>
                          Schritt 2: <code>2x = 8</code>
                        </Typography>
                        <Chip
                          label="1.0 / 1.0 P."
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.7rem',
                            fontWeight: 750,
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                          }}
                        />
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.5 }}>
                        <CheckCircleIcon sx={{ fontSize: '0.85rem', color: '#d97706' }} />
                        <Chip
                          label="Folgefehler berücksichtigt"
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            backgroundColor: '#fffbeb',
                            color: '#b45309',
                            border: '1px solid #fcd34d',
                          }}
                        />
                      </Stack>
                      <Typography
                        variant="caption"
                        sx={{ color: '#64748b', display: 'block', lineHeight: 1.4 }}
                      >
                        Subtraktion (-6) mit Schülerwert mathematisch korrekt ausgeführt. Folgepunkt
                        angerechnet.
                      </Typography>
                    </Box>

                    {/* Schritt 3: Folgefehler */}
                    <Box
                      sx={{
                        backgroundColor: '#ffffff',
                        borderRadius: '8px',
                        border: '1px solid #fde68a',
                        borderLeft: '4px solid #f59e0b',
                        padding: '12px 14px',
                      }}
                    >
                      <Stack
                        direction="row"
                        sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}
                      >
                        <Typography variant="caption" sx={{ fontWeight: 700, color: '#0f172a' }}>
                          Schritt 3: <code>x = 4</code>
                        </Typography>
                        <Chip
                          label="1.0 / 1.0 P."
                          size="small"
                          sx={{
                            height: 20,
                            fontSize: '0.7rem',
                            fontWeight: 750,
                            backgroundColor: '#fef3c7',
                            color: '#92400e',
                          }}
                        />
                      </Stack>
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.5 }}>
                        <CheckCircleIcon sx={{ fontSize: '0.85rem', color: '#d97706' }} />
                        <Chip
                          label="Folgefehler berücksichtigt"
                          size="small"
                          sx={{
                            height: 18,
                            fontSize: '0.65rem',
                            fontWeight: 700,
                            backgroundColor: '#fffbeb',
                            color: '#b45309',
                            border: '1px solid #fcd34d',
                          }}
                        />
                      </Stack>
                      <Typography
                        variant="caption"
                        sx={{ color: '#64748b', display: 'block', lineHeight: 1.4 }}
                      >
                        Division durch 2 mit Schülerwert korrekt. Voller Folgepunkt vergütet.
                      </Typography>
                    </Box>

                    {/* Task Result footer */}
                    <Box
                      sx={{
                        mt: 'auto',
                        padding: '10px 14px',
                        backgroundColor: '#f8fafc',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Typography variant="caption" sx={{ fontWeight: 700, color: '#334155' }}>
                        Aufgabenergebnis:
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 800, color: '#0f172a' }}>
                        2.0 / 3.0 Punkte
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              </Grid>

              {/* Column 3: Schüler-Feedback */}
              <Grid size={{ xs: 12, md: 4 }}>
                <Box
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    borderRadius: '12px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#fafbfc',
                    overflow: 'hidden',
                  }}
                >
                  <Box
                    sx={{
                      padding: '16px 20px',
                      borderBottom: '1px solid #e2e8f0',
                      backgroundColor: '#ffffff',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        backgroundColor: '#dcfce7',
                        color: '#15803d',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontWeight: 800,
                        fontSize: '0.85rem',
                      }}
                    >
                      3
                    </Box>
                    <Box>
                      <Typography variant="subtitle2" sx={{ fontWeight: 750, color: '#0f172a' }}>
                        Schüler-Feedback
                      </Typography>
                      <Typography variant="caption" sx={{ color: '#64748b' }}>
                        Schweizer Note & Förderhinweise
                      </Typography>
                    </Box>
                  </Box>

                  <Box
                    sx={{
                      padding: '20px',
                      flex: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.5,
                    }}
                  >
                    {/* Grade Badge */}
                    <Box
                      sx={{
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '12px 14px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Box>
                        <Typography
                          variant="caption"
                          sx={{ color: '#64748b', display: 'block', fontWeight: 600 }}
                        >
                          Schweizer Standardnote (Linear 60%)
                        </Typography>
                        <Typography
                          variant="h5"
                          sx={{ fontWeight: 800, color: '#1b77d1', lineHeight: 1.2 }}
                        >
                          Note 4.3
                        </Typography>
                      </Box>
                      <Chip
                        label="Genügend"
                        size="small"
                        sx={{
                          backgroundColor: '#ecfdf5',
                          color: '#065f46',
                          border: '1px solid #a7f3d0',
                          fontWeight: 700,
                        }}
                      />
                    </Box>

                    {/* Stärken */}
                    <Box
                      sx={{
                        backgroundColor: '#f0fdf4',
                        border: '1px solid #bbf7d0',
                        borderRadius: '8px',
                        padding: '12px',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 750, color: '#166534', display: 'block', mb: 0.5 }}
                      >
                        Erkannte Stärken:
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: '#15803d', display: 'block', lineHeight: 1.4 }}
                      >
                        • Sichere Äquivalenzumformung beider Gleichungsseiten
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: '#15803d', display: 'block', lineHeight: 1.4 }}
                      >
                        • Klar strukturierter und lesbarer Lösungsweg
                      </Typography>
                    </Box>

                    {/* Hilfreicher Tipp & Übung */}
                    <Box
                      sx={{
                        backgroundColor: '#faf5ff',
                        border: '1px solid #e9d5ff',
                        borderRadius: '8px',
                        padding: '12px',
                      }}
                    >
                      <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', mb: 0.5 }}>
                        <AutoAwesomeIcon sx={{ fontSize: '0.85rem', color: '#7c3aed' }} />
                        <Typography variant="caption" sx={{ fontWeight: 750, color: '#6b21a8' }}>
                          Hilfreicher Tipp für den Schüler:
                        </Typography>
                      </Stack>
                      <Typography
                        variant="caption"
                        sx={{
                          color: '#581c87',
                          display: 'block',
                          lineHeight: 1.4,
                          fontStyle: 'italic',
                        }}
                      >
                        «Setze dein Resultat x = 4 am Ende in die Ausgangsgleichung ein: 2(4 + 4) =
                        16 ≠ 14. Die Probe zeigt dir den Rechenfehler sofort.»
                      </Typography>
                    </Box>

                    <Box
                      sx={{
                        mt: 'auto',
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: '8px',
                        padding: '10px 14px',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 700, color: '#334155', display: 'block' }}
                      >
                        Übungs-Empfehlung:
                      </Typography>
                      <Typography
                        variant="caption"
                        sx={{ color: '#64748b', display: 'block', mt: 0.25 }}
                      >
                        Terme mit Klammern ausmultiplizieren (3 Übungen)
                      </Typography>
                    </Box>
                  </Box>
                </Box>
              </Grid>
            </Grid>
          </Box>
        </Card>
      </Container>

      {/* Feature section */}
      <Container
        maxWidth="lg"
        className="no-print"
        sx={{
          paddingBottom: '100px',
          zIndex: 5,
        }}
      >
        <Grid container spacing={4}>
          {/* Feature 1 */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid #e2e8f0',
                borderTop: '4px solid #1b77d1',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <CardContent
                sx={{
                  padding: '32px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  flexGrow: 1,
                }}
              >
                <Box
                  sx={{
                    width: '48px',
                    height: '48px',
                    backgroundColor: '#e3f2fd',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#1b77d1',
                  }}
                >
                  <CreateIcon sx={{ fontSize: '1.5rem' }} />
                </Box>
                <Typography variant="h5" component="h3" sx={{ color: '#0f172a', fontWeight: 700 }}>
                  Präzise Handschrift-OCR
                </Typography>
                <Typography variant="body2" sx={{ color: '#666666', lineHeight: 1.6 }}>
                  Liest handschriftliche Prüfungen von Schülern. Die KI nutzt den Kontext des
                  Erwartungshorizonts, um selbst krakelige oder unsaubere Schriftzüge zuverlässig zu
                  entziffern.
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Feature 2 */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid #e2e8f0',
                borderTop: '4px solid #938eef',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <CardContent
                sx={{
                  padding: '32px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  flexGrow: 1,
                }}
              >
                <Box
                  sx={{
                    width: '48px',
                    height: '48px',
                    backgroundColor: '#f3e5f5',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#938eef',
                  }}
                >
                  <FunctionsIcon sx={{ fontSize: '1.5rem' }} />
                </Box>
                <Typography variant="h5" component="h3" sx={{ color: '#0f172a', fontWeight: 700 }}>
                  Folgefehler & Teilpunkte
                </Typography>
                <Typography variant="body2" sx={{ color: '#666666', lineHeight: 1.6 }}>
                  Erkennt Rechenfehler sofort und zieht Teilpunkte ab. Die KI rechnet nachfolgende
                  Schritte jedoch konsequent mit dem Fehlerwert weiter, um Folgepunkte voll
                  anzurechnen.
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          {/* Feature 3 */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Card
              sx={{
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                border: '1px solid #e2e8f0',
                borderTop: '4px solid #ed6c02',
                borderRadius: '8px',
                backgroundColor: '#ffffff',
                boxShadow: '0 2px 8px rgba(0,0,0,0.02)',
              }}
            >
              <CardContent
                sx={{
                  padding: '32px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  flexGrow: 1,
                }}
              >
                <Box
                  sx={{
                    width: '48px',
                    height: '48px',
                    backgroundColor: '#fff3e0',
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#ed6c02',
                  }}
                >
                  <AssessmentIcon sx={{ fontSize: '1.5rem' }} />
                </Box>
                <Typography variant="h5" component="h3" sx={{ color: '#0f172a', fontWeight: 700 }}>
                  Schüler-Feedback (PDF)
                </Typography>
                <Typography variant="body2" sx={{ color: '#666666', lineHeight: 1.6 }}>
                  Erstellt per Mausklick ein ausdruckbares Feedback-Blatt für Schüler mit den
                  erreichten Punkten, einer Auswertung ihrer Stärken/Schwächen und konkreten
                  Übungstipps.
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>
      </Container>

      {/* Footer */}
      <Box
        component="footer"
        sx={{
          padding: '24px 40px',
          borderTop: '1px solid #e2e8f0',
          backgroundColor: '#ffffff',
          color: '#666666',
          fontSize: '0.85rem',
          fontWeight: 500,
          zIndex: 5,
          display: 'flex',
          flexDirection: { xs: 'column', sm: 'row' },
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 1.5,
        }}
      >
        <Typography variant="body2" sx={{ color: '#666666' }}>
          © 2026 prüefli. Die intelligente Prüfungskorrektur für Schweizer Lehrpersonen.
        </Typography>
        <Stack direction="row" spacing={3}>
          <Link
            href="/privacy"
            style={{
              color: '#1b77d1',
              textDecoration: 'none',
              fontWeight: 600,
              fontSize: '0.85rem',
            }}
          >
            Datenschutzerklärung
          </Link>
        </Stack>
      </Box>
    </Box>
  );
}
