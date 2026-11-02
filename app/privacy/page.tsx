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
  Chip,
  Button,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import SecurityIcon from '@mui/icons-material/Security';
import StorageIcon from '@mui/icons-material/Storage';
import CookieIcon from '@mui/icons-material/Cookie';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PolicyIcon from '@mui/icons-material/Policy';

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

          <Chip
            icon={<SecurityIcon style={{ color: '#1b77d1' }} />}
            label="Schweizer Datenschutzgesetz (DSG)"
            variant="outlined"
            sx={{
              borderColor: '#cbd5e1',
              fontWeight: 600,
              color: '#334155',
              backgroundColor: '#ffffff',
            }}
          />
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
            <Box sx={{ mb: 4 }}>
              <Typography
                variant="h4"
                component="h1"
                sx={{
                  fontWeight: 800,
                  color: '#0f172a',
                  mb: 1.5,
                  letterSpacing: '-0.02em',
                }}
              >
                Datenschutzerklärung
              </Typography>
              <Typography variant="body1" sx={{ color: '#64748b', lineHeight: 1.6 }}>
                Transparenz und Datensicherheit für Lehrpersonen. Diese Erklärung informiert Sie
                umfassend über die Erhebung, Verarbeitung und den Schutz von Daten bei der Nutzung
                der Korrektur-Plattform prüefli.
              </Typography>
            </Box>

            <Divider sx={{ my: 3 }} />

            <Stack spacing={4}>
              {/* Section 1: Verantwortliche Stelle */}
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
                  <PolicyIcon sx={{ color: '#1b77d1', fontSize: '1.5rem' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    1. Verantwortliche Stelle & Kontakt
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7, mb: 2 }}>
                  Verantwortlich für die Datenverarbeitung auf dieser Plattform ist der jeweilige
                  Plattform-Betreiber bzw. die Schule oder Lehrperson, die das Konto verwaltet.
                </Typography>
                <Box
                  sx={{
                    p: 2.5,
                    backgroundColor: '#f1f5f9',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: '#64748b', display: 'block', mb: 0.5 }}
                  >
                    ANSPRECHPARTNER & KONTAKT
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#0f172a', fontWeight: 600 }}>
                    Mahdi Nasserzadeh
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#475569' }}>
                    support@pruefli.ch
                  </Typography>
                </Box>
              </Box>

              {/* Section 2: Hosting & Infrastruktur */}
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
                  <StorageIcon sx={{ color: '#1b77d1', fontSize: '1.5rem' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    2. Hosting-Provider & Server-Standort
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  prüefli wird über die Cloud-Plattform <strong>Render</strong> (Render Services
                  Inc.) bereitgestellt. Die Anwendung und die relationale PostgreSQL-Datenbank
                  werden in der europäischen Server-Region{' '}
                  <strong>Frankfurt am Main (Deutschland / EU)</strong> betrieben. Sämtliche
                  Datenübertragungen zwischen Ihrem Endgerät und den Servern erfolgen
                  transportverschlüsselt über modernes HTTPS (TLS 1.3) mit erzwungenem HTTP Strict
                  Transport Security (HSTS).
                </Typography>
              </Box>

              {/* Section 3: Cookies & Lokaler Speicher */}
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
                  <CookieIcon sx={{ color: '#1b77d1', fontSize: '1.5rem' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    3. Cookies & Lokaler Speicher (Local Storage)
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7, mb: 2 }}>
                  prüefli setzt <strong>keine</strong> Tracking-, Werbe- oder Analyse-Cookies ein.
                  Es existiert genau ein einziges First-Party-Cookie, welches für den Betrieb der
                  Plattform technisch zwingend erforderlich ist:
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    backgroundColor: '#ffffff',
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    mb: 2,
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    <code>grade_ai_session</code> (Technisch notwendig)
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#475569', mt: 0.5, lineHeight: 1.6 }}>
                    Sichert die authentifizierte Sitzung der Lehrperson mittels kryptografisch
                    signiertem JSON Web Token (JWT). Attribute: <code>Secure</code> (nur
                    verschlüsselt), <code>HttpOnly</code> (kein Zugriff durch clientseitige
                    Skripte), <code>SameSite=lax</code> (Schutz vor Cross-Site-Request-Forgery),
                    Gültigkeitsdauer: 7 Tage.
                  </Typography>
                </Box>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Im <code>localStorage</code> Ihres Browsers werden ausschliesslich
                  nicht-personenbezogene Darstellungs- und Benutzeroberflächen-Präferenzen abgelegt
                  (z. B. die ID der zuletzt ausgewählten Schulklasse oder ausgeblendete
                  UI-Hinweise). Es findet keine browserübergreifende Nachverfolgung oder
                  Profilerstellung statt.
                </Typography>
              </Box>

              {/* Section 4: Keine Drittanbieter-Anfragen im Browser */}
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
                  <SecurityIcon sx={{ color: '#1b77d1', fontSize: '1.5rem' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    4. Keine Drittanbieter-Anfragen (Browser-Privatsphäre)
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Beim Laden von prüefli werden vom Browser des Nutzers{' '}
                  <strong>keine externen Drittanbieter-Ressourcen</strong> nachgeladen. Sämtliche
                  Schriftarten werden direkt über den System-Schriften-Stack Ihres Betriebssystems
                  bezogen (keine IP-Übertragung an Google Fonts oder externe Content Delivery
                  Networks). Es sind keinerlei Web-Analytics (wie Google Analytics), Tag-Manager
                  oder Social-Media-Pixel eingebunden.
                </Typography>
              </Box>

              {/* Section 5: KI-Verarbeitung (Google Gemini API) */}
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
                  <SmartToyIcon sx={{ color: '#1b77d1', fontSize: '1.5rem' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    5. Server-seitige KI-Verarbeitung (Google Gemini API)
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7, mb: 1.5 }}>
                  Zur automatisierten Handschrift- und Textanalyse sowie zur Korrekturunterstützung
                  von Prüfungsaufgaben nutzt prüefli serverseitig die{' '}
                  <strong>Google Gemini API</strong>. Prüfungsmusterlösungen und eingereichte
                  Aufgabenblätter werden verschlüsselt von unserem Server an die API übermittelt, um
                  Teilschrittbewertungen, Fehlerkategorisierungen und didaktisches Feedback zu
                  berechnen.
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    backgroundColor: '#fffbeb',
                    borderRadius: '8px',
                    border: '1px solid #fde68a',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: '#b45309', display: 'block', mb: 0.5 }}
                  >
                    WICHTIGER HINWEIS ZUM ENTWICKLUNGS- & TESTBETRIEB
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#92400e', lineHeight: 1.6 }}>
                    Im aktuellen Free-Tier-Testbetrieb behält sich Google das Recht vor,
                    übermittelte Inhalte zur Modellverbesserung zu verwenden. Daher dürfen im
                    derzeitigen Teststadium{' '}
                    <strong>
                      ausschliesslich synthetische Testdaten, anonymisierte Musterprüfungen und
                      keine echten Schülerdaten
                    </strong>{' '}
                    verarbeitet werden. Vor der Einführung für reale Schülerarbeiten bedarf es einer
                    separaten Vereinbarung bzw. eines Umstiegs auf enterprise-zertifizierte
                    Verarbeitung.
                  </Typography>
                </Box>
              </Box>

              {/* Section 6: Social Sign-in (Google & Microsoft Identity) */}
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ mb: 1.5, alignItems: 'center' }}>
                  <SecurityIcon sx={{ color: '#1b77d1', fontSize: '1.5rem' }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    6. Social Sign-in (Google & Microsoft Identity Platform)
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7, mb: 1.5 }}>
                  Lehrpersonen können sich auf prüefli optional über bestehende institutionelle oder
                  persönliche Konten von <strong>Google</strong> (Google Workspace / Cloud Identity)
                  oder <strong>Microsoft</strong> (Microsoft Entra ID / Microsoft 365) anmelden.
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7, mb: 1.5 }}>
                  Bei der Nutzung des Social Sign-in werden ausschliesslich die zur sicheren
                  Identifikation erforderlichen Daten (eindeutige Benutzer-ID des Providers,
                  E-Mail-Adresse und Anzeigename) über standardisierte, verschlüsselte OAuth 2.0 /
                  OpenID Connect Protokolle ausgetauscht. Die Prüfung erfolgt rein serverseitig: Es
                  werden keinerlei Analyse-, Werbe- oder Tracking-Skripte der Identitätsanbieter in
                  den Browser des Nutzers eingebunden.
                </Typography>
                <Box
                  sx={{
                    p: 2,
                    backgroundColor: '#f8fafc',
                    borderRadius: '8px',
                    border: '1px solid #cbd5e1',
                  }}
                >
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 700, color: '#334155', display: 'block', mb: 0.5 }}
                  >
                    SCHUTZ VOR UNBERECHTIGTER KONTO-VERKNÜPFUNG
                  </Typography>
                  <Typography variant="body2" sx={{ color: '#475569', lineHeight: 1.6 }}>
                    Ein Social-Login verknüpft ein bestehendes prüefli-Konto niemals automatisch
                    allein aufgrund einer übereinstimmenden E-Mail-Adresse oder eines
                    Provider-Claims. Zum Schutz der Schüler- und Prüfungsdaten ist stets ein
                    Nachweis der bestehenden Konto-Inhaberschaft (z. B. durch Passworteingabe oder
                    Bestätigung per E-Mail) zwingend erforderlich.
                  </Typography>
                </Box>
              </Box>

              {/* Section 7: Betroffenenrechte nach Schweizer DSG */}
              <Box>
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#0f172a', mb: 1.5 }}>
                  7. Rechte der betroffenen Personen (Schweizer DSG)
                </Typography>
                <Typography variant="body2" sx={{ color: '#334155', lineHeight: 1.7 }}>
                  Nach dem Schweizer Bundesgesetz über den Datenschutz (DSG) sowie ggf. anwendbaren
                  kantonalen Datenschutzbestimmungen haben Sie das Recht auf unentgeltliche Auskunft
                  über Ihre gespeicherten Personendaten, deren Berichtigung, Sperrung oder
                  vollständige Löschung. Zur Ausübung Ihrer Rechte wenden Sie sich bitte an die oben
                  genannte verantwortliche Stelle.
                </Typography>
              </Box>
            </Stack>

            <Divider sx={{ my: 4 }} />

            {/* Footer */}
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              sx={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Typography variant="caption" sx={{ color: '#94a3b8' }}>
                Stand: Oktober 2026 • prüefli für Schweizer Lehrpersonen
              </Typography>
              <Link href="/" style={{ textDecoration: 'none' }}>
                <Button
                  variant="outlined"
                  size="small"
                  sx={{
                    color: '#1b77d1',
                    borderColor: '#cbd5e1',
                    textTransform: 'none',
                    fontWeight: 600,
                  }}
                >
                  Zurück zur Startseite
                </Button>
              </Link>
            </Stack>
          </CardContent>
        </Card>
      </Container>
    </Box>
  );
}
