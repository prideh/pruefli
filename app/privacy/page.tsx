import type { Metadata } from 'next';
import Link from 'next/link';
import {
  Box,
  Container,
  Typography,
  Card,
  CardContent,
  Stack,
  Divider,
  Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';

export const metadata: Metadata = {
  title: 'Datenschutzerklärung',
  description:
    'Informationen zum Datenschutz, zu technisch notwendigen Cookies und zur Datenverarbeitung von prüefli.',
};

export default function PrivacyPage() {
  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: '#f8fafc',
        py: { xs: 4, md: 8 },
        px: { xs: 2, sm: 3 },
      }}
    >
      <Container maxWidth="md">
        {/* Navigation Header */}
        <Stack
          direction="row"
          sx={{ mb: 4, justifyContent: 'space-between', alignItems: 'center' }}
        >
          <Link href="/" style={{ textDecoration: 'none' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              variant="text"
              sx={{
                color: '#1b77d1',
                fontWeight: 600,
                textTransform: 'none',
                '&:hover': { backgroundColor: 'rgba(27, 119, 209, 0.08)' },
              }}
            >
              Zurück zur Startseite
            </Button>
          </Link>
        </Stack>

        {/* Main Card */}
        <Card
          sx={{
            borderRadius: '16px',
            boxShadow: '0 4px 20px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e2e8f0',
            backgroundColor: '#ffffff',
            overflow: 'hidden',
          }}
        >
          <CardContent sx={{ p: { xs: 3, sm: 6 } }}>
            {/* Header */}
            <Typography
              variant="h4"
              component="h1"
              sx={{
                fontWeight: 800,
                color: '#0f172a',
                letterSpacing: '-0.02em',
              }}
            >
              Datenschutzerklärung
            </Typography>

            <Divider sx={{ my: 3 }} />

            <Stack spacing={3.5}>
              {/* 1. Verantwortliche Stelle */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  1. Verantwortliche Stelle
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Mahdi Nasserzadeh, support@pruefli.ch
                </Typography>
              </Box>

              {/* 2. Daten und Zwecke */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  2. Daten und Zwecke
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  prüefli bearbeitet Konto- und Zugangsdaten der Lehrpersonen, Klassenbezeichnungen
                  und Schülernamen, Prüfungsangaben, eingescannte Prüfungsarbeiten und
                  Korrekturresultate. Dies dient dem Betrieb der Plattform und der KI-unterstützten
                  Prüfungskorrektur.
                </Typography>
              </Box>

              {/* 3. Eingesetzte Dienste */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  3. Eingesetzte Dienste
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Google (Gemini API) erhält Scans sowie zugehörige Prüfungs- und Schülerangaben zur
                  Korrektur. Cloudflare R2 speichert die Scans. Render betreibt die Anwendung und
                  Datenbank. Infomaniak stellt die Kontakt-E-Mail-Adresse bereit.
                </Typography>
              </Box>

              {/* 4. Bearbeitung im Ausland */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  4. Bearbeitung im Ausland
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7, mb: 1.5 }}>
                  Die Anwendung und Datenbank werden bei Render in Frankfurt am Main betrieben; der
                  Anbieter Render Services Inc. sitzt in den USA. Die Scans werden bei Cloudflare in
                  der EU gespeichert. Infomaniak hat seinen Sitz in der Schweiz.
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Bei der kostenpflichtigen Gemini-API verwendet Google die übermittelten Inhalte
                  nicht zur Produktverbesserung. Eine vorübergehende Speicherung kann weltweit in
                  Einrichtungen von Google oder seinen Unterauftragsverarbeitern erfolgen. Für
                  Übermittlungen in die USA sieht Googles Datenverarbeitungsvereinbarung das
                  Schweizerisch-US-amerikanische Data Privacy Framework vor, für andere Drittstaaten
                  Standardvertragsklauseln.
                </Typography>
              </Box>

              {/* 5. Cookies */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  5. Cookies
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Für die Anmeldung wird ein technisch notwendiges Cookie eingesetzt.
                </Typography>
              </Box>

              {/* 6. Ihre Rechte */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1 }}>
                  6. Ihre Rechte
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Anfragen zu Auskunft, Berichtigung oder Löschung Ihrer Daten richten Sie an
                  support@pruefli.ch.
                </Typography>
              </Box>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
