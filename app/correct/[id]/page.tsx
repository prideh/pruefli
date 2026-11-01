'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Stack,
  TextField,
  Divider,
  Chip,
  Snackbar,
  Alert,
  Tabs,
  Tab,
  useTheme,
  CircularProgress,
  IconButton,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import PrintIcon from '@mui/icons-material/Print';
import SaveIcon from '@mui/icons-material/Save';
import ErrorIcon from '@mui/icons-material/Error';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import { getErrorMessage } from '@/lib/api-error';
import AddIcon from '@mui/icons-material/Add';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import QrScannerDialog from '@/components/QrScannerDialog';
import { invalidateSubmissions } from '@/lib/dataCache';

import { ExamCorrectionResult, CorrectedTask, CorrectedStep } from '../../../lib/gemini';
import { calculateSwissGrade, parseStudentExamUrls } from '../../../lib/grading';

interface SiblingSubmissionItem {
  id: string;
  studentName: string;
  status: string;
  grade: string | null;
  earnedPoints: number;
  uncertainStepsCount: number;
}

interface WorkspaceSubmission extends ExamCorrectionResult {
  examId?: string;
  examTitle?: string;
  siblingSubmissions?: SiblingSubmissionItem[];
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  errorMessage?: string | null;
  studentId?: string | null;
  classId?: string | null;
  isReused?: boolean;
}

export default function CorrectWorkspace() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id;
  const theme = useTheme();

  const [data, setData] = useState<WorkspaceSubmission | null>(null);
  const [activeTaskIndex, setActiveTaskIndex] = useState<number>(0);
  const [showSaveToast, setShowSaveToast] = useState<boolean>(false);
  const [noSession, setNoSession] = useState<boolean>(false);
  const [leftPanelTab, setLeftPanelTab] = useState<'transcript' | 'scan'>('scan');
  const [activeScanPageIndex, setActiveScanPageIndex] = useState<number>(0);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
  const [qrOpen, setQrOpen] = useState<boolean>(false);

  const [openAddTask, setOpenAddTask] = useState<boolean>(false);
  const [addTaskTaskId, setAddTaskTaskId] = useState<string>('');
  const [addTaskTitle, setAddTaskTitle] = useState<string>('');
  const [addTaskMaxPoints, setAddTaskMaxPoints] = useState<number>(5);
  const [addTaskLoading, setAddTaskLoading] = useState<boolean>(false);
  const [addTaskError, setAddTaskError] = useState<string>('');
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryError, setRetryError] = useState<string>('');

  const handleRetry = async () => {
    const submissionId = Array.isArray(id) ? id[0] : id;
    if (!submissionId) return;
    setIsRetrying(true);
    setRetryError('');
    try {
      const res = await fetch(`/api/submissions/${submissionId}/replace`, {
        method: 'POST',
      });
      if (res.ok) {
        setData((prev) =>
          prev ? { ...prev, status: 'PROCESSING' as const, errorMessage: null } : prev
        );
      } else {
        const errJson = await res.json().catch(() => ({}));
        setRetryError(errJson.error || 'Fehler beim Neustart der Korrektur.');
      }
    } catch (e) {
      console.error('Failed to retry submission:', e);
      setRetryError('Netzwerkverbindung unterbrochen. Bitte versuche es erneut.');
    } finally {
      setIsRetrying(false);
    }
  };

  // Load submission data from PostgreSQL database
  const loadSubmission = React.useCallback(async () => {
    if (!id) return;
    try {
      const res = await fetch(`/api/submissions/${id}`);
      if (!res.ok) {
        setNoSession(true);
        return;
      }
      const parsed = await res.json();
      setData(parsed);
      setLeftPanelTab(parsed.studentExamUrl ? 'scan' : 'transcript');
    } catch (e) {
      console.error('Failed to load submission from database', e);
      setNoSession(true);
    }
  }, [id]);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addTaskTaskId.trim() || !addTaskTitle.trim() || addTaskMaxPoints === undefined) {
      setAddTaskError('Bitte fülle alle Felder aus.');
      return;
    }

    setAddTaskLoading(true);
    setAddTaskError('');

    try {
      const res = await fetch(`/api/submissions/${id}/add-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: addTaskTaskId.trim(),
          title: addTaskTitle.trim(),
          maxPoints: Number(addTaskMaxPoints),
        }),
      });

      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Aufgabe konnte nicht hinzugefügt werden.');
        setAddTaskError(errorMsg);
        return;
      }

      setOpenAddTask(false);
      setAddTaskTaskId('');
      setAddTaskTitle('');
      setAddTaskMaxPoints(5);

      invalidateSubmissions(id as string, data?.examId, data?.classId, data?.studentId);
      // Refresh state without hard page reload
      await loadSubmission();
    } catch (err) {
      setAddTaskError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen der Aufgabe.');
    } finally {
      setAddTaskLoading(false);
    }
  };

  // Debounced auto-save function to prevent network storms
  const saveTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  const saveToDatabase = (updatedData: WorkspaceSubmission, immediate = false) => {
    setSaveStatus('saving');
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    const executeSave = async () => {
      try {
        const res = await fetch(`/api/submissions/${id}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            aufgaben: updatedData.aufgaben,
            schuelerFeedback: updatedData.schuelerFeedback,
          }),
        });
        if (res.ok) {
          setShowSaveToast(true);
          setSaveStatus('saved');
          invalidateSubmissions(
            id as string,
            updatedData.examId,
            updatedData.classId,
            updatedData.studentId
          );
        } else {
          setSaveStatus('error');
        }
      } catch (e) {
        console.error('Failed to auto-save:', e);
        setSaveStatus('error');
      }
    };

    if (immediate) {
      executeSave();
    } else {
      saveTimeoutRef.current = setTimeout(executeSave, 1000); // 1-second debounce
    }
  };

  // Clean up timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  // Initialize data from PostgreSQL database
  useEffect(() => {
    Promise.resolve().then(() => {
      loadSubmission();
    });
  }, [loadSubmission]);

  // Live polling for PENDING & PROCESSING status updates
  useEffect(() => {
    if (!id || !data) return;
    if (data.status !== 'PENDING' && data.status !== 'PROCESSING') return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/submissions/${id}`);
        if (res.ok) {
          const parsed = await res.json();
          setData(parsed);
        }
      } catch (e) {
        console.error('Failed to poll status:', e);
      }
    }, 3000);

    return () => clearInterval(interval);
  }, [id, data]);

  if (noSession) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: '64px',
            height: '64px',
            borderRadius: '16px',
            backgroundColor: '#fee2e2',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: '20px',
          }}
        >
          <ErrorIcon sx={{ fontSize: '2.5rem' }} />
        </Box>
        <Typography
          variant="h5"
          component="h2"
          sx={{ fontWeight: 800, color: '#0f172a', marginBottom: '8px' }}
        >
          Keine aktive Korrektur-Sitzung gefunden
        </Typography>
        <Typography
          variant="body1"
          sx={{ color: 'text.secondary', maxWidth: '400px', marginBottom: '28px', lineHeight: 1.5 }}
        >
          Bitte lade zuerst eine Schülerarbeit auf dem Dashboard hoch, um die automatisierte Analyse
          und Korrektur zu starten.
        </Typography>
        <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
          <Button
            variant="contained"
            sx={{
              backgroundColor: '#1b77d1',
              padding: '10px 24px',
              borderRadius: '8px',
              fontWeight: 600,
              textTransform: 'none',
              '&:hover': {
                backgroundColor: '#1565c0',
              },
            }}
          >
            Zurück zum Dashboard
          </Button>
        </Link>
      </Box>
    );
  }

  if (!data) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <CircularProgress size={40} thickness={4} sx={{ color: 'primary.main' }} />
        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
          Korrektur-Daten werden geladen...
        </Typography>
      </Box>
    );
  }

  // Waiting screen for PENDING and PROCESSING queue states
  if (data.status === 'PENDING' || data.status === 'PROCESSING') {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '24px',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <Box sx={{ position: 'relative', display: 'inline-flex' }}>
          <CircularProgress size={80} thickness={4.5} sx={{ color: 'primary.main' }} />
          <Box
            sx={{
              top: 0,
              left: 0,
              bottom: 0,
              right: 0,
              position: 'absolute',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <AutoAwesomeIcon sx={{ color: 'primary.main', fontSize: '2rem' }} />
          </Box>
        </Box>

        <Box>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
            {data.status === 'PENDING' ? 'In der Warteschlange...' : 'KI-Analyse läuft...'}
          </Typography>
          <Typography
            variant="body2"
            sx={{ color: 'text.secondary', maxWidth: '450px', mx: 'auto', lineHeight: 1.6 }}
          >
            {data.status === 'PENDING'
              ? 'Deine Schülerarbeit wartet darauf, von der KI bewertet zu werden. Der Prozess startet in wenigen Sekunden.'
              : 'Die multimodale KI entziffert die Handschrift, überprüft Lösungswege auf Folgefehler und erstellt personalisiertes Feedback.'}
          </Typography>
        </Box>

        <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
          <Button
            variant="outlined"
            sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 600, px: 3 }}
          >
            Zurück zum Dashboard
          </Button>
        </Link>
      </Box>
    );
  }

  // Failure screen for FAILED state
  if (data.status === 'FAILED') {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '20px',
          padding: '24px',
          textAlign: 'center',
        }}
      >
        <Box
          sx={{
            width: '72px',
            height: '72px',
            borderRadius: '50%',
            backgroundColor: '#fee2e2',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ErrorIcon sx={{ fontSize: '3rem' }} />
        </Box>

        <Box sx={{ maxWidth: '500px', width: '100%' }}>
          <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
            KI-Korrektur fehlgeschlagen
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            Während der automatisierten Korrektur ist ein Fehler aufgetreten.
          </Typography>

          <Alert severity="error" sx={{ textAlign: 'left', borderRadius: '8px', mb: 3 }}>
            {data.errorMessage || 'Ein unbekannter Fehler ist aufgetreten.'}
          </Alert>

          {retryError && (
            <Alert severity="warning" sx={{ textAlign: 'left', borderRadius: '8px', mb: 3 }}>
              {retryError}
            </Alert>
          )}
        </Box>

        <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
          {data.errorMessage?.includes('nicht mehr verfügbar') ||
          data.errorMessage?.includes('vor der Speicher-Migration') ||
          data.errorMessage?.includes('Dokumenten-Scan') ? (
            <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
              <Button
                variant="contained"
                startIcon={<CloudUploadIcon />}
                sx={{
                  backgroundColor: '#0284c7',
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 700,
                  px: 3,
                  '&:hover': { backgroundColor: '#0369a1' },
                }}
              >
                Prüfung neu hochladen
              </Button>
            </Link>
          ) : (
            <Button
              variant="contained"
              disabled={isRetrying}
              onClick={handleRetry}
              startIcon={
                isRetrying ? <CircularProgress size={16} color="inherit" /> : <AutoAwesomeIcon />
              }
              sx={{
                backgroundColor: '#0284c7',
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 700,
                px: 3,
                '&:hover': { backgroundColor: '#0369a1' },
              }}
            >
              {isRetrying ? 'Starte neu...' : 'Erneut versuchen'}
            </Button>
          )}

          <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
            <Button
              variant="outlined"
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 600,
                px: 3,
              }}
            >
              Zurück zum Dashboard
            </Button>
          </Link>
        </Stack>
      </Box>
    );
  }

  // Helper to dynamically calculate task status based on its steps
  const updateTaskStatus = (task: CorrectedTask) => {
    const allStepsCorrect = task.schritte.every((s: CorrectedStep) => s.fehlerTyp === 'KeinFehler');
    if (allStepsCorrect) {
      task.status = 'Korrekt';
    } else {
      const hasFolgefehlerStep = task.schritte.some(
        (s: CorrectedStep) => s.fehlerTyp === 'Folgefehler'
      );
      if (task.status === 'Folgefehler' || hasFolgefehlerStep) {
        task.status = 'Folgefehler';
      } else {
        task.status = 'Fehler';
      }
    }
  };

  // Handle inline point adjustments by the teacher
  const handlePointChange = (taskIndex: number, stepIndex: number, newPoints: number) => {
    if (!data) return;

    const updatedTasks = [...data.aufgaben];
    const task = { ...updatedTasks[taskIndex] };
    const steps = [...task.schritte];
    const step = { ...steps[stepIndex] };

    // Ensure points are clamped between 0 and max and rounded to 1 decimal place
    const roundedPoints = Math.round(newPoints * 10) / 10;
    const clamped = Math.max(0, Math.min(step.maximalPunkte, roundedPoints));
    step.erreichtePunkte = clamped;

    // Auto-adjust error type based on points
    if (clamped === step.maximalPunkte) {
      step.fehlerTyp = 'KeinFehler';
    } else if (clamped < step.maximalPunkte && step.fehlerTyp === 'KeinFehler') {
      step.fehlerTyp = 'SonstigerFehler';
    }

    // Teacher adjustment resolves AI uncertainty
    step.istUnsicher = false;
    step.unsicherheitsGrund = '';

    steps[stepIndex] = step;
    task.schritte = steps;

    // Recalculate task total with rounding
    task.erzieltePunkte =
      Math.round(steps.reduce((sum, s) => sum + s.erreichtePunkte, 0) * 10) / 10;

    // Update task status dynamically
    updateTaskStatus(task);

    updatedTasks[taskIndex] = task;

    // Recalculate total score with rounding
    const totalScore =
      Math.round(updatedTasks.reduce((sum, t) => sum + t.erzieltePunkte, 0) * 10) / 10;

    // Recalculate school grade dynamically based on exam's Swiss grading formula and rounding step
    const maxScore = data.gesamtmaximalPunkte;
    const newGrade = calculateSwissGrade(
      totalScore,
      maxScore,
      data.gradingFormula || 'LINEAR_60',
      data.gradeRounding || '0.1'
    );

    const updatedResult = {
      ...data,
      aufgaben: updatedTasks,
      gesamterzieltePunkte: totalScore,
      note: newGrade,
    };

    setData(updatedResult);
    // Auto-save Point adjustments directly to PostgreSQL
    saveToDatabase(updatedResult);
  };

  // Handle inline description adjustments by the teacher
  const handleDescriptionChange = (
    taskIndex: number,
    stepIndex: number,
    newDescription: string
  ) => {
    if (!data) return;

    const updatedTasks = [...data.aufgaben];
    const task = { ...updatedTasks[taskIndex] };
    const steps = [...task.schritte];
    const step = { ...steps[stepIndex] };

    step.begruendung = newDescription;
    steps[stepIndex] = step;
    task.schritte = steps;
    updatedTasks[taskIndex] = task;

    const updatedResult = {
      ...data,
      aufgaben: updatedTasks,
    };

    setData(updatedResult);
    // Auto-save Description adjustments directly to PostgreSQL (debounced)
    saveToDatabase(updatedResult);
  };

  // Handle inline error type adjustments by the teacher
  const handleErrorTypeChange = (
    taskIndex: number,
    stepIndex: number,
    newErrorType: 'KeinFehler' | 'Folgefehler' | 'SonstigerFehler'
  ) => {
    if (!data) return;

    const updatedTasks = [...data.aufgaben];
    const task = { ...updatedTasks[taskIndex] };
    const steps = [...task.schritte];
    const step = { ...steps[stepIndex] };

    step.fehlerTyp = newErrorType;
    step.istUnsicher = false;
    step.unsicherheitsGrund = '';

    steps[stepIndex] = step;
    task.schritte = steps;

    // Recalculate task total
    task.erzieltePunkte =
      Math.round(steps.reduce((sum, s) => sum + s.erreichtePunkte, 0) * 10) / 10;

    // Update task status dynamically
    updateTaskStatus(task);

    updatedTasks[taskIndex] = task;

    // Recalculate total score with rounding
    const totalScore =
      Math.round(updatedTasks.reduce((sum, t) => sum + t.erzieltePunkte, 0) * 10) / 10;

    const maxScore = data.gesamtmaximalPunkte;
    const newGrade = calculateSwissGrade(
      totalScore,
      maxScore,
      data.gradingFormula || 'LINEAR_60',
      data.gradeRounding || '0.1'
    );

    const updatedResult = {
      ...data,
      aufgaben: updatedTasks,
      gesamterzieltePunkte: totalScore,
      note: newGrade,
    };

    setData(updatedResult);
    // Auto-save Error Type adjustments directly to PostgreSQL (debounced)
    saveToDatabase(updatedResult);
  };

  // Handle explicit resolution of AI uncertainty by the teacher
  const handleResolveStepUncertainty = (taskIndex: number, stepIndex: number) => {
    if (!data) return;

    const updatedTasks = [...data.aufgaben];
    const task = { ...updatedTasks[taskIndex] };
    const steps = [...task.schritte];
    const step = { ...steps[stepIndex] };

    step.istUnsicher = false;
    step.unsicherheitsGrund = '';

    steps[stepIndex] = step;
    task.schritte = steps;
    updatedTasks[taskIndex] = task;

    const updatedResult = {
      ...data,
      aufgaben: updatedTasks,
    };

    setData(updatedResult);
    saveToDatabase(updatedResult, true);
  };

  // Handle inline comments adjustments by the teacher
  const handleCommentChange = (taskIndex: number, newComment: string) => {
    if (!data) return;
    const updatedTasks = [...data.aufgaben];
    updatedTasks[taskIndex] = {
      ...updatedTasks[taskIndex],
      lehrerKommentar: newComment,
    };

    const updatedResult = {
      ...data,
      aufgaben: updatedTasks,
    };

    setData(updatedResult);
    // Auto-save Comment changes directly to PostgreSQL (debounced)
    saveToDatabase(updatedResult);
  };

  // Handle inline student feedback adjustments by the teacher
  const handleFeedbackChange = (key: 'hilfreicherTipp' | 'uebungsEmpfehlung', newValue: string) => {
    if (!data) return;

    const updatedFeedback = {
      ...data.schuelerFeedback,
      [key]: newValue,
    };

    const updatedResult = {
      ...data,
      schuelerFeedback: updatedFeedback,
    };

    setData(updatedResult);
    // Auto-save feedback changes directly to PostgreSQL (debounced)
    saveToDatabase(updatedResult);
  };

  const activeTask = data.aufgaben[activeTaskIndex];

  return (
    <Box sx={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {/* 1. Normal Web UI View (Hidden during printing) */}
      <Box className="no-print" sx={{ display: 'flex', flexDirection: 'column', height: '100vh' }}>
        {/* Top Navbar */}
        <Box
          component="header"
          sx={{
            padding: '12px 24px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            borderBottom: '1px solid #e2e8f0',
            background: '#ffffff',
            height: '64px',
            zIndex: 10,
          }}
        >
          <Stack direction="row" spacing={2} sx={{ alignItems: 'center' }}>
            <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<ArrowBackIcon />}
                sx={{ color: 'text.primary', borderColor: '#e2e8f0' }}
              >
                Dashboard
              </Button>
            </Link>
            {data.examId && (
              <Link href={`/exams/${data.examId}`} passHref style={{ textDecoration: 'none' }}>
                <Button
                  variant="text"
                  size="small"
                  sx={{
                    color: '#475569',
                    fontWeight: 600,
                    textTransform: 'none',
                    display: { xs: 'none', lg: 'inline-flex' },
                  }}
                >
                  {data.examTitle || 'Zur Prüfung'}
                </Button>
              </Link>
            )}
            <Divider orientation="vertical" flexItem sx={{ borderColor: '#e2e8f0' }} />

            {/* Continuous Speed-Grading Student Navigation Bar */}
            {(() => {
              const siblings = data.siblingSubmissions || [];
              const currentIdx = siblings.findIndex((s) => s.id === String(id));
              if (siblings.length > 1 && currentIdx !== -1) {
                const prevSib = currentIdx > 0 ? siblings[currentIdx - 1] : null;
                const nextSib = currentIdx < siblings.length - 1 ? siblings[currentIdx + 1] : null;
                return (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Tooltip
                      title={
                        prevSib
                          ? `Vorherige/r: ${prevSib.studentName}`
                          : 'Erste Arbeit in dieser Prüfung'
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!prevSib}
                          onClick={() => prevSib && router.push(`/correct/${prevSib.id}`)}
                          sx={{
                            minWidth: 32,
                            px: 1,
                            py: 0.4,
                            borderRadius: '6px',
                            borderColor: '#cbd5e1',
                            fontWeight: 800,
                          }}
                        >
                          ‹
                        </Button>
                      </span>
                    </Tooltip>

                    <select
                      value={String(id)}
                      onChange={(e) => router.push(`/correct/${e.target.value}`)}
                      style={{
                        padding: '5px 10px',
                        borderRadius: '8px',
                        border: '1px solid #cbd5e1',
                        backgroundColor: '#f8fafc',
                        color: '#0f172a',
                        fontWeight: 700,
                        fontSize: '0.85rem',
                        cursor: 'pointer',
                        outline: 'none',
                        fontFamily: 'inherit',
                      }}
                    >
                      {siblings.map((sib, idx) => (
                        <option key={sib.id} value={sib.id}>
                          {idx + 1}/{siblings.length}: {sib.studentName}
                          {sib.grade ? ` (Note ${sib.grade})` : ''}
                          {sib.uncertainStepsCount > 0
                            ? ` ⚠ (${sib.uncertainStepsCount} unsicher)`
                            : ''}
                        </option>
                      ))}
                    </select>

                    <Tooltip
                      title={
                        nextSib
                          ? `Nächste/r: ${nextSib.studentName}`
                          : 'Letzte Arbeit in dieser Prüfung'
                      }
                    >
                      <span>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={!nextSib}
                          onClick={() => nextSib && router.push(`/correct/${nextSib.id}`)}
                          sx={{
                            minWidth: 32,
                            px: 1,
                            py: 0.4,
                            borderRadius: '6px',
                            borderColor: '#cbd5e1',
                            fontWeight: 800,
                          }}
                        >
                          ›
                        </Button>
                      </span>
                    </Tooltip>
                  </Stack>
                );
              }
              return (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Schüler:
                  </Typography>
                  <Typography variant="subtitle2" sx={{ color: '#0f172a', fontWeight: 'bold' }}>
                    {data.schuelerName}
                  </Typography>
                </Stack>
              );
            })()}

            <Stack
              direction="row"
              spacing={1}
              sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'center' }}
            >
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Fach:
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.primary', fontWeight: 500 }}>
                {data.fach}
              </Typography>
            </Stack>
          </Stack>

          <Stack direction="row" spacing={3} sx={{ alignItems: 'center' }}>
            {data.isReused && (
              <Tooltip title="Dieses Korrekturergebnis wurde aus dem KI-Cache für identische Eingaben wiederverwendet.">
                <Chip
                  size="small"
                  label="Ergebnis wiederverwendet"
                  sx={{
                    fontWeight: 700,
                    borderRadius: '8px',
                    backgroundColor: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #cbd5e1',
                    fontSize: '0.75rem',
                  }}
                />
              </Tooltip>
            )}
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
              >
                Gesamtpunkte:
              </Typography>
              {(() => {
                const taskMaxSum =
                  Math.round(
                    data.aufgaben.reduce((acc, t) => acc + (t.maximalPunkte || 0), 0) * 10
                  ) / 10;
                const hasMismatch =
                  Boolean(data.gesamtmaximalPunkte) &&
                  taskMaxSum > 0 &&
                  Math.abs(taskMaxSum - data.gesamtmaximalPunkte) > 0.05;

                return (
                  <Tooltip
                    title={
                      hasMismatch
                        ? `Prüfungs-Maximum (Noten-Basis): ${data.gesamtmaximalPunkte} P. · Summe der erkannten Aufgaben: ${taskMaxSum.toFixed(1)} P.`
                        : `Gesamtpunkte: ${data.gesamterzieltePunkte.toFixed(1)} / ${data.gesamtmaximalPunkte}`
                    }
                  >
                    <Chip
                      label={`${data.gesamterzieltePunkte.toFixed(1)} / ${data.gesamtmaximalPunkte}${hasMismatch ? ' *' : ''}`}
                      sx={{
                        fontWeight: 'bold',
                        borderRadius: '8px',
                        backgroundColor: '#e6f4ea',
                        borderColor: '#a3cfbb',
                        color: '#137333',
                        border: '1px solid #a3cfbb',
                      }}
                    />
                  </Tooltip>
                );
              })()}
            </Stack>

            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
              >
                Note:
              </Typography>
              <Chip
                label={data.note}
                sx={{
                  fontWeight: 'bold',
                  borderRadius: '8px',
                  fontSize: '1rem',
                  padding: '4px 8px',
                  backgroundColor: parseFloat(data.note) >= 4.0 ? '#1b77d1' : '#dc2626',
                  color: '#ffffff',
                }}
              />
            </Stack>

            <Button
              onClick={() => window.print()}
              className="glow-button"
              variant="contained"
              size="small"
              startIcon={<PrintIcon />}
              sx={{ borderRadius: '8px', padding: '8px 16px' }}
            >
              Feedback drucken
            </Button>
          </Stack>
        </Box>

        {/* Split container layout */}
        <Box sx={{ display: 'flex', flex: 1, overflow: 'hidden', height: 'calc(100vh - 64px)' }}>
          {/* Left panel: Visual Exam Sheet rendering */}
          <Box
            sx={{
              flex: 1.1,
              background: '#e2e8f0',
              borderRight: '1px solid #cbd5e1',
              padding: '24px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '20px',
            }}
          >
            <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <Typography variant="subtitle1" sx={{ color: 'text.primary', fontWeight: 700 }}>
                Schülerarbeit
              </Typography>

              {/* Scan / Transcript switcher tabs */}
              {data.studentExamUrl && (
                <Stack
                  direction="row"
                  spacing={0.5}
                  sx={{ backgroundColor: '#e2e8f0', p: '3px', borderRadius: '6px' }}
                >
                  <Button
                    size="small"
                    onClick={() => setLeftPanelTab('scan')}
                    sx={{
                      fontSize: '0.75rem',
                      py: '2px',
                      px: '10px',
                      textTransform: 'none',
                      borderRadius: '4px',
                      backgroundColor: leftPanelTab === 'scan' ? '#ffffff' : 'transparent',
                      color: leftPanelTab === 'scan' ? '#1b77d1' : '#475569',
                      fontWeight: leftPanelTab === 'scan' ? 700 : 500,
                      boxShadow: leftPanelTab === 'scan' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      '&:hover': {
                        backgroundColor: leftPanelTab === 'scan' ? '#ffffff' : 'rgba(0,0,0,0.04)',
                      },
                    }}
                  >
                    Originaler Scan
                  </Button>
                  <Button
                    size="small"
                    onClick={() => setLeftPanelTab('transcript')}
                    sx={{
                      fontSize: '0.75rem',
                      py: '2px',
                      px: '10px',
                      textTransform: 'none',
                      borderRadius: '4px',
                      backgroundColor: leftPanelTab === 'transcript' ? '#ffffff' : 'transparent',
                      color: leftPanelTab === 'transcript' ? '#1b77d1' : '#475569',
                      fontWeight: leftPanelTab === 'transcript' ? 700 : 500,
                      boxShadow:
                        leftPanelTab === 'transcript' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                      '&:hover': {
                        backgroundColor:
                          leftPanelTab === 'transcript' ? '#ffffff' : 'rgba(0,0,0,0.04)',
                      },
                    }}
                  >
                    Digitales Transkript
                  </Button>
                </Stack>
              )}

              {(() => {
                const scanUrls = parseStudentExamUrls(data.studentExamUrl);
                const totalPages = Math.max(1, scanUrls.length);
                const safeIdx = Math.min(activeScanPageIndex, totalPages - 1);
                return (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    {leftPanelTab === 'scan' && totalPages > 1 ? (
                      <>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={safeIdx === 0}
                          onClick={() => setActiveScanPageIndex(Math.max(0, safeIdx - 1))}
                          sx={{ minWidth: 28, px: 1, py: 0.25, fontSize: '0.75rem' }}
                        >
                          ‹
                        </Button>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', fontWeight: 700 }}
                        >
                          Seite {safeIdx + 1} / {totalPages}
                        </Typography>
                        <Button
                          size="small"
                          variant="outlined"
                          disabled={safeIdx >= totalPages - 1}
                          onClick={() =>
                            setActiveScanPageIndex(Math.min(totalPages - 1, safeIdx + 1))
                          }
                          sx={{ minWidth: 28, px: 1, py: 0.25, fontSize: '0.75rem' }}
                        >
                          ›
                        </Button>
                      </>
                    ) : (
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', display: { xs: 'none', sm: 'block' } }}
                      >
                        Seite 1 von {totalPages}
                      </Typography>
                    )}
                    <Tooltip title="Fehlende Seite anhängen oder unscharfen Scan per Smartphone/Datei ersetzen">
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<QrCodeScannerIcon sx={{ fontSize: '0.95rem !important' }} />}
                        onClick={() => setQrOpen(true)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          fontSize: '0.73rem',
                          py: 0.35,
                          px: 1.25,
                          borderRadius: '6px',
                          backgroundColor: '#ffffff',
                          borderColor: '#cbd5e1',
                          color: '#0f172a',
                          '&:hover': {
                            backgroundColor: '#f8fafc',
                            borderColor: '#1b77d1',
                            color: '#1b77d1',
                          },
                        }}
                      >
                        + Seite / Neu scannen
                      </Button>
                    </Tooltip>
                  </Stack>
                );
              })()}
            </Stack>

            {leftPanelTab === 'scan' && data.studentExamUrl ? (
              /* Premium Real Scanned Sheet Viewer (Single or Multi-Page) */
              (() => {
                const scanUrls = parseStudentExamUrls(data.studentExamUrl);
                const activeUrl =
                  scanUrls[Math.min(activeScanPageIndex, Math.max(0, scanUrls.length - 1))] ||
                  data.studentExamUrl;
                return (
                  <Box
                    sx={{
                      background: '#f1f5f9',
                      borderRadius: '8px',
                      padding: '12px',
                      minHeight: '680px',
                      height: '750px',
                      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                      display: 'flex',
                      justifyContent: 'center',
                      alignItems: 'center',
                      border: '1px solid #cbd5e1',
                      overflow: 'hidden',
                      position: 'relative',
                    }}
                  >
                    {activeUrl.toLowerCase().endsWith('.pdf') ? (
                      <iframe
                        src={activeUrl}
                        width="100%"
                        height="100%"
                        style={{ border: 'none', borderRadius: '8px' }}
                      />
                    ) : (
                      <Image
                        src={activeUrl}
                        alt="Original Schülerarbeit Scan"
                        fill
                        unoptimized
                        style={{
                          objectFit: 'contain',
                          padding: '12px',
                        }}
                        sizes="(max-width: 1200px) 100vw, 50vw"
                        priority
                      />
                    )}
                  </Box>
                );
              })()
            ) : (
              /* Premium Simulated Scanned Sheet with red grading ink */
              <Box
                sx={{
                  background: '#ffffff',
                  backgroundImage: 'radial-gradient(#cbd5e1 1.5px, transparent 1.5px)',
                  backgroundSize: '24px 24px',
                  color: '#0f172a',
                  borderRadius: '8px',
                  padding: '30px',
                  minHeight: '680px',
                  boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
                  position: 'relative',
                  fontFamily: '"Architects Daughter", "Comic Sans MS", cursive, sans-serif',
                  border: '1px solid #cbd5e1',
                  overflow: 'hidden',
                }}
              >
                {/* Paper line markers */}
                <Box
                  sx={{
                    position: 'absolute',
                    top: 0,
                    left: '40px',
                    width: '1px',
                    height: '100%',
                    background: 'rgba(239, 68, 68, 0.15)',
                    pointerEvents: 'none',
                  }}
                />

                {/* Student Header details */}
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    borderBottom: '1px solid #94a3b8',
                    paddingBottom: '10px',
                    marginBottom: '30px',
                    fontFamily: 'sans-serif',
                    fontSize: '0.85rem',
                    color: '#475569',
                    fontWeight: 500,
                  }}
                >
                  <Box>Name: {data.schuelerName}</Box>
                  <Box>Klasse: {data.className || '—'}</Box>
                  <Box>Datum: {data.datum}</Box>
                </Box>

                {/* Dynamically render actual student tasks & transcribed handwriting from Gemini API */}
                {data.aufgaben.map((task, taskIdx) => (
                  <Box
                    key={task.aufgabeId}
                    onClick={() => setActiveTaskIndex(taskIdx)}
                    sx={{
                      position: 'relative',
                      padding: '16px',
                      borderRadius: '8px',
                      marginBottom: '24px',
                      cursor: 'pointer',
                      border:
                        activeTaskIndex === taskIdx
                          ? '1px dashed #1b77d1'
                          : '1px solid transparent',
                      background:
                        activeTaskIndex === taskIdx ? 'rgba(27, 119, 209, 0.05)' : 'transparent',
                      '&:hover': {
                        background: 'rgba(27, 119, 209, 0.02)',
                      },
                    }}
                  >
                    <Typography
                      sx={{
                        fontFamily: 'sans-serif',
                        fontSize: '0.95rem',
                        fontWeight: 'bold',
                        color: '#1e293b',
                        marginBottom: '8px',
                      }}
                    >
                      {task.titel}
                    </Typography>
                    <Typography
                      component="div"
                      sx={{
                        fontSize: '1.25rem',
                        letterSpacing: '0.05em',
                        lineHeight: 1.8,
                        color: '#334155',
                        fontFamily: 'inherit',
                        whiteSpace: 'pre-wrap',
                        maxWidth: '85%',
                      }}
                    >
                      {task.schuelerAntwort}

                      {/* Dynamic Digital Red Ink corrections drawn based on real steps! */}
                      <Box sx={{ mt: 1.5, fontFamily: 'sans-serif', fontSize: '0.9rem' }}>
                        {task.schritte.map((step) => {
                          const uncertaintyBadge = step.istUnsicher ? (
                            <Box
                              key={`uncertain-${step.schrittIndex}`}
                              sx={{
                                color: '#b45309',
                                border: '1.5px dashed #f59e0b',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontWeight: 'bold',
                                display: 'inline-block',
                                backgroundColor: '#fef3c7',
                                mr: 1,
                                mb: 1,
                              }}
                            >
                              ⚠ Schritt {step.schrittIndex + 1} – KI unsicher:{' '}
                              {step.unsicherheitsGrund || 'Bitte manuell prüfen'}
                            </Box>
                          ) : null;

                          if (
                            step.fehlerTyp === 'Rechenfehler' ||
                            step.fehlerTyp === 'SonstigerFehler'
                          ) {
                            return (
                              <React.Fragment key={step.schrittIndex}>
                                {uncertaintyBadge}
                                <Box
                                  sx={{
                                    color: 'error.main',
                                    border: `1.5px solid ${theme.palette.error.main}`,
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontWeight: 'bold',
                                    display: 'inline-block',
                                    transform: `rotate(${step.schrittIndex % 2 === 0 ? -1 : 1}deg)`,
                                    backgroundColor: 'rgba(239, 68, 68, 0.05)',
                                    mr: 1,
                                    mb: 1,
                                  }}
                                >
                                  Schritt {step.schrittIndex + 1}: {step.begruendung} ❌ (-
                                  {Math.round((step.maximalPunkte - step.erreichtePunkte) * 10) /
                                    10}{' '}
                                  P.)
                                </Box>
                              </React.Fragment>
                            );
                          } else if (step.fehlerTyp === 'Folgefehler') {
                            return (
                              <React.Fragment key={step.schrittIndex}>
                                {uncertaintyBadge}
                                <Box
                                  sx={{
                                    color: 'warning.main',
                                    border: `1.5px solid ${theme.palette.warning.main}`,
                                    padding: '2px 8px',
                                    borderRadius: '4px',
                                    fontWeight: 'bold',
                                    display: 'inline-block',
                                    transform: `rotate(${step.schrittIndex % 2 === 0 ? 1 : -0.5}deg)`,
                                    backgroundColor: 'rgba(245, 158, 11, 0.05)',
                                    mr: 1,
                                    mb: 1,
                                  }}
                                >
                                  Schritt {step.schrittIndex + 1}: Folgefehler berücksichtigt! ✔️ (
                                  {Math.round(step.erreichtePunkte * 10) / 10}/
                                  {Math.round(step.maximalPunkte * 10) / 10} P.)
                                </Box>
                              </React.Fragment>
                            );
                          }
                          return uncertaintyBadge;
                        })}
                      </Box>
                    </Typography>

                    {/* Red ink point stamp */}
                    <Box
                      sx={{
                        position: 'absolute',
                        right: '15px',
                        top: '15px',
                        fontSize: '1.4rem',
                        color: 'error.main',
                        fontWeight: 'bold',
                        border: '3px double #ef4444',
                        width: '56px',
                        height: '56px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: '50%',
                        transform: `rotate(${taskIdx % 2 === 0 ? -8 : 6}deg)`,
                        pointerEvents: 'none',
                      }}
                    >
                      {task.erzieltePunkte?.toFixed(1) ?? '0.0'}/{task.maximalPunkte}
                    </Box>
                  </Box>
                ))}
              </Box>
            )}
          </Box>

          {/* Right panel: AI Grading & Feedback Workspace */}
          <Box
            sx={{
              flex: 1,
              background: 'background.default',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
          >
            {/* Task selector Tabs */}
            <Stack
              direction="row"
              sx={{
                alignItems: 'center',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
              }}
            >
              <Tabs
                value={activeTaskIndex}
                onChange={(_, val) => setActiveTaskIndex(val)}
                variant="scrollable"
                scrollButtons="auto"
                sx={{
                  flex: 1,
                  '& .MuiTabs-indicator': {
                    backgroundColor: '#1b77d1',
                    height: '3px',
                  },
                  '& .MuiTab-root': {
                    color: 'text.secondary',
                    fontWeight: 600,
                    fontSize: '0.85rem',
                    borderRight: '1px solid #e2e8f0',
                    textTransform: 'none',
                    minHeight: '52px',
                    transition: 'all 0.2s ease',
                    '&.Mui-selected': {
                      color: '#1b77d1',
                      backgroundColor: '#f8fafc',
                      fontWeight: 800,
                    },
                  },
                }}
              >
                {data.aufgaben.map((t, idx) => {
                  const hasUncertainStep = t.schritte.some((s) => s.istUnsicher);
                  return (
                    <Tab
                      key={t.aufgabeId}
                      label={
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography variant="body2" sx={{ fontWeight: 'inherit' }}>
                            Aufg. {t.aufgabeId}
                          </Typography>
                          <Chip
                            label={`${t.erzieltePunkte.toFixed(1)} P.`}
                            size="small"
                            sx={{
                              height: '20px',
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              backgroundColor: activeTaskIndex === idx ? '#e3f2fd' : '#f1f5f9',
                              color: activeTaskIndex === idx ? '#1b77d1' : 'text.secondary',
                              border: activeTaskIndex === idx ? '1px solid #1b77d1' : 'none',
                              transition: 'all 0.2s ease',
                            }}
                          />
                          {hasUncertainStep && (
                            <Chip
                              label="⚠ KI unsicher"
                              size="small"
                              sx={{
                                height: '20px',
                                fontSize: '0.7rem',
                                fontWeight: 700,
                                backgroundColor: '#fef3c7',
                                color: '#b45309',
                                border: '1px solid #f59e0b',
                              }}
                            />
                          )}
                        </Stack>
                      }
                    />
                  );
                })}
              </Tabs>
              <Box
                sx={{
                  px: 2,
                  borderLeft: '1px solid #e2e8f0',
                  height: '52px',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <Tooltip title="Fehlende Aufgabe hinzufügen">
                  <IconButton
                    color="primary"
                    onClick={() => {
                      setAddTaskError('');
                      setOpenAddTask(true);
                    }}
                    sx={{
                      backgroundColor: '#f0f7ff',
                      '&:hover': { backgroundColor: '#e3f2fd' },
                      width: '36px',
                      height: '36px',
                      borderRadius: '8px',
                    }}
                  >
                    <AddIcon sx={{ fontSize: '1.25rem' }} />
                  </IconButton>
                </Tooltip>
              </Box>
            </Stack>

            {/* Graded steps & Comments content */}
            <Box
              sx={{
                flex: 1,
                overflowY: 'auto',
                padding: '24px 24px 80px 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: '24px',
              }}
            >
              {/* Global AI Uncertainty Warning Banner */}
              {(() => {
                const uncertainStepCount = data.aufgaben.reduce(
                  (acc, t) => acc + t.schritte.filter((s) => s.istUnsicher).length,
                  0
                );
                const firstUncertainTaskIdx = data.aufgaben.findIndex((t) =>
                  t.schritte.some((s) => s.istUnsicher)
                );
                if (uncertainStepCount === 0) return null;
                return (
                  <Alert
                    severity="warning"
                    sx={{
                      borderRadius: '10px',
                      border: '1px solid #f59e0b',
                      backgroundColor: '#fffbeb',
                      color: '#92400e',
                      flexShrink: 0,
                      alignItems: 'center',
                    }}
                    action={
                      firstUncertainTaskIdx !== -1 && firstUncertainTaskIdx !== activeTaskIndex ? (
                        <Button
                          color="warning"
                          size="small"
                          variant="outlined"
                          onClick={() => setActiveTaskIndex(firstUncertainTaskIdx)}
                          sx={{ textTransform: 'none', fontWeight: 700 }}
                        >
                          Zur Aufgabe springen
                        </Button>
                      ) : undefined
                    }
                  >
                    <strong>KI-Unsicherheit erkannt ({uncertainStepCount}):</strong> Die KI war bei{' '}
                    {uncertainStepCount === 1
                      ? 'einem Teilschritt'
                      : `${uncertainStepCount} Teilschritten`}{' '}
                    unsicher (z. B. schwer lesbare Handschrift oder alternativer Lösungsweg) und hat
                    eine vorläufige Bewertung vorgeschlagen. Bitte vor Abschluss kurz prüfen.
                  </Alert>
                );
              })()}

              {/* Point Maximum Mismatch Notice */}
              {(() => {
                const taskMaxSum =
                  Math.round(
                    data.aufgaben.reduce((acc, t) => acc + (t.maximalPunkte || 0), 0) * 10
                  ) / 10;
                if (
                  !data.gesamtmaximalPunkte ||
                  taskMaxSum <= 0 ||
                  Math.abs(taskMaxSum - data.gesamtmaximalPunkte) <= 0.05
                ) {
                  return null;
                }
                return (
                  <Alert
                    severity="info"
                    sx={{
                      borderRadius: '10px',
                      border: '1px solid #93c5fd',
                      backgroundColor: '#eff6ff',
                      color: '#1e40af',
                      flexShrink: 0,
                    }}
                  >
                    <strong>Hinweis zur Maximalpunktzahl:</strong> Die Summe der erkannten Aufgaben
                    ({taskMaxSum.toFixed(1)} P.) weicht vom Prüfungs-Maximum (
                    {data.gesamtmaximalPunkte.toFixed(1)} P.) ab. Die Note ({data.note}) basiert
                    verbindlich auf deinem vorgegebenen Prüfungs-Maximum.
                  </Alert>
                );
              })()}

              {/* Task title */}
              <Box sx={{ flexShrink: 0 }}>
                <Typography
                  variant="caption"
                  sx={{ color: 'primary.main', fontWeight: 650, letterSpacing: '0.05em' }}
                >
                  AKTIVE AUFGABE
                </Typography>
                <Typography variant="h5" component="h3" sx={{ fontWeight: 700, marginTop: '4px' }}>
                  {activeTask.titel}
                </Typography>
              </Box>

              {/* Steps breakdown list */}
              <Stack spacing={2} sx={{ flexShrink: 0 }}>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Teilschritte & Bepunktung
                </Typography>

                {activeTask.schritte.map((s, sIdx) => (
                  <Card
                    key={s.schrittIndex}
                    sx={{
                      borderRadius: '12px',
                      borderLeft: `4px solid ${
                        s.istUnsicher
                          ? '#f59e0b'
                          : s.fehlerTyp === 'KeinFehler'
                            ? theme.palette.success.main
                            : s.fehlerTyp === 'Folgefehler'
                              ? theme.palette.warning.main
                              : theme.palette.error.main
                      }`,
                      backgroundColor: s.istUnsicher ? '#fffbeb' : '#ffffff',
                      border: s.istUnsicher ? '1.5px solid #f59e0b' : '1px solid #e2e8f0',
                      boxShadow: '0 1px 3px rgba(0, 0, 0, 0.05)',
                    }}
                  >
                    <CardContent sx={{ padding: '16px !important' }}>
                      <Stack spacing={1.5}>
                        {s.istUnsicher && (
                          <Stack
                            direction={{ xs: 'column', sm: 'row' }}
                            spacing={1}
                            sx={{
                              justifyContent: 'space-between',
                              alignItems: { xs: 'flex-start', sm: 'center' },
                              backgroundColor: '#fef3c7',
                              border: '1px solid #f59e0b',
                              borderRadius: '8px',
                              px: 1.5,
                              py: 1,
                            }}
                          >
                            <Typography
                              variant="caption"
                              sx={{ color: '#92400e', fontWeight: 700, fontSize: '0.8rem' }}
                            >
                              ⚠ KI unsicher: {s.unsicherheitsGrund || 'Bitte manuell prüfen.'}
                            </Typography>
                            <Button
                              size="small"
                              variant="contained"
                              color="warning"
                              onClick={() => handleResolveStepUncertainty(activeTaskIndex, sIdx)}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                fontSize: '0.75rem',
                                py: 0.25,
                                px: 1.25,
                                borderRadius: '6px',
                                flexShrink: 0,
                                boxShadow: 'none',
                              }}
                            >
                              Als geprüft bestätigen ✓
                            </Button>
                          </Stack>
                        )}
                        <Stack
                          direction="row"
                          sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                        >
                          <Typography
                            variant="subtitle2"
                            sx={{
                              color: 'text.primary',
                              fontWeight: 700,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 1,
                            }}
                          >
                            Schritt {s.schrittIndex + 1}:
                            <Box
                              component="code"
                              sx={{
                                fontFamily: 'monospace',
                                backgroundColor: '#f1f5f9',
                                border: '1px solid #cbd5e1',
                                padding: '2px 8px',
                                borderRadius: '4px',
                                fontSize: '0.9rem',
                                color: '#0f172a',
                              }}
                            >
                              {s.schrittText}
                            </Box>
                          </Typography>

                          {/* Interactive point selector */}
                          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              Punkte:
                            </Typography>
                            <TextField
                              type="number"
                              size="small"
                              slotProps={{
                                htmlInput: {
                                  step: 0.5,
                                  min: 0,
                                  max: Math.round(s.maximalPunkte * 10) / 10,
                                  style: {
                                    textAlign: 'center',
                                    fontWeight: 'bold',
                                    width: '50px',
                                    padding: '4px 6px',
                                  },
                                },
                              }}
                              value={Math.round(s.erreichtePunkte * 10) / 10}
                              onChange={(e) =>
                                handlePointChange(
                                  activeTaskIndex,
                                  sIdx,
                                  parseFloat(e.target.value) || 0
                                )
                              }
                              sx={{
                                '& .MuiOutlinedInput-root': {
                                  backgroundColor: '#ffffff',
                                  borderRadius: '6px',
                                },
                              }}
                            />
                            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                              / {s.maximalPunkte}
                            </Typography>
                          </Stack>
                        </Stack>

                        <TextField
                          variant="outlined"
                          size="small"
                          fullWidth
                          multiline
                          value={s.begruendung}
                          onChange={(e) =>
                            handleDescriptionChange(activeTaskIndex, sIdx, e.target.value)
                          }
                          placeholder="Begründung oder Erklärung für diesen Schritt..."
                          sx={{
                            '& .MuiOutlinedInput-root': {
                              fontSize: '0.875rem',
                              color: 'text.secondary',
                              lineHeight: 1.5,
                              padding: '6px 10px',
                              backgroundColor: '#f8fafc',
                              '& fieldset': {
                                border: '1px dashed #cbd5e1',
                              },
                              '&:hover fieldset': {
                                border: '1px solid #1b77d1',
                              },
                              '&.Mui-focused fieldset': {
                                border: '1.5px solid #1b77d1',
                              },
                            },
                          }}
                        />

                        <Box sx={{ mt: 0.5 }}>
                          <select
                            value={s.fehlerTyp === 'Rechenfehler' ? 'SonstigerFehler' : s.fehlerTyp}
                            onChange={(e) =>
                              handleErrorTypeChange(
                                activeTaskIndex,
                                sIdx,
                                e.target.value as 'KeinFehler' | 'Folgefehler' | 'SonstigerFehler'
                              )
                            }
                            style={{
                              fontSize: '0.75rem',
                              fontWeight: 700,
                              borderRadius: '16px',
                              padding: '3px 10px',
                              cursor: 'pointer',
                              border: `1.5px solid ${
                                s.fehlerTyp === 'KeinFehler'
                                  ? theme.palette.success.main
                                  : s.fehlerTyp === 'Folgefehler'
                                    ? theme.palette.warning.main
                                    : theme.palette.error.main
                              }`,
                              color:
                                s.fehlerTyp === 'KeinFehler'
                                  ? theme.palette.success.main
                                  : s.fehlerTyp === 'Folgefehler'
                                    ? theme.palette.warning.main
                                    : theme.palette.error.main,
                              backgroundColor: '#ffffff',
                              outline: 'none',
                              fontFamily: 'inherit',
                              transition: 'all 0.2s ease',
                              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
                            }}
                          >
                            <option value="KeinFehler">Korrekt</option>
                            <option value="Folgefehler">Folgefehler (Teilpunkte)</option>
                            <option value="SonstigerFehler">Fehler</option>
                          </select>
                        </Box>
                      </Stack>
                    </CardContent>
                  </Card>
                ))}
              </Stack>

              {/* Teacher Comments Editor */}
              <Stack spacing={1} sx={{ flexShrink: 0 }}>
                <Typography variant="subtitle2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Lehrer-Kommentar zu dieser Aufgabe
                </Typography>
                <TextField
                  multiline
                  rows={3}
                  value={activeTask.lehrerKommentar}
                  onChange={(e) => handleCommentChange(activeTaskIndex, e.target.value)}
                  fullWidth
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      backgroundColor: '#ffffff',
                    },
                  }}
                />
              </Stack>

              {/* Student Assistance view */}
              <Card
                sx={{
                  background: '#f4f3ff',
                  borderColor: '#938eef',
                  boxShadow: 'none',
                  flexShrink: 0,
                }}
              >
                <CardContent sx={{ padding: '20px !important' }}>
                  <Typography
                    variant="subtitle1"
                    sx={{
                      color: '#0f172a',
                      marginBottom: '12px',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <AutoAwesomeIcon sx={{ color: 'secondary.main', fontSize: '1.2rem' }} />{' '}
                    Schüler-Hilfekarte (wird gedruckt)
                  </Typography>
                  <Stack spacing={2.5} sx={{ mt: 1 }}>
                    <TextField
                      label="Hilfreicher Tipp"
                      value={data.schuelerFeedback.hilfreicherTipp}
                      onChange={(e) => handleFeedbackChange('hilfreicherTipp', e.target.value)}
                      fullWidth
                      multiline
                      rows={2}
                      variant="outlined"
                      size="small"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          borderRadius: '8px',
                          backgroundColor: '#faf5ff',
                        },
                        '& .MuiInputLabel-root': {
                          color: 'secondary.dark',
                        },
                      }}
                    />
                    <TextField
                      label="Übungs-Empfehlung"
                      value={data.schuelerFeedback.uebungsEmpfehlung}
                      onChange={(e) => handleFeedbackChange('uebungsEmpfehlung', e.target.value)}
                      fullWidth
                      multiline
                      rows={2}
                      variant="outlined"
                      size="small"
                      sx={{
                        '& .MuiOutlinedInput-root': {
                          borderRadius: '8px',
                          backgroundColor: '#f0fdf4',
                        },
                        '& .MuiInputLabel-root': {
                          color: 'success.main',
                        },
                      }}
                    />
                  </Stack>
                </CardContent>
              </Card>
            </Box>

            {/* Persistent Save status */}
            <Box
              sx={{
                padding: '16px 24px',
                borderTop: '1px solid #e2e8f0',
                background: '#ffffff',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  color:
                    saveStatus === 'saved'
                      ? 'success.main'
                      : saveStatus === 'saving'
                        ? 'warning.main'
                        : 'error.main',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontWeight: 600,
                  transition: 'color 0.3s ease',
                }}
              >
                <Box
                  component="span"
                  sx={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    backgroundColor:
                      saveStatus === 'saved'
                        ? 'success.main'
                        : saveStatus === 'saving'
                          ? 'warning.main'
                          : 'error.main',
                    display: 'inline-block',
                    transition: 'background-color 0.3s ease',
                    animation:
                      saveStatus === 'saving'
                        ? 'pulse 1.2s infinite ease-in-out'
                        : saveStatus === 'error'
                          ? 'blink 1s infinite ease-in-out'
                          : 'none',
                    '@keyframes pulse': {
                      '0%, 100%': { opacity: 0.5, transform: 'scale(0.8)' },
                      '50%': { opacity: 1, transform: 'scale(1.2)' },
                    },
                    '@keyframes blink': {
                      '0%, 100%': { opacity: 0.4 },
                      '50%': { opacity: 1 },
                    },
                  }}
                />
                {saveStatus === 'saved' && 'Änderungen automatisch gesichert'}
                {saveStatus === 'saving' && 'Änderungen werden gespeichert...'}
                {saveStatus === 'error' && 'Fehler beim Speichern – Verbindung prüfen'}
              </Typography>
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                {saveStatus === 'error' && (
                  <Button
                    onClick={() => {
                      saveToDatabase(data, true);
                    }}
                    variant="contained"
                    color="error"
                    size="small"
                    startIcon={<SaveIcon />}
                    sx={{
                      borderRadius: '8px',
                      padding: '8px 14px',
                      textTransform: 'none',
                      fontWeight: 700,
                    }}
                  >
                    Erneut speichern
                  </Button>
                )}

                {(() => {
                  const siblings = data.siblingSubmissions || [];
                  const currentIdx = siblings.findIndex((s) => s.id === String(id));
                  const nextSib =
                    currentIdx !== -1 && currentIdx < siblings.length - 1
                      ? siblings[currentIdx + 1]
                      : null;
                  if (nextSib) {
                    return (
                      <Button
                        variant="contained"
                        size="small"
                        onClick={() => router.push(`/correct/${nextSib.id}`)}
                        sx={{
                          borderRadius: '8px',
                          padding: '8px 16px',
                          textTransform: 'none',
                          fontWeight: 700,
                          backgroundColor: '#1b77d1',
                          '&:hover': {
                            backgroundColor: '#1565c0',
                          },
                        }}
                      >
                        Nächste/r ({nextSib.studentName}) →
                      </Button>
                    );
                  }
                  if (data.examId) {
                    return (
                      <Button
                        variant="outlined"
                        size="small"
                        onClick={() => router.push(`/exams/${data.examId}`)}
                        sx={{
                          borderRadius: '8px',
                          padding: '8px 16px',
                          textTransform: 'none',
                          fontWeight: 700,
                          borderColor: '#cbd5e1',
                          color: '#0f172a',
                        }}
                      >
                        Zur Prüfungsübersicht
                      </Button>
                    );
                  }
                  return null;
                })()}
              </Stack>
            </Box>
          </Box>
        </Box>
      </Box>

      {/* QR Re-Scan / Page Append Dialog */}
      <QrScannerDialog
        open={qrOpen}
        onClose={() => setQrOpen(false)}
        targetMode="APPEND_SUBMISSION"
        examId={data.examId}
        examTitle={data.examTitle}
        classId={data.classId || undefined}
        className={data.className}
        submissionId={String(id)}
        studentName={data.schuelerName}
        onRefreshSubmissions={loadSubmission}
      />

      {/* Toast Notification */}
      <Snackbar
        open={showSaveToast}
        autoHideDuration={3000}
        onClose={() => setShowSaveToast(false)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
      >
        <Alert
          onClose={() => setShowSaveToast(false)}
          severity="success"
          variant="filled"
          sx={{
            borderRadius: '10px',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.3), 0 0 15px rgba(16, 185, 129, 0.4)',
            fontWeight: 600,
          }}
        >
          Korrekturen erfolgreich gespeichert!
        </Alert>
      </Snackbar>

      {/* Dialog for adding missing tasks */}
      <Dialog
        open={openAddTask}
        onClose={(_e, reason) => {
          if (addTaskLoading || reason === 'backdropClick') return;
          setOpenAddTask(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <form onSubmit={handleAddTask}>
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
            Fehlende Aufgabe erfassen
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {addTaskError && <Alert severity="error">{addTaskError}</Alert>}
              <TextField
                label="Aufgaben-ID / Nummer"
                placeholder="z.B. 2"
                fullWidth
                variant="outlined"
                value={addTaskTaskId}
                onChange={(e) => setAddTaskTaskId(e.target.value)}
                required
                autoFocus
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
              />
              <TextField
                label="Aufgabenbezeichnung / Titel"
                placeholder="z.B. Aufgabe 2"
                fullWidth
                variant="outlined"
                value={addTaskTitle}
                onChange={(e) => setAddTaskTitle(e.target.value)}
                required
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
              />
              <TextField
                label="Maximale Punkte"
                type="number"
                fullWidth
                variant="outlined"
                value={addTaskMaxPoints}
                onChange={(e) => setAddTaskMaxPoints(Number(e.target.value))}
                required
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => setOpenAddTask(false)}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={addTaskLoading}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: '#1b77d1',
                borderRadius: '8px',
              }}
            >
              {addTaskLoading ? <CircularProgress size={20} /> : 'Aufgabe hinzufügen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* 2. Hidden HTML A4 Printable View (Rendered only on window.print()) */}
      <div className="print-only print-page" style={{ fontFamily: 'sans-serif' }}>
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
              GradeAi - Schüler-Feedbackbericht
            </h1>
            <p
              style={{
                fontSize: '11pt',
                color: '#475569',
                fontWeight: 'bold',
                margin: '6px 0 0 0',
              }}
            >
              Fach: {data.fach} | Klasse: {data.className || '—'}
            </p>
          </div>
          <div style={{ textAlign: 'right', fontSize: '10pt', color: '#334155' }}>
            <strong>Schüler: {data.schuelerName}</strong>
            <br />
            Datum: {data.datum}
            <br />
            Ergebnis:{' '}
            <strong style={{ color: '#0f172a' }}>
              {data.gesamterzieltePunkte.toFixed(1)} / {data.gesamtmaximalPunkte} Punkte
            </strong>{' '}
            (Note: <strong>{data.note}</strong>)
          </div>
        </div>

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
            {data.aufgaben.map((t) => (
              <tr key={t.aufgabeId} style={{ borderBottom: '1px solid #e2e8f0' }}>
                <td style={{ padding: '8px 12px' }}>{t.titel}</td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                  <strong>{t.erzieltePunkte.toFixed(1)}</strong>
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'center' }}>{t.maximalPunkte}</td>
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
                {data.gesamterzieltePunkte.toFixed(1)}
              </td>
              <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                {data.gesamtmaximalPunkte}
              </td>
              <td style={{ padding: '10px 12px' }}>Note: {data.note}</td>
            </tr>
          </tbody>
        </table>

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
        {data.aufgaben.map((t) => (
          <div key={t.aufgabeId} style={{ marginTop: '16px', pageBreakInside: 'avoid' }}>
            <h4 style={{ fontSize: '11pt', color: '#0f172a', margin: '0 0 4px 0' }}>{t.titel}</h4>
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
                style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '9.5pt', color: '#334155' }}
              >
                {data.schuelerFeedback.staerken.map((s, i) => (
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
                style={{ margin: '6px 0 0 16px', padding: 0, fontSize: '9.5pt', color: '#334155' }}
              >
                {data.schuelerFeedback.schwaechen.map((s, i) => (
                  <li key={i} style={{ marginBottom: '4px' }}>
                    {s}
                  </li>
                ))}
              </ul>
            </div>
          </div>

          <div style={{ marginTop: '16px', borderTop: '1px solid #cbd5e1', paddingTop: '12px' }}>
            <p style={{ fontSize: '10pt', lineHeight: 1.4, margin: '0 0 8px 0', color: '#0f172a' }}>
              💡 <strong>Lern-Tipp: </strong> {data.schuelerFeedback.hilfreicherTipp}
            </p>
            <p style={{ fontSize: '10pt', lineHeight: 1.4, margin: 0, color: '#0f172a' }}>
              📚 <strong>Deine Übungs-Empfehlung: </strong>{' '}
              {data.schuelerFeedback.uebungsEmpfehlung}
            </p>
          </div>
        </div>

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
          Viel Erfolg beim Lernen! Mit fleissigem Üben klappt es beim nächsten Mal noch besser.
        </div>
      </div>
    </Box>
  );
}
