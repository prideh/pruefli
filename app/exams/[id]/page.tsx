'use client';

import * as React from 'react';
import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Stack,
  CircularProgress,
  Alert,
  Divider,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Tooltip,
  Collapse,
  IconButton,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import AddIcon from '@mui/icons-material/Add';
import { getErrorMessage } from '@/lib/api-error';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import PrintIcon from '@mui/icons-material/Print';
import AssessmentIcon from '@mui/icons-material/Assessment';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import StarsIcon from '@mui/icons-material/Stars';
import SchoolIcon from '@mui/icons-material/School';
import PersonIcon from '@mui/icons-material/Person';
import AssignmentIcon from '@mui/icons-material/Assignment';
import SaveIcon from '@mui/icons-material/Save';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import QueryStatsIcon from '@mui/icons-material/QueryStats';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import LockIcon from '@mui/icons-material/Lock';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import type { ExamTaskAnalysis } from '@/lib/task-analysis';
import { BarChart } from '@mui/x-charts/BarChart';
import DashboardLayout from '@/components/DashboardLayout';
import ErrorState from '@/components/ErrorState';
import QrScannerDialog from '@/components/QrScannerDialog';
import PdfBatchSplitDialog from '@/components/PdfBatchSplitDialog';
import { isPdfFile, inspectPdfBytes, type PdfPageInfo } from '@/lib/pdf-batch';
import {
  useDataCache,
  invalidateExams,
  invalidateSubmissions,
  invalidateStudents,
} from '@/lib/dataCache';
import {
  GRADING_FORMULA_OPTIONS,
  GRADE_ROUNDING_OPTIONS,
  getSubjectSupportInfo,
  isSerializedDocumentPayload,
  parseSerializedDocumentPayload,
  type GradingFormula,
  type GradeRounding,
} from '@/lib/grading';

interface ExamData {
  id: string;
  title: string;
  classId: string;
  className: string;
  isClassArchived?: boolean;
  subject: string;
  maxPoints: number;
  rubricText?: string;
  examTemplateText?: string | null;
  gradingNotes?: string | null;
  rawGradingNotes?: string | null;
  isGenerated?: boolean;
  isApproved?: boolean;
  approvedAt?: string | null;
  generatorParams?: unknown;
  taskSources?: Record<string, string>;
  gradingFormula?: string;
  gradeRounding?: string;
  tasks?: {
    id: string;
    taskId: string;
    title: string;
    maxPoints: number;
    orderIndex?: number;
    sourceReference?: string | null;
  }[];
}

interface ExamStats {
  averageGrade: string;
  passRate: string;
  highestGrade: string;
  lowestGrade: string;
  stdDev: string;
  totalCompleted: number;
  totalStudents?: number;
  gradeDistribution: Record<string, number>;
}

interface ExamRosterStudent {
  studentId: string;
  studentName: string;
  status: 'COMPLETED' | 'DRAFT' | 'PROCESSING' | 'PENDING' | 'FAILED' | 'UNSTARTED';
  earnedPoints: number | string;
  grade: string;
  date: string;
  submissionId?: string | null;
  uncertainStepsCount?: number;
  errorMessage?: string | null;
  failedAttemptsCount?: number;
}

interface FailedExamSubmission {
  id: string;
  studentId?: string | null;
  studentName?: string | null;
  errorMessage: string;
  createdAt: string;
  isAssignedInRoster?: boolean;
}

interface ExamDetailsApiResponse {
  exam: ExamData;
  stats: ExamStats;
  roster: ExamRosterStudent[];
  failedSubmissions?: FailedExamSubmission[];
  taskAnalysis: ExamTaskAnalysis | null;
}

export default function ExamDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const examId = params.id as string;

  // Rubric & Template Editing
  const [rubricText, setRubricText] = useState('');
  const [templateText, setTemplateText] = useState('');
  const [gradingNotes, setGradingNotes] = useState('');
  const [gradingFormula, setGradingFormula] = useState<GradingFormula>('LINEAR_60');
  const [gradeRounding, setGradeRounding] = useState<GradeRounding>('0.1');
  const [editingRubric, setEditingRubric] = useState(false);
  const [activeArtifactTab, setActiveArtifactTab] = useState<'TEMPLATE' | 'RUBRIC'>('TEMPLATE');
  const [saveLoading, setSaveLoading] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');

  // Approval Gate State
  const [approving, setApproving] = useState(false);
  const [approveError, setApproveError] = useState('');

  // Single-Task Regenerate State
  const [regenDialogOpen, setRegenDialogOpen] = useState(false);
  const [regenTaskId, setRegenTaskId] = useState<string | null>(null);
  const [regenTaskTitle, setRegenTaskTitle] = useState('');
  const [regenInstructions, setRegenInstructions] = useState('');
  const [regenLoading, setRegenLoading] = useState(false);
  const [regenError, setRegenError] = useState('');

  const fetchExamDetailsApi = React.useCallback(async () => {
    const res = await fetch(`/api/exams/${examId}`);
    if (!res.ok) {
      if (res.status === 404) {
        router.replace('/exams');
        throw new Error('Prüfung nicht gefunden.');
      }
      throw new Error('Prüfungsdetails konnten nicht geladen werden.');
    }
    const data = await res.json();
    return data as ExamDetailsApiResponse;
  }, [examId, router]);

  const {
    data: cachedExamDetails,
    loading,
    error,
    revalidate: fetchData,
  } = useDataCache<ExamDetailsApiResponse>(
    examId ? `/api/exams/${examId}` : null,
    fetchExamDetailsApi,
    {
      onSuccess: (data) => {
        setRubricText((prev) => (editingRubric ? prev : data.exam.rubricText || ''));
        setTemplateText((prev) => (editingRubric ? prev : data.exam.examTemplateText || ''));
        setGradingNotes((prev) => (editingRubric ? prev : data.exam.gradingNotes || ''));
        setGradingFormula((prev) =>
          editingRubric ? prev : (data.exam.gradingFormula as GradingFormula) || 'LINEAR_60'
        );
        setGradeRounding((prev) =>
          editingRubric ? prev : (data.exam.gradeRounding as GradeRounding) || '0.1'
        );
      },
    }
  );

  const exam = cachedExamDetails?.exam || null;
  const isClassArchived = Boolean(exam?.isClassArchived);
  const stats = cachedExamDetails?.stats || null;
  const roster = cachedExamDetails?.roster || [];
  const failedSubmissions = cachedExamDetails?.failedSubmissions || [];
  const taskAnalysis = cachedExamDetails?.taskAnalysis || null;

  const [retryingSubmissionId, setRetryingSubmissionId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const handleRetryFailedSubmission = async (submissionId: string) => {
    if (!submissionId) return;
    setRetryingSubmissionId(submissionId);
    setRetryError(null);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/replace`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Korrektur konnte nicht erneut gestartet werden.');
        setRetryError(msg);
        return;
      }
      invalidateSubmissions(submissionId, examId, exam?.classId);
      invalidateExams(examId, exam?.classId);
      fetchData();
    } catch (err) {
      setRetryError(
        err instanceof Error ? err.message : 'Korrektur konnte nicht erneut gestartet werden.'
      );
    } finally {
      setRetryingSubmissionId(null);
    }
  };

  const [expandedTasks, setExpandedTasks] = useState<Record<string, boolean>>({});

  const toggleTaskExpand = (taskId: string) => {
    setExpandedTasks((prev) => ({
      ...prev,
      [taskId]: !prev[taskId],
    }));
  };

  // QR Scanner Dialog
  const [qrOpen, setQrOpen] = useState(false);
  const [qrTargetMode, setQrTargetMode] = useState<'SUBMISSION' | 'RUBRIC'>('SUBMISSION');
  const [qrStudent, setQrStudent] = useState<{ id: string; name: string } | null>(null);

  // Duplicate Exam State
  const [openDuplicate, setOpenDuplicate] = useState(false);
  const [duplicateTitle, setDuplicateTitle] = useState('');
  const [duplicateTargetClassId, setDuplicateTargetClassId] = useState('');
  const [allClasses, setAllClasses] = useState<{ id: string; name: string }[]>([]);
  const [duplicateLoading, setDuplicateLoading] = useState(false);
  const [duplicateError, setDuplicateError] = useState('');

  const handleOpenDuplicate = async () => {
    setDuplicateTitle(exam ? `${exam.title} (Kopie)` : '');
    setDuplicateTargetClassId(exam ? exam.classId : '');
    setDuplicateError('');
    setOpenDuplicate(true);

    if (allClasses.length === 0) {
      try {
        const res = await fetch('/api/classes');
        if (res.ok) {
          const data = await res.json();
          setAllClasses(data.classes || []);
        }
      } catch {
        // Fallback: ignore
      }
    }
  };

  const handleDuplicateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!duplicateTitle.trim()) {
      setDuplicateError('Bitte gib einen Titel für die duplizierte Prüfung an.');
      return;
    }

    setDuplicateLoading(true);
    setDuplicateError('');

    try {
      const res = await fetch(`/api/exams/${examId}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: duplicateTitle.trim(),
          targetClassId: duplicateTargetClassId || undefined,
        }),
      });

      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Prüfung konnte nicht dupliziert werden.');
        setDuplicateError(msg);
        return;
      }

      invalidateExams(undefined, duplicateTargetClassId || exam?.classId);
      const data = await res.json();
      setOpenDuplicate(false);
      const newExamId = data.id || data.exam?.id;
      if (newExamId) {
        router.push(`/exams/${newExamId}`);
      }
    } catch (err) {
      setDuplicateError(err instanceof Error ? err.message : 'Fehler beim Duplizieren.');
    } finally {
      setDuplicateLoading(false);
    }
  };

  const handleExportCsv = () => {
    if (!exam || roster.length === 0) return;
    const header = [
      'Schüler/in',
      'Status',
      'Erzielte Punkte',
      'Maximalpunkte',
      'Note',
      'Korrekturdatum',
      'KI-Unsichere Schritte',
    ];
    const rows = roster.map((r) => [
      `"${r.studentName.replace(/"/g, '""')}"`,
      r.status === 'COMPLETED'
        ? 'Abgeschlossen'
        : r.status === 'DRAFT'
          ? 'Entwurf'
          : r.status === 'FAILED'
            ? 'Fehlgeschlagen'
            : r.status === 'PROCESSING' || r.status === 'PENDING'
              ? 'In Verarbeitung'
              : 'Ungestartet',
      r.earnedPoints !== 'N/A' ? String(r.earnedPoints) : '',
      String(exam.maxPoints || ''),
      r.status === 'COMPLETED' ? String(r.grade) : '',
      r.date !== '—' ? r.date : '',
      String(r.uncertainStepsCount ?? 0),
    ]);
    const csvContent =
      '\uFEFF' + [header.join(';'), ...rows.map((row) => row.join(';'))].join('\r\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    const safeTitle = `${exam.className}_${exam.title}`.replace(/[^a-zA-Z0-9äöüÄÖÜ_-]/g, '_');
    link.download = `Notenliste_${safeTitle}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // Add Student Dialog State
  const [openAddStudent, setOpenAddStudent] = useState(false);
  const [addStudentName, setAddStudentName] = useState('');
  const [addStudentLoading, setAddStudentLoading] = useState(false);
  const [addStudentError, setAddStudentError] = useState('');

  // Batch / Multi-page PDF Upload State on Exam Detail Page
  const [examPdfSplitQueue, setExamPdfSplitQueue] = useState<
    Array<{ file: File; pages: PdfPageInfo[] }>
  >([]);
  const [batchUploading, setBatchUploading] = useState(false);
  const [batchUploadStep, setBatchUploadStep] = useState('');
  const [batchUploadMessage, setBatchUploadMessage] = useState<{
    type: 'success' | 'warning' | 'error';
    text: string;
  } | null>(null);

  const uploadExamBatchWorks = async (filesToUpload: File[]) => {
    if (!exam?.id || !exam?.classId || filesToUpload.length === 0) return;
    setBatchUploading(true);
    setBatchUploadMessage(null);

    let successCount = 0;
    const failedFiles: { fileName: string; error: string }[] = [];

    for (let idx = 0; idx < filesToUpload.length; idx++) {
      const f = filesToUpload[idx];
      setBatchUploadStep(`Lade Arbeit ${idx + 1} von ${filesToUpload.length} hoch...`);
      try {
        const formData = new FormData();
        formData.append('classId', exam.classId);
        formData.append('examId', exam.id);
        formData.append('studentExam', f);

        const res = await fetch('/api/correct', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Fehler beim Upload von ${f.name}`);
        }
        successCount++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Upload fehlgeschlagen';
        failedFiles.push({ fileName: f.name, error: msg });
      }
    }

    setBatchUploading(false);
    setBatchUploadStep('');

    if (successCount > 0) {
      invalidateSubmissions(undefined, exam.id, exam.classId);
      invalidateExams(exam.id, exam.classId);
      fetchData();
    }

    if (failedFiles.length === 0) {
      setBatchUploadMessage({
        type: 'success',
        text: `${successCount} ${successCount === 1 ? 'Arbeit' : 'Arbeiten'} erfolgreich zur Korrektur eingereicht. Namens-Vorschläge stehen auf dem Dashboard zur Bestätigung bereit.`,
      });
    } else if (successCount > 0) {
      setBatchUploadMessage({
        type: 'warning',
        text: `${successCount} von ${filesToUpload.length} Arbeiten hochgeladen. Fehler bei: ${failedFiles
          .map((item) => `${item.fileName} (${item.error})`)
          .join(', ')}`,
      });
    } else {
      setBatchUploadMessage({
        type: 'error',
        text: failedFiles[0]?.error || 'Upload fehlgeschlagen.',
      });
    }
  };

  const handleExamFilesSelected = async (incomingFiles: File[]) => {
    if (!incomingFiles || incomingFiles.length === 0) return;
    setBatchUploadMessage(null);

    const directFiles: File[] = [];
    const multiPageQueue: Array<{ file: File; pages: PdfPageInfo[] }> = [];

    for (const file of incomingFiles) {
      if (isPdfFile(file)) {
        try {
          const bytes = await file.arrayBuffer();
          const inspection = inspectPdfBytes(bytes);
          if (inspection.isPdf && inspection.pageCount > 1) {
            multiPageQueue.push({ file, pages: inspection.pages });
            continue;
          }
        } catch {
          // Fallback auf Einzeldatei
        }
      }
      directFiles.push(file);
    }

    if (directFiles.length > 0) {
      await uploadExamBatchWorks(directFiles);
    }

    if (multiPageQueue.length > 0) {
      setExamPdfSplitQueue((prev) => [...prev, ...multiPageQueue]);
    }
  };

  const handleAddStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = addStudentName.trim();
    if (!trimmed) {
      setAddStudentError('Bitte gib einen Schülernamen an.');
      return;
    }
    if (!exam?.classId) {
      setAddStudentError('Keine Klasse gefunden.');
      return;
    }

    setAddStudentLoading(true);
    setAddStudentError('');

    try {
      const res = await fetch(`/api/classes/${exam.classId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setAddStudentError(data.error || 'Schüler/in konnte nicht hinzugefügt werden.');
        return;
      }

      invalidateStudents(data.student?.id, exam.classId);
      invalidateExams(examId, exam.classId);
      await fetchData();
      setOpenAddStudent(false);
      setAddStudentName('');
    } catch (err) {
      setAddStudentError(
        err instanceof Error ? err.message : 'Schüler/in konnte nicht hinzugefügt werden.'
      );
    } finally {
      setAddStudentLoading(false);
    }
  };

  const handleRubricFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadedFileName(file.name);

      const reader = new FileReader();
      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (dataUrl) {
            const base64Data = dataUrl.split(',')[1];
            setRubricText(
              JSON.stringify({
                mimeType: file.type,
                data: base64Data,
                name: file.name,
              })
            );
          }
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (event) => {
          const text = event.target?.result as string;
          if (text) {
            setRubricText(text);
          }
        };
        reader.readAsText(file);
      }
    }
  };

  const handleResetRubric = () => {
    setRubricText('');
    setUploadedFileName('');
  };

  // Dialogs
  const [openDelete, setOpenDelete] = useState(false);
  const [deleteError, setDeleteError] = useState('');

  // SAVE updated rubric and template text
  const handleSaveRubric = async () => {
    setSaveLoading(true);
    setSaveError('');
    try {
      const res = await fetch(`/api/exams/${examId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricText,
          examTemplateText: templateText || undefined,
          gradingNotes: gradingNotes || null,
          gradingFormula,
          gradeRounding,
        }),
      });
      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Prüfung konnte nicht aktualisiert werden.');
        setSaveError(msg);
        return;
      }
      setEditingRubric(false);
      setUploadedFileName('');
      invalidateExams(examId, exam?.classId);
      await fetchData();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Fehler beim Speichern.');
    } finally {
      setSaveLoading(false);
    }
  };

  // EXPLICIT APPROVAL GATE: Teacher approves and freezes the exam
  const handleApproveExam = async () => {
    setApproving(true);
    setApproveError('');
    try {
      const res = await fetch(`/api/exams/${examId}/approve`, {
        method: 'POST',
      });
      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Freigabe fehlgeschlagen.');
        setApproveError(msg);
        return;
      }
      invalidateExams(examId, exam?.classId);
      await fetchData();
    } catch (err) {
      setApproveError(err instanceof Error ? err.message : 'Fehler bei der Freigabe.');
    } finally {
      setApproving(false);
    }
  };

  // SINGLE-TASK REGENERATE: Regenerate one task without losing other tasks or teacher edits
  const handleRegenerateTask = async () => {
    if (!regenTaskId) return;
    setRegenLoading(true);
    setRegenError('');
    try {
      const res = await fetch(`/api/exams/${examId}/regenerate-task`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          taskId: regenTaskId,
          instructions: regenInstructions.trim() || undefined,
        }),
      });
      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Aufgabe konnte nicht neu generiert werden.');
        setRegenError(msg);
        return;
      }
      setRegenDialogOpen(false);
      setRegenTaskId(null);
      setRegenInstructions('');
      invalidateExams(examId, exam?.classId);
      await fetchData();
    } catch (err) {
      setRegenError(err instanceof Error ? err.message : 'Fehler bei der Neu-Generierung.');
    } finally {
      setRegenLoading(false);
    }
  };

  // DELETE Exam
  const handleDeleteExam = async () => {
    setSaveLoading(true);
    setDeleteError('');
    try {
      const res = await fetch(`/api/exams/${examId}`, { method: 'DELETE' });
      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Prüfung konnte nicht gelöscht werden.');
        setDeleteError(msg);
        return;
      }
      invalidateExams(examId, exam?.classId);
      invalidateSubmissions(undefined, examId, exam?.classId);
      setOpenDelete(false);
      router.push('/exams');
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Fehler beim Löschen.');
    } finally {
      setSaveLoading(false);
    }
  };

  if (loading) {
    return (
      <DashboardLayout>
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
          <CircularProgress size={40} />
        </Box>
      </DashboardLayout>
    );
  }

  if (error) {
    return (
      <DashboardLayout>
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
          <Link href="/exams" passHref style={{ textDecoration: 'none' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', fontWeight: 650, color: 'text.secondary' }}
            >
              Zurück zur Prüfungsübersicht
            </Button>
          </Link>
          <ErrorState
            title="Fehler beim Laden der Prüfungsdetails"
            message={error}
            onRetry={() => {
              fetchData();
            }}
          />
        </Box>
      </DashboardLayout>
    );
  }

  // Pre-process grade distribution
  const distributionKeys = ['1.0-2.0', '2.0-3.0', '3.0-4.0', '4.0-5.0', '5.0-6.0'];
  const chartData = stats?.gradeDistribution
    ? distributionKeys.map((key) => stats.gradeDistribution[key] || 0)
    : [0, 0, 0, 0, 0];

  const formulaLabel =
    GRADING_FORMULA_OPTIONS.find((f) => f.value === (exam?.gradingFormula || 'LINEAR_60'))?.label ||
    'Linear (60% = 4.0)';
  const roundingLabel =
    GRADE_ROUNDING_OPTIONS.find((r) => r.value === (exam?.gradeRounding || '0.1'))?.label ||
    'Zehntelnoten (0.1)';

  const totalStudentsCount = stats?.totalStudents ?? roster.length;
  const completedCount = stats?.totalCompleted || 0;
  const ungradedCount = Math.max(0, totalStudentsCount - completedCount);

  return (
    <DashboardLayout>
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: '32px',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        {/* Navigation & Header */}
        <Stack spacing={2} sx={{ width: '100%', maxWidth: '100%', minWidth: 0 }}>
          <Link href="/exams" passHref style={{ textDecoration: 'none' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', fontWeight: 650, color: 'text.secondary' }}
            >
              Zurück zur Prüfungsübersicht
            </Button>
          </Link>

          <Box
            sx={{
              display: 'flex',
              flexDirection: { xs: 'column', md: 'row' },
              justifyContent: 'space-between',
              alignItems: { xs: 'stretch', md: 'center' },
              flexWrap: 'wrap',
              gap: 2,
              width: '100%',
              maxWidth: '100%',
              minWidth: 0,
            }}
          >
            <Box
              sx={{
                minWidth: 0,
                width: { xs: '100%', md: 'auto' },
                flex: { xs: '1 1 auto', md: '1 1 300px' },
                maxWidth: '100%',
              }}
            >
              <Typography
                variant="h4"
                sx={{
                  fontWeight: 800,
                  color: '#0f172a',
                  letterSpacing: '-0.02em',
                  mb: 0.5,
                  wordBreak: 'break-word',
                  overflowWrap: 'anywhere',
                }}
              >
                {exam?.title}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                Klasse:{' '}
                <Link
                  href={`/classes/${exam?.classId}`}
                  style={{ color: '#1b77d1', fontWeight: 700, textDecoration: 'none' }}
                >
                  {exam?.className}
                </Link>{' '}
                • Fach: {exam?.subject} ({getSubjectSupportInfo(exam?.subject).supportBadge}) • Max.
                Punkte: {exam?.maxPoints} P. • Formel: {formulaLabel} • Rundung: {roundingLabel}
              </Typography>
            </Box>

            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1.5}
              useFlexGap
              sx={{
                width: { xs: '100%', sm: 'auto' },
                maxWidth: '100%',
                minWidth: 0,
                flexWrap: 'wrap',
                alignItems: { xs: 'stretch', sm: 'center' },
              }}
            >
              <Tooltip
                title={
                  exam?.isApproved === false
                    ? 'Erst nach der ausdrücklichen Freigabe der Prüfung verfügbar.'
                    : 'Aufgabenblatt für Schülerinnen und Schüler drucken oder als PDF exportieren'
                }
              >
                <Box
                  component="span"
                  sx={{
                    display: { xs: 'block', sm: 'inline-flex' },
                    width: { xs: '100%', sm: 'auto' },
                    maxWidth: '100%',
                    minWidth: 0,
                  }}
                >
                  <Link
                    href={`/exams/${examId}/print-task-sheet`}
                    passHref
                    style={{
                      textDecoration: 'none',
                      display: 'flex',
                      width: '100%',
                      maxWidth: '100%',
                      pointerEvents: exam?.isApproved === false ? 'none' : 'auto',
                    }}
                  >
                    <Button
                      variant="contained"
                      startIcon={<PrintIcon />}
                      disabled={exam?.isApproved === false}
                      sx={{
                        width: { xs: '100%', sm: 'auto' },
                        maxWidth: '100%',
                        minWidth: 0,
                        boxSizing: 'border-box',
                        borderRadius: '8px',
                        textTransform: 'none',
                        fontWeight: 700,
                        backgroundColor: '#0f172a',
                        '&:hover': { backgroundColor: '#1e293b' },
                      }}
                    >
                      Aufgabenblatt drucken (PDF)
                    </Button>
                  </Link>
                </Box>
              </Tooltip>

              <Tooltip
                title={
                  completedCount === 0
                    ? 'Noch keine bewerteten Arbeiten vorhanden (mindestens eine abgeschlossene Korrektur erforderlich)'
                    : ungradedCount > 0
                      ? `${ungradedCount} von ${totalStudentsCount} noch nicht bewertet – nicht enthalten (${ungradedCount} of ${totalStudentsCount} not yet graded - not included)`
                      : 'Feedback-Blätter für die gesamte Klasse drucken'
                }
              >
                <Box
                  component="span"
                  sx={{
                    display: { xs: 'block', sm: 'inline-flex' },
                    width: { xs: '100%', sm: 'auto' },
                    maxWidth: '100%',
                    minWidth: 0,
                  }}
                >
                  <Link
                    href={`/exams/${examId}/print`}
                    passHref
                    style={{
                      textDecoration: 'none',
                      display: 'flex',
                      width: '100%',
                      maxWidth: '100%',
                      pointerEvents: completedCount === 0 ? 'none' : 'auto',
                    }}
                  >
                    <Button
                      variant="outlined"
                      startIcon={<PrintIcon />}
                      disabled={completedCount === 0}
                      sx={{
                        width: { xs: '100%', sm: 'auto' },
                        maxWidth: '100%',
                        minWidth: 0,
                        boxSizing: 'border-box',
                        borderRadius: '8px',
                        textTransform: 'none',
                        fontWeight: 700,
                        borderColor: '#cbd5e1',
                        color: '#0f172a',
                        '&:hover': { backgroundColor: '#f8fafc', borderColor: '#94a3b8' },
                      }}
                    >
                      Feedback für alle drucken
                    </Button>
                  </Link>
                </Box>
              </Tooltip>
              <Button
                variant="outlined"
                startIcon={<ContentCopyIcon />}
                onClick={handleOpenDuplicate}
                sx={{
                  width: { xs: '100%', sm: 'auto' },
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 650,
                  color: '#1b77d1',
                  borderColor: '#cbd5e1',
                  '&:hover': {
                    borderColor: '#1b77d1',
                    backgroundColor: 'rgba(27, 119, 209, 0.04)',
                  },
                }}
              >
                Prüfung duplizieren
              </Button>
              <Button
                variant="outlined"
                startIcon={
                  batchUploading ? (
                    <CircularProgress size={16} color="inherit" />
                  ) : (
                    <CloudUploadIcon />
                  )
                }
                disabled={exam?.isApproved === false || isClassArchived || batchUploading}
                onClick={() => {
                  const input = document.createElement('input');
                  input.type = 'file';
                  input.multiple = true;
                  input.accept = 'application/pdf,image/*';
                  input.onchange = (e: Event) => {
                    const target = e.target as HTMLInputElement;
                    if (target.files) {
                      void handleExamFilesSelected(Array.from(target.files));
                    }
                  };
                  input.click();
                }}
                sx={{
                  width: { xs: '100%', sm: 'auto' },
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 700,
                  color: '#1b77d1',
                  borderColor: '#1b77d1',
                }}
              >
                {batchUploading
                  ? batchUploadStep || 'Lädt hoch...'
                  : 'Klassensatz / Arbeiten hochladen'}
              </Button>
              <Button
                variant="contained"
                startIcon={<QrCodeScannerIcon />}
                disabled={exam?.isApproved === false || isClassArchived}
                onClick={() => {
                  setQrTargetMode('SUBMISSION');
                  setQrStudent(null);
                  setQrOpen(true);
                }}
                sx={{
                  width: { xs: '100%', sm: 'auto' },
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#1b77d1',
                }}
              >
                Mit Smartphone scannen (QR)
              </Button>
              <Button
                variant="outlined"
                color="error"
                startIcon={<DeleteIcon />}
                disabled={isClassArchived}
                onClick={() => {
                  setDeleteError('');
                  setOpenDelete(true);
                }}
                sx={{
                  width: { xs: '100%', sm: 'auto' },
                  maxWidth: '100%',
                  minWidth: 0,
                  boxSizing: 'border-box',
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 650,
                }}
              >
                Prüfung löschen
              </Button>
            </Stack>
            {ungradedCount > 0 && completedCount > 0 && (
              <Typography
                variant="caption"
                sx={{
                  color: 'text.secondary',
                  fontWeight: 600,
                  display: 'block',
                  mt: 0.5,
                  textAlign: { xs: 'left', sm: 'right' },
                  width: '100%',
                }}
              >
                {ungradedCount} von {totalStudentsCount} noch nicht bewertet – nicht enthalten (
                {ungradedCount} of {totalStudentsCount} not yet graded - not included)
              </Typography>
            )}
          </Box>
        </Stack>

        {batchUploadMessage && (
          <Alert
            severity={batchUploadMessage.type}
            onClose={() => setBatchUploadMessage(null)}
            sx={{ borderRadius: '12px' }}
          >
            {batchUploadMessage.text}
          </Alert>
        )}

        {isClassArchived && (
          <Alert
            severity="info"
            icon={<LockIcon sx={{ color: '#0369a1' }} />}
            sx={{
              borderRadius: '12px',
              border: '1px solid #bae6fd',
              backgroundColor: '#f0f9ff',
              color: '#0c4a6e',
            }}
          >
            <strong>Archivierte Klasse (Lesemodus):</strong> Die zugehörige Klasse ist archiviert.
            Alle Ergebnisse, Aufgabenanalysen und KI-Rückmeldungen sind vollständig einsehbar und
            exportierbar. Zum Bearbeiten oder für neue Korrekturen kann die Klasse in der
            Klassenverwaltung wiederhergestellt werden.
          </Alert>
        )}

        {/* REVIEW & APPROVAL GATE BANNER */}
        {exam?.isGenerated && exam?.isApproved === false && (
          <Alert
            severity="warning"
            icon={<LockIcon sx={{ fontSize: '1.5rem', color: '#d97706' }} />}
            sx={{
              borderRadius: '12px',
              border: '1px solid #fcd34d',
              backgroundColor: '#fffbeb',
              p: 2.5,
              '& .MuiAlert-message': { width: '100%' },
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              sx={{
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', md: 'center' },
              }}
            >
              <Box>
                <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#92400e', mb: 0.5 }}>
                  KI-Entwurf: Freigabe erforderlich
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: '#78350f', maxWidth: '850px', lineHeight: 1.6 }}
                >
                  Diese Prüfung wurde aus Unterrichtsmaterial generiert. Als Lehrperson trägst du
                  die pädagogische Verantwortung: Überprüfe die Aufgabenstellungen, Punkte und die
                  Musterlösung. Du kannst einzelne Aufgaben isoliert neu generieren oder anpassen.
                  Erst nach deiner ausdrücklichen Freigabe wird die Prüfung eingefroren und für den
                  Druck sowie für Schülerkorrekturen freigeschaltet.
                </Typography>
                {approveError && (
                  <Typography
                    variant="caption"
                    sx={{ color: '#b91c1c', fontWeight: 700, mt: 1, display: 'block' }}
                  >
                    {approveError}
                  </Typography>
                )}
              </Box>

              <Button
                variant="contained"
                startIcon={
                  approving ? <CircularProgress size={16} color="inherit" /> : <CheckCircleIcon />
                }
                disabled={approving || isClassArchived}
                onClick={handleApproveExam}
                sx={{
                  whiteSpace: 'nowrap',
                  fontWeight: 800,
                  textTransform: 'none',
                  borderRadius: '8px',
                  backgroundColor: '#d97706',
                  color: '#ffffff',
                  px: 3,
                  py: 1.25,
                  boxShadow: '0 4px 12px rgba(217, 119, 6, 0.3)',
                  '&:hover': { backgroundColor: '#b45309' },
                }}
              >
                {approving ? 'Freigabe läuft...' : 'Prüfung freigeben & einfrieren'}
              </Button>
            </Stack>
          </Alert>
        )}

        {exam?.isApproved && exam?.isGenerated && (
          <Alert
            severity="success"
            icon={<CheckCircleIcon sx={{ color: '#16a34a' }} />}
            sx={{
              borderRadius: '12px',
              border: '1px solid #bbf7d0',
              backgroundColor: '#f0fdf4',
              py: 1.5,
              px: 2,
            }}
          >
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1,
              }}
            >
              <Box>
                <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#166534' }}>
                  Freigegeben & Eingefroren
                </Typography>
                <Typography variant="caption" sx={{ color: '#15803d' }}>
                  Aufgabenblatt, Musterlösung und Punkteschema sind finalisiert und unveränderlich.
                  Korrekturen laufen verbindlich gegen diese Version.{' '}
                  {exam.approvedAt &&
                    `(Freigegeben am ${new Date(exam.approvedAt).toLocaleDateString('de-CH')})`}
                </Typography>
              </Box>
              <Chip
                icon={<LockIcon sx={{ fontSize: '0.85rem !important' }} />}
                label="Unveränderlich"
                size="small"
                sx={{ backgroundColor: '#dcfce7', color: '#15803d', fontWeight: 700, height: 24 }}
              />
            </Stack>
          </Alert>
        )}

        {/* 1. Statistical Aggregates Grid */}
        <Grid container spacing={3}>
          {/* Card 1: Class Average */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#e0f2fe',
                    color: '#1b77d1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <TrendingUpIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Klassenschnitt (Ø)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {stats?.averageGrade}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 2: Pass Rate */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#dcfce7',
                    color: '#16a34a',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <StarsIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Bestehensquote
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {stats?.passRate}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 3: Best / Worst */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#fff7ed',
                    color: '#ea580c',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <AssessmentIcon />
                </Box>
                <Box sx={{ flex: 1 }}>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', fontWeight: 600, display: 'block' }}
                  >
                    Spannweite (Max - Min)
                  </Typography>
                  <Typography variant="body2" sx={{ fontWeight: 750, color: '#1e293b' }}>
                    Beste: {stats?.highestGrade} | Tiefste: {stats?.lowestGrade}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 4: Grading Progress (Korrigiert X / Y) */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: 2.5, display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box
                  sx={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#f3e8ff',
                    color: '#9333ea',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <SchoolIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Korrektur-Fortschritt
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {roster.filter((r) => r.status === 'COMPLETED').length} / {roster.length}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* 2. Histogram Chart & Rubric Panel */}
        <Grid container spacing={4} sx={{ minWidth: 0, maxWidth: '100%' }}>
          {/* Histogram Chart */}
          <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
            <Card
              sx={{
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: 'none',
                height: '100%',
                minWidth: 0,
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              <CardContent sx={{ p: 3, minWidth: 0 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', mb: 2 }}>
                  Notenverteilung der Prüfung
                </Typography>
                {stats?.totalCompleted === 0 ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'text.secondary',
                      fontStyle: 'italic',
                      py: 6,
                      textAlign: 'center',
                    }}
                  >
                    Bisher wurden keine Arbeiten für diese Prüfung korrigiert.
                  </Typography>
                ) : (
                  <Box
                    sx={{
                      display: 'flex',
                      justifyContent: 'center',
                      width: '100%',
                      maxWidth: '100%',
                      overflowX: 'auto',
                    }}
                  >
                    <BarChart
                      xAxis={[
                        {
                          scaleType: 'band',
                          data: ['1.0-2.0', '2.0-3.0', '3.0-4.0', '4.0-5.0', '5.0-6.0'],
                        },
                      ]}
                      series={[{ data: chartData, label: 'Korrekturen', color: '#1b77d1' }]}
                      width={480}
                      height={260}
                      margin={{ top: 20, bottom: 30, left: 30, right: 10 }}
                    />
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          {/* Rubric config block */}
          <Grid size={{ xs: 12, md: 6 }} sx={{ minWidth: 0 }}>
            <Card
              sx={{
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: 'none',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                minWidth: 0,
                maxWidth: '100%',
                overflow: 'hidden',
              }}
            >
              <CardContent sx={{ p: 3, flexGrow: 1, display: 'flex', flexDirection: 'column' }}>
                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1.5,
                    mb: 2,
                  }}
                >
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    <Button
                      size="small"
                      variant={activeArtifactTab === 'TEMPLATE' ? 'contained' : 'outlined'}
                      onClick={() => setActiveArtifactTab('TEMPLATE')}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        borderRadius: '6px',
                        backgroundColor: activeArtifactTab === 'TEMPLATE' ? '#0f172a' : undefined,
                        color: activeArtifactTab === 'TEMPLATE' ? '#ffffff' : 'text.primary',
                        borderColor: '#cbd5e1',
                      }}
                    >
                      Aufgabenblatt (Schüler)
                    </Button>
                    <Button
                      size="small"
                      variant={activeArtifactTab === 'RUBRIC' ? 'contained' : 'outlined'}
                      onClick={() => setActiveArtifactTab('RUBRIC')}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        borderRadius: '6px',
                        backgroundColor: activeArtifactTab === 'RUBRIC' ? '#0f172a' : undefined,
                        color: activeArtifactTab === 'RUBRIC' ? '#ffffff' : 'text.primary',
                        borderColor: '#cbd5e1',
                      }}
                    >
                      Musterlösung & Kriterien
                    </Button>
                  </Stack>

                  {!editingRubric ? (
                    exam?.isGenerated && exam?.isApproved ? (
                      <Chip
                        icon={<LockIcon sx={{ fontSize: '0.85rem !important' }} />}
                        label="Eingefroren"
                        size="small"
                        sx={{ fontWeight: 700, backgroundColor: '#f1f5f9' }}
                      />
                    ) : isClassArchived ? (
                      <Chip
                        icon={<LockIcon sx={{ fontSize: '0.85rem !important' }} />}
                        label="Archiviert (Lesemodus)"
                        size="small"
                        sx={{ fontWeight: 700, backgroundColor: '#f1f5f9' }}
                      />
                    ) : (
                      <Button
                        size="small"
                        startIcon={<EditIcon />}
                        onClick={() => {
                          setRubricText(exam?.rubricText || '');
                          setTemplateText(exam?.examTemplateText || '');
                          setGradingNotes(exam?.gradingNotes || '');
                          setGradingFormula(
                            (exam?.gradingFormula as GradingFormula) || 'LINEAR_60'
                          );
                          setGradeRounding((exam?.gradeRounding as GradeRounding) || '0.1');
                          setEditingRubric(true);
                        }}
                      >
                        Bearbeiten
                      </Button>
                    )
                  ) : (
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() => {
                          setEditingRubric(false);
                          setUploadedFileName('');
                          setRubricText(exam?.rubricText || '');
                          setTemplateText(exam?.examTemplateText || '');
                          setGradingNotes(exam?.gradingNotes || '');
                          setGradingFormula(
                            (exam?.gradingFormula as GradingFormula) || 'LINEAR_60'
                          );
                          setGradeRounding((exam?.gradeRounding as GradeRounding) || '0.1');
                        }}
                      >
                        Abbrechen
                      </Button>
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SaveIcon />}
                        onClick={handleSaveRubric}
                        disabled={saveLoading}
                      >
                        Speichern
                      </Button>
                    </Stack>
                  )}
                </Box>

                <Divider sx={{ mb: 2 }} />

                {editingRubric ? (
                  <Stack spacing={2} sx={{ flexGrow: 1 }}>
                    {saveError && <Alert severity="error">{saveError}</Alert>}
                    <Grid container spacing={1.5}>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel id="edit-formula-label">Notenformel (CH)</InputLabel>
                          <Select
                            labelId="edit-formula-label"
                            value={gradingFormula}
                            label="Notenformel (CH)"
                            onChange={(e) => setGradingFormula(e.target.value as GradingFormula)}
                            sx={{ borderRadius: '8px' }}
                          >
                            {GRADING_FORMULA_OPTIONS.map((opt) => (
                              <MenuItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                      <Grid size={{ xs: 12, sm: 6 }}>
                        <FormControl fullWidth size="small">
                          <InputLabel id="edit-rounding-label">Notenrundung</InputLabel>
                          <Select
                            labelId="edit-rounding-label"
                            value={gradeRounding}
                            label="Notenrundung"
                            onChange={(e) => setGradeRounding(e.target.value as GradeRounding)}
                            sx={{ borderRadius: '8px' }}
                          >
                            {GRADE_ROUNDING_OPTIONS.map((opt) => (
                              <MenuItem key={opt.value} value={opt.value}>
                                {opt.label}
                              </MenuItem>
                            ))}
                          </Select>
                        </FormControl>
                      </Grid>
                    </Grid>

                    {activeArtifactTab === 'TEMPLATE' ? (
                      <TextField
                        label="Aufgabenblatt für Schülerinnen und Schüler (Markdown)"
                        placeholder="Aufgabenblatt mit Aufgabenstellungen hier bearbeiten..."
                        multiline
                        rows={8}
                        fullWidth
                        variant="outlined"
                        value={templateText}
                        onChange={(e) => setTemplateText(e.target.value)}
                        sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' }, flexGrow: 1 }}
                      />
                    ) : (
                      <>
                        {uploadedFileName || isSerializedDocumentPayload(rubricText) ? (
                          <Box
                            sx={{
                              border: '1px solid #cbd5e1',
                              padding: '12px 16px',
                              borderRadius: '8px',
                              display: 'flex',
                              justifyContent: 'space-between',
                              alignItems: 'center',
                              backgroundColor: '#f8fafc',
                            }}
                          >
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <StarsIcon sx={{ color: 'primary.main' }} />
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 600, color: 'text.primary' }}
                              >
                                {uploadedFileName || 'Bild-Musterlösung geladen'}
                              </Typography>
                            </Stack>
                            <Button size="small" color="error" onClick={handleResetRubric}>
                              Zurücksetzen
                            </Button>
                          </Box>
                        ) : (
                          <Stack spacing={1.5} sx={{ flexGrow: 1 }}>
                            <TextField
                              label="Musterlösung (Stufe 2)"
                              multiline
                              rows={5}
                              fullWidth
                              variant="outlined"
                              value={rubricText}
                              onChange={(e) => setRubricText(e.target.value)}
                              sx={{
                                '& .MuiOutlinedInput-root': { borderRadius: '8px' },
                                flexGrow: 1,
                              }}
                            />
                            <Stack
                              direction="row"
                              spacing={1.5}
                              sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                            >
                              <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary', fontWeight: 600 }}
                              >
                                Oder lade eine Datei hoch / fotografiere sie:
                              </Typography>
                              <input
                                type="file"
                                accept="application/pdf,text/plain,image/*"
                                id="editRubricFile"
                                onChange={handleRubricFileChange}
                                style={{ display: 'none' }}
                              />
                              <Button
                                component="label"
                                htmlFor="editRubricFile"
                                variant="outlined"
                                size="small"
                                sx={{
                                  color: 'text.primary',
                                  borderColor: '#cbd5e1',
                                  fontWeight: 650,
                                  textTransform: 'none',
                                }}
                              >
                                Datei auswählen
                              </Button>
                              <Button
                                variant="outlined"
                                size="small"
                                startIcon={<QrCodeScannerIcon />}
                                onClick={() => {
                                  setQrTargetMode('RUBRIC');
                                  setQrStudent(null);
                                  setQrOpen(true);
                                }}
                                sx={{
                                  color: '#1b77d1',
                                  borderColor: '#1b77d1',
                                  fontWeight: 700,
                                  textTransform: 'none',
                                }}
                              >
                                Per Smartphone scannen (QR)
                              </Button>
                            </Stack>
                          </Stack>
                        )}
                      </>
                    )}

                    <TextField
                      label="Zusätzliche Bewertungshinweise & Kontext (Stufe 3, optional)"
                      placeholder="z.B. Teilpunkte für richtige Formel ohne Einheiten vergeben..."
                      helperText="Stufe 3 der KI-Korrektur: Individuelle Bewertungsregeln der Lehrperson (nach Stufe 1: Handschrifterkennung und Stufe 2: Folgefehlerprüfung), z.B. für Teilpunkte oder alternative Lösungswege."
                      multiline
                      rows={2}
                      fullWidth
                      size="small"
                      variant="outlined"
                      value={gradingNotes}
                      onChange={(e) => setGradingNotes(e.target.value)}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Stack>
                ) : activeArtifactTab === 'TEMPLATE' ? (
                  <Box
                    sx={{
                      p: 2.5,
                      borderRadius: '8px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      flexGrow: 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1.5,
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 700, color: 'text.secondary' }}
                      >
                        Druckreifes Aufgabenblatt für Schülerinnen und Schüler
                      </Typography>
                      {exam?.isApproved !== false && (
                        <Link
                          href={`/exams/${examId}/print-task-sheet`}
                          passHref
                          style={{ textDecoration: 'none' }}
                        >
                          <Button
                            size="small"
                            variant="outlined"
                            startIcon={<PrintIcon />}
                            sx={{ textTransform: 'none', borderRadius: '6px', fontWeight: 700 }}
                          >
                            Druckansicht öffnen
                          </Button>
                        </Link>
                      )}
                    </Box>
                    <Box
                      sx={{
                        p: 2,
                        borderRadius: '6px',
                        backgroundColor: '#ffffff',
                        border: '1px solid #e2e8f0',
                        fontFamily: 'inherit',
                        fontSize: '0.88rem',
                        whiteSpace: 'pre-wrap',
                        color: '#1e293b',
                        maxHeight: '360px',
                        overflowY: 'auto',
                      }}
                    >
                      {exam?.examTemplateText || 'Kein Aufgabenblatt hinterlegt.'}
                    </Box>
                  </Box>
                ) : (
                  <Box
                    sx={{
                      p: 2.5,
                      borderRadius: '8px',
                      backgroundColor: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      fontFamily: isSerializedDocumentPayload(exam?.rubricText)
                        ? 'inherit'
                        : 'monospace',
                      fontSize: '0.85rem',
                      whiteSpace: isSerializedDocumentPayload(exam?.rubricText)
                        ? 'normal'
                        : 'pre-wrap',
                      color: '#334155',
                      flexGrow: 1,
                      overflowY: exam?.rubricText?.includes('"application/pdf"')
                        ? 'hidden'
                        : 'auto',
                      maxHeight: exam?.rubricText?.includes('"application/pdf"')
                        ? '500px'
                        : '220px',
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    {(() => {
                      const parsedDoc = parseSerializedDocumentPayload(exam?.rubricText);
                      if (parsedDoc?.kind === 'single') {
                        const parsed = parsedDoc.page;
                        if (parsed.mimeType === 'application/pdf') {
                          return (
                            <Stack spacing={2} sx={{ width: '100%' }}>
                              <Stack
                                direction="row"
                                sx={{ justifyContent: 'space-between', alignItems: 'center' }}
                              >
                                <Stack
                                  direction="row"
                                  spacing={1.5}
                                  sx={{ alignItems: 'center', p: 0.5 }}
                                >
                                  <StarsIcon sx={{ color: 'primary.main', fontSize: '1.5rem' }} />
                                  <Box>
                                    <Typography
                                      variant="subtitle2"
                                      sx={{ fontWeight: 700, color: 'text.primary' }}
                                    >
                                      PDF-Musterlösung hinterlegt
                                    </Typography>
                                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                      Die KI liest dieses Dokument zur Korrektur.
                                    </Typography>
                                  </Box>
                                </Stack>
                                <Button
                                  size="small"
                                  variant="outlined"
                                  onClick={() => {
                                    const newTab = window.open();
                                    if (newTab) {
                                      newTab.document.write(
                                        `<title>PDF Musterlösung</title><body style="margin:0"><iframe width="100%" height="100%" style="border:none" src="data:application/pdf;base64,${parsed.data}"></iframe></body>`
                                      );
                                    }
                                  }}
                                  sx={{ textTransform: 'none', borderRadius: '6px' }}
                                >
                                  In neuem Tab öffnen
                                </Button>
                              </Stack>
                              <Box
                                sx={{
                                  border: '1px solid #cbd5e1',
                                  borderRadius: '8px',
                                  overflow: 'hidden',
                                  height: '350px',
                                  backgroundColor: '#f8fafc',
                                }}
                              >
                                <iframe
                                  src={`data:${parsed.mimeType};base64,${parsed.data}`}
                                  title="PDF Musterlösung Vorschau"
                                  width="100%"
                                  height="100%"
                                  style={{ border: 'none' }}
                                />
                              </Box>
                            </Stack>
                          );
                        }
                        return (
                          <Box
                            sx={{
                              maxWidth: '100%',
                              maxHeight: '180px',
                              display: 'flex',
                              justifySelf: 'center',
                              justifyContent: 'center',
                            }}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={`data:${parsed.mimeType};base64,${parsed.data}`}
                              alt="Musterlösung"
                              style={{
                                maxWidth: '100%',
                                maxHeight: '180px',
                                objectFit: 'contain',
                                borderRadius: '4px',
                              }}
                            />
                          </Box>
                        );
                      }
                      if (parsedDoc?.kind === 'multi') {
                        const pages = parsedDoc.pages;
                        return (
                          <Stack spacing={1.5}>
                            <Typography
                              variant="caption"
                              sx={{ fontWeight: 700, color: '#0f172a' }}
                            >
                              Mehrseitige Bild-Musterlösung ({pages.length} Seiten)
                            </Typography>
                            <Stack direction="row" spacing={1.5} sx={{ overflowX: 'auto', pb: 1 }}>
                              {pages.map((p, idx) => (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img
                                  key={idx}
                                  src={`data:${p.mimeType};base64,${p.data}`}
                                  alt={`Musterlösung Seite ${idx + 1}`}
                                  style={{
                                    height: '160px',
                                    objectFit: 'contain',
                                    borderRadius: '6px',
                                    border: '1px solid #cbd5e1',
                                  }}
                                />
                              ))}
                            </Stack>
                          </Stack>
                        );
                      }
                      return exam?.rubricText || 'Keine Musterlösung hinterlegt.';
                    })()}
                    {exam?.gradingNotes && (
                      <Box
                        sx={{
                          mt: 2,
                          pt: 1.5,
                          borderTop: '1px dashed #cbd5e1',
                          fontFamily: 'inherit',
                          fontSize: '0.8rem',
                          color: '#475569',
                        }}
                      >
                        <Typography
                          variant="caption"
                          sx={{ fontWeight: 700, color: '#0f172a', display: 'block', mb: 0.5 }}
                        >
                          Zusätzliche Bewertungshinweise (Stufe 3: Individueller Korrekturkontext):
                        </Typography>
                        {exam.gradingNotes}
                      </Box>
                    )}
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* 2a. Prüfungsaufgaben & Bepunktung (mit Quellenbezug und Einzelaufgabe-Regenerierung) */}
        {exam?.tasks && exam.tasks.length > 0 && (
          <Card
            sx={{
              borderRadius: '12px',
              border: '1px solid #e2e8f0',
              boxShadow: 'none',
              minWidth: 0,
              maxWidth: '100%',
              overflow: 'hidden',
            }}
          >
            <CardContent sx={{ p: 3, minWidth: 0 }}>
              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 1.5,
                  mb: 2,
                }}
              >
                <Box>
                  <Typography variant="h6" sx={{ fontWeight: 850, color: '#0f172a' }}>
                    Prüfungsaufgaben &amp; Bepunktung
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {exam?.isGenerated
                      ? 'Aus Unterrichtsmaterial generierte Aufgaben mit nachvollziehbarem Quellenbezug.'
                      : 'Hinterlegte Aufgabenstellungen und Punkteverteilung.'}
                  </Typography>
                </Box>
                <Chip
                  label={`${exam.tasks.length} Aufgaben • ${exam.maxPoints} Punkte`}
                  sx={{ fontWeight: 700, backgroundColor: '#f1f5f9' }}
                />
              </Stack>

              <TableContainer
                component={Box}
                sx={{
                  border: '1px solid #f1f5f9',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  maxWidth: '100%',
                }}
              >
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold', width: '60px' }}>Nr.</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Aufgabenstellung / Titel</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', width: '130px' }}>Max. Punkte</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', minWidth: '180px' }}>
                        Quellenbezug
                      </TableCell>
                      <TableCell sx={{ fontWeight: 'bold', width: '180px', textAlign: 'right' }}>
                        Aktion
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {exam.tasks.map((task, idx) => (
                      <TableRow key={task.id || task.taskId || idx} hover>
                        <TableCell sx={{ fontWeight: 700, color: 'text.secondary' }}>
                          {task.orderIndex !== undefined ? task.orderIndex + 1 : idx + 1}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 600, color: '#0f172a' }}>
                          {task.title}
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>{task.maxPoints} Pkt.</TableCell>
                        <TableCell>
                          {task.sourceReference ? (
                            <Chip
                              label={task.sourceReference}
                              size="small"
                              variant="outlined"
                              sx={{
                                fontWeight: 650,
                                fontSize: '0.75rem',
                                borderColor: '#cbd5e1',
                                backgroundColor: '#f8fafc',
                                color: '#334155',
                              }}
                            />
                          ) : (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              —
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          {exam.isGenerated && !exam.isApproved && !isClassArchived ? (
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={
                                <AutoAwesomeIcon sx={{ fontSize: '0.95rem !important' }} />
                              }
                              onClick={() => {
                                setRegenTaskId(task.taskId || task.id);
                                setRegenTaskTitle(task.title);
                                setRegenInstructions('');
                                setRegenError('');
                                setRegenDialogOpen(true);
                              }}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                borderRadius: '6px',
                                fontSize: '0.78rem',
                                borderColor: '#cbd5e1',
                                color: '#0f172a',
                                '&:hover': {
                                  borderColor: '#0f172a',
                                  backgroundColor: '#f8fafc',
                                },
                              }}
                            >
                              Neu generieren
                            </Button>
                          ) : exam.isGenerated && exam.isApproved ? (
                            <Chip
                              icon={<LockIcon sx={{ fontSize: '0.75rem !important' }} />}
                              label="Eingefroren"
                              size="small"
                              sx={{
                                fontWeight: 700,
                                fontSize: '0.72rem',
                                height: 22,
                                backgroundColor: '#f1f5f9',
                                color: '#64748b',
                              }}
                            />
                          ) : (
                            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                              —
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>
        )}

        {/* 2b. Aufgabenanalyse */}
        <Card
          sx={{
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            boxShadow: 'none',
            minWidth: 0,
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <CardContent sx={{ p: 3, minWidth: 0 }}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: 1.5,
                mb: 2,
              }}
            >
              <Box>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 0.5 }}>
                  <QueryStatsIcon sx={{ color: '#0f172a' }} />
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 850, color: '#0f172a', letterSpacing: '-0.01em' }}
                  >
                    Aufgabenanalyse
                  </Typography>
                </Stack>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Ergebnisse und Fehlerschwerpunkte pro Aufgabe zur gezielten Nachbesprechung im
                  Unterricht.
                </Typography>
              </Box>

              {taskAnalysis && (
                <Box sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    {`Basis: ${taskAnalysis.completedSubmissionsCount} von ${taskAnalysis.totalSubmissions} korrigierten Arbeiten`}
                    {taskAnalysis.unmatchedCompletedCount > 0 && (
                      <span style={{ fontWeight: 500, color: '#64748b' }}>
                        {` (davon ${taskAnalysis.unmatchedCompletedCount} nicht zugeordnete Arbeiten)`}
                      </span>
                    )}
                  </Typography>
                  {taskAnalysis.excludedSubmissionsCount > 0 ? (
                    <Typography variant="caption" sx={{ color: '#d97706', display: 'block' }}>
                      {`Ausgeschlossen (noch nicht abgeschlossen): ${taskAnalysis.excludedSubmissionsCount} Arbeiten `}
                      {`(${taskAnalysis.excludedBreakdown.pending} ausstehend, ${taskAnalysis.excludedBreakdown.processing} in Verarbeitung, ${taskAnalysis.excludedBreakdown.failed} fehlgeschlagen)`}
                    </Typography>
                  ) : (
                    <Typography
                      variant="caption"
                      sx={{ color: 'text.secondary', display: 'block' }}
                    >
                      Alle eingereichten Arbeiten sind abgeschlossen.
                    </Typography>
                  )}
                </Box>
              )}
            </Stack>

            <Typography
              variant="caption"
              sx={{ color: 'text.secondary', display: 'block', mb: 2.5, fontStyle: 'italic' }}
            >
              Hinweis: Alle Werte spiegeln den aktuellen Speicherstand (KI-Korrektur einschliesslich
              manueller Lehrpersonen-Anpassungen) wider.
            </Typography>

            {/* Empty State when no completed submissions */}
            {!taskAnalysis || taskAnalysis.completedSubmissionsCount === 0 ? (
              <Alert severity="info" sx={{ borderRadius: '8px' }}>
                Bisher liegen keine abgeschlossenen Korrekturen für diese Prüfung vor. Die
                Aufgabenanalyse steht zur Verfügung, sobald mindestens eine Arbeit den Status
                &bdquo;Abgeschlossen&ldquo; erreicht hat.
                {taskAnalysis && taskAnalysis.totalSubmissions > 0 && (
                  <span>
                    {' '}
                    Aktuell befinden sich {taskAnalysis.totalSubmissions} Arbeiten in der
                    Warteschlange oder Verarbeitung.
                  </span>
                )}
              </Alert>
            ) : taskAnalysis.tasks.length === 0 ? (
              <Alert severity="info" sx={{ borderRadius: '8px' }}>
                Keine Aufgaben für diese Prüfung hinterlegt.
              </Alert>
            ) : (
              <TableContainer
                component={Box}
                sx={{
                  border: '1px solid #f1f5f9',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  maxWidth: '100%',
                }}
              >
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ width: 48 }} />
                      <TableCell sx={{ fontWeight: 'bold' }}>Aufgabe</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Bewertete Arbeiten</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Punkte-Schnitt</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Erfolgsquote</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Status-Verteilung</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', textAlign: 'right' }}>
                        Teilschritte
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {taskAnalysis.tasks.map((task) => {
                      const isExpanded = Boolean(expandedTasks[task.id]);

                      return (
                        <React.Fragment key={task.id}>
                          <TableRow
                            hover
                            sx={{
                              '& > *': { borderBottom: isExpanded ? 'unset' : undefined },
                              cursor: task.hasSteps ? 'pointer' : 'default',
                              backgroundColor: isExpanded ? '#f8fafc' : 'inherit',
                            }}
                            onClick={() => {
                              if (task.hasSteps) toggleTaskExpand(task.id);
                            }}
                          >
                            <TableCell>
                              {task.hasSteps ? (
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTaskExpand(task.id);
                                  }}
                                  aria-label={
                                    isExpanded ? 'Details schliessen' : 'Details aufklappen'
                                  }
                                >
                                  {isExpanded ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                                </IconButton>
                              ) : null}
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>
                              <Stack spacing={0.5}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                                >
                                  <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 700, color: '#0f172a' }}
                                  >
                                    {task.title}
                                  </Typography>
                                  {task.hasMaxPointsDeviation && (
                                    <Tooltip title="In mindestens einer korrigierten Arbeit weichen die Maximalpunkte von der Aufgabenvorlage ab.">
                                      <Chip
                                        label="Abweichende Maximalpunkte"
                                        size="small"
                                        color="warning"
                                        variant="outlined"
                                        sx={{ fontWeight: 650, fontSize: '0.72rem', height: 20 }}
                                      />
                                    </Tooltip>
                                  )}
                                  {task.uncertainStepsCount > 0 && (
                                    <Chip
                                      label={`⚠ KI unsicher (${task.uncertainStepsCount})`}
                                      size="small"
                                      sx={{
                                        backgroundColor: '#fef3c7',
                                        color: '#b45309',
                                        border: '1px solid #f59e0b',
                                        fontWeight: 700,
                                        fontSize: '0.72rem',
                                        height: 20,
                                      }}
                                    />
                                  )}
                                </Stack>
                              </Stack>
                            </TableCell>
                            <TableCell>
                              <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                {`${task.gradedCount} / ${taskAnalysis.completedSubmissionsCount}`}
                              </Typography>
                              {task.ungradedCount > 0 && (
                                <Typography
                                  variant="caption"
                                  sx={{ color: 'text.secondary', display: 'block' }}
                                >
                                  {`Nicht bewertet: ${task.ungradedCount}`}
                                </Typography>
                              )}
                            </TableCell>
                            <TableCell sx={{ fontWeight: 600 }}>
                              {task.avgPoints !== null
                                ? `${task.avgPoints.toFixed(1)} / ${task.canonicalMaxPoints} Pkt.`
                                : '—'}
                            </TableCell>
                            <TableCell>
                              {task.isZeroMaxPoints ? (
                                <Tooltip title="Da die Aufgabe mit 0 Maximalpunkten definiert ist, kann keine Prozentquote berechnet werden.">
                                  <Typography
                                    variant="caption"
                                    sx={{ color: 'text.secondary', fontStyle: 'italic' }}
                                  >
                                    0 Max. Punkte
                                  </Typography>
                                </Tooltip>
                              ) : task.avgPercent !== null ? (
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                  <Chip
                                    label={`${task.avgPercent.toFixed(1)}%`}
                                    size="small"
                                    sx={{
                                      backgroundColor:
                                        task.avgPercent >= 75
                                          ? '#dcfce7'
                                          : task.avgPercent >= 50
                                            ? '#fef9c3'
                                            : '#fee2e2',
                                      color:
                                        task.avgPercent >= 75
                                          ? '#15803d'
                                          : task.avgPercent >= 50
                                            ? '#a16207'
                                            : '#b91c1c',
                                      fontWeight: 700,
                                    }}
                                  />
                                </Stack>
                              ) : (
                                '—'
                              )}
                            </TableCell>
                            <TableCell>
                              <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap' }}>
                                <Tooltip title="Korrekt gelöst">
                                  <Chip
                                    label={`Korrekt: ${task.statusDistribution.korrekt}`}
                                    size="small"
                                    sx={{
                                      backgroundColor: '#f0fdf4',
                                      color: '#166534',
                                      border: '1px solid #bbf7d0',
                                      fontWeight: 650,
                                      fontSize: '0.72rem',
                                      height: 20,
                                    }}
                                  />
                                </Tooltip>
                                <Tooltip title="Folgefehler">
                                  <Chip
                                    label={`Folgefehler: ${task.statusDistribution.folgefehler}`}
                                    size="small"
                                    sx={{
                                      backgroundColor: '#fffbeb',
                                      color: '#92400e',
                                      border: '1px solid #fde68a',
                                      fontWeight: 650,
                                      fontSize: '0.72rem',
                                      height: 20,
                                    }}
                                  />
                                </Tooltip>
                                <Tooltip title="Fehler">
                                  <Chip
                                    label={`Fehler: ${task.statusDistribution.fehler}`}
                                    size="small"
                                    sx={{
                                      backgroundColor: '#fef2f2',
                                      color: '#991b1b',
                                      border: '1px solid #fecaca',
                                      fontWeight: 650,
                                      fontSize: '0.72rem',
                                      height: 20,
                                    }}
                                  />
                                </Tooltip>
                              </Stack>
                            </TableCell>
                            <TableCell sx={{ textAlign: 'right' }}>
                              {task.hasSteps ? (
                                <Button
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    toggleTaskExpand(task.id);
                                  }}
                                  sx={{ textTransform: 'none', fontWeight: 650 }}
                                >
                                  {isExpanded ? 'Schliessen' : `${task.steps.length} Schritte`}
                                </Button>
                              ) : (
                                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                  Keine Teilschritte
                                </Typography>
                              )}
                            </TableCell>
                          </TableRow>

                          {/* Collapsible Step Details */}
                          {task.hasSteps && (
                            <TableRow sx={{ backgroundColor: '#f8fafc' }}>
                              <TableCell style={{ paddingBottom: 0, paddingTop: 0 }} colSpan={7}>
                                <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                                  <Box sx={{ py: 2, px: 1 }}>
                                    {task.hasVaryingStepStructure && (
                                      <Alert severity="warning" sx={{ mb: 2, borderRadius: '8px' }}>
                                        Hinweis: Unterschiedliche Teilschritt-Struktur zwischen den
                                        Arbeiten erkannt (Schrittanzahl oder -indizes variieren).
                                        Die Gruppierung dient als Orientierungshilfe.
                                      </Alert>
                                    )}

                                    <Typography
                                      variant="subtitle2"
                                      sx={{ fontWeight: 800, color: '#0f172a', mb: 1.5 }}
                                    >
                                      Teilschritt-Analyse &amp; Fehlerschwerpunkte ({task.title})
                                    </Typography>

                                    <TableContainer
                                      component={Box}
                                      sx={{
                                        backgroundColor: '#ffffff',
                                        border: '1px solid #e2e8f0',
                                        borderRadius: '8px',
                                        overflowX: 'auto',
                                        maxWidth: '100%',
                                      }}
                                    >
                                      <Table size="small">
                                        <TableHead sx={{ backgroundColor: '#f1f5f9' }}>
                                          <TableRow>
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                              Schritt
                                            </TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                              Bezeichnung / Beschreibung
                                            </TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                              Erfasste Arbeiten
                                            </TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                              Punkte-Schnitt
                                            </TableCell>
                                            <TableCell sx={{ fontWeight: 'bold' }}>
                                              Fehler-Verteilung
                                            </TableCell>
                                            <TableCell
                                              sx={{ fontWeight: 'bold', textAlign: 'right' }}
                                            >
                                              KI-Unsicherheit
                                            </TableCell>
                                          </TableRow>
                                        </TableHead>
                                        <TableBody>
                                          {task.steps.map((st) => (
                                            <TableRow key={st.schrittIndex}>
                                              <TableCell sx={{ fontWeight: 700 }}>
                                                {`Schritt ${st.schrittIndex + 1}`}
                                              </TableCell>
                                              <TableCell sx={{ maxWidth: 320 }}>
                                                <Typography
                                                  variant="body2"
                                                  sx={{ color: '#0f172a' }}
                                                >
                                                  {st.schrittText}
                                                </Typography>
                                              </TableCell>
                                              <TableCell>{`${st.count} Arbeiten`}</TableCell>
                                              <TableCell sx={{ fontWeight: 600 }}>
                                                {`${st.avgErreichtePunkte.toFixed(1)} / ${st.avgMaximalPunkte.toFixed(1)} Pkt.`}
                                              </TableCell>
                                              <TableCell>
                                                <Stack
                                                  direction="row"
                                                  spacing={0.5}
                                                  sx={{ flexWrap: 'wrap' }}
                                                >
                                                  {st.errorCounts.KeinFehler > 0 && (
                                                    <Chip
                                                      label={`Kein Fehler: ${st.errorCounts.KeinFehler}`}
                                                      size="small"
                                                      sx={{
                                                        backgroundColor: '#f0fdf4',
                                                        color: '#166534',
                                                        fontSize: '0.72rem',
                                                        height: 20,
                                                      }}
                                                    />
                                                  )}
                                                  {st.errorCounts.Rechenfehler > 0 && (
                                                    <Chip
                                                      label={`Rechenfehler: ${st.errorCounts.Rechenfehler}`}
                                                      size="small"
                                                      sx={{
                                                        backgroundColor: '#fef2f2',
                                                        color: '#991b1b',
                                                        fontSize: '0.72rem',
                                                        height: 20,
                                                      }}
                                                    />
                                                  )}
                                                  {st.errorCounts.Folgefehler > 0 && (
                                                    <Chip
                                                      label={`Folgefehler: ${st.errorCounts.Folgefehler}`}
                                                      size="small"
                                                      sx={{
                                                        backgroundColor: '#fffbeb',
                                                        color: '#92400e',
                                                        fontSize: '0.72rem',
                                                        height: 20,
                                                      }}
                                                    />
                                                  )}
                                                  {st.errorCounts.SonstigerFehler > 0 && (
                                                    <Chip
                                                      label={`Sonstiger Fehler: ${st.errorCounts.SonstigerFehler}`}
                                                      size="small"
                                                      sx={{
                                                        backgroundColor: '#f1f5f9',
                                                        color: '#475569',
                                                        fontSize: '0.72rem',
                                                        height: 20,
                                                      }}
                                                    />
                                                  )}
                                                </Stack>
                                              </TableCell>
                                              <TableCell sx={{ textAlign: 'right' }}>
                                                {st.uncertainCount > 0 ? (
                                                  <Chip
                                                    label={`⚠ ${st.uncertainCount} unsicher`}
                                                    size="small"
                                                    sx={{
                                                      backgroundColor: '#fef3c7',
                                                      color: '#b45309',
                                                      border: '1px solid #f59e0b',
                                                      fontWeight: 700,
                                                      fontSize: '0.72rem',
                                                      height: 20,
                                                    }}
                                                  />
                                                ) : (
                                                  <Typography
                                                    variant="caption"
                                                    sx={{ color: 'text.secondary' }}
                                                  >
                                                    —
                                                  </Typography>
                                                )}
                                              </TableCell>
                                            </TableRow>
                                          ))}
                                        </TableBody>
                                      </Table>
                                    </TableContainer>
                                  </Box>
                                </Collapse>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* 3. Class Roster Submissions Tracker */}
        <Card
          sx={{
            borderRadius: '12px',
            border: '1px solid #e2e8f0',
            boxShadow: 'none',
            minWidth: 0,
            maxWidth: '100%',
            overflow: 'hidden',
          }}
        >
          <CardContent sx={{ p: 3, minWidth: 0 }}>
            <Stack
              direction="row"
              sx={{
                justifyContent: 'space-between',
                alignItems: 'center',
                flexWrap: 'wrap',
                gap: 1.5,
                mb: 2.5,
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <AssignmentIcon sx={{ color: '#0f172a' }} />
                <Typography
                  variant="h6"
                  sx={{ fontWeight: 850, color: '#0f172a', letterSpacing: '-0.01em' }}
                >
                  Korrektur-Status (Klassenliste)
                </Typography>
              </Stack>
              <Button
                variant="outlined"
                size="small"
                onClick={handleExportCsv}
                disabled={roster.length === 0}
                sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
              >
                Notenliste exportieren (CSV)
              </Button>
            </Stack>

            {retryError && (
              <Alert
                severity="error"
                onClose={() => setRetryError(null)}
                sx={{ mb: 2, borderRadius: '8px' }}
              >
                {retryError}
              </Alert>
            )}

            {failedSubmissions.some((f) => !f.isAssignedInRoster) && (
              <Alert
                severity="error"
                sx={{
                  mb: 2.5,
                  borderRadius: '8px',
                  '& .MuiAlert-message': { width: '100%' },
                }}
              >
                <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1 }}>
                  Fehlgeschlagene Korrekturen (noch nicht eindeutig zugeordnet)
                </Typography>
                <Stack spacing={1.5}>
                  {failedSubmissions
                    .filter((f) => !f.isAssignedInRoster)
                    .map((failedSub) => (
                      <Stack
                        key={failedSub.id}
                        direction={{ xs: 'column', sm: 'row' }}
                        spacing={1.5}
                        sx={{
                          justifyContent: 'space-between',
                          alignItems: { xs: 'flex-start', sm: 'center' },
                          p: 1.25,
                          borderRadius: '6px',
                          backgroundColor: 'rgba(255, 255, 255, 0.7)',
                          border: '1px solid #fecaca',
                        }}
                      >
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: '#991b1b' }}>
                            {failedSub.studentName || 'Nicht zugeordnete Arbeit'} (
                            {failedSub.createdAt})
                          </Typography>
                          <Typography variant="caption" sx={{ color: '#b91c1c', display: 'block' }}>
                            Fehlergrund: {failedSub.errorMessage}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ flexShrink: 0, flexWrap: 'wrap' }}>
                          <Button
                            variant="contained"
                            color="error"
                            size="small"
                            disabled={isClassArchived || retryingSubmissionId === failedSub.id}
                            onClick={() => void handleRetryFailedSubmission(failedSub.id)}
                            sx={{ textTransform: 'none', fontWeight: 700 }}
                          >
                            {retryingSubmissionId === failedSub.id
                              ? 'Startet neu...'
                              : 'Erneut versuchen'}
                          </Button>
                          <Link
                            href={`/correct/${failedSub.id}`}
                            passHref
                            style={{ textDecoration: 'none' }}
                          >
                            <Button
                              variant="outlined"
                              color="error"
                              size="small"
                              sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                              Fehlerdetails
                            </Button>
                          </Link>
                        </Stack>
                      </Stack>
                    ))}
                </Stack>
              </Alert>
            )}

            {roster.length === 0 ? (
              <Box
                sx={{
                  py: 6,
                  px: 3,
                  textAlign: 'center',
                  border: '2px dashed #cbd5e1',
                  borderRadius: '12px',
                  backgroundColor: '#f8fafc',
                }}
              >
                <PersonIcon sx={{ fontSize: '3rem', color: '#94a3b8', mb: 1.5 }} />
                <Typography variant="subtitle1" sx={{ fontWeight: 700, color: '#334155', mb: 0.5 }}>
                  Keine Schüler/innen für diese Prüfung gefunden
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', maxWidth: '440px', mx: 'auto', mb: 2.5 }}
                >
                  {exam?.className
                    ? `In der Klasse "${exam.className}" sind noch keine Schüler/innen erfasst.`
                    : 'In dieser Klasse sind noch keine Schüler/innen erfasst.'}{' '}
                  Füge Schüler/innen hinzu, um Abgaben zuzuordnen und Noten zu berechnen.
                </Typography>
                <Stack
                  direction="row"
                  spacing={1.5}
                  sx={{ justifyContent: 'center', flexWrap: 'wrap' }}
                >
                  {exam?.classId && (
                    <>
                      <Button
                        variant="contained"
                        size="small"
                        startIcon={<AddIcon />}
                        disabled={isClassArchived}
                        onClick={() => {
                          setAddStudentError('');
                          setAddStudentName('');
                          setOpenAddStudent(true);
                        }}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          borderRadius: '8px',
                          backgroundColor: '#1b77d1',
                          '&:hover': { backgroundColor: '#1565c0' },
                        }}
                      >
                        Schüler/in hinzufügen
                      </Button>
                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<SchoolIcon />}
                        component={Link}
                        href={`/classes/${exam.classId}`}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          borderRadius: '8px',
                          color: '#334155',
                          borderColor: '#cbd5e1',
                        }}
                      >
                        Klassenverwaltung öffnen
                      </Button>
                    </>
                  )}
                </Stack>
              </Box>
            ) : (
              <TableContainer
                component={Box}
                sx={{
                  border: '1px solid #f1f5f9',
                  borderRadius: '8px',
                  overflowX: 'auto',
                  maxWidth: '100%',
                }}
              >
                <Table>
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Schüler/in</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Punkte</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Note</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Korrekturdatum</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', textAlign: 'right' }}>
                        Korrektur-Aktion
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {roster.map((student) => {
                      let statusLabel = 'Ungestartet';
                      let statusColor: 'default' | 'success' | 'warning' | 'error' | 'info' =
                        'default';
                      if (student.status === 'COMPLETED') {
                        statusLabel = 'Abgeschlossen';
                        statusColor = 'success';
                      } else if (student.status === 'DRAFT') {
                        statusLabel = 'Entwurf';
                        statusColor = 'warning';
                      } else if (student.status === 'FAILED') {
                        statusLabel =
                          (student.failedAttemptsCount ?? 0) > 1
                            ? `Fehlgeschlagen (${student.failedAttemptsCount}×) – erneut versuchen`
                            : 'Fehlgeschlagen – erneut versuchen';
                        statusColor = 'error';
                      } else if (student.status === 'PROCESSING' || student.status === 'PENDING') {
                        statusLabel = 'In Verarbeitung';
                        statusColor = 'info';
                      }

                      return (
                        <TableRow
                          key={student.studentId}
                          sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                          <TableCell sx={{ fontWeight: 600 }}>
                            <Link
                              href={`/students/${student.studentId}`}
                              style={{ textDecoration: 'none', color: '#1b77d1', fontWeight: 700 }}
                            >
                              {student.studentName}
                            </Link>
                          </TableCell>
                          <TableCell>
                            <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
                              <Chip
                                label={statusLabel}
                                size="small"
                                color={statusColor}
                                variant={statusColor === 'default' ? 'outlined' : 'filled'}
                                sx={{ fontWeight: 'bold' }}
                              />
                              {student.status === 'FAILED' && student.errorMessage && (
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: '#b91c1c',
                                    fontWeight: 600,
                                    display: 'block',
                                    maxWidth: '340px',
                                    lineHeight: 1.35,
                                  }}
                                >
                                  Fehlergrund: {student.errorMessage}
                                </Typography>
                              )}
                            </Stack>
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>
                            {student.earnedPoints !== 'N/A'
                              ? `${student.earnedPoints} / ${exam?.maxPoints}`
                              : '—'}
                          </TableCell>
                          <TableCell>
                            {student.status === 'COMPLETED' ? (
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <Chip
                                  label={student.grade}
                                  size="small"
                                  sx={{
                                    backgroundColor:
                                      parseFloat(student.grade) >= 4.0 ? '#1b77d1' : '#dc2626',
                                    color: '#ffffff',
                                    fontWeight: 'bold',
                                    borderRadius: '6px',
                                  }}
                                />
                                {(student.uncertainStepsCount ?? 0) > 0 && (
                                  <Chip
                                    label={`⚠ KI unsicher (${student.uncertainStepsCount})`}
                                    size="small"
                                    sx={{
                                      backgroundColor: '#fef3c7',
                                      color: '#b45309',
                                      border: '1px solid #f59e0b',
                                      fontWeight: 700,
                                      borderRadius: '6px',
                                    }}
                                  />
                                )}
                              </Stack>
                            ) : (
                              '—'
                            )}
                          </TableCell>
                          <TableCell>{student.date}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>
                            {student.status === 'FAILED' && student.submissionId ? (
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ justifyContent: 'flex-end', flexWrap: 'wrap', gap: 1 }}
                              >
                                <Button
                                  variant="contained"
                                  color="error"
                                  size="small"
                                  disabled={
                                    isClassArchived || retryingSubmissionId === student.submissionId
                                  }
                                  onClick={() => {
                                    if (student.submissionId) {
                                      void handleRetryFailedSubmission(student.submissionId);
                                    }
                                  }}
                                  sx={{ textTransform: 'none', fontWeight: 700 }}
                                >
                                  {retryingSubmissionId === student.submissionId
                                    ? 'Startet neu...'
                                    : 'Erneut versuchen'}
                                </Button>
                                <Link
                                  href={`/correct/${student.submissionId}`}
                                  passHref
                                  style={{ textDecoration: 'none' }}
                                >
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    sx={{ textTransform: 'none', fontWeight: 600 }}
                                  >
                                    Fehlerdetails
                                  </Button>
                                </Link>
                              </Stack>
                            ) : student.status !== 'UNSTARTED' ? (
                              <Link
                                href={`/correct/${student.submissionId}`}
                                passHref
                                style={{ textDecoration: 'none' }}
                              >
                                <Button
                                  variant="outlined"
                                  size="small"
                                  sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                  {isClassArchived ? 'Korrektur ansehen' : 'Korrektur bearbeiten'}
                                </Button>
                              </Link>
                            ) : (
                              <Button
                                variant="contained"
                                color="success"
                                size="small"
                                startIcon={<PlayArrowIcon />}
                                disabled={exam?.isApproved === false || isClassArchived}
                                onClick={() => {
                                  setQrTargetMode('SUBMISSION');
                                  setQrStudent({
                                    id: student.studentId,
                                    name: student.studentName,
                                  });
                                  setQrOpen(true);
                                }}
                                sx={{ textTransform: 'none', fontWeight: 700 }}
                              >
                                Arbeit einscannen (QR / Datei)
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* Single-Task Regenerate Dialog */}
        <Dialog
          open={regenDialogOpen}
          onClose={(_e, reason) => {
            if (regenLoading || reason === 'backdropClick') return;
            setRegenDialogOpen(false);
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
            Aufgabe neu generieren
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {regenError && <Alert severity="error">{regenError}</Alert>}
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Die Aufgabe <strong>{regenTaskTitle}</strong> wird basierend auf dem hinterlegten
                Unterrichtsmaterial neu generiert. Alle anderen Aufgaben sowie deine bisherigen
                Anpassungen bleiben unverändert erhalten.
              </Typography>
              <TextField
                label="Spezifische Anweisungen (optional)"
                placeholder="z.B. Mehr Fokus auf Textverständnis legen, Schwierigkeitsgrad erhöhen, etc."
                multiline
                rows={3}
                fullWidth
                value={regenInstructions}
                onChange={(e) => setRegenInstructions(e.target.value)}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => setRegenDialogOpen(false)}
              disabled={regenLoading}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleRegenerateTask}
              variant="contained"
              disabled={regenLoading}
              startIcon={
                regenLoading ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />
              }
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: '#0f172a',
                '&:hover': { backgroundColor: '#1e293b' },
                borderRadius: '8px',
              }}
            >
              {regenLoading ? 'Generierung läuft...' : 'Aufgabe neu generieren'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Duplicate Exam Dialog */}
        <Dialog
          open={openDuplicate}
          onClose={(_e, reason) => {
            if (duplicateLoading || reason === 'backdropClick') return;
            setOpenDuplicate(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <form onSubmit={handleDuplicateExam}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
              Prüfung duplizieren
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {duplicateError && <Alert severity="error">{duplicateError}</Alert>}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Erstellt eine Kopie aller Aufgaben, des Erwartungshorizonts und der
                  Bewertungseinstellungen. Schülerabgaben werden nicht übernommen.
                </Typography>
                <TextField
                  label="Neuer Prüfungstitel"
                  fullWidth
                  variant="outlined"
                  value={duplicateTitle}
                  onChange={(e) => setDuplicateTitle(e.target.value)}
                  autoFocus
                  required
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />
                {allClasses.length > 0 ? (
                  <FormControl fullWidth>
                    <InputLabel id="duplicate-class-label">Zielklasse</InputLabel>
                    <Select
                      labelId="duplicate-class-label"
                      value={duplicateTargetClassId}
                      label="Zielklasse"
                      onChange={(e) => setDuplicateTargetClassId(e.target.value)}
                      sx={{ borderRadius: '8px' }}
                    >
                      {allClasses.map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.name} {c.id === exam?.classId && '(Aktuelle Klasse)'}
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                ) : (
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Die Prüfung wird in der aktuellen Klasse dupliziert.
                  </Typography>
                )}
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, pt: 0 }}>
              <Button
                onClick={() => setOpenDuplicate(false)}
                disabled={duplicateLoading}
                sx={{ textTransform: 'none', fontWeight: 650 }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={duplicateLoading || !duplicateTitle.trim()}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#1b77d1',
                  borderRadius: '8px',
                }}
              >
                {duplicateLoading ? <CircularProgress size={20} /> : 'Duplizieren'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>

        {/* Delete Exam Dialog Confirmation */}
        <Dialog
          open={openDelete}
          onClose={(_e, reason) => {
            if (saveLoading || reason === 'backdropClick') return;
            setOpenDelete(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>Prüfung löschen?</DialogTitle>
          <DialogContent>
            {deleteError && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>
                {deleteError}
              </Alert>
            )}
            <Typography variant="body2" sx={{ color: 'text.primary', mb: 1 }}>
              Möchtest du die Prüfung <strong>{exam?.title}</strong> wirklich löschen?
            </Typography>
            <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
              Dabei werden all ihre bereits durchgeführten Korrekturen und KI-Rückmeldungen
              unwiderruflich entfernt!
            </Typography>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => setOpenDelete(false)}
              disabled={saveLoading}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleDeleteExam}
              variant="contained"
              color="error"
              disabled={saveLoading}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
            >
              {saveLoading ? <CircularProgress size={20} /> : 'Dauerhaft löschen'}
            </Button>
          </DialogActions>
        </Dialog>

        <QrScannerDialog
          open={qrOpen}
          onClose={() => setQrOpen(false)}
          targetMode={qrTargetMode}
          classId={exam?.classId}
          className={exam?.className}
          examId={exam?.id}
          examTitle={exam?.title}
          studentId={qrStudent?.id || null}
          studentName={qrStudent?.name || null}
          onRefreshSubmissions={fetchData}
          onDocumentScanned={(payload, pageCount) => {
            setUploadedFileName(
              `Smartphone-Musterlösung (${pageCount} ${pageCount === 1 ? 'Seite' : 'Seiten'})`
            );
            setRubricText(payload);
            fetchData();
          }}
        />

        <PdfBatchSplitDialog
          open={examPdfSplitQueue.length > 0}
          file={examPdfSplitQueue[0]?.file || null}
          pages={examPdfSplitQueue[0]?.pages || []}
          onCancel={() => {
            setExamPdfSplitQueue((prev) => prev.slice(1));
          }}
          onConfirmSplit={({ files }) => {
            setExamPdfSplitQueue((prev) => prev.slice(1));
            void uploadExamBatchWorks(files);
          }}
        />

        {/* Add Student Dialog */}
        <Dialog
          open={openAddStudent}
          onClose={(_e, reason) => {
            if (addStudentLoading || reason === 'backdropClick') return;
            setOpenAddStudent(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <form onSubmit={handleAddStudentSubmit}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
              Schüler/in hinzufügen
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {addStudentError && <Alert severity="error">{addStudentError}</Alert>}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Füge der Klasse <strong>{exam?.className}</strong> eine Schülerin oder einen
                  Schüler hinzu.
                </Typography>
                <TextField
                  label="Vor- und Nachname"
                  placeholder="z. B. Sophie Meier"
                  fullWidth
                  variant="outlined"
                  value={addStudentName}
                  onChange={(e) => setAddStudentName(e.target.value)}
                  autoFocus
                  required
                  disabled={addStudentLoading}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, pt: 0 }}>
              <Button
                onClick={() => setOpenAddStudent(false)}
                disabled={addStudentLoading}
                sx={{ textTransform: 'none', fontWeight: 650 }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={addStudentLoading || !addStudentName.trim()}
                startIcon={
                  addStudentLoading ? <CircularProgress size={16} color="inherit" /> : <AddIcon />
                }
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#1b77d1',
                  borderRadius: '8px',
                }}
              >
                {addStudentLoading ? 'Wird hinzugefügt...' : 'Hinzufügen'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Box>
    </DashboardLayout>
  );
}
