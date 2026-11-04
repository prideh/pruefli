'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  Stack,
  TextField,
  CircularProgress,
  Alert,
  MenuItem,
  Select,
  FormControl,
  InputLabel,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  IconButton,
  Tooltip,
  FormHelperText,
} from '@mui/material';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import DescriptionIcon from '@mui/icons-material/Description';
import SettingsIcon from '@mui/icons-material/Settings';
import CloseIcon from '@mui/icons-material/Close';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import FlashOnIcon from '@mui/icons-material/FlashOn';
import PersonIcon from '@mui/icons-material/Person';
import HistoryIcon from '@mui/icons-material/History';
import AddCircleIcon from '@mui/icons-material/AddCircle';
import GroupIcon from '@mui/icons-material/Group';
import AssignmentIcon from '@mui/icons-material/Assignment';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import ErrorIcon from '@mui/icons-material/Error';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { getErrorMessage } from '@/lib/api-error';
import { getDashboardJobTitle, isDuplicateSubmissionError } from '@/lib/job-title';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import DashboardLayout from '@/components/DashboardLayout';
import QrScannerDialog from '@/components/QrScannerDialog';
import PdfBatchSplitDialog from '@/components/PdfBatchSplitDialog';
import { isPdfFile, inspectPdfBytes, type PdfPageInfo } from '@/lib/pdf-batch';
import { getCachedTeacher, setCachedTeacher } from '@/lib/sessionCache';
import {
  fetchWithCache,
  useDataCache,
  invalidateSubmissions,
  invalidateExams,
  invalidateClasses,
} from '@/lib/dataCache';
import {
  GRADING_FORMULA_OPTIONS,
  GRADE_ROUNDING_OPTIONS,
  getSubjectSupportInfo,
  resolveTeacherSubjects,
  resolveClassSubjectOptions,
  resolveDefaultExamSubjectForClass,
  isSerializedDocumentPayload,
  computeAssignedGradeAverage,
  DUPLICATE_STUDENT_NAME_WARNING,
  hasDuplicateStudentName,
  type GradingFormula,
  type GradeRounding,
} from '@/lib/grading';

interface DashboardClass {
  id: string;
  name: string;
  averageGrade?: string;
  gradedSubmissionsCount?: number;
  gradeRawSum?: number;
  subjects?: string[];
  _count?: {
    students: number;
  };
}

interface DashboardStudent {
  id: string;
  name: string;
}

interface DashboardExam {
  id: string;
  title: string;
  subject: string;
  maxPoints: number;
}

interface DashboardSubmission {
  id: string;
  studentId?: string | null;
  assignedStudentId?: string | null;
  studentName: string;
  extractedStudentName?: string | null;
  suggestedStudentId?: string | null;
  isStudentMatchUncertain?: boolean;
  isExamMatchUncertain?: boolean;
  examId: string;
  examTitle: string;
  classId: string;
  className: string;
  subject: string;
  points: string;
  grade: string;
  gradeRaw?: number | null;
  date: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  errorMessage?: string | null;
  uncertainStepsCount?: number;
}

interface GlobalExamOption {
  id: string;
  title: string;
  subject: string;
  classId: string;
  className: string;
}

interface DuplicateAssignConflict {
  submissionId: string;
  studentId: string;
  studentName: string;
  examId?: string;
}

function UnassignedSubmissionCell({
  sub,
  allExams,
  activeExamIdForAssign,
  availableStudentsForAssign,
  selectedAssignStudentId,
  isRowDuplicateConflict,
  isReplacing,
  onChangeExam,
  onChangeStudent,
  onOpenCreateStudent,
  onAssign,
}: {
  sub: DashboardSubmission;
  allExams: GlobalExamOption[];
  activeExamIdForAssign: string;
  availableStudentsForAssign: DashboardStudent[];
  selectedAssignStudentId: string;
  isRowDuplicateConflict: boolean;
  isReplacing: boolean;
  onChangeExam: (newExamId: string) => void;
  onChangeStudent: (newStudentId: string) => void;
  onOpenCreateStudent: () => void;
  onAssign: (submissionId: string, forceOverwrite: boolean) => void;
}) {
  return (
    <Stack spacing={1} sx={{ py: 1 }}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
        <Chip
          label={
            sub.isExamMatchUncertain ? '⚠ Klasse/Prüfung & Schüler prüfen' : 'Zuordnung ausstehend'
          }
          size="small"
          sx={{
            backgroundColor: '#fef3c7',
            color: '#d97706',
            fontWeight: 'bold',
            borderRadius: '6px',
          }}
        />
        {sub.extractedStudentName && (
          <Typography variant="caption" sx={{ color: '#92400e', fontWeight: 700 }}>
            KI gelesen: &quot;{sub.extractedStudentName}&quot;
          </Typography>
        )}
      </Stack>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        sx={{
          alignItems: { xs: 'stretch', sm: 'center' },
          flexWrap: 'wrap',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {allExams.length > 1 && (
          <FormControl size="small" sx={{ minWidth: '180px' }}>
            <Select
              value={activeExamIdForAssign}
              onChange={(e) => onChangeExam(e.target.value)}
              sx={{
                height: '32px',
                fontSize: '0.8rem',
                borderRadius: '6px',
                backgroundColor: '#ffffff',
              }}
            >
              {allExams.map((ex) => (
                <MenuItem key={ex.id} value={ex.id}>
                  {ex.className} · {ex.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        )}
        <FormControl size="small" sx={{ minWidth: '160px' }}>
          <Select
            value={selectedAssignStudentId}
            onChange={(e) => {
              const val = e.target.value;
              if (val === 'CREATE_STUDENT') {
                onOpenCreateStudent();
                return;
              }
              onChangeStudent(val);
            }}
            displayEmpty
            sx={{
              height: '32px',
              fontSize: '0.85rem',
              borderRadius: '6px',
              backgroundColor: '#ffffff',
            }}
          >
            <MenuItem value="" disabled>
              <em>Schüler/in wählen...</em>
            </MenuItem>
            {availableStudentsForAssign.map((st) => (
              <MenuItem key={st.id} value={st.id}>
                {st.name}
              </MenuItem>
            ))}
            <MenuItem value="CREATE_STUDENT" sx={{ color: 'primary.main', fontWeight: 600 }}>
              + Schüler/in hinzufügen
            </MenuItem>
          </Select>
        </FormControl>
        <Button
          size="small"
          variant={isRowDuplicateConflict ? 'outlined' : 'contained'}
          disabled={!selectedAssignStudentId || isReplacing}
          onClick={() => onAssign(sub.id, false)}
          sx={{
            minWidth: 'auto',
            px: 1.5,
            py: 0.5,
            height: '32px',
            textTransform: 'none',
            borderRadius: '6px',
            fontWeight: 600,
          }}
        >
          Zuordnen
        </Button>
        {isRowDuplicateConflict && (
          <Button
            size="small"
            variant="contained"
            color="error"
            disabled={!selectedAssignStudentId || isReplacing}
            onClick={() => onAssign(sub.id, true)}
            startIcon={
              isReplacing ? (
                <CircularProgress size={14} color="inherit" />
              ) : (
                <AutoAwesomeIcon sx={{ fontSize: '0.95rem !important' }} />
              )
            }
            sx={{
              minWidth: 'auto',
              px: 1.5,
              py: 0.5,
              height: '32px',
              textTransform: 'none',
              borderRadius: '6px',
              fontWeight: 700,
              backgroundColor: '#dc2626',
              whiteSpace: 'nowrap',
              '&:hover': {
                backgroundColor: '#b91c1c',
              },
            }}
          >
            Korrektur ersetzen
          </Button>
        )}
      </Stack>
      {isRowDuplicateConflict && (
        <Typography variant="caption" sx={{ color: '#b45309', fontWeight: 700, display: 'block' }}>
          Für diese/n Schüler/in existiert bereits eine Korrektur — klicke auf &apos;Korrektur
          ersetzen&apos;, um die bestehende Korrektur zu überschreiben.
        </Typography>
      )}
    </Stack>
  );
}

export default function Dashboard() {
  const router = useRouter();

  // Auth and Session state
  const [authChecking, setAuthChecking] = useState(!getCachedTeacher());

  // Database lists
  const [classes, setClasses] = useState<DashboardClass[]>([]);
  const [students, setStudents] = useState<DashboardStudent[]>([]);
  const [studentsByClass, setStudentsByClass] = useState<Record<string, DashboardStudent[]>>({});
  const [exams, setExams] = useState<DashboardExam[]>([]);
  const [recentSubmissions, setRecentSubmissions] = useState<DashboardSubmission[]>([]);
  const [cancelTargetId, setCancelTargetId] = useState<string | null>(null);
  const [cancelLoading, setCancelLoading] = useState(false);
  const [cancelError, setCancelError] = useState('');
  const [dismissedSubmissionIds, setDismissedSubmissionIds] = useState<string[]>(() => {
    if (typeof window !== 'undefined') {
      const stored =
        localStorage.getItem('pruefli_dismissed_submission_ids') ||
        localStorage.getItem('gradeai_dismissed_submission_ids');
      if (stored) {
        try {
          return JSON.parse(stored);
        } catch (e) {
          console.error(e);
        }
      }
    }
    return [];
  });

  const [nonExamOverridePrompt, setNonExamOverridePrompt] = useState<{
    fileName: string;
    reason: string;
    summary?: string;
    category?: string;
  } | null>(null);

  const executeCancelSubmission = async (subId: string) => {
    try {
      const res = await fetch(`/api/submissions/${subId}`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error('Abbrechen fehlgeschlagen.');
      }
      invalidateSubmissions(subId);
      fetchRecentSubmissions();
      fetchClasses();
    } catch (err) {
      console.error('Error canceling/deleting submission on dismiss:', err);
      setError('Fehler beim Abbrechen der Korrektur.');
    }
  };

  const handleDismissSubmission = async (subId: string) => {
    const sub = recentSubmissions.find((s) => s.id === subId);

    const isCancelOrFailure =
      sub && (sub.status === 'FAILED' || sub.status === 'PENDING' || sub.status === 'PROCESSING');

    if (isCancelOrFailure) {
      if (sub.status === 'PENDING' || sub.status === 'PROCESSING') {
        setCancelError('');
        setCancelTargetId(subId);
        return;
      }

      await executeCancelSubmission(subId);
      return;
    }

    // Für COMPLETED Einträge: Nur lokal ausblenden, in DB belassen
    const updated = [...dismissedSubmissionIds, subId];
    setDismissedSubmissionIds(updated);
    localStorage.setItem('pruefli_dismissed_submission_ids', JSON.stringify(updated));
  };

  // Selection states
  const [selectedClassId, setSelectedClassId] = useState<string>('');
  const [defaultClassId, setDefaultClassId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('pruefli_default_class_id') ||
        localStorage.getItem('gradeai_default_class_id')
      );
    }
    return null;
  });
  const [selectedStudentId, setSelectedStudentId] = useState<string>('AUTO'); // Recommended default
  const [selectedExamId, setSelectedExamId] = useState<string>('NEW'); // 'NEW' or specific exam UUID

  // New exam states
  const [examTitle, setExamTitle] = useState<string>('');
  const [examSubject, setExamSubject] = useState<string>('');
  const [examMaxPoints, setExamMaxPoints] = useState<number>(20);
  const [rubricText, setRubricText] = useState<string>('');
  const [rubricFile, setRubricFile] = useState<File | null>(null);
  const [rubricScannedPages, setRubricScannedPages] = useState<number>(0);
  const [examTemplateFile, setExamTemplateFile] = useState<File | null>(null);
  const [examTemplateScannedPayload, setExamTemplateScannedPayload] = useState<string>('');
  const [examTemplateScannedPages, setExamTemplateScannedPages] = useState<number>(0);
  const [gradingNotes, setGradingNotes] = useState<string>('');
  const [gradingFormula, setGradingFormula] = useState<GradingFormula>('LINEAR_60');
  const [gradeRounding, setGradeRounding] = useState<GradeRounding>('0.1');
  const [showAdvancedExamOptions, setShowAdvancedExamOptions] = useState<boolean>(false);

  // Correction configs
  const [studentFiles, setStudentFiles] = useState<File[]>([]); // Supports bulk uploads
  const [pdfSplitQueue, setPdfSplitQueue] = useState<Array<{ file: File; pages: PdfPageInfo[] }>>(
    []
  );
  const [assignState, setAssignState] = useState<Record<string, string>>({}); // Inline student assignments
  const [examAssignState, setExamAssignState] = useState<Record<string, string>>({}); // Inline exam reassignments
  const [allExams, setAllExams] = useState<GlobalExamOption[]>([]);

  // QR Mobile Camera Relay Dialog state
  const [qrDialogOpen, setQrDialogOpen] = useState<boolean>(false);
  const [qrDialogMode, setQrDialogMode] = useState<'universal' | 'contextual'>('universal');
  const [qrTargetMode, setQrTargetMode] = useState<'SUBMISSION' | 'RUBRIC' | 'EXAM_TEMPLATE'>(
    'SUBMISSION'
  );

  // Loading & Error states
  const [loading, setLoading] = useState<boolean>(false);
  const [loadingStep, setLoadingStep] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [openConfirmOverwrite, setOpenConfirmOverwrite] = useState<boolean>(false);
  const [replacingSubmissionId, setReplacingSubmissionId] = useState<string | null>(null);
  const [duplicateAssignConflict, setDuplicateAssignConflict] =
    useState<DuplicateAssignConflict | null>(null);
  const [globalExamsCount, setGlobalExamsCount] = useState<number>(0);
  const [initialDataLoading, setInitialDataLoading] = useState<boolean>(true);

  const { data: cachedSubjectsData } = useDataCache<{ savedSubjects?: string[] | null }>(
    '/api/subjects'
  );
  const mySubjects = React.useMemo(
    () =>
      resolveTeacherSubjects(
        cachedSubjectsData?.savedSubjects ?? null,
        exams.map((ex) => ex.subject)
      ),
    [cachedSubjectsData?.savedSubjects, exams]
  );

  const selectedClass = React.useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const classSubjectOptions = React.useMemo(
    () => resolveClassSubjectOptions(mySubjects, selectedClass?.subjects),
    [mySubjects, selectedClass]
  );

  const effectiveExamSubject = React.useMemo(() => {
    if (
      examSubject &&
      classSubjectOptions.some((sp) => sp.value.toLowerCase() === examSubject.toLowerCase())
    ) {
      return examSubject;
    }
    return resolveDefaultExamSubjectForClass(classSubjectOptions, exams);
  }, [examSubject, classSubjectOptions, exams]);

  // 4. Handle Class Change (Fetch Students & Exams for selected class)
  const handleClassChange = React.useCallback(
    async (classId: string) => {
      setSelectedClassId(classId);
      setSelectedStudentId('AUTO'); // Recommended default: Auto-Match
      setExamSubject('');
      setStudentFiles([]); // Reset uploads
      setExams([]);
      setStudents([]);

      if (!classId) return;

      try {
        // Fetch students for class
        const studentsRes = await fetch(`/api/classes/${classId}/students`);
        if (studentsRes.ok) {
          const studentsData = await studentsRes.json();
          setStudents(studentsData.students || []);
        }

        // Fetch previous exams for class
        const examsRes = await fetch(`/api/classes/${classId}/exams`);
        if (examsRes.ok) {
          const examsData = await examsRes.json();
          const loadedExams = examsData.exams || [];
          setExams(loadedExams);
          // Pre-select the latest created exam if one exists, else NEW
          if (loadedExams.length > 0) {
            setSelectedExamId(loadedExams[0].id);
          } else {
            setSelectedExamId('NEW');
          }
        }
      } catch (err) {
        console.error('Error fetching class details:', err);
      }
    },
    [setSelectedStudentId, setExamSubject, setStudentFiles, setSelectedExamId]
  );

  // 2. Fetch classes from DB
  const fetchClasses = React.useCallback(async () => {
    try {
      const data = await fetchWithCache<{ classes: DashboardClass[] } | DashboardClass[]>(
        '/api/classes'
      );
      const loadedClasses: DashboardClass[] = Array.isArray(data) ? data : data?.classes || [];
      setClasses(loadedClasses);
      // Pre-select default class if available, else first class
      if (loadedClasses.length > 0) {
        const stored = localStorage.getItem('gradeai_default_class_id');
        const classExists = loadedClasses.some((c: DashboardClass) => c.id === stored);
        if (stored && classExists) {
          handleClassChange(stored);
        } else {
          handleClassChange(loadedClasses[0].id);
        }
      }
    } catch (err) {
      console.error('Error fetching classes:', err);
    }
  }, [handleClassChange]);

  // Quick Create Class & Student States
  const [openCreateClass, setOpenCreateClass] = useState<boolean>(false);
  const [newClassName, setNewClassName] = useState<string>('');
  const [createClassLoading, setCreateClassLoading] = useState<boolean>(false);
  const [createClassError, setCreateClassError] = useState<string>('');

  const [openCreateStudent, setOpenCreateStudent] = useState<boolean>(false);
  const [newStudentName, setNewStudentName] = useState<string>('');
  const [confirmDuplicateStudent, setConfirmDuplicateStudent] = useState<boolean>(false);
  const [targetClassForStudent, setTargetClassForStudent] = useState<string>('');
  const [createStudentLoading, setCreateStudentLoading] = useState<boolean>(false);
  const [createStudentError, setCreateStudentError] = useState<string>('');

  const handleCreateClassSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newClassName.trim();
    if (!trimmed) {
      setCreateClassError('Bitte gib einen Klassennamen an.');
      return;
    }
    setCreateClassLoading(true);
    setCreateClassError('');
    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateClassError(data.error || 'Klasse konnte nicht erstellt werden.');
        return;
      }
      invalidateClasses();
      await fetchClasses();
      if (data.class?.id) {
        await handleClassChange(data.class.id);
      }
      setOpenCreateClass(false);
      setNewClassName('');
    } catch (err) {
      setCreateClassError(err instanceof Error ? err.message : 'Fehler beim Erstellen der Klasse.');
    } finally {
      setCreateClassLoading(false);
    }
  };

  const handleCreateStudentSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newStudentName.trim();
    const targetClassId = targetClassForStudent || selectedClassId;
    if (!trimmed) {
      setCreateStudentError('Bitte gib einen Schülernamen an.');
      return;
    }
    if (!targetClassId) {
      setCreateStudentError('Keine Klasse ausgewählt.');
      return;
    }
    const existingClassStudents =
      targetClassId === selectedClassId && students.length > 0
        ? students
        : studentsByClass[targetClassId] || students;
    if (hasDuplicateStudentName(existingClassStudents, trimmed) && !confirmDuplicateStudent) {
      setCreateStudentError('');
      setConfirmDuplicateStudent(true);
      return;
    }
    setCreateStudentLoading(true);
    setCreateStudentError('');
    try {
      const res = await fetch(`/api/classes/${targetClassId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCreateStudentError(data.error || 'Schüler/in konnte nicht erstellt werden.');
        return;
      }
      invalidateClasses(targetClassId);
      const studentsRes = await fetch(`/api/classes/${targetClassId}/students`);
      if (studentsRes.ok) {
        const studentsData = await studentsRes.json();
        const updatedStudents = studentsData.students || [];
        if (targetClassId === selectedClassId) {
          setStudents(updatedStudents);
          if (data.student?.id) {
            setSelectedStudentId(data.student.id);
          }
        }
        setStudentsByClass((prev) => ({
          ...prev,
          [targetClassId]: updatedStudents,
        }));
      }
      setOpenCreateStudent(false);
      setNewStudentName('');
      setConfirmDuplicateStudent(false);
    } catch (err) {
      setCreateStudentError(
        err instanceof Error ? err.message : 'Fehler beim Erstellen des Schülers.'
      );
    } finally {
      setCreateStudentLoading(false);
    }
  };

  // 3. Fetch recent submissions history from DB
  const fetchRecentSubmissions = React.useCallback(
    async (forceRefresh = false) => {
      try {
        if (forceRefresh) {
          invalidateSubmissions();
        }
        const data = await fetchWithCache<
          | {
              submissions: DashboardSubmission[];
              studentsByClass?: Record<string, DashboardStudent[]>;
              allExams?: GlobalExamOption[];
              totalExamsCount?: number;
            }
          | DashboardSubmission[]
        >('/api/submissions');
        const subs: DashboardSubmission[] = Array.isArray(data) ? data : data?.submissions || [];
        setRecentSubmissions(subs);
        if (!Array.isArray(data) && data?.studentsByClass) {
          setStudentsByClass(data.studentsByClass);
        }
        if (!Array.isArray(data) && Array.isArray(data?.allExams)) {
          setAllExams(data.allExams);
        }
        if (!Array.isArray(data) && typeof data?.totalExamsCount === 'number') {
          setGlobalExamsCount(data.totalExamsCount);
        }
        // Pre-populate suggestedStudentId in assignState if not already chosen by teacher
        setAssignState((prev) => {
          const next = { ...prev };
          for (const s of subs) {
            if (s.studentName === 'Nicht zugeordnet' && s.suggestedStudentId && !next[s.id]) {
              next[s.id] = s.suggestedStudentId;
            }
          }
          return next;
        });
      } catch (err) {
        console.error('Error fetching recent submissions or global exams count:', err);
      }
    },
    [setAssignState]
  );

  // 1. Verify Authentication & Load Initial Data
  useEffect(() => {
    let active = true;
    const cached = getCachedTeacher();

    async function checkAuth() {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const data = await res.json();
        if (active) {
          setCachedTeacher(data.teacher);
          setAuthChecking(false);

          if (!cached) {
            try {
              await Promise.all([fetchClasses(), fetchRecentSubmissions()]);
            } finally {
              setInitialDataLoading(false);
            }
          }
        }
      } catch (err) {
        console.error('Session verification failed:', err);
        router.replace('/login');
      }
    }

    if (cached) {
      Promise.resolve().then(async () => {
        try {
          await Promise.all([fetchClasses(), fetchRecentSubmissions()]);
        } finally {
          setInitialDataLoading(false);
        }
      });
    }

    checkAuth();

    return () => {
      active = false;
    };
  }, [router, fetchClasses, fetchRecentSubmissions]);

  // Memoized check for active background jobs to prevent unnecessary polling interval resets
  const hasActiveJobs = React.useMemo(() => {
    return recentSubmissions.some((sub) => sub.status === 'PENDING' || sub.status === 'PROCESSING');
  }, [recentSubmissions]);

  // Poll recent submissions if there are any pending/processing jobs in the queue
  useEffect(() => {
    if (!hasActiveJobs) return;

    const interval = setInterval(() => {
      invalidateSubmissions();
      fetchRecentSubmissions(true);
    }, 3000);

    return () => clearInterval(interval);
  }, [hasActiveJobs, fetchRecentSubmissions]);

  // Set default class handler
  const handleSetDefaultClass = () => {
    if (!selectedClassId) return;

    if (defaultClassId === selectedClassId) {
      localStorage.removeItem('pruefli_default_class_id');
      localStorage.removeItem('gradeai_default_class_id');
      setDefaultClassId(null);
    } else {
      localStorage.setItem('pruefli_default_class_id', selectedClassId);
      setDefaultClassId(selectedClassId);
    }
  };

  // 5. Handle Logout
  const _handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        router.push('/login');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const handleIncomingStudentFiles = async (incomingFiles: File[]) => {
    if (!incomingFiles || incomingFiles.length === 0) return;
    setError('');

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
          // Falls PDF-Inspektion fehlschlägt, wie reguläre Einzeldatei behandeln
        }
      }
      directFiles.push(file);
    }

    if (directFiles.length > 0) {
      if (selectedStudentId === 'AUTO' || directFiles.length > 1) {
        if (selectedStudentId !== 'AUTO' && directFiles.length > 1) {
          setSelectedStudentId('AUTO');
        }
        setStudentFiles((prev) => [...prev, ...directFiles]);
      } else if (multiPageQueue.length === 0) {
        setStudentFiles([directFiles[0]]);
      } else {
        setStudentFiles((prev) => [...prev, ...directFiles]);
      }
    }

    if (multiPageQueue.length > 0) {
      setPdfSplitQueue((prev) => [...prev, ...multiPageQueue]);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDropStudent = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files) {
      const files = Array.from(e.dataTransfer.files);
      void handleIncomingStudentFiles(files);
    }
  };

  const handleManualAssign = async (submissionId: string, forceOverwrite = false) => {
    const studentId = assignState[submissionId];
    if (!studentId) return;
    const targetExamId = examAssignState[submissionId];
    const sub = recentSubmissions.find((s) => s.id === submissionId);
    const activeExamId = targetExamId || sub?.examId;
    const activeExamOpt = allExams.find((e) => e.id === activeExamId);
    const activeClassId = activeExamOpt?.classId || sub?.classId || '';
    const classStudentList = studentsByClass[activeClassId] || students;
    const selectedStudentName =
      classStudentList.find((s) => s.id === studentId)?.name || 'diese/n Schüler/in';

    setReplacingSubmissionId(submissionId);
    if (forceOverwrite) {
      setError('');
      setDuplicateAssignConflict(null);
    }

    try {
      const res = await fetch(`/api/submissions/${submissionId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studentId,
          examId: targetExamId || undefined,
          ...(forceOverwrite ? { overwrite: true } : {}),
        }),
      });

      const resData = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (
          res.status === 409 ||
          resData.code === 'DUPLICATE_SUBMISSION' ||
          isDuplicateSubmissionError(resData.error)
        ) {
          const conflictStudentName = resData.studentName || selectedStudentName;
          setDuplicateAssignConflict({
            submissionId,
            studentId,
            studentName: conflictStudentName,
            examId: activeExamId,
          });
          setError(
            resData.error ||
              `Für Schüler/in "${conflictStudentName}" existiert bereits eine Korrektur für diese Prüfung. Klicke auf 'Korrektur ersetzen', um sie zu überschreiben.`
          );
          return;
        }
        throw new Error(resData.error || 'Zuweisung fehlgeschlagen');
      }

      setError('');
      setDuplicateAssignConflict(null);

      // If the teacher reassigned the submission to a different Exam, re-run correction against that Exam's rubric
      if (resData.examChanged) {
        await fetch(`/api/submissions/${submissionId}/replace`, {
          method: 'POST',
        });
      }

      // Refresh submissions and class averages
      invalidateSubmissions(submissionId, targetExamId || undefined, undefined, studentId);
      fetchRecentSubmissions(true);
      fetchClasses();
      setAssignState((prev) => {
        const copy = { ...prev };
        delete copy[submissionId];
        return copy;
      });
      setExamAssignState((prev) => {
        const copy = { ...prev };
        delete copy[submissionId];
        return copy;
      });
    } catch (err) {
      console.error('Error in manual assignment:', err);
      setError(err instanceof Error ? err.message : 'Zuweisung fehlgeschlagen.');
    } finally {
      setReplacingSubmissionId(null);
    }
  };

  const handleReplaceSubmission = async (submissionId: string) => {
    setError('');
    setReplacingSubmissionId(submissionId);
    try {
      const res = await fetch(`/api/submissions/${submissionId}/replace`, {
        method: 'POST',
      });
      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(errorData.error || 'Ersetzen fehlgeschlagen.');
      }
      invalidateSubmissions(submissionId);
      fetchRecentSubmissions(true);
      fetchClasses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Ersetzen.');
    } finally {
      setReplacingSubmissionId(null);
    }
  };

  // 6. Submit Grading job to API
  const startAnalysis = async (
    forceOverwrite?: boolean | React.MouseEvent,
    allowDocumentOverride = false
  ) => {
    const shouldOverwrite = forceOverwrite === true;

    if (!selectedClassId) {
      setError('Bitte wähle eine Klasse aus.');
      return;
    }
    if (!selectedStudentId) {
      setError('Bitte wähle einen Schüler oder Auto-Match aus.');
      return;
    }
    if (selectedExamId === 'NEW') {
      if (!examTitle.trim() || !effectiveExamSubject.trim()) {
        setError('Bitte gib einen Prüfungstitel und ein Fach für die neue Prüfung an.');
        return;
      }
      if (!examMaxPoints || Number(examMaxPoints) <= 0) {
        setError('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.');
        return;
      }
    }
    if (studentFiles.length === 0) {
      setError('Bitte lade mindestens eine Schülerarbeit (PDF oder Bild) hoch.');
      return;
    }

    setLoading(true);
    setError('');
    setLoadingStep('Bereite Upload vor...');

    let resolvedExamId = selectedExamId;

    try {
      const uploadFile = async (file: File, isFirst = false) => {
        const formData = new FormData();
        formData.append('classId', selectedClassId);
        formData.append('studentExam', file);

        if (shouldOverwrite) {
          formData.append('overwrite', 'true');
        }

        if (allowDocumentOverride) {
          formData.append('overrideDocumentType', 'true');
        }

        if (!isFirst && resolvedExamId !== 'NEW') {
          formData.append('examId', resolvedExamId);
        } else if (selectedExamId === 'NEW') {
          formData.append('examTitle', examTitle.trim());
          formData.append('examSubject', effectiveExamSubject.trim());
          formData.append(
            'maxPoints',
            String(Number(examMaxPoints) > 0 ? Number(examMaxPoints) : 20)
          );
          formData.append('gradingFormula', gradingFormula);
          formData.append('gradeRounding', gradeRounding);
          if (examTemplateFile) {
            formData.append('examTemplate', examTemplateFile);
          } else if (examTemplateScannedPayload) {
            formData.append('examTemplate', examTemplateScannedPayload);
          }
          if (gradingNotes.trim()) {
            formData.append('gradingNotes', gradingNotes.trim());
          }
          if (rubricFile) {
            formData.append('rubric', rubricFile);
          } else {
            formData.append('rubric', rubricText || 'Standard Musterlösung');
          }
        } else {
          formData.append('examId', selectedExamId);
        }

        if (selectedStudentId !== 'AUTO') {
          formData.append('studentId', selectedStudentId);
        }

        const res = await fetch('/api/correct', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const errorData = await res.json();
          if (res.status === 409 && errorData.exists) {
            setLoading(false);
            setOpenConfirmOverwrite(true);
            throw new Error('DUPLICATE_SUBMISSION');
          }
          if (errorData.canOverride) {
            setNonExamOverridePrompt({
              fileName: file.name,
              reason:
                errorData.error ||
                'Das Dokument wurde als Nicht-Prüfungsdokument erkannt (z. B. Einverständniserklärung).',
              summary: errorData.classification?.detectedSummary,
              category: errorData.classification?.documentType,
            });
            setLoading(false);
            throw new Error('NON_EXAM_DOCUMENT');
          }
          throw new Error(errorData.error || `Fehler beim Upload von ${file.name}`);
        }

        return await res.json();
      };

      let successCount = 0;
      const failedUploads: { fileName: string; error: string }[] = [];

      for (let idx = 0; idx < studentFiles.length; idx++) {
        const currentFile = studentFiles[idx];
        setLoadingStep(`Lade Arbeit ${idx + 1} von ${studentFiles.length} hoch...`);
        const isCreatingNewExamNow = resolvedExamId === 'NEW';

        try {
          const uploadRes = await uploadFile(currentFile, isCreatingNewExamNow);
          if (uploadRes?.examId) {
            resolvedExamId = uploadRes.examId;
          }
          successCount++;
        } catch (fileErr) {
          if (
            studentFiles.length === 1 ||
            (fileErr instanceof Error &&
              (fileErr.message === 'DUPLICATE_SUBMISSION' ||
                fileErr.message === 'NON_EXAM_DOCUMENT'))
          ) {
            throw fileErr;
          }
          const errMessage = fileErr instanceof Error ? fileErr.message : 'Upload fehlgeschlagen';
          console.error(`Swallowed individual upload error for ${currentFile.name}:`, fileErr);
          failedUploads.push({ fileName: currentFile.name, error: errMessage });
        }
      }

      if (successCount === 0 && failedUploads.length > 0) {
        throw new Error(failedUploads[0].error);
      }

      setStudentFiles([]);
      setLoading(false);
      setNonExamOverridePrompt(null);
      if (failedUploads.length > 0) {
        setError(
          `${successCount} von ${studentFiles.length} Arbeiten hochgeladen. Fehler bei: ${failedUploads
            .map((f) => `${f.fileName} (${f.error})`)
            .join(', ')}`
        );
      }
      invalidateSubmissions(undefined, resolvedExamId, selectedClassId);
      if (selectedExamId === 'NEW') {
        invalidateExams(resolvedExamId, selectedClassId);
        invalidateClasses(selectedClassId);
      }
      fetchRecentSubmissions(true);

      // Immer auf dem Dashboard bleiben, damit die aktive Warteschlange direkt sichtbar ist und live mitverfolgt werden kann
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err instanceof Error && err.message === 'DUPLICATE_SUBMISSION') {
        return; // Handled by overwrite modal
      }
      if (err instanceof Error && err.message === 'NON_EXAM_DOCUMENT') {
        return; // Handled by nonExamOverridePrompt modal
      }
      const errMsg = err instanceof Error ? err.message : 'Ein Fehler ist aufgetreten.';
      setError(errMsg);
      setLoading(false);
    }
  };

  if (authChecking) {
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
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Sitzung wird geladen...
        </Typography>
      </Box>
    );
  }

  const totalClasses = classes.length;
  const totalStudents = classes.reduce((sum, cls) => sum + (cls._count?.students || 0), 0);

  // Calculate unified overall grade average across completed, student-assigned submissions
  const recentAssignedAvg = computeAssignedGradeAverage(recentSubmissions);
  let overallAverage = recentAssignedAvg.averageGrade;
  const totalClassGradedCount = classes.reduce(
    (sum, cls) => sum + (cls.gradedSubmissionsCount || 0),
    0
  );
  if (totalClassGradedCount > recentAssignedAvg.count) {
    const totalClassGradeSum = classes.reduce((sum, cls) => sum + (cls.gradeRawSum || 0), 0);
    overallAverage = (totalClassGradeSum / totalClassGradedCount).toFixed(2);
  }

  return (
    <DashboardLayout>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px', position: 'relative' }}>
        {/* High Level Stats Grid */}
        <Grid container spacing={3}>
          {/* Card 1: Classes */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
                <Box
                  sx={{
                    width: '44px',
                    height: '44px',
                    borderRadius: '10px',
                    backgroundColor: '#e0f2fe',
                    color: '#0284c7',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <GroupIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Klassen
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {initialDataLoading ? '...' : totalClasses}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 2: Students */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
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
                  <PersonIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Schüler/innen
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {initialDataLoading ? '...' : totalStudents}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 3: Exams */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
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
                  <AssignmentIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Prüfungen
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {initialDataLoading ? '...' : globalExamsCount}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 4: Average Grade */}
          <Grid size={{ xs: 12, sm: 6, md: 3 }}>
            <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
              <CardContent sx={{ p: '20px', display: 'flex', alignItems: 'center', gap: '16px' }}>
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
                  <TrendingUpIcon />
                </Box>
                <Box>
                  <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                    Notenschnitt (Ø)
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    {initialDataLoading ? '...' : overallAverage}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* Active Corrections Queue Tracker (only shown while jobs are active or failed) */}
        {recentSubmissions.some(
          (sub) =>
            (sub.status === 'PENDING' || sub.status === 'PROCESSING' || sub.status === 'FAILED') &&
            !dismissedSubmissionIds.includes(sub.id)
        ) && (
          <Card
            sx={{
              borderRadius: '16px',
              border: '2px solid #e0f2fe',
              boxShadow: '0 4px 20px rgba(2, 132, 199, 0.08)',
              background: 'linear-gradient(135deg, #f0f9ff 0%, #e0f2fe 100%)',
              overflow: 'hidden',
            }}
          >
            <CardContent sx={{ p: '24px' }}>
              {(() => {
                const activeCount = recentSubmissions.filter(
                  (sub) => sub.status === 'PENDING' || sub.status === 'PROCESSING'
                ).length;
                return (
                  <Stack
                    direction="row"
                    sx={{ justifyContent: 'space-between', alignItems: 'center', mb: 2.5 }}
                  >
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                      {activeCount > 0 ? (
                        <CircularProgress size={22} thickness={5} sx={{ color: '#0284c7' }} />
                      ) : (
                        <ErrorIcon sx={{ color: '#dc2626', fontSize: '1.5rem' }} />
                      )}
                      <Typography
                        variant="h6"
                        sx={{ fontWeight: 800, color: '#0369a1', letterSpacing: '-0.01em' }}
                      >
                        {activeCount > 0
                          ? 'Aktive Korrekturen in der Warteschlange'
                          : 'Fehlgeschlagene Korrekturen'}
                      </Typography>
                    </Stack>
                    <Chip
                      label={`${activeCount} aktiv`}
                      size="small"
                      sx={{
                        backgroundColor: activeCount > 0 ? '#0284c7' : '#dc2626',
                        color: '#ffffff',
                        fontWeight: 'bold',
                      }}
                    />
                  </Stack>
                );
              })()}

              <Stack spacing={1.5}>
                {recentSubmissions
                  .filter(
                    (sub) =>
                      (sub.status === 'PENDING' ||
                        sub.status === 'PROCESSING' ||
                        sub.status === 'FAILED') &&
                      !dismissedSubmissionIds.includes(sub.id)
                  )
                  .slice(0, 5) // Show top 5
                  .map((job) => {
                    const isProcessing = job.status === 'PROCESSING';
                    const isFailed = job.status === 'FAILED';
                    const isCompleted = job.status === 'COMPLETED';

                    return (
                      <Box
                        key={job.id}
                        sx={{
                          backgroundColor: '#ffffff',
                          borderRadius: '12px',
                          border: '1px solid #cbd5e1',
                          padding: '14px 18px',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                        }}
                      >
                        <Stack
                          direction="row"
                          spacing={2}
                          sx={{ alignItems: 'center', overflow: 'hidden' }}
                        >
                          {isFailed ? (
                            <Box sx={{ color: 'error.main', display: 'flex' }}>
                              <ErrorIcon />
                            </Box>
                          ) : isProcessing ? (
                            <CircularProgress
                              size={18}
                              thickness={5}
                              sx={{ color: 'primary.main' }}
                            />
                          ) : isCompleted ? (
                            <Box sx={{ color: 'success.main', display: 'flex' }}>
                              <CheckCircleIcon />
                            </Box>
                          ) : (
                            <Box
                              sx={{
                                color: 'text.secondary',
                                animation: 'pulse 1.5s infinite',
                                display: 'flex',
                              }}
                            >
                              <SettingsIcon />
                            </Box>
                          )}

                          <Box sx={{ overflow: 'hidden', textAlign: 'left' }}>
                            <Typography variant="body2" sx={{ fontWeight: 700, color: '#1e293b' }}>
                              {job.studentName === 'Nicht zugeordnet' && isFailed ? (
                                <Box
                                  component="span"
                                  sx={{
                                    color: 'error.main',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  {getDashboardJobTitle(job)}
                                </Box>
                              ) : job.studentName === 'Nicht zugeordnet' &&
                                (isProcessing || job.status === 'PENDING') ? (
                                <Box
                                  component="span"
                                  sx={{
                                    color: '#d97706',
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                  }}
                                >
                                  {getDashboardJobTitle(job)}
                                </Box>
                              ) : (
                                getDashboardJobTitle(job)
                              )}
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ color: 'text.secondary', display: 'block' }}
                            >
                              {isFailed
                                ? job.errorMessage?.includes('bereits eine Korrektur')
                                  ? job.errorMessage
                                  : `Fehlgeschlagen: ${job.errorMessage || 'Unbekannter KI-Fehler'}`
                                : isProcessing
                                  ? 'KI analysiert Lösungswege auf Folgefehler...'
                                  : isCompleted
                                    ? 'Korrektur abgeschlossen. Resultate im Workspace verfügbar.'
                                    : 'In der Warteschlange...'}
                            </Typography>
                          </Box>
                        </Stack>

                        <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                          <Chip
                            label={
                              isFailed
                                ? job.errorMessage?.includes('bereits eine Korrektur')
                                  ? 'Duplikat'
                                  : 'Fehler'
                                : isProcessing
                                  ? 'Wird korrigiert'
                                  : isCompleted
                                    ? 'Fertig'
                                    : 'Wartend'
                            }
                            size="small"
                            color={
                              isFailed
                                ? job.errorMessage?.includes('bereits eine Korrektur')
                                  ? 'warning'
                                  : 'error'
                                : isProcessing
                                  ? 'info'
                                  : isCompleted
                                    ? 'success'
                                    : 'warning'
                            }
                            sx={{ fontWeight: 'bold' }}
                          />
                          {isFailed &&
                            (job.errorMessage?.includes('nicht mehr verfügbar') ||
                            job.errorMessage?.includes('vor der Speicher-Migration') ||
                            job.errorMessage?.includes('Dokumenten-Scan') ? (
                              <Button
                                size="small"
                                variant="contained"
                                color="primary"
                                onClick={() => {
                                  const uploadCard =
                                    document.getElementById('student-upload-card') ||
                                    document.getElementById('step3-upload-card');
                                  if (uploadCard) {
                                    uploadCard.scrollIntoView({ behavior: 'smooth' });
                                  } else {
                                    window.scrollTo({ top: 350, behavior: 'smooth' });
                                  }
                                }}
                                startIcon={<CloudUploadIcon />}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  borderRadius: '8px',
                                  backgroundColor: '#0284c7',
                                  '&:hover': {
                                    backgroundColor: '#0369a1',
                                  },
                                }}
                              >
                                Prüfung neu hochladen
                              </Button>
                            ) : (
                              <Button
                                size="small"
                                variant="contained"
                                color={
                                  job.errorMessage?.includes('bereits eine Korrektur')
                                    ? 'error'
                                    : 'primary'
                                }
                                disabled={replacingSubmissionId === job.id}
                                onClick={() => handleReplaceSubmission(job.id)}
                                startIcon={
                                  replacingSubmissionId === job.id ? (
                                    <CircularProgress size={16} color="inherit" />
                                  ) : (
                                    <AutoAwesomeIcon />
                                  )
                                }
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  borderRadius: '8px',
                                  ...(job.errorMessage?.includes('bereits eine Korrektur')
                                    ? {
                                        backgroundColor: '#dc2626',
                                        '&:hover': {
                                          backgroundColor: '#b91c1c',
                                        },
                                      }
                                    : {
                                        backgroundColor: '#0284c7',
                                        '&:hover': {
                                          backgroundColor: '#0369a1',
                                        },
                                      }),
                                }}
                              >
                                {job.errorMessage?.includes('bereits eine Korrektur')
                                  ? 'Korrektur ersetzen'
                                  : 'Erneut versuchen'}
                              </Button>
                            ))}
                          <Link
                            href={`/correct/${job.id}`}
                            passHref
                            style={{ textDecoration: 'none' }}
                          >
                            <Button
                              size="small"
                              variant="text"
                              sx={{ textTransform: 'none', fontWeight: 600 }}
                            >
                              Workspace öffnen
                            </Button>
                          </Link>
                          <Tooltip
                            title={
                              isCompleted
                                ? 'Aus Liste ausblenden'
                                : isFailed
                                  ? 'Fehlgeschlagenen Job löschen'
                                  : 'Korrektur abbrechen & löschen'
                            }
                          >
                            <IconButton
                              size="small"
                              onClick={() => handleDismissSubmission(job.id)}
                              sx={{
                                color: 'text.secondary',
                                '&:hover': {
                                  color: 'error.main',
                                  backgroundColor: '#fee2e2',
                                },
                              }}
                            >
                              <CloseIcon sx={{ fontSize: '1.1rem' }} />
                            </IconButton>
                          </Tooltip>
                        </Stack>
                      </Box>
                    );
                  })}
              </Stack>
            </CardContent>
          </Card>
        )}

        {/* Wizard Start Title & Universal QR Mobile Relay Action */}
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={2}
          sx={{ justifyContent: 'space-between', alignItems: { xs: 'flex-start', md: 'center' } }}
        >
          <Box>
            <Typography
              variant="h4"
              component="h2"
              sx={{
                fontWeight: 800,
                color: '#0f172a',
                marginBottom: '8px',
                letterSpacing: '-0.02em',
              }}
            >
              Prüfungskorrektur starten
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', fontWeight: 550 }}>
              Wähle eine Klasse und eine/n Schüler/in aus, wähle eine Prüfung und lade den Scan hoch
              – oder fotografiere direkt per Smartphone.
            </Typography>
          </Box>
          <Button
            variant="outlined"
            size="large"
            startIcon={<QrCodeScannerIcon />}
            onClick={() => {
              setQrDialogMode('universal');
              setQrTargetMode('SUBMISSION');
              setQrDialogOpen(true);
            }}
            sx={{
              borderRadius: '10px',
              textTransform: 'none',
              fontWeight: 800,
              px: 2.5,
              py: 1.25,
              borderColor: '#1b77d1',
              color: '#1b77d1',
              backgroundColor: '#f0f7ff',
              '&:hover': {
                backgroundColor: '#e0f2fe',
                borderColor: '#0284c7',
              },
              flexShrink: 0,
            }}
          >
            Smartphone-Kamera (Universal-QR-Scan)
          </Button>
        </Stack>

        {error && (
          <Alert
            severity={
              duplicateAssignConflict || isDuplicateSubmissionError(error) ? 'warning' : 'error'
            }
            sx={{ borderRadius: '12px', alignItems: 'center' }}
            action={
              nonExamOverridePrompt ? (
                <Button
                  color="inherit"
                  size="small"
                  variant="outlined"
                  onClick={() => {
                    setNonExamOverridePrompt(null);
                    setError('');
                    startAnalysis(false, true);
                  }}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Trotzdem als Prüfung behandeln
                </Button>
              ) : duplicateAssignConflict ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                  <Button
                    color="error"
                    size="small"
                    variant="contained"
                    disabled={replacingSubmissionId === duplicateAssignConflict.submissionId}
                    onClick={() => handleManualAssign(duplicateAssignConflict.submissionId, true)}
                    startIcon={
                      replacingSubmissionId === duplicateAssignConflict.submissionId ? (
                        <CircularProgress size={14} color="inherit" />
                      ) : (
                        <AutoAwesomeIcon />
                      )
                    }
                    sx={{
                      textTransform: 'none',
                      fontWeight: 700,
                      borderRadius: '8px',
                      backgroundColor: '#dc2626',
                      whiteSpace: 'nowrap',
                      '&:hover': { backgroundColor: '#b91c1c' },
                    }}
                  >
                    Korrektur ersetzen
                  </Button>
                  <Button
                    color="inherit"
                    size="small"
                    variant="outlined"
                    onClick={() => {
                      const targetId = duplicateAssignConflict.submissionId;
                      setDuplicateAssignConflict(null);
                      setError('');
                      executeCancelSubmission(targetId);
                    }}
                    sx={{ textTransform: 'none', fontWeight: 600, whiteSpace: 'nowrap' }}
                  >
                    Duplikat löschen
                  </Button>
                </Stack>
              ) : undefined
            }
          >
            {error}
          </Alert>
        )}

        {/* Main interactive grid */}
        <Grid container spacing={4}>
          {/* Form Setup */}
          <Grid size={{ xs: 12 }}>
            <Stack spacing={4}>
              {/* Step 1: Select Class & Student */}
              <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
                <CardContent sx={{ padding: '24px' }}>
                  <Typography
                    variant="h6"
                    component="h3"
                    sx={{
                      color: '#0f172a',
                      fontWeight: 700,
                      marginBottom: '20px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '8px',
                    }}
                  >
                    <Box component="span" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                      ①
                    </Box>{' '}
                    Klasse & Schüler/in auswählen
                  </Typography>

                  <Grid container spacing={2.5} sx={{ alignItems: 'center' }}>
                    {/* Class Selector Dropdown */}
                    <Grid size={{ xs: 12, md: selectedClassId ? 6 : 12 }}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <FormControl fullWidth size="medium">
                          <InputLabel id="class-select-label">Klasse auswählen</InputLabel>
                          <Select
                            labelId="class-select-label"
                            value={selectedClassId}
                            label="Klasse auswählen"
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'CREATE_CLASS') {
                                setOpenCreateClass(true);
                                return;
                              }
                              handleClassChange(val);
                            }}
                            sx={{ borderRadius: '8px' }}
                          >
                            <MenuItem
                              value="CREATE_CLASS"
                              sx={{ color: 'primary.main', fontWeight: 600 }}
                            >
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <AddCircleIcon sx={{ color: 'primary.main', fontSize: '1.2rem' }} />
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 'bold', color: 'primary.main' }}
                                >
                                  [Neue Klasse erstellen]
                                </Typography>
                              </Stack>
                            </MenuItem>
                            {classes.map((cls) => (
                              <MenuItem key={cls.id} value={cls.id}>
                                {cls.name} ({cls._count?.students || 0} Schüler)
                              </MenuItem>
                            ))}
                          </Select>
                          {classes.length === 0 && !initialDataLoading && (
                            <FormHelperText sx={{ color: '#b45309', mt: 0.75 }}>
                              Noch keine Klassen vorhanden.{' '}
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => setOpenCreateClass(true)}
                                sx={{
                                  p: 0,
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  minWidth: 'auto',
                                  verticalAlign: 'baseline',
                                }}
                              >
                                Jetzt erste Klasse erstellen
                              </Button>
                            </FormHelperText>
                          )}
                        </FormControl>
                        {selectedClassId && (
                          <Tooltip
                            title={
                              defaultClassId === selectedClassId
                                ? 'Als Standardklasse gespeichert'
                                : 'Als Standardklasse festlegen'
                            }
                          >
                            <Button
                              variant={
                                defaultClassId === selectedClassId ? 'contained' : 'outlined'
                              }
                              color="primary"
                              onClick={handleSetDefaultClass}
                              startIcon={
                                defaultClassId === selectedClassId ? (
                                  <StarIcon sx={{ color: '#ffffff' }} />
                                ) : (
                                  <StarBorderIcon />
                                )
                              }
                              sx={{
                                height: '56px',
                                borderRadius: '8px',
                                px: 2,
                                textTransform: 'none',
                                whiteSpace: 'nowrap',
                                flexShrink: 0,
                              }}
                            >
                              {defaultClassId === selectedClassId ? 'Standard' : 'Standard setzen'}
                            </Button>
                          </Tooltip>
                        )}
                      </Stack>
                    </Grid>

                    {/* Compact Student Assignment Dropdown (replaces 25-card wall) */}
                    {selectedClassId && (
                      <Grid size={{ xs: 12, md: 6 }}>
                        <FormControl fullWidth size="medium">
                          <InputLabel id="student-select-label">Schüler-Zuordnung</InputLabel>
                          <Select
                            labelId="student-select-label"
                            value={selectedStudentId}
                            label="Schüler-Zuordnung"
                            onChange={(e) => {
                              const val = e.target.value;
                              if (val === 'CREATE_STUDENT') {
                                setTargetClassForStudent(selectedClassId);
                                setCreateStudentError('');
                                setConfirmDuplicateStudent(false);
                                setOpenCreateStudent(true);
                                return;
                              }
                              setSelectedStudentId(val);
                              setError('');
                              setStudentFiles([]);
                            }}
                            sx={{ borderRadius: '8px' }}
                          >
                            <MenuItem value="AUTO">
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <AutoAwesomeIcon sx={{ color: '#1b77d1', fontSize: '1.1rem' }} />
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 700, color: '#1b77d1' }}
                                >
                                  Automatische Namenserkennung (Mehrfach-Upload / QR — Empfohlen)
                                </Typography>
                              </Stack>
                            </MenuItem>
                            <MenuItem
                              value="CREATE_STUDENT"
                              sx={{ color: 'primary.main', fontWeight: 600 }}
                            >
                              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                <AddCircleIcon sx={{ color: 'primary.main', fontSize: '1.1rem' }} />
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 700, color: 'primary.main' }}
                                >
                                  [Schüler/in hinzufügen]
                                </Typography>
                              </Stack>
                            </MenuItem>
                            {students.map((student) => (
                              <MenuItem key={student.id} value={student.id}>
                                {student.name} (Manuelle Einzelzuordnung)
                              </MenuItem>
                            ))}
                          </Select>
                          {students.length === 0 && (
                            <FormHelperText sx={{ color: 'text.secondary', mt: 0.75 }}>
                              Noch keine Schüler/innen in dieser Klasse vorhanden.{' '}
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => {
                                  setTargetClassForStudent(selectedClassId);
                                  setCreateStudentError('');
                                  setConfirmDuplicateStudent(false);
                                  setOpenCreateStudent(true);
                                }}
                                sx={{
                                  p: 0,
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  minWidth: 'auto',
                                  verticalAlign: 'baseline',
                                }}
                              >
                                Schüler/in hinzufügen
                              </Button>
                            </FormHelperText>
                          )}
                        </FormControl>
                      </Grid>
                    )}
                  </Grid>
                </CardContent>
              </Card>

              {/* Step 2: Select Exam / Rubric */}
              {selectedClassId && (
                <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
                  <CardContent sx={{ padding: '24px' }}>
                    <Typography
                      variant="h6"
                      component="h3"
                      sx={{
                        color: '#0f172a',
                        fontWeight: 700,
                        marginBottom: '20px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '8px',
                      }}
                    >
                      <Box component="span" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                        ②
                      </Box>{' '}
                      Prüfung & Musterlösung
                    </Typography>

                    <Stack spacing={3}>
                      {/* Select existing or create new */}
                      <FormControl fullWidth size="medium">
                        <InputLabel id="exam-select-label">Prüfung auswählen</InputLabel>
                        <Select
                          labelId="exam-select-label"
                          value={selectedExamId}
                          label="Prüfung auswählen"
                          onChange={(e) => {
                            setSelectedExamId(e.target.value);
                            setError('');
                          }}
                          sx={{ borderRadius: '8px' }}
                        >
                          <MenuItem value="NEW">
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <AddCircleIcon sx={{ color: 'success.main', fontSize: '1.2rem' }} />
                              <Typography
                                variant="body2"
                                sx={{ fontWeight: 'bold', color: 'success.main' }}
                              >
                                [Neue Prüfung erstellen]
                              </Typography>
                            </Stack>
                          </MenuItem>
                          {exams.map((ex) => (
                            <MenuItem key={ex.id} value={ex.id}>
                              {ex.title} ({ex.subject}) — Max: {ex.maxPoints} P.
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>

                      {/* Input fields for NEW Exam */}
                      {selectedExamId === 'NEW' && (
                        <Stack spacing={2.5} sx={{ borderLeft: '3px solid #1b77d1', pl: 2, py: 1 }}>
                          <Grid container spacing={2}>
                            <Grid size={{ xs: 12, sm: 6 }}>
                              <TextField
                                label="Prüfungstitel"
                                value={examTitle}
                                onChange={(e) => setExamTitle(e.target.value)}
                                placeholder="z.B. Klassenarbeit 1: Lineare Gleichungen"
                                fullWidth
                                size="small"
                                required
                              />
                            </Grid>
                            <Grid size={{ xs: 12, sm: 3 }}>
                              <FormControl fullWidth size="small">
                                <InputLabel id="subject-select-label">Fach (KI-Profil)</InputLabel>
                                <Select
                                  labelId="subject-select-label"
                                  value={effectiveExamSubject}
                                  label="Fach (KI-Profil)"
                                  onChange={(e) => setExamSubject(e.target.value)}
                                >
                                  {classSubjectOptions.map((sp) => (
                                    <MenuItem key={sp.value} value={sp.value}>
                                      {sp.label} ({sp.supportInfo.supportBadge})
                                    </MenuItem>
                                  ))}
                                </Select>
                                <FormHelperText
                                  sx={{ fontSize: '0.73rem', color: 'text.secondary' }}
                                >
                                  {getSubjectSupportInfo(effectiveExamSubject).supportBadge}:{' '}
                                  {getSubjectSupportInfo(effectiveExamSubject).profileFocus}
                                </FormHelperText>
                              </FormControl>
                            </Grid>
                            <Grid size={{ xs: 12, sm: 3 }}>
                              <TextField
                                label="Maximalpunktzahl"
                                type="number"
                                value={examMaxPoints}
                                onChange={(e) => {
                                  const val = Number(e.target.value);
                                  setExamMaxPoints(val > 0 ? val : 0);
                                }}
                                slotProps={{
                                  htmlInput: { min: 1, step: 0.5 },
                                }}
                                fullWidth
                                size="small"
                                required
                                helperText="Max. Punkte (z. B. 20)"
                              />
                            </Grid>
                          </Grid>

                          {/* Primary Field: Musterlösung */}
                          <Stack spacing={1.25}>
                            <Typography
                              variant="caption"
                              sx={{ fontWeight: 700, color: 'text.secondary' }}
                            >
                              Musterlösung / Erwartungshorizont der Lehrperson:
                            </Typography>
                            <Typography
                              variant="caption"
                              sx={{ color: 'text.secondary', display: 'block', mb: 0.5 }}
                            >
                              Hier die Lösungsvorgabe oder das Kriterienraster hinterlegen (als Text
                              oder Datei). Die Schülerarbeiten werden anschliessend in Schritt ③
                              hochgeladen.
                            </Typography>
                            {rubricFile || isSerializedDocumentPayload(rubricText) ? (
                              <Box
                                sx={{
                                  border: '1px solid #e2e8f0',
                                  padding: '12px 16px',
                                  borderRadius: '8px',
                                  display: 'flex',
                                  justifyContent: 'space-between',
                                  alignItems: 'center',
                                  background: '#f8fafc',
                                }}
                              >
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                  <DescriptionIcon sx={{ color: 'primary.main' }} />
                                  <Typography
                                    variant="body2"
                                    sx={{ color: 'text.primary', fontWeight: 600 }}
                                  >
                                    {rubricFile
                                      ? `Musterlösung: ${rubricFile.name}`
                                      : `Smartphone-Musterlösung geladen (${rubricScannedPages || 1} ${(rubricScannedPages || 1) === 1 ? 'Seite' : 'Seiten'})`}
                                  </Typography>
                                </Stack>
                                <Button
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    setRubricFile(null);
                                    setRubricText('');
                                    setRubricScannedPages(0);
                                  }}
                                >
                                  Löschen
                                </Button>
                              </Box>
                            ) : (
                              <>
                                <TextField
                                  placeholder="Trage hier die Musterlösung, Formeln oder Bepunktungsvorgaben ein (z.B. 'Aufgabe 1: 4x-12=8, Erg. x=5, Max 3P. Folgefehler erlaubt')"
                                  value={rubricText}
                                  multiline
                                  rows={3}
                                  onChange={(e) => setRubricText(e.target.value)}
                                  fullWidth
                                />
                                <Stack
                                  direction="row"
                                  spacing={1.5}
                                  sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                                >
                                  <input
                                    type="file"
                                    accept="application/pdf,text/plain,image/*"
                                    id="rubricFile"
                                    onChange={(e) => {
                                      if (e.target.files && e.target.files[0]) {
                                        setRubricFile(e.target.files[0]);
                                      }
                                    }}
                                    style={{ display: 'none' }}
                                  />
                                  <Button
                                    component="label"
                                    htmlFor="rubricFile"
                                    variant="outlined"
                                    size="small"
                                    sx={{
                                      color: 'text.primary',
                                      borderColor: '#e2e8f0',
                                      fontWeight: 600,
                                      textTransform: 'none',
                                    }}
                                  >
                                    Datei auswählen (PDF/Bild)
                                  </Button>
                                  <Button
                                    variant="outlined"
                                    size="small"
                                    startIcon={<QrCodeScannerIcon />}
                                    onClick={() => {
                                      setQrDialogMode('contextual');
                                      setQrTargetMode('RUBRIC');
                                      setQrDialogOpen(true);
                                    }}
                                    sx={{
                                      borderColor: '#1b77d1',
                                      color: '#1b77d1',
                                      fontWeight: 700,
                                      textTransform: 'none',
                                    }}
                                  >
                                    Per Smartphone scannen (QR)
                                  </Button>
                                </Stack>
                              </>
                            )}
                          </Stack>

                          {/* Collapsible Advanced Options (Notenformel, Rundung, Vorlage, Hinweise) */}
                          <Box>
                            <Button
                              size="small"
                              variant="text"
                              onClick={() => setShowAdvancedExamOptions((prev) => !prev)}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 700,
                                color: '#475569',
                                px: 1,
                                py: 0.5,
                              }}
                            >
                              {showAdvancedExamOptions ? '▾' : '▸'} Erweiterte Optionen
                              (Notenformel, Vorlagenblatt & Bewertungshinweise)
                            </Button>

                            {showAdvancedExamOptions && (
                              <Stack
                                spacing={2}
                                sx={{
                                  mt: 1.5,
                                  p: 2,
                                  borderRadius: '10px',
                                  backgroundColor: '#f8fafc',
                                  border: '1px solid #e2e8f0',
                                }}
                              >
                                <Grid container spacing={2}>
                                  <Grid size={{ xs: 12, sm: 6 }}>
                                    <FormControl fullWidth size="small">
                                      <InputLabel>Notenformel (Schweizer Skala 1–6)</InputLabel>
                                      <Select
                                        value={gradingFormula}
                                        label="Notenformel (Schweizer Skala 1–6)"
                                        onChange={(e) =>
                                          setGradingFormula(e.target.value as GradingFormula)
                                        }
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
                                      <InputLabel>Notenrundung</InputLabel>
                                      <Select
                                        value={gradeRounding}
                                        label="Notenrundung"
                                        onChange={(e) =>
                                          setGradeRounding(e.target.value as GradeRounding)
                                        }
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

                                <Stack spacing={1}>
                                  <Typography
                                    variant="caption"
                                    sx={{ fontWeight: 700, color: 'text.secondary' }}
                                  >
                                    Leeres Aufgabenblatt / Vorlagenprüfung (optional):
                                  </Typography>
                                  {examTemplateFile || examTemplateScannedPayload ? (
                                    <Stack
                                      direction="row"
                                      spacing={1}
                                      sx={{
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        border: '1px solid #e2e8f0',
                                        p: '8px 12px',
                                        borderRadius: '8px',
                                        backgroundColor: '#ffffff',
                                      }}
                                    >
                                      <Typography variant="body2" sx={{ fontWeight: 600 }}>
                                        {examTemplateFile
                                          ? examTemplateFile.name
                                          : `Smartphone-Vorlage geladen (${examTemplateScannedPages} ${examTemplateScannedPages === 1 ? 'Seite' : 'Seiten'})`}
                                      </Typography>
                                      <Button
                                        size="small"
                                        color="error"
                                        onClick={() => {
                                          setExamTemplateFile(null);
                                          setExamTemplateScannedPayload('');
                                          setExamTemplateScannedPages(0);
                                        }}
                                      >
                                        Entfernen
                                      </Button>
                                    </Stack>
                                  ) : (
                                    <Stack
                                      direction="row"
                                      spacing={1.5}
                                      sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                                    >
                                      <input
                                        type="file"
                                        accept="application/pdf,text/plain,image/*"
                                        id="examTemplateFile"
                                        onChange={(e) => {
                                          if (e.target.files && e.target.files[0]) {
                                            setExamTemplateFile(e.target.files[0]);
                                          }
                                        }}
                                        style={{ display: 'none' }}
                                      />
                                      <Button
                                        component="label"
                                        htmlFor="examTemplateFile"
                                        variant="outlined"
                                        size="small"
                                        sx={{
                                          color: 'text.primary',
                                          borderColor: '#cbd5e1',
                                          backgroundColor: '#ffffff',
                                          fontWeight: 600,
                                          textTransform: 'none',
                                        }}
                                      >
                                        Aufgabenblatt hochladen (PDF/Bild)
                                      </Button>
                                      <Button
                                        variant="outlined"
                                        size="small"
                                        startIcon={<QrCodeScannerIcon />}
                                        onClick={() => {
                                          setQrDialogMode('contextual');
                                          setQrTargetMode('EXAM_TEMPLATE');
                                          setQrDialogOpen(true);
                                        }}
                                        sx={{
                                          borderColor: '#1b77d1',
                                          color: '#1b77d1',
                                          backgroundColor: '#ffffff',
                                          fontWeight: 700,
                                          textTransform: 'none',
                                        }}
                                      >
                                        Vorlage per Smartphone scannen (QR)
                                      </Button>
                                    </Stack>
                                  )}
                                </Stack>

                                <Stack spacing={1}>
                                  <Typography
                                    variant="caption"
                                    sx={{ fontWeight: 700, color: 'text.secondary' }}
                                  >
                                    Zusätzliche Bewertungshinweise für die KI (optional):
                                  </Typography>
                                  <TextField
                                    placeholder="z. B. 'Fehlende Masseinheiten geben 0.5 P. Abzug; auch grafische Lösung bei Aufgabe 2 voll gültig'"
                                    value={gradingNotes}
                                    onChange={(e) => setGradingNotes(e.target.value)}
                                    size="small"
                                    fullWidth
                                    sx={{ backgroundColor: '#ffffff' }}
                                  />
                                </Stack>
                              </Stack>
                            )}
                          </Box>
                        </Stack>
                      )}
                    </Stack>
                  </CardContent>
                </Card>
              )}

              {/* Step 3: Student Upload Scan */}
              {selectedStudentId && (
                <Card
                  id="student-upload-card"
                  sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}
                >
                  <CardContent sx={{ padding: '24px' }}>
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={1.5}
                      sx={{
                        justifyContent: 'space-between',
                        alignItems: { xs: 'flex-start', sm: 'center' },
                        marginBottom: '16px',
                      }}
                    >
                      <Typography
                        variant="h6"
                        component="h3"
                        sx={{
                          color: '#0f172a',
                          fontWeight: 700,
                          display: 'flex',
                          alignItems: 'center',
                          gap: '8px',
                        }}
                      >
                        <Box component="span" sx={{ color: 'primary.main', fontWeight: 'bold' }}>
                          ③
                        </Box>{' '}
                        {selectedStudentId === 'AUTO'
                          ? 'Schülerarbeiten hochladen (Mehrfach-Upload)'
                          : 'Schülerarbeit hochladen (Scans/Fotos/PDF)'}
                      </Typography>

                      <Button
                        variant="outlined"
                        size="small"
                        startIcon={<QrCodeScannerIcon />}
                        onClick={async () => {
                          if (selectedExamId === 'NEW' && selectedClassId) {
                            if (!examTitle.trim()) {
                              setError(
                                'Bitte gib in Schritt ② zuerst einen Prüfungstitel ein, bevor du den QR-Scanner für diese neue Prüfung startest.'
                              );
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                              return;
                            }
                            if (!examMaxPoints || Number(examMaxPoints) <= 0) {
                              setError('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                              return;
                            }
                            try {
                              let resolvedRubric = rubricText || 'Standard Musterlösung';
                              if (rubricFile) {
                                const dataUrl = await new Promise<string>((resolve) => {
                                  const r = new FileReader();
                                  r.onload = (ev) => resolve((ev.target?.result as string) || '');
                                  r.readAsDataURL(rubricFile);
                                });
                                if (dataUrl.includes(',')) {
                                  resolvedRubric = JSON.stringify({
                                    mimeType: rubricFile.type || 'image/jpeg',
                                    data: dataUrl.split(',')[1],
                                  });
                                }
                              }
                              const res = await fetch('/api/exams', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({
                                  title: examTitle.trim(),
                                  subject: examSubject,
                                  maxPoints: Number(examMaxPoints) > 0 ? Number(examMaxPoints) : 20,
                                  rubricText: resolvedRubric,
                                  examTemplateText: examTemplateScannedPayload || null,
                                  gradingNotes: gradingNotes.trim() || null,
                                  gradingFormula,
                                  gradeRounding,
                                  classId: selectedClassId,
                                }),
                              });
                              const created = await res.json();
                              if (!res.ok) {
                                setError(created.error || 'Prüfung konnte nicht angelegt werden.');
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                                return;
                              }
                              setExams((prev) => [created.exam, ...prev]);
                              setSelectedExamId(created.exam.id);
                            } catch {
                              setError('Fehler beim Anlegen der Prüfung für den QR-Scan.');
                              window.scrollTo({ top: 0, behavior: 'smooth' });
                              return;
                            }
                          }
                          setQrDialogMode('contextual');
                          setQrTargetMode('SUBMISSION');
                          setQrDialogOpen(true);
                        }}
                        sx={{
                          borderRadius: '8px',
                          textTransform: 'none',
                          fontWeight: 700,
                          borderColor: '#1b77d1',
                          color: '#1b77d1',
                        }}
                      >
                        Mit Smartphone scannen (QR)
                      </Button>
                    </Stack>

                    <Box
                      onDragOver={handleDragOver}
                      onDrop={handleDropStudent}
                      onClick={() => {
                        const input = document.createElement('input');
                        input.type = 'file';
                        input.multiple = selectedStudentId === 'AUTO';
                        input.accept = 'image/*,application/pdf';
                        input.onchange = (e: Event) => {
                          const target = e.target as HTMLInputElement;
                          if (target.files) {
                            const files = Array.from(target.files);
                            void handleIncomingStudentFiles(files);
                          }
                        };
                        input.click();
                      }}
                      sx={{
                        border:
                          studentFiles.length > 0 ? '2px dashed #2e7d32' : '2px dashed #cbd5e1',
                        borderRadius: '8px',
                        padding: '40px 20px',
                        textAlign: 'center',
                        cursor: 'pointer',
                        transition: 'all 0.2s ease',
                        backgroundColor: '#f8fafc',
                        '&:hover': {
                          borderColor: '#1b77d1',
                          backgroundColor: '#f1f5f9',
                        },
                      }}
                    >
                      {studentFiles.length > 0 ? (
                        <Stack spacing={1.5} sx={{ width: '100%' }}>
                          {selectedStudentId === 'AUTO' ? (
                            <>
                              <Typography
                                variant="subtitle2"
                                sx={{
                                  fontWeight: 700,
                                  color: 'text.secondary',
                                  textAlign: 'left',
                                  mb: 0.5,
                                }}
                              >
                                Ausgewählte Arbeiten ({studentFiles.length}):
                              </Typography>
                              <Box
                                sx={{
                                  display: 'grid',
                                  gridTemplateColumns: '1fr',
                                  gap: '8px',
                                  width: '100%',
                                }}
                              >
                                {studentFiles.map((file, fileIdx) => (
                                  <Box
                                    key={fileIdx}
                                    sx={{
                                      display: 'flex',
                                      alignItems: 'center',
                                      justifyContent: 'space-between',
                                      padding: '10px 16px',
                                      borderRadius: '8px',
                                      border: '1px solid #cbd5e1',
                                      background: '#ffffff',
                                    }}
                                    onClick={(e) => e.stopPropagation()} // Stop triggering file picker
                                  >
                                    <Stack
                                      direction="row"
                                      spacing={1.5}
                                      sx={{ alignItems: 'center', overflow: 'hidden' }}
                                    >
                                      <DescriptionIcon sx={{ color: 'primary.main' }} />
                                      <Box sx={{ textAlign: 'left', overflow: 'hidden' }}>
                                        <Typography
                                          variant="body2"
                                          sx={{
                                            fontWeight: 700,
                                            color: 'text.primary',
                                            overflow: 'hidden',
                                            textOverflow: 'ellipsis',
                                            whiteSpace: 'nowrap',
                                          }}
                                        >
                                          {file.name}
                                        </Typography>
                                        <Typography
                                          variant="caption"
                                          sx={{ color: 'text.secondary' }}
                                        >
                                          {(file.size / (1024 * 1024)).toFixed(2)} MB
                                        </Typography>
                                      </Box>
                                    </Stack>
                                    <Button
                                      size="small"
                                      color="error"
                                      sx={{
                                        minWidth: 'auto',
                                        p: '4px',
                                        textTransform: 'none',
                                        fontWeight: 600,
                                      }}
                                      onClick={() => {
                                        setStudentFiles((prev) =>
                                          prev.filter((_, idx) => idx !== fileIdx)
                                        );
                                      }}
                                    >
                                      Entfernen
                                    </Button>
                                  </Box>
                                ))}
                              </Box>
                              <Button
                                size="small"
                                variant="outlined"
                                startIcon={<CloudUploadIcon />}
                                sx={{ mt: 1, textTransform: 'none', fontWeight: 600 }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  const input = document.createElement('input');
                                  input.type = 'file';
                                  input.multiple = true;
                                  input.accept = 'image/*,application/pdf';
                                  input.onchange = (evt: Event) => {
                                    const target = evt.target as HTMLInputElement;
                                    if (target.files) {
                                      const files = Array.from(target.files);
                                      void handleIncomingStudentFiles(files);
                                    }
                                  };
                                  input.click();
                                }}
                              >
                                Weitere Arbeiten hinzufügen
                              </Button>
                            </>
                          ) : (
                            <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                              <DescriptionIcon sx={{ fontSize: '3rem', color: 'success.main' }} />
                              <Typography
                                variant="subtitle1"
                                sx={{ fontWeight: 650, color: 'success.main' }}
                              >
                                {studentFiles[0].name}
                              </Typography>
                              <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                                {(studentFiles[0].size / (1024 * 1024)).toFixed(2)} MB • Bereit für
                                Analyse
                              </Typography>
                            </Stack>
                          )}
                        </Stack>
                      ) : (
                        <Stack spacing={1.5} sx={{ alignItems: 'center' }}>
                          <CloudUploadIcon sx={{ fontSize: '3rem', color: 'text.secondary' }} />
                          <Typography
                            variant="subtitle1"
                            sx={{ fontWeight: 650, color: 'text.primary' }}
                          >
                            Zieh die Arbeit(en) hierher oder klicke zum Auswählen
                          </Typography>
                          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                            {selectedStudentId === 'AUTO'
                              ? 'Wähle eine oder mehrere Dateien aus • PDF, JPG, PNG'
                              : 'Wähle eine einzelne Datei aus • PDF, JPG, PNG'}
                          </Typography>
                          <Typography
                            variant="caption"
                            sx={{ color: '#64748b', fontWeight: 600, mt: 0.5 }}
                          >
                            (Hier nur Schülerarbeiten hochladen — die Musterlösung gehört in Schritt
                            ②)
                          </Typography>
                        </Stack>
                      )}
                    </Box>

                    {(() => {
                      const missingRequirements: string[] = [];
                      if (!selectedClassId) {
                        missingRequirements.push('Klasse auswählen (Schritt ①)');
                      }
                      if (!selectedStudentId) {
                        missingRequirements.push('Schülerzuordnung auswählen (Schritt ①)');
                      }
                      if (selectedExamId === 'NEW') {
                        if (!examTitle.trim()) {
                          missingRequirements.push('Prüfungstitel angeben (Schritt ②)');
                        }
                        if (!examMaxPoints || Number(examMaxPoints) <= 0) {
                          missingRequirements.push('Gültige Maximalpunktzahl angeben (Schritt ②)');
                        }
                        if (!rubricText.trim() && !rubricFile) {
                          missingRequirements.push('Musterlösung hinterlegen (Schritt ②)');
                        }
                      }
                      if (studentFiles.length === 0) {
                        missingRequirements.push(
                          'Mindestens eine Schülerarbeit hochladen (Schritt ③)'
                        );
                      }
                      const isStartDisabled = missingRequirements.length > 0 || loading;

                      return (
                        <>
                          {/* Start Button */}
                          <Button
                            onClick={() => startAnalysis(false)}
                            className="glow-button"
                            variant="contained"
                            fullWidth
                            size="large"
                            endIcon={<FlashOnIcon />}
                            disabled={isStartDisabled}
                            sx={{
                              padding: '14px',
                              borderRadius: '8px',
                              fontSize: '1rem',
                              fontWeight: 700,
                              marginTop: '20px',
                              backgroundColor: '#1b77d1',
                            }}
                          >
                            Korrektur starten!
                          </Button>

                          {missingRequirements.length > 0 && !loading && (
                            <Box
                              sx={{
                                marginTop: '12px',
                                padding: '10px 14px',
                                borderRadius: '8px',
                                backgroundColor: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                display: 'flex',
                                alignItems: 'flex-start',
                                gap: 1,
                              }}
                            >
                              <InfoOutlinedIcon
                                sx={{
                                  color: '#0284c7',
                                  fontSize: '1.2rem',
                                  mt: '2px',
                                  flexShrink: 0,
                                }}
                              />
                              <Box sx={{ minWidth: 0 }}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    fontWeight: 700,
                                    color: '#334155',
                                    display: 'block',
                                    mb: 0.25,
                                  }}
                                >
                                  Noch erforderlich, um die Korrektur zu starten:
                                </Typography>
                                <Typography
                                  variant="caption"
                                  sx={{ color: '#64748b', lineHeight: 1.4, display: 'block' }}
                                >
                                  {missingRequirements.join(' • ')}
                                </Typography>
                              </Box>
                            </Box>
                          )}
                        </>
                      );
                    })()}
                  </CardContent>
                </Card>
              )}
            </Stack>
          </Grid>
        </Grid>

        {/* Table of Recent Submissions (Gradings) */}
        {recentSubmissions.filter((sub) => sub.status === 'COMPLETED').length > 0 && (
          <Box sx={{ mt: 4 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2 }}>
              <HistoryIcon sx={{ color: '#0f172a' }} />
              <Typography
                variant="h5"
                sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em' }}
              >
                Letzte Korrekturen (Historie)
              </Typography>
            </Stack>
            <TableContainer
              component={Paper}
              sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}
            >
              <Table>
                <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                  <TableRow>
                    <TableCell sx={{ fontWeight: 'bold' }}>Schüler/in</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Prüfung</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Fach</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Punkte</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Note</TableCell>
                    <TableCell sx={{ fontWeight: 'bold' }}>Datum</TableCell>
                    <TableCell sx={{ fontWeight: 'bold', textAlign: 'right' }}>Aktion</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {recentSubmissions
                    .filter((sub) => sub.status === 'COMPLETED')
                    .map((sub) => {
                      const isUnassigned =
                        sub.studentName === 'Nicht zugeordnet' ||
                        Boolean(sub.isExamMatchUncertain) ||
                        Boolean(sub.isStudentMatchUncertain);
                      const activeExamIdForAssign = examAssignState[sub.id] || sub.examId;
                      const activeExamOption = allExams.find((e) => e.id === activeExamIdForAssign);
                      const activeClassIdForAssign = activeExamOption?.classId || sub.classId;
                      const availableStudentsForAssign =
                        studentsByClass[activeClassIdForAssign] || students;
                      const selectedAssignStudentId = assignState[sub.id] || '';
                      const hasExistingCorrectionForSelectedStudent = Boolean(
                        selectedAssignStudentId &&
                        recentSubmissions.some(
                          (other) =>
                            other.id !== sub.id &&
                            other.status === 'COMPLETED' &&
                            other.examId === activeExamIdForAssign &&
                            other.studentId === selectedAssignStudentId
                        )
                      );
                      const isRowDuplicateConflict =
                        hasExistingCorrectionForSelectedStudent ||
                        (duplicateAssignConflict?.submissionId === sub.id &&
                          duplicateAssignConflict?.studentId === selectedAssignStudentId);

                      return (
                        <TableRow
                          key={sub.id}
                          sx={{
                            backgroundColor: isUnassigned ? '#fffbeb' : 'inherit',
                            '&:hover': {
                              backgroundColor: isUnassigned ? '#fff7ed' : '#f8fafc',
                            },
                            '&:last-child td, &:last-child th': { border: 0 },
                          }}
                        >
                          <TableCell sx={{ fontWeight: 600 }}>
                            {!isUnassigned ? (
                              sub.studentName
                            ) : (
                              <UnassignedSubmissionCell
                                sub={sub}
                                allExams={allExams}
                                activeExamIdForAssign={activeExamIdForAssign}
                                availableStudentsForAssign={availableStudentsForAssign}
                                selectedAssignStudentId={selectedAssignStudentId}
                                isRowDuplicateConflict={isRowDuplicateConflict}
                                isReplacing={replacingSubmissionId === sub.id}
                                onChangeExam={(newExId) => {
                                  setExamAssignState((prev) => ({
                                    ...prev,
                                    [sub.id]: newExId,
                                  }));
                                  setAssignState((prev) => ({
                                    ...prev,
                                    [sub.id]: '',
                                  }));
                                }}
                                onChangeStudent={(val) => {
                                  setAssignState((prev) => ({
                                    ...prev,
                                    [sub.id]: val,
                                  }));
                                }}
                                onOpenCreateStudent={() => {
                                  setTargetClassForStudent(activeClassIdForAssign);
                                  setCreateStudentError('');
                                  setConfirmDuplicateStudent(false);
                                  setOpenCreateStudent(true);
                                }}
                                onAssign={handleManualAssign}
                              />
                            )}
                          </TableCell>
                          <TableCell>{sub.examTitle}</TableCell>
                          <TableCell>
                            <Chip
                              label={sub.subject}
                              size="small"
                              sx={{ backgroundColor: '#e3f2fd', color: '#1b77d1', fontWeight: 600 }}
                            />
                          </TableCell>
                          <TableCell sx={{ fontWeight: 600 }}>{sub.points}</TableCell>
                          <TableCell>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Chip
                                label={sub.grade}
                                size="small"
                                sx={{
                                  backgroundColor:
                                    parseFloat(sub.grade) >= 4.0 ? '#1b77d1' : '#dc2626',
                                  color: '#ffffff',
                                  fontWeight: 'bold',
                                  borderRadius: '6px',
                                }}
                              />
                              {(sub.uncertainStepsCount ?? 0) > 0 && (
                                <Chip
                                  label={`⚠ KI unsicher (${sub.uncertainStepsCount})`}
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
                          </TableCell>
                          <TableCell>{sub.date}</TableCell>
                          <TableCell sx={{ textAlign: 'right' }}>
                            <Stack
                              direction="row"
                              spacing={1}
                              sx={{ justifyContent: 'flex-end', alignItems: 'center' }}
                            >
                              <Link
                                href={`/correct/${sub.id}`}
                                passHref
                                style={{ textDecoration: 'none' }}
                              >
                                <Button
                                  variant="outlined"
                                  size="small"
                                  sx={{ textTransform: 'none', fontWeight: 600 }}
                                >
                                  Workspace öffnen
                                </Button>
                              </Link>
                              {isUnassigned && (
                                <Tooltip title="Ausstehenden Eintrag löschen">
                                  <IconButton
                                    size="small"
                                    onClick={() => executeCancelSubmission(sub.id)}
                                    sx={{
                                      color: 'text.secondary',
                                      '&:hover': {
                                        color: 'error.main',
                                        backgroundColor: '#fee2e2',
                                      },
                                    }}
                                  >
                                    <CloseIcon sx={{ fontSize: '1.1rem' }} />
                                  </IconButton>
                                </Tooltip>
                              )}
                            </Stack>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                </TableBody>
              </Table>
            </TableContainer>
          </Box>
        )}
      </Box>

      {/* Loading Overlay */}
      {loading && (
        <Box
          sx={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(10px)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 9999,
          }}
        >
          <CircularProgress
            size={64}
            thickness={4}
            sx={{
              color: 'primary.main',
              marginBottom: '24px',
            }}
          />

          <Typography
            variant="h5"
            component="h4"
            sx={{
              fontWeight: 700,
              color: 'text.primary',
              marginBottom: '8px',
              textAlign: 'center',
            }}
          >
            Prüfungsanalyse läuft
          </Typography>
          <Typography
            variant="body1"
            sx={{
              color: 'primary.main',
              textAlign: 'center',
              maxWidth: '400px',
              height: '24px',
              fontWeight: 600,
            }}
          >
            {loadingStep}
          </Typography>

          <Typography variant="caption" sx={{ color: 'text.secondary', marginTop: '30px' }}>
            Das dauert in der Regel ca. 5 bis 10 Sekunden...
          </Typography>
        </Box>
      )}

      {/* Dialog for Overwrite Confirmation */}
      <Dialog
        open={openConfirmOverwrite}
        onClose={() => setOpenConfirmOverwrite(false)}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '12px',
              padding: '8px',
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
          Korrektur überschreiben?
        </DialogTitle>
        <DialogContent>
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
            Für diese/n Schüler/in existiert bereits eine Korrektur für diese Prüfung. Wenn du
            fortfährst, wird die{' '}
            <Box component="span" sx={{ fontWeight: 'bold', color: 'text.primary' }}>
              bestehende Korrektur komplett überschrieben
            </Box>
            . Alle manuellen Änderungen und Lehrer-Kommentare gehen dabei unwiderruflich verloren.
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 1 }}>
          <Button
            onClick={() => setOpenConfirmOverwrite(false)}
            sx={{ textTransform: 'none', fontWeight: 650 }}
          >
            Abbrechen
          </Button>
          <Button
            onClick={() => {
              setOpenConfirmOverwrite(false);
              startAnalysis(true);
            }}
            variant="contained"
            color="error"
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '8px',
              backgroundColor: '#d32f2f',
              '&:hover': {
                backgroundColor: '#c62828',
              },
            }}
          >
            Ja, überschreiben
          </Button>
        </DialogActions>
      </Dialog>

      {/* Non-Exam Document Override Confirmation Dialog */}
      <Dialog
        open={Boolean(nonExamOverridePrompt)}
        onClose={() => setNonExamOverridePrompt(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle
          sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#b45309', fontWeight: 700 }}
        >
          <InfoOutlinedIcon />
          Nicht-Prüfungsdokument erkannt
        </DialogTitle>
        <DialogContent>
          <Typography variant="body1" sx={{ mb: 2 }}>
            {nonExamOverridePrompt?.reason}
          </Typography>
          {nonExamOverridePrompt?.summary && (
            <Alert severity="warning" sx={{ mb: 2 }}>
              <strong>Erkannter Inhalt:</strong> {nonExamOverridePrompt.summary}
            </Alert>
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary' }}>
            Das Dokument scheint keine Prüfung oder Schülerarbeit zu sein. Möchten Sie es dennoch
            ausdrücklich als Prüfung behandeln und zur Korrektur freigeben?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, gap: 1 }}>
          <Button onClick={() => setNonExamOverridePrompt(null)} variant="outlined" color="inherit">
            Abbrechen
          </Button>
          <Button
            onClick={() => {
              setNonExamOverridePrompt(null);
              setError('');
              startAnalysis(false, true);
            }}
            variant="contained"
            color="warning"
          >
            Trotzdem als Prüfung behandeln
          </Button>
        </DialogActions>
      </Dialog>

      {/* Dialog for Cancel Active Submission Confirmation */}
      <Dialog
        open={Boolean(cancelTargetId)}
        onClose={(_e, reason) => {
          if (cancelLoading || reason === 'backdropClick') return;
          setCancelTargetId(null);
        }}
        maxWidth="xs"
        fullWidth
        slotProps={{
          paper: {
            sx: {
              borderRadius: '12px',
              padding: '8px',
            },
          },
        }}
      >
        <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
          Korrektur abbrechen?
        </DialogTitle>
        <DialogContent>
          {cancelError && (
            <Alert severity="error" sx={{ mb: 1.5, borderRadius: '8px' }}>
              {cancelError}
            </Alert>
          )}
          <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5 }}>
            Möchtest du diese aktive Korrektur wirklich abbrechen und aus der Warteschlange löschen?
          </Typography>
        </DialogContent>
        <DialogActions sx={{ p: 2, pt: 1 }}>
          <Button
            onClick={() => setCancelTargetId(null)}
            disabled={cancelLoading}
            sx={{ textTransform: 'none', fontWeight: 650 }}
          >
            Zurück
          </Button>
          <Button
            onClick={async () => {
              if (!cancelTargetId) return;
              setCancelLoading(true);
              setCancelError('');
              try {
                const res = await fetch(`/api/submissions/${cancelTargetId}`, { method: 'DELETE' });
                if (!res.ok) {
                  const msg = await getErrorMessage(res, 'Fehler beim Abbrechen der Korrektur.');
                  setCancelError(msg);
                  return;
                }
                setCancelTargetId(null);
                fetchRecentSubmissions();
              } catch (err) {
                setCancelError(
                  err instanceof Error ? err.message : 'Fehler beim Abbrechen der Korrektur.'
                );
              } finally {
                setCancelLoading(false);
              }
            }}
            variant="contained"
            color="error"
            disabled={cancelLoading}
            sx={{
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '8px',
            }}
          >
            {cancelLoading ? <CircularProgress size={20} /> : 'Ja, abbrechen'}
          </Button>
        </DialogActions>
      </Dialog>

      {/* QR Code Mobile Camera Relay Dialog */}
      <QrScannerDialog
        open={qrDialogOpen}
        onClose={() => setQrDialogOpen(false)}
        targetMode={qrTargetMode}
        classId={qrDialogMode === 'contextual' ? selectedClassId : null}
        className={
          qrDialogMode === 'contextual'
            ? classes.find((c) => c.id === selectedClassId)?.name || null
            : null
        }
        examId={qrDialogMode === 'contextual' && selectedExamId !== 'NEW' ? selectedExamId : null}
        examTitle={
          qrDialogMode === 'contextual'
            ? exams.find((e) => e.id === selectedExamId)?.title || examTitle || null
            : null
        }
        studentId={
          qrDialogMode === 'contextual' &&
          qrTargetMode === 'SUBMISSION' &&
          selectedStudentId &&
          selectedStudentId !== 'AUTO'
            ? selectedStudentId
            : null
        }
        studentName={
          qrDialogMode === 'contextual' &&
          qrTargetMode === 'SUBMISSION' &&
          selectedStudentId &&
          selectedStudentId !== 'AUTO'
            ? students.find((s) => s.id === selectedStudentId)?.name || null
            : null
        }
        onRefreshSubmissions={fetchRecentSubmissions}
        onDocumentScanned={(payload, pageCount, mode) => {
          if (mode === 'RUBRIC') {
            setRubricFile(null);
            setRubricText(payload);
            setRubricScannedPages(pageCount);
          } else if (mode === 'EXAM_TEMPLATE') {
            setExamTemplateFile(null);
            setExamTemplateScannedPayload(payload);
            setExamTemplateScannedPages(pageCount);
          }
        }}
      />

      <PdfBatchSplitDialog
        open={pdfSplitQueue.length > 0}
        file={pdfSplitQueue[0]?.file || null}
        pages={pdfSplitQueue[0]?.pages || []}
        onCancel={() => {
          setPdfSplitQueue((prev) => prev.slice(1));
        }}
        onConfirmSplit={({ files }) => {
          if (files.length > 1 && selectedStudentId !== 'AUTO') {
            setSelectedStudentId('AUTO');
          }
          setStudentFiles((prev) => {
            if (selectedStudentId !== 'AUTO' && files.length === 1 && prev.length === 0) {
              return [files[0]];
            }
            return [...prev, ...files];
          });
          setPdfSplitQueue((prev) => prev.slice(1));
        }}
      />

      {/* Create Class Modal */}
      <Dialog
        open={openCreateClass}
        onClose={(_e, reason) => {
          if (createClassLoading || reason === 'backdropClick') return;
          setOpenCreateClass(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <form onSubmit={handleCreateClassSubmit}>
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
            Neue Klasse erstellen
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {createClassError && <Alert severity="error">{createClassError}</Alert>}
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Gib den Namen der Klasse ein (z. B. &quot;3a Sekundarstufe&quot; oder
                &quot;Gymnasium 1b&quot;).
              </Typography>
              <TextField
                label="Klassenname"
                fullWidth
                variant="outlined"
                value={newClassName}
                onChange={(e) => setNewClassName(e.target.value)}
                autoFocus
                required
                disabled={createClassLoading}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => {
                setOpenCreateClass(false);
                setNewClassName('');
                setCreateClassError('');
              }}
              disabled={createClassLoading}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={createClassLoading || !newClassName.trim()}
              startIcon={
                createClassLoading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <AddCircleIcon />
                )
              }
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: '#1b77d1',
                borderRadius: '8px',
              }}
            >
              {createClassLoading ? 'Wird erstellt...' : 'Klasse erstellen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Create Student Modal */}
      <Dialog
        open={openCreateStudent}
        onClose={(_e, reason) => {
          if (createStudentLoading || reason === 'backdropClick') return;
          setOpenCreateStudent(false);
          setConfirmDuplicateStudent(false);
        }}
        maxWidth="xs"
        fullWidth
      >
        <form onSubmit={handleCreateStudentSubmit}>
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
            Schüler/in hinzufügen
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2} sx={{ mt: 1 }}>
              {createStudentError && <Alert severity="error">{createStudentError}</Alert>}
              {confirmDuplicateStudent && (
                <Alert severity="warning">{DUPLICATE_STUDENT_NAME_WARNING}</Alert>
              )}
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Gib den Vor- und Nachnamen der Schülerin oder des Schülers ein.
              </Typography>
              <TextField
                label="Vor- und Nachname"
                placeholder="z. B. Max Muster"
                fullWidth
                variant="outlined"
                value={newStudentName}
                onChange={(e) => {
                  setNewStudentName(e.target.value);
                  if (confirmDuplicateStudent) setConfirmDuplicateStudent(false);
                  if (createStudentError) setCreateStudentError('');
                }}
                autoFocus
                required
                disabled={createStudentLoading}
                sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
              />
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => {
                setOpenCreateStudent(false);
                setNewStudentName('');
                setCreateStudentError('');
                setConfirmDuplicateStudent(false);
              }}
              disabled={createStudentLoading}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              type="submit"
              variant="contained"
              color={confirmDuplicateStudent ? 'warning' : 'primary'}
              disabled={createStudentLoading || !newStudentName.trim()}
              startIcon={
                createStudentLoading ? (
                  <CircularProgress size={16} color="inherit" />
                ) : (
                  <AddCircleIcon />
                )
              }
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                ...(confirmDuplicateStudent ? {} : { backgroundColor: '#1b77d1' }),
                borderRadius: '8px',
              }}
            >
              {createStudentLoading
                ? 'Wird gespeichert...'
                : confirmDuplicateStudent
                  ? 'Trotzdem hinzufügen'
                  : 'Hinzufügen'}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </DashboardLayout>
  );
}
