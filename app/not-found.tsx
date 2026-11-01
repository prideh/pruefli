import * as React from 'react';
import Link from 'next/link';
import { Box, Container, Typography, Button, Card, CardContent, Stack, Chip } from '@mui/material';
import SchoolIcon from '@mui/icons-material/School';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import HomeOutlinedIcon from '@mui/icons-material/HomeOutlined';
import SearchOffIcon from '@mui/icons-material/SearchOff';

export default function NotFound() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* Branded Top Header */}
      <Box
        component="header"
        sx={{
          padding: { xs: '16px 20px', sm: '20px 40px' },
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
        }}
      >
        <Link href="/" style={{ textDecoration: 'none' }}>
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
        </Link>

        <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
          <Button
            variant="outlined"
            size="small"
            startIcon={<ArrowBackIcon />}
            sx={{
              fontWeight: 650,
              color: '#0f172a',
              borderColor: '#cbd5e1',
              textTransform: 'none',
              borderRadius: '8px',
              '&:hover': {
                borderColor: '#94a3b8',
                backgroundColor: '#f1f5f9',
              },
            }}
          >
            Zur Übersicht
          </Button>
        </Link>
      </Box>

      {/* Centered 404 Content */}
      <Container
        maxWidth="sm"
        sx={{
          flex: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          py: 8,
        }}
      >
        <Card
          sx={{
            width: '100%',
            borderRadius: '16px',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            boxShadow: '0 4px 20px rgba(15, 23, 42, 0.04)',
            textAlign: 'center',
          }}
        >
          <CardContent sx={{ p: { xs: 4, sm: 6 } }}>
            <Box
              sx={{
                width: '64px',
                height: '64px',
                borderRadius: '16px',
                backgroundColor: '#eff6ff',
                color: '#1b77d1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                mx: 'auto',
                mb: 2.5,
              }}
            >
              <SearchOffIcon sx={{ fontSize: '2.2rem' }} />
            </Box>

            <Chip
              label="Fehler 404"
              size="small"
              sx={{
                fontWeight: 700,
                backgroundColor: '#f1f5f9',
                color: '#475569',
                border: '1px solid #cbd5e1',
                mb: 2,
              }}
            />

            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
                mb: 1.5,
              }}
            >
              Seite nicht gefunden
            </Typography>

            <Typography
              variant="body1"
              sx={{
                color: '#475569',
                lineHeight: 1.65,
                maxWidth: '420px',
                mx: 'auto',
                mb: 4,
              }}
            >
              Die aufgerufene Seite existiert leider nicht oder die Adresse ist unvollständig. Kehre
              zur Übersicht zurück, um mit deinen Klassen und Prüfungen weiterzuarbeiten.
            </Typography>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              sx={{ justifyContent: 'center' }}
            >
              <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
                <Button
                  variant="contained"
                  startIcon={<ArrowBackIcon />}
                  sx={{
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    color: '#ffffff',
                    textTransform: 'none',
                    borderRadius: '8px',
                    px: 3,
                    py: 1.2,
                    boxShadow: 'none',
                    width: { xs: '100%', sm: 'auto' },
                    '&:hover': {
                      backgroundColor: '#1565c0',
                    },
                  }}
                >
                  Zur Übersicht
                </Button>
              </Link>

              <Link href="/" passHref style={{ textDecoration: 'none' }}>
                <Button
                  variant="outlined"
                  startIcon={<HomeOutlinedIcon />}
                  sx={{
                    fontWeight: 650,
                    color: '#334155',
                    borderColor: '#cbd5e1',
                    textTransform: 'none',
                    borderRadius: '8px',
                    px: 3,
                    py: 1.2,
                    width: { xs: '100%', sm: 'auto' },
                    '&:hover': {
                      borderColor: '#94a3b8',
                      backgroundColor: '#f8fafc',
                    },
                  }}
                >
                  Zur Startseite
                </Button>
              </Link>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
