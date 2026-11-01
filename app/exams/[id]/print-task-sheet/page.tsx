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
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import LockIcon from '@mui/icons-material/Lock';

interface TaskItem {
  id: string;
  taskId: string;
  title: string;
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
  tasks: TaskItem[];
}

export default function ExamPrintTaskSheetPage() {
  const params = useParams();
  const examId = params.id as string;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [exam, setExam] = useState<ExamPrintData | null>(null);

  useEffect(() => {
    if (!examId) return;

    async function loadExam() {
      try {
        const res = await fetch(`/api/exams/${examId}`);
        if (!res.ok) {
          throw new Error('Prüfungsdetails konnten nicht geladen werden.');
        }
        const data = await res.json();
        setExam(data.exam);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Fehler beim Laden.');
      } finally {
        setLoading(false);
      }
    }

    loadExam();
  }, [examId]);

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
            Zurück zum Editor & Freigabe erteilen
          </Button>
        </Link>
      </Box>
    );
  }

  // Split tasks from template text if formatted
  const templateText = exam.examTemplateText || '';

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
        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
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
            sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2 }}
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
            <Box
              sx={{
                textAlign: 'right',
                border: '1px solid #0f172a',
                p: 1.5,
                borderRadius: '4px',
                minWidth: '130px',
              }}
            >
              <Typography
                variant="caption"
                sx={{ display: 'block', fontWeight: 700, color: 'text.secondary' }}
              >
                Max. Punkte: {exam.maxPoints} P.
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 0.5 }}>
                Punkte: ______
              </Typography>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mt: 0.5 }}>
                Note: ________
              </Typography>
            </Box>
          </Stack>

          {/* Student metadata fields */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: '2fr 1fr' },
              gap: 2,
              mt: 2,
            }}
          >
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Name / Vorname: __________________________________________________
            </Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Datum: ________________________
            </Typography>
          </Box>
        </Box>

        {/* Exam Template Body / Tasks */}
        {templateText ? (
          <Box
            sx={{
              fontFamily: 'inherit',
              whiteSpace: 'pre-wrap',
              lineHeight: 1.7,
              fontSize: '0.98rem',
              color: '#0f172a',
              '& h1, & h2, & h3, & h4': {
                fontWeight: 800,
                color: '#0f172a',
                mt: 3,
                mb: 1.5,
                pageBreakAfter: 'avoid',
              },
            }}
          >
            {templateText}
          </Box>
        ) : (
          <Stack spacing={3.5}>
            {exam.tasks.map((task, index) => (
              <Box
                key={task.id || task.taskId}
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
                    {task.title || `Aufgabe ${index + 1}`}
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

        <Divider sx={{ my: 4 }} />

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
