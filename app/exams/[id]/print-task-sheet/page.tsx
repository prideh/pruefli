'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Typography,
  Button,
  Stack,
  CircularProgress,
  Alert,
  Paper,
  Divider,
  Switch,
  FormControlLabel,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import LockIcon from '@mui/icons-material/Lock';
import QRCode from 'qrcode';
import 'katex/dist/katex.min.css';
import { buildExamSheetQrPayload, type ExamGeneratorParams } from '@/lib/exam-meta';
import {
  parseInlineTaskSheetTokens,
  parseTaskSheetBlocks,
  stripInlineMarkdown,
  type InlineTaskSheetToken,
} from '@/lib/task-sheet-print';

interface TaskItem {
  id: string;
  taskId?: string;
  title?: string;
  question?: string;
  maxPoints: number;
  sourceReference?: string | null;
}

interface ExamPrintData {
  id: string;
  title: string;
  subject: string;
  className: string;
  maxPoints: number;
  examTemplateText?: string | null;
  isGenerated?: boolean;
  isApproved?: boolean;
  approvedAt?: string | null;
  generatorParams?: ExamGeneratorParams | null;
  tasks: TaskItem[];
}

function renderInlineTokens(tokens: InlineTaskSheetToken[]): React.ReactNode {
  return tokens.map((token, idx) => {
    if (token.type === 'bold') {
      return (
        <Box key={idx} component="strong" sx={{ fontWeight: 700, color: '#0f172a' }}>
          {token.tokens ? renderInlineTokens(token.tokens) : token.content}
        </Box>
      );
    }
    if (token.type === 'italic') {
      return (
        <Box key={idx} component="em" sx={{ fontStyle: 'italic' }}>
          {token.tokens ? renderInlineTokens(token.tokens) : token.content}
        </Box>
      );
    }
    if (token.type === 'code') {
      return (
        <Box
          key={idx}
          component="code"
          sx={{
            fontFamily: 'monospace',
            backgroundColor: '#f1f5f9',
            px: 0.5,
            py: 0.15,
            borderRadius: '3px',
            fontSize: '0.92em',
          }}
        >
          {token.content}
        </Box>
      );
    }
    if (token.type === 'math') {
      if (token.isFallback) {
        return (
          <Box
            key={idx}
            component="code"
            data-testid="task-sheet-math-fallback"
            sx={{
              fontFamily: 'monospace',
              backgroundColor: '#f1f5f9',
              border: '1px dashed #64748b',
              px: 0.6,
              py: 0.15,
              mx: 0.25,
              borderRadius: '3px',
              fontSize: '0.9em',
            }}
          >
            {token.latex}
          </Box>
        );
      }
      return (
        <Box
          key={idx}
          component="span"
          data-testid="task-sheet-inline-math"
          sx={{
            display: 'inline-block',
            verticalAlign: 'middle',
            mx: 0.15,
          }}
          dangerouslySetInnerHTML={{ __html: token.html }}
        />
      );
    }
    return <React.Fragment key={idx}>{token.content}</React.Fragment>;
  });
}

export default function ExamPrintTaskSheetPage() {
  const params = useParams();
  const examId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exam, setExam] = useState<ExamPrintData | null>(null);
  const [showQrSheet, setShowQrSheet] = useState<boolean>(false);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');

  useEffect(() => {
    if (!examId) return;

    async function loadExam() {
      try {
        const res = await fetch(`/api/exams/${examId}`);
        if (!res.ok) {
          throw new Error('Prüfungsdetails konnten nicht geladen werden.');
        }
        const data = await res.json();
        setExam(data.exam ?? data);
        setShowQrSheet(Boolean(data.exam?.generatorParams?.enableQrSheet));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden.');
      } finally {
        setLoading(false);
      }
    }

    loadExam();
  }, [examId]);

  useEffect(() => {
    if (!exam || !showQrSheet) {
      return;
    }
    let cancelled = false;
    const payload = buildExamSheetQrPayload({
      examId: exam.id,
      title: exam.title,
      className: exam.className,
      subject: exam.subject,
    });
    QRCode.toDataURL(payload, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 112,
      color: {
        dark: '#0f172a',
        light: '#ffffff',
      },
    })
      .then((url) => {
        if (!cancelled) setQrDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) setQrDataUrl('');
      });

    return () => {
      cancelled = true;
    };
  }, [exam, showQrSheet]);

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
        <CircularProgress size={40} />
      </Box>
    );
  }

  if (error || !exam) {
    return (
      <Box sx={{ p: 4, maxWidth: '600px', mx: 'auto' }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error || 'Prüfung nicht gefunden.'}
        </Alert>
        <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
          <Button startIcon={<ArrowBackIcon />}>Zurück zur Prüfung</Button>
        </Link>
      </Box>
    );
  }

  // Pre-approval gate: Pre-approval drafts are NOT printable
  const isApproved = exam.isApproved !== false;
  if (!isApproved) {
    return (
      <Box sx={{ p: 4, maxWidth: '650px', mx: 'auto', mt: 4 }}>
        <Alert
          severity="warning"
          icon={<LockIcon />}
          sx={{ mb: 3, borderRadius: '8px', fontSize: '0.95rem' }}
        >
          <Typography variant="subtitle1" sx={{ fontWeight: 800, mb: 0.5 }}>
            Drucken nicht möglich: Prüfung noch nicht freigegeben
          </Typography>
          Diese Prüfung ist ein noch ungeprüfter Entwurf aus Unterrichtsmaterial. Gemäss den
          Qualitätsrichtlinien von prüefli muss die Prüfung von der Lehrperson im Editor geprüft und
          ausdrücklich freigegeben werden, bevor ein Aufgabenblatt gedruckt oder exportiert werden
          kann.
        </Alert>
        <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
          <Button variant="contained" startIcon={<ArrowBackIcon />} sx={{ borderRadius: '8px' }}>
            Zurück zum Editor &amp; Freigabe erteilen
          </Button>
        </Link>
      </Box>
    );
  }

  // Parse structured blocks from template text (strips duplicate header & formats Markdown/LaTeX)
  const templateText = exam.examTemplateText || '';
  const templateBlocks = parseTaskSheetBlocks(templateText, { examTitle: exam.title });
  const totalMaxPoints =
    Number(exam.maxPoints) ||
    (Array.isArray(exam.tasks)
      ? exam.tasks.reduce((sum, t) => sum + (Number(t.maxPoints) || 0), 0)
      : 0);

  return (
    <Box sx={{ backgroundColor: '#ffffff', minHeight: '100vh', p: { xs: 2, sm: 4 } }}>
      {/* Non-printable Control Header */}
      <Box
        className="no-print"
        sx={{
          maxWidth: '850px',
          mx: 'auto',
          mb: 4,
          p: 2,
          backgroundColor: '#f8fafc',
          border: '1px solid #e2e8f0',
          borderRadius: '8px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 2,
        }}
      >
        <Link href={`/exams/${examId}`} passHref style={{ textDecoration: 'none' }}>
          <Button
            startIcon={<ArrowBackIcon />}
            sx={{ textTransform: 'none', fontWeight: 650, color: 'text.secondary' }}
          >
            Zurück zur Prüfung
          </Button>
        </Link>
        <Stack direction="row" spacing={2} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={showQrSheet}
                onChange={(e) => setShowQrSheet(e.target.checked)}
                color="primary"
              />
            }
            label={
              <Typography variant="body2" sx={{ fontWeight: 600, color: '#0f172a' }}>
                QR-Code auf Aufgabenblatt
              </Typography>
            }
            sx={{ m: 0 }}
          />
          <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
            Druckansicht (Aufgabenblatt)
          </Typography>
          <Button
            variant="contained"
            startIcon={<PrintIcon />}
            onClick={() => window.print()}
            sx={{
              backgroundColor: '#0f172a',
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '6px',
              '&:hover': { backgroundColor: '#1e293b' },
            }}
          >
            Drucken / Als PDF speichern
          </Button>
        </Stack>
      </Box>

      {/* Printable Sheet */}
      <Paper
        elevation={0}
        sx={{
          maxWidth: '850px',
          mx: 'auto',
          p: { xs: 2, sm: 5 },
          border: '1px solid #e2e8f0',
          borderRadius: '4px',
          '@media print': {
            border: 'none',
            p: 0,
            maxWidth: '100%',
          },
        }}
      >
        {/* Swiss School Exam Header */}
        <Box sx={{ borderBottom: '2px solid #0f172a', pb: 2.5, mb: 3 }}>
          <Stack
            direction="row"
            sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2, gap: 2 }}
          >
            <Box>
              <Typography
                variant="overline"
                sx={{ letterSpacing: '0.1em', color: 'text.secondary', fontWeight: 700 }}
              >
                {exam.subject} • {exam.className}
              </Typography>
              <Typography
                variant="h4"
                sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}
              >
                {exam.title}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'stretch' }}>
              {showQrSheet && qrDataUrl && (
                <Box
                  data-testid="smart-exam-qr-badge"
                  sx={{
                    border: '1px solid #0f172a',
                    borderRadius: '4px',
                    p: 0.75,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    backgroundColor: '#ffffff',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="Prüfungs-QR-Code"
                    width={76}
                    height={76}
                    style={{ display: 'block' }}
                  />
                  <Typography
                    variant="caption"
                    sx={{ fontSize: '0.62rem', fontWeight: 700, color: '#334155', mt: 0.25 }}
                  >
                    Auto-Zuordnung
                  </Typography>
                </Box>
              )}
              <Box
                sx={{
                  textAlign: 'right',
                  border: '1px solid #cbd5e1',
                  p: 1.5,
                  borderRadius: '4px',
                  minWidth: '145px',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                }}
              >
                <Typography
                  variant="caption"
                  sx={{
                    color: 'text.secondary',
                    display: 'block',
                    fontWeight: 600,
                    whiteSpace: 'nowrap',
                  }}
                >
                  Max. Punkte: {totalMaxPoints} P.
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.5, whiteSpace: 'nowrap' }}>
                  Punkte: ______
                </Typography>
                <Typography variant="body2" sx={{ fontWeight: 700, mt: 0.5, whiteSpace: 'nowrap' }}>
                  Note: ________
                </Typography>
              </Box>
            </Stack>
          </Stack>

          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' },
              gap: 3,
              mt: 2.5,
            }}
          >
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}
            >
              Name / Vorname: ______________________________________
            </Typography>
            <Typography
              variant="body2"
              sx={{ fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden' }}
            >
              Datum: ______________________
            </Typography>
          </Box>
        </Box>

        {/* Exam Template Body / Tasks */}
        {templateBlocks.length > 0 ? (
          <Box
            data-testid="formatted-task-sheet-body"
            sx={{
              fontFamily: 'inherit',
              lineHeight: 1.7,
              fontSize: '0.98rem',
              color: '#0f172a',
            }}
          >
            {templateBlocks.map((block, index) => {
              if (block.type === 'heading') {
                if (block.variant === 'task') {
                  return (
                    <Box
                      key={index}
                      sx={{
                        mt: index === 0 ? 0.5 : 2.25,
                        mb: 1,
                        pb: 0.5,
                        borderBottom: '1px solid #cbd5e1',
                        pageBreakAfter: 'avoid',
                      }}
                    >
                      <Typography
                        component="h3"
                        variant="h6"
                        sx={{
                          fontWeight: 800,
                          fontSize: '1.05rem',
                          color: '#0f172a',
                          letterSpacing: '-0.01em',
                        }}
                      >
                        {renderInlineTokens(block.tokens)}
                      </Typography>
                    </Box>
                  );
                }

                return (
                  <Typography
                    key={index}
                    component="h3"
                    variant="subtitle1"
                    sx={{
                      fontWeight: 800,
                      fontSize: '1rem',
                      color: '#0f172a',
                      mt: index === 0 ? 0.5 : 1.75,
                      mb: 0.75,
                      pageBreakAfter: 'avoid',
                    }}
                  >
                    {renderInlineTokens(block.tokens)}
                  </Typography>
                );
              }

              if (block.type === 'divider') {
                return <Divider key={index} sx={{ my: 1.5, borderColor: '#cbd5e1' }} />;
              }

              if (block.type === 'math') {
                if (block.isFallback) {
                  return (
                    <Box
                      key={index}
                      component="code"
                      data-testid="task-sheet-math-fallback"
                      sx={{
                        display: 'block',
                        my: 1.5,
                        py: 1,
                        px: 1.5,
                        backgroundColor: '#f8fafc',
                        border: '1px dashed #64748b',
                        borderRadius: '6px',
                        fontFamily: 'monospace',
                        fontSize: '0.95rem',
                        color: '#0f172a',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {block.latex}
                    </Box>
                  );
                }
                return (
                  <Box
                    key={index}
                    data-testid="task-sheet-math-block"
                    sx={{
                      my: 1.5,
                      py: 1.25,
                      px: 2,
                      backgroundColor: '#f8fafc',
                      border: '1px solid #cbd5e1',
                      borderRadius: '6px',
                      fontSize: '1.08rem',
                      color: '#0f172a',
                      pageBreakInside: 'avoid',
                      overflowX: 'auto',
                      '& .katex-display': {
                        margin: 0,
                        textAlign: 'left',
                      },
                    }}
                    dangerouslySetInnerHTML={{ __html: block.html }}
                  />
                );
              }

              if (block.type === 'list') {
                return (
                  <Stack
                    key={index}
                    component={block.ordered ? 'ol' : 'ul'}
                    spacing={0.75}
                    sx={{ my: 1, pl: 0, listStyle: 'none' }}
                  >
                    {block.items.map((item, itemIdx) => (
                      <Box
                        key={itemIdx}
                        component="li"
                        sx={{
                          display: 'flex',
                          alignItems: 'baseline',
                          gap: 1.25,
                          lineHeight: 1.65,
                        }}
                      >
                        <Typography
                          component="span"
                          sx={{
                            fontWeight: 700,
                            minWidth: block.ordered ? '1.6rem' : '0.9rem',
                            color: '#0f172a',
                            flexShrink: 0,
                          }}
                        >
                          {item.marker || '•'}
                        </Typography>
                        <Typography
                          component="span"
                          sx={{
                            fontSize: '0.98rem',
                            color: '#0f172a',
                            overflowWrap: 'anywhere',
                          }}
                        >
                          {renderInlineTokens(item.tokens)}
                        </Typography>
                      </Box>
                    ))}
                  </Stack>
                );
              }

              if (block.type === 'answer-lines') {
                return (
                  <Box key={index} sx={{ my: 1.5 }}>
                    {Array.from({ length: block.count }).map((_, lineIdx) => (
                      <Box
                        key={lineIdx}
                        sx={{
                          pt: 1.5,
                          borderBottom: '1px dashed #64748b',
                          minHeight: '28px',
                        }}
                        aria-label="Antwortlinie"
                      />
                    ))}
                  </Box>
                );
              }

              return (
                <Typography
                  key={index}
                  variant="body1"
                  sx={{
                    my: 1,
                    lineHeight: 1.7,
                    fontSize: '0.98rem',
                    color: '#0f172a',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {renderInlineTokens(block.tokens)}
                </Typography>
              );
            })}
          </Box>
        ) : (
          <Stack spacing={3.5}>
            {exam.tasks.map((task, index) => (
              <Box
                key={task.id || task.taskId || index}
                sx={{
                  pageBreakInside: 'avoid',
                  border: '1px solid #e2e8f0',
                  borderRadius: '6px',
                  p: 2.5,
                }}
              >
                <Stack
                  direction="row"
                  sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 1.5 }}
                >
                  <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {task.question
                      ? renderInlineTokens(parseInlineTaskSheetTokens(task.question))
                      : stripInlineMarkdown(task.title || '') || `Aufgabe ${index + 1}`}
                  </Typography>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                    [{task.maxPoints} {task.maxPoints === 1 ? 'Punkt' : 'Punkte'}]
                  </Typography>
                </Stack>
                {/* Handwriting work space */}
                <Box
                  sx={{
                    minHeight: '130px',
                    mt: 2,
                    border: '1px dashed #cbd5e1',
                    borderRadius: '4px',
                    backgroundColor: '#fafafa',
                  }}
                />
              </Box>
            ))}
          </Stack>
        )}

        <Divider sx={{ my: 2 }} />

        {/* Footer */}
        <Stack
          direction="row"
          sx={{ justifyContent: 'space-between', alignItems: 'center', color: 'text.secondary' }}
        >
          <Typography variant="caption" sx={{ fontWeight: 500 }}>
            Erstellt mit prüefli • Lehrperson geprüft und freigegeben
          </Typography>
          <Typography variant="caption" sx={{ fontWeight: 600 }}>
            Viel Erfolg!
          </Typography>
        </Stack>
      </Paper>

      {/* Global Print Styles */}
      <style jsx global>{`
        @media print {
          body {
            background-color: #ffffff !important;
            color: #000000 !important;
          }
          .no-print {
            display: none !important;
          }
          @page {
            margin: 1.5cm;
            size: A4 portrait;
          }
        }
      `}</style>
    </Box>
  );
}
