import type { Metadata } from 'next';

import * as React from 'react';
import Link from 'next/link';
import { Box, Container, Typography, Button, Grid, Card, CardContent, Stack } from '@mui/material';
import CreateIcon from '@mui/icons-material/Create';
import FunctionsIcon from '@mui/icons-material/Functions';
import AssessmentIcon from '@mui/icons-material/Assessment';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import SchoolIcon from '@mui/icons-material/School';
import { buildHomeMetadata } from '@/lib/seo-url';

export const metadata: Metadata = buildHomeMetadata();

export default function Home() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        backgroundColor: '#f8fafc', // Soft light gray background
        overflow: 'hidden',
      }}
    >
      {/* Header bar */}
      <Box
        component="header"
        className="no-print"
        sx={{
          padding: '20px 40px',
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
              backgroundColor: '#1b77d1', // Escola Blue
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
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '80px 20px',
          textAlign: 'center',
          zIndex: 5,
        }}
      >
        <Typography
          variant="h2"
          component="h1"
          sx={{
            fontSize: { xs: '2.2rem', md: '3.6rem' },
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
              color: '#1b77d1', // Escola Blue
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
            marginBottom: '40px',
            fontSize: { xs: '1rem', md: '1.2rem' },
            fontWeight: 400,
          }}
        >
          Die professionelle Schweizer Prüfungs-Assistenten-Plattform, die handschriftliche Arbeiten
          liest, Teilpunkte vergibt und mathematische Folgefehler vollautomatisch berücksichtigt.
          Spare bis zu 80% deiner Korrekturzeit.
        </Typography>

        <Stack spacing={2} sx={{ alignItems: 'center' }}>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={2}
            sx={{
              alignItems: 'center',
              justifyContent: 'center',
              width: { xs: '100%', sm: 'auto' },
            }}
          >
            <Link href="/dashboard" passHref style={{ textDecoration: 'none', width: '100%' }}>
              <Button
                variant="contained"
                size="large"
                endIcon={<ArrowForwardIcon />}
                sx={{
                  fontSize: '1.1rem',
                  padding: '14px 36px',
                  borderRadius: '8px',
                  minWidth: { xs: '100%', sm: '260px' },
                  backgroundColor: '#1b77d1',
                  color: '#ffffff',
                  textTransform: 'none',
                  fontWeight: 600,
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
            <Link href="/login" passHref style={{ textDecoration: 'none', width: '100%' }}>
              <Button
                variant="outlined"
                size="large"
                sx={{
                  fontSize: '1.1rem',
                  padding: '14px 28px',
                  borderRadius: '8px',
                  borderColor: '#cbd5e1',
                  color: '#334155',
                  textTransform: 'none',
                  fontWeight: 600,
                  minWidth: { xs: '100%', sm: 'auto' },
                  '&:hover': {
                    borderColor: '#1b77d1',
                    color: '#1b77d1',
                    backgroundColor: 'rgba(27, 119, 209, 0.04)',
                  },
                }}
              >
                Login / Registrieren
              </Button>
            </Link>
          </Stack>
          <Typography
            variant="caption"
            sx={{ color: '#9e9e9e', fontSize: '0.85rem', fontWeight: 500 }}
          >
            Professionelle Prüfungskorrektur direkt über die integrierte Gemini-Schnittstelle.
          </Typography>
        </Stack>
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
                borderTop: '4px solid #1b77d1', // Accent top line like Escola
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
                borderTop: '4px solid #938eef', // Accent top line lavender
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
                borderTop: '4px solid #ed6c02', // Accent top line orange
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
