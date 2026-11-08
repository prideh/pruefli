'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Box, Typography, Button, Stack, CircularProgress, Alert } from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import { filterFeedbackSheetsForPrint } from '@/lib/ux-polish';

interface SheetTask {
  aufgabeId: string;
  titel: string;
  schuelerAntwort: string;
  erzieltePunkte: number;
  maximalPunkte: number;
  status: string;
  lehrerKommentar: string;
}

interface FeedbackSheet {
  submissionId: string;
  examId: string;
  examTitle: string;
  fach: string;
  className: string;
  schuelerName: string;
  datum: string;
  gesamterzieltePunkte: number;
  gesamtmaximalPunkte: number;
  note: string;
  aufgaben: SheetTask[];
  schuelerFeedback: {
    staerken: string[];
    schwaechen: string[];
    hilfreicherTipp: string;
    uebungsEmpfehlung: string;
  };
}

export interface ExamPrintFeedbackContentProps {
  initialData?: {
    examTitle?: string;
    sheets?: FeedbackSheet[];
    totalCount?: number;
    completedCount?: number;
    ungradedCount?: number;
  };
  [key: string]: unknown;
}

function ExamPrintFeedbackContent({ initialData }: ExamPrintFeedbackContentProps) {
  const params = useParams();
  const searchParams = useSearchParams();
  const examId = params.id as string;
  const rawSubId = searchParams?.get('submissionId') ?? null;
  const targetSubmissionId = rawSubId && rawSubId.trim() ? rawSubId.trim() : null;

  const [loading, setLoading] = useState(!initialData);
  const [error, setError] = useState('');
  const [sheets, setSheets] = useState<FeedbackSheet[]>(initialData?.sheets || []);
  const [examTitle, setExamTitle] = useState(initialData?.examTitle || '');
  const [totalCount, setTotalCount] = useState(initialData?.totalCount || 0);
  const [completedCount, setCompletedCount] = useState(initialData?.completedCount || 0);
  const [ungradedCount, setUngradedCount] = useState(initialData?.ungradedCount || 0);

  useEffect(() => {
    if (!examId || initialData) return;

    async function loadSheets() {
      try {
        const res = await fetch(`/api/exams/${examId}/feedback-sheets`);
        if (!res.ok) {
          throw new Error('Feedback-Berichte konnten nicht geladen werden.');
        }
        const data = await res.json();
        setSheets(data.sheets || []);
        setExamTitle(data.examTitle || 'Prüfung');
        setTotalCount(data.totalCount || 0);
        setCompletedCount(data.completedCount || 0);
        setUngradedCount(data.ungradedCount || 0);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden.');
      } finally {
        setLoading(false);
      }
    }

    loadSheets();
  }, [examId, initialData]);

  const visibleSheets = React.useMemo(
    () => filterFeedbackSheetsForPrint(sheets, targetSubmissionId),
    [sheets, targetSubmissionId]
  );

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 4, maxWidth: '600px', mx: 'auto' }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
          <Button startIcon={<ArrowBackIcon />}>Zurück zur Prüfung</Button>
        </Link>
      </Box>
    );
  }

  return (
    <Box sx={{ backgroundColor: '#ffffff', minHeight: '100vh' }}>
      {/* Top action bar: hidden during print */}
      <Box
        className="no-print"
        sx={{
          p: 2.5,
          borderBottom: '1px solid #e2e8f0',
          backgroundColor: '#f8fafc',
          position: 'sticky',
          top: 0,
          zIndex: 100,
        }}
      >
        <Stack
          direction="row"
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 2 }}
        >
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            {targetSubmissionId && (
              <Link
                href={`/correct/${targetSubmissionId}`}
                passHref
                style={{ textDecoration: 'none' }}
              >
                <Button
                  variant="outlined"
                  startIcon={<ArrowBackIcon />}
                  sx={{ textTransform: 'none', fontWeight: 650, borderRadius: '8px' }}
                >
                  Zurück zur Korrektur
                </Button>
              </Link>
            )}
            <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
              <Button
                variant="outlined"
                startIcon={<ArrowBackIcon />}
                sx={{ textTransform: 'none', fontWeight: 650, borderRadius: '8px' }}
              >
                Zurück zur Prüfung
              </Button>
            </Link>
            <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a' }}>
              Feedback-Blätter: {examTitle}
            </Typography>
          </Stack>

          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            {ungradedCount > 0 && (
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                {ungradedCount} von {totalCount} noch nicht bewertet – nicht enthalten (
                {ungradedCount} of {totalCount} not yet graded - not included)
              </Typography>
            )}
            <Button
              variant="contained"
              startIcon={<PrintIcon />}
              onClick={() => window.print()}
              disabled={completedCount === 0 || visibleSheets.length === 0}
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: '#1b77d1',
              }}
            >
              Jetzt drucken ({visibleSheets.length} Schüler/innen)
            </Button>
          </Stack>
        </Stack>
      </Box>

      {/* Empty State */}
      {completedCount === 0 ? (
        <Box sx={{ p: 6, textAlign: 'center' }}>
          <Typography variant="h6" sx={{ color: '#475569', fontWeight: 700, mb: 1 }}>
            Keine bewerteten Arbeiten vorhanden
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            Für diese Prüfung wurden noch keine Arbeiten abgeschlossen korrigiert. Mindestens eine
            bewertete Arbeit ist erforderlich, um Feedback-Blätter zu drucken.
          </Typography>
          <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
            <Button variant="outlined" startIcon={<ArrowBackIcon />}>
              Zurück zur Prüfung
            </Button>
          </Link>
        </Box>
      ) : targetSubmissionId && visibleSheets.length === 0 ? (
        <Box
          sx={{ p: 6, textAlign: 'center', maxWidth: '640px', mx: 'auto' }}
          data-testid="print-target-not-found"
        >
          <Alert severity="warning" sx={{ mb: 3, textAlign: 'left' }}>
            Der angeforderte Feedback-Bericht (Korrektur-ID: {targetSubmissionId}) wurde unter den
            abgeschlossenen Arbeiten dieser Prüfung nicht gefunden. Aus Datenschutzgründen werden
            keine fremden Schülerberichte angezeigt.
          </Alert>
          <Typography variant="h6" sx={{ color: '#475569', fontWeight: 700, mb: 1 }}>
            Gewünschter Feedback-Bericht nicht gefunden
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            Stelle sicher, dass die Korrektur für diese Schülerin bzw. diesen Schüler vollständig
            abgeschlossen ist, oder kehre zur Korrekturansicht zurück.
          </Typography>
          <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link
              href={`/correct/${targetSubmissionId}`}
              passHref
              style={{ textDecoration: 'none' }}
            >
              <Button variant="outlined" startIcon={<ArrowBackIcon />}>
                Zurück zur Korrektur
              </Button>
            </Link>
            <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
              <Button variant="outlined" startIcon={<ArrowBackIcon />}>
                Zurück zur Prüfung
              </Button>
            </Link>
          </Stack>
        </Box>
      ) : (
        /* Sequential Feedback Sheets (one page per student) */
        <Box sx={{ fontFamily: 'sans-serif' }}>
          {visibleSheets.map((sheet) => (
            <div
              key={sheet.submissionId}
              className="print-page"
              style={{
                fontFamily: 'sans-serif',
                pageBreakAfter: 'always',
                padding: '20mm',
                maxWidth: '210mm',
                margin: '0 auto',
                backgroundColor: '#ffffff',
              }}
            >
              {/* Header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  borderBottom: '2px solid #0f172a',
                  paddingBottom: '16px',
                  marginBottom: '20px',
                }}
              >
                <div>
                  <h1 style={{ fontSize: '20pt', margin: 0, fontWeight: 'bold', color: '#0f172a' }}>
                    prüefli - Schüler-Feedbackbericht
                  </h1>
                  <p
                    style={{
                      fontSize: '11pt',
                      color: '#475569',
                      fontWeight: 'bold',
                      margin: '6px 0 0 0',
                    }}
                  >
                    Prüfung: {sheet.examTitle} | Fach: {sheet.fach} | Klasse:{' '}
                    {sheet.className || '—'}
                  </p>
                </div>
                <div style={{ textAlign: 'right', fontSize: '10pt', color: '#334155' }}>
                  <strong>Schüler: {sheet.schuelerName}</strong>
                  <br />
                  Datum: {sheet.datum}
                  <br />
                  Ergebnis:{' '}
                  <strong style={{ color: '#0f172a' }}>
                    {sheet.gesamterzieltePunkte.toFixed(1)} / {sheet.gesamtmaximalPunkte} Punkte
                  </strong>{' '}
                  (Note: <strong>{sheet.note}</strong>)
                </div>
              </div>

              {/* Notenspiegel & Bepunktung */}
              <h3
                style={{
                  fontSize: '13pt',
                  borderBottom: '1px solid #cbd5e1',
                  paddingBottom: '4px',
                  marginTop: '24px',
                  color: '#0f172a',
                }}
              >
                Notenspiegel & Bepunktung
              </h3>
              <table
                style={{
                  width: '100%',
                  borderCollapse: 'collapse',
                  marginTop: '10px',
                  fontSize: '10pt',
                }}
              >
                <thead>
                  <tr style={{ backgroundColor: '#f8fafc', borderBottom: '1.5px solid #cbd5e1' }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Aufgabe</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' }}>Erreichte Punkte</th>
                    <th style={{ padding: '8px 12px', textAlign: 'center' }}>Maximalpunkte</th>
                    <th style={{ padding: '8px 12px', textAlign: 'left' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {sheet.aufgaben.map((t) => (
                    <tr key={t.aufgabeId} style={{ borderBottom: '1px solid #e2e8f0' }}>
                      <td style={{ padding: '8px 12px' }}>{t.titel}</td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        <strong>{t.erzieltePunkte.toFixed(1)}</strong>
                      </td>
                      <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                        {t.maximalPunkte}
                      </td>
                      <td style={{ padding: '8px 12px' }}>
                        <span
                          style={{
                            color:
                              t.status === 'Korrekt'
                                ? 'green'
                                : t.status === 'Folgefehler'
                                  ? 'orange'
                                  : 'red',
                            fontWeight: 'bold',
                          }}
                        >
                          {t.status === 'Folgefehler' ? 'Folgefehler berücksichtigt' : t.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                  <tr
                    style={{
                      backgroundColor: '#f1f5f9',
                      fontWeight: 'bold',
                      borderTop: '1.5px solid #cbd5e1',
                    }}
                  >
                    <td style={{ padding: '10px 12px' }}>GESAMT</td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {sheet.gesamterzieltePunkte.toFixed(1)}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      {sheet.gesamtmaximalPunkte}
                    </td>
                    <td style={{ padding: '10px 12px' }}>Note: {sheet.note}</td>
                  </tr>
                </tbody>
              </table>

              {/* Detailliertes Gutachten */}
              <h3
                style={{
                  fontSize: '13pt',
                  borderBottom: '1px solid #cbd5e1',
                  paddingBottom: '4px',
                  marginTop: '30px',
                  color: '#0f172a',
                }}
              >
                Detailliertes Gutachten & Hinweise der Lehrkraft
              </h3>
              {sheet.aufgaben.map((t) => (
                <div key={t.aufgabeId} style={{ marginTop: '16px', pageBreakInside: 'avoid' }}>
                  <h4 style={{ fontSize: '11pt', color: '#0f172a', margin: '0 0 4px 0' }}>
                    {t.titel}
                  </h4>
                  <p
                    style={{
                      fontStyle: 'italic',
                      color: '#475569',
                      fontSize: '9.5pt',
                      margin: '4px 0 8px 0',
                    }}
                  >
                    Schülerlösung: {t.schuelerAntwort}
                  </p>
                  <p style={{ fontSize: '10pt', color: '#0f172a', lineHeight: 1.4, margin: 0 }}>
                    <strong>Korrekturkommentar: </strong>
                    {t.lehrerKommentar}
                  </p>
                </div>
              ))}

              {/* Individueller Lern- und Übungsplan */}
              <div
                style={{
                  marginTop: '32px',
                  border: '1.5px solid #cbd5e1',
                  borderRadius: '8px',
                  padding: '16px',
                  pageBreakInside: 'avoid',
                  backgroundColor: '#f8fafc',
                }}
              >
                <h3
                  style={{
                    fontSize: '12pt',
                    margin: '0 0 12px 0',
                    color: '#0f172a',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                  }}
                >
                  🎯 Individueller Lern- und Übungsplan
                </h3>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                  <div>
                    <strong style={{ color: '#0f172a', fontSize: '9.5pt' }}>Deine Stärken:</strong>
                    <ul
                      style={{
                        margin: '6px 0 0 16px',
                        padding: 0,
                        fontSize: '9.5pt',
                        color: '#334155',
                      }}
                    >
                      {sheet.schuelerFeedback.staerken.map((s, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <strong style={{ color: '#0f172a', fontSize: '9.5pt' }}>
                      Daran arbeiten wir noch:
                    </strong>
                    <ul
                      style={{
                        margin: '6px 0 0 16px',
                        padding: 0,
                        fontSize: '9.5pt',
                        color: '#334155',
                      }}
                    >
                      {sheet.schuelerFeedback.schwaechen.map((s, i) => (
                        <li key={i} style={{ marginBottom: '4px' }}>
                          {s}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>

                <div
                  style={{ marginTop: '16px', borderTop: '1px solid #cbd5e1', paddingTop: '12px' }}
                >
                  <p
                    style={{
                      fontSize: '10pt',
                      lineHeight: 1.4,
                      margin: '0 0 8px 0',
                      color: '#0f172a',
                    }}
                  >
                    💡 <strong>Lern-Tipp: </strong> {sheet.schuelerFeedback.hilfreicherTipp}
                  </p>
                  <p style={{ fontSize: '10pt', lineHeight: 1.4, margin: 0, color: '#0f172a' }}>
                    📚 <strong>Deine Übungs-Empfehlung: </strong>{' '}
                    {sheet.schuelerFeedback.uebungsEmpfehlung}
                  </p>
                </div>
              </div>

              {/* Footer */}
              <div
                style={{
                  marginTop: '40px',
                  textAlign: 'center',
                  fontSize: '9pt',
                  color: '#64748b',
                  borderTop: '1px solid #cbd5e1',
                  paddingTop: '10px',
                }}
              >
                Viel Erfolg beim Lernen! Mit fleissigem Üben klappt es beim nächsten Mal noch
                besser.
              </div>
            </div>
          ))}
        </Box>
      )}
    </Box>
  );
}

export default function ExamPrintFeedbackPage({ initialData }: ExamPrintFeedbackContentProps) {
  return (
    <React.Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
          <CircularProgress size={40} />
        </Box>
      }
    >
      <ExamPrintFeedbackContent initialData={initialData} />
    </React.Suspense>
  );
}
