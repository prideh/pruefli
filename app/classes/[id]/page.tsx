'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
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
  Chip,
  IconButton,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  ButtonGroup,
  Tooltip,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import { getErrorMessage } from '@/lib/api-error';
import AddIcon from '@mui/icons-material/Add';
import GroupAddIcon from '@mui/icons-material/GroupAdd';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import SchoolIcon from '@mui/icons-material/School';
import PersonIcon from '@mui/icons-material/Person';
import AssessmentIcon from '@mui/icons-material/Assessment';
import TrendingUpIcon from '@mui/icons-material/TrendingUp';
import StarsIcon from '@mui/icons-material/Stars';
import GroupIcon from '@mui/icons-material/Group';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import { BarChart } from '@mui/x-charts/BarChart';
import DashboardLayout from '@/components/DashboardLayout';
import ErrorState from '@/components/ErrorState';
import {
  useDataCache,
  invalidateClasses,
  invalidateExams,
  invalidateSubmissions,
  invalidateStudents,
} from '@/lib/dataCache';
import {
  resolveTeacherSubjects,
  computeClassSubjectBreakdown,
  getSubjectSupportInfo,
  normalizeSubjectValue,
  formatClassDeletionConsequences,
  isClassDeleteConfirmationValid,
  formatClassDeletedCompletionMessage,
  type ClassSubjectStatItem,
  type ClassDeletionImpact,
} from '@/lib/grading';

interface ClassData {
  id: string;
  name: string;
  createdAt: string;
  teacherId: string;
  subjects?: string[];
  isArchived?: boolean;
  archivedAt?: string | null;
  deletionImpact?: ClassDeletionImpact;
}

interface ClassStats {
  averageGrade: string;
  passRate: string;
  highestGrade: string;
  lowestGrade: string;
  stdDev: string;
  totalSubmissions: number;
  gradeDistribution: Record<string, number>;
}

interface StudentRosterItem {
  id: string;
  name: string;
  totalExamsCorrected: number;
  averageGrade: string;
}

interface ExamRosterItem {
  id: string;
  title: string;
  subject: string;
  maxPoints: number;
  submissionsCount: number;
  averageGrade: string;
}

interface SimpleClassInfo {
  id: string;
  name: string;
}

interface BulkStudentItem {
  id: string;
  name: string;
  isExistingDuplicate: boolean;
  isInputDuplicate: boolean;
  decision: 'add' | 'skip';
}

interface ClassDetailsApiResponse {
  class: ClassData;
  deletionImpact?: ClassDeletionImpact;
  stats: ClassStats;
  subjectStats?: ClassSubjectStatItem[];
  students: StudentRosterItem[];
  exams: ExamRosterItem[];
}

export default function ClassDetailsPage() {
  const router = useRouter();
  const params = useParams();
  const classId = params.id as string;

  const fetchClassDetailsApi = React.useCallback(async () => {
    const res = await fetch(`/api/classes/${classId}`);
    if (!res.ok) {
      if (res.status === 404) {
        router.replace('/classes');
        throw new Error('Klasse nicht gefunden.');
      }
      throw new Error('Klassendetails konnten nicht geladen werden.');
    }
    const data = await res.json();
    return data as ClassDetailsApiResponse;
  }, [classId, router]);

  const {
    data: cachedDetails,
    loading,
    error,
    revalidate: fetchData,
  } = useDataCache<ClassDetailsApiResponse>(
    classId ? `/api/classes/${classId}` : null,
    fetchClassDetailsApi
  );

  const classData = cachedDetails?.class || null;
  const stats = cachedDetails?.stats || null;
  const students = React.useMemo(() => cachedDetails?.students || [], [cachedDetails?.students]);
  const exams = React.useMemo(() => cachedDetails?.exams || [], [cachedDetails?.exams]);

  const fetchSubjectsApi = React.useCallback(async () => {
    const res = await fetch('/api/subjects');
    if (!res.ok) return { savedSubjects: null, existingExamSubjects: [] };
    return (await res.json()) as {
      savedSubjects?: string[] | null;
      existingExamSubjects?: string[];
    };
  }, []);

  const { data: cachedSubjectsData } = useDataCache<{
    savedSubjects?: string[] | null;
    existingExamSubjects?: string[];
  }>('/api/subjects', fetchSubjectsApi);

  const mySubjects = React.useMemo(
    () =>
      resolveTeacherSubjects(cachedSubjectsData?.savedSubjects ?? null, [
        ...(cachedSubjectsData?.existingExamSubjects ?? []),
        ...exams.map((ex) => ex.subject),
      ]).map((item) => item.value),
    [cachedSubjectsData, exams]
  );

  const classSubjectBreakdown = React.useMemo(
    () => computeClassSubjectBreakdown(exams, classData?.subjects),
    [exams, classData?.subjects]
  );

  const [allClasses, setAllClasses] = useState<SimpleClassInfo[]>([]); // For student transfer selection

  useEffect(() => {
    let active = true;
    fetch('/api/classes')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (active && data?.classes) setAllClasses(data.classes);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // Dialogs States
  const [openAddStudent, setOpenAddStudent] = useState(false);
  const [newStudentName, setNewStudentName] = useState('');
  const [studentActionLoading, setStudentActionLoading] = useState(false);
  const [studentActionError, setStudentActionError] = useState('');

  const [openTransfer, setOpenTransfer] = useState(false);
  const [selectedStudent, setSelectedStudent] = useState<StudentRosterItem | null>(null);
  const [targetClassId, setTargetClassId] = useState('');

  const [openDeleteStudent, setOpenDeleteStudent] = useState(false);
  const [openDeleteClass, setOpenDeleteClass] = useState(false);
  const [deleteClassError, setDeleteClassError] = useState('');
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [openArchiveClass, setOpenArchiveClass] = useState(false);
  const [archiveClassError, setArchiveClassError] = useState('');
  const [openEditClass, setOpenEditClass] = useState(false);
  const [editedClassName, setEditedClassName] = useState('');
  const [editedClassSubjects, setEditedClassSubjects] = useState<string[]>([]);
  const [editClassError, setEditClassError] = useState('');
  const isArchived = Boolean(classData?.isArchived);

  const deletionImpact: ClassDeletionImpact = React.useMemo(() => {
    const impactSource = cachedDetails?.deletionImpact || classData?.deletionImpact;
    const examsSubSum = exams.reduce((sum, ex) => sum + (ex.submissionsCount || 0), 0);
    return {
      studentsCount: impactSource?.studentsCount ?? students.length,
      examsCount: impactSource?.examsCount ?? exams.length,
      submissionsCount:
        impactSource?.submissionsCount ?? Math.max(stats?.totalSubmissions ?? 0, examsSubSum),
    };
  }, [cachedDetails?.deletionImpact, classData?.deletionImpact, students.length, exams, stats]);
  const isDeleteNameConfirmed = isClassDeleteConfirmationValid(
    classData?.name || '',
    deleteConfirmName
  );

  const handleArchiveToggle = async (archived: boolean) => {
    setStudentActionLoading(true);
    setArchiveClassError('');
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived }),
      });
      if (!res.ok) {
        const msg = await getErrorMessage(
          res,
          archived
            ? 'Klasse konnte nicht archiviert werden.'
            : 'Klasse konnte nicht wiederhergestellt werden.'
        );
        setArchiveClassError(msg);
        return;
      }
      setOpenArchiveClass(false);
      invalidateClasses(classId);
      invalidateExams(undefined, classId);
      invalidateSubmissions(undefined, undefined, classId);
      await fetchData();
    } catch (err) {
      setArchiveClassError(
        err instanceof Error ? err.message : 'Status konnte nicht geändert werden.'
      );
    } finally {
      setStudentActionLoading(false);
    }
  };

  const handleOpenEditClass = () => {
    setEditClassError('');
    setEditedClassName(classData?.name || '');
    setEditedClassSubjects(
      Array.isArray(classData?.subjects)
        ? classData.subjects.map((s) => normalizeSubjectValue(s)).filter(Boolean)
        : []
    );
    if ((classData?.name || '').trim().length > 100) {
      setEditClassError('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
    }
    setOpenEditClass(true);
  };

  const handleToggleEditedSubject = (subject: string) => {
    const normalized = normalizeSubjectValue(subject);
    if (!normalized) return;
    setEditedClassSubjects((prev) => {
      const exists = prev.some((s) => s.toLowerCase() === normalized.toLowerCase());
      if (exists) {
        return prev.filter((s) => s.toLowerCase() !== normalized.toLowerCase());
      }
      return [...prev, normalized];
    });
  };

  // Bulk Add Dialog State
  const [openBulkAdd, setOpenBulkAdd] = useState(false);
  const [bulkInputText, setBulkInputText] = useState('');
  const [bulkStep, setBulkStep] = useState<'input' | 'preview' | 'result'>('input');
  const [bulkParsedItems, setBulkParsedItems] = useState<BulkStudentItem[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [bulkResult, setBulkResult] = useState<{
    added: number;
    skipped: number;
    failed: number;
    failedDetails: { name: string; error: string }[];
  } | null>(null);
  const [bulkError, setBulkError] = useState('');

  const handleOpenBulkAdd = () => {
    setBulkInputText('');
    setBulkStep('input');
    setBulkParsedItems([]);
    setBulkResult(null);
    setBulkError('');
    setOpenBulkAdd(true);
  };

  const handleParseBulkInput = () => {
    const lines = bulkInputText
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (lines.length === 0) {
      setBulkError('Bitte gib mindestens einen Schülernamen ein.');
      return;
    }

    setBulkError('');

    const inputCounts = new Map<string, number>();
    for (const name of lines) {
      const lower = name.toLowerCase();
      inputCounts.set(lower, (inputCounts.get(lower) || 0) + 1);
    }

    const existingSet = new Set(students.map((s) => s.name.trim().toLowerCase()));

    const items: BulkStudentItem[] = lines.map((name, index) => {
      const lower = name.toLowerCase();
      const isExistingDuplicate = existingSet.has(lower);
      const isInputDuplicate = (inputCounts.get(lower) || 0) > 1;
      const isFlagged = isExistingDuplicate || isInputDuplicate;

      return {
        id: `bulk-${index}-${name}`,
        name,
        isExistingDuplicate,
        isInputDuplicate,
        decision: isFlagged ? 'skip' : 'add',
      };
    });

    setBulkParsedItems(items);
    setBulkStep('preview');
  };

  const handleConfirmBulkAdd = async () => {
    setBulkLoading(true);
    setBulkError('');

    const itemsToAdd = bulkParsedItems.filter((item) => item.decision === 'add');
    const skippedCount = bulkParsedItems.filter((item) => item.decision === 'skip').length;

    let addedCount = 0;
    const failedDetails: { name: string; error: string }[] = [];

    for (const item of itemsToAdd) {
      try {
        const res = await fetch(`/api/classes/${classId}/students`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: item.name }),
        });

        if (!res.ok) {
          const errorMsg = await getErrorMessage(res, 'Fehler beim Erstellen.');
          failedDetails.push({ name: item.name, error: errorMsg });
        } else {
          addedCount++;
        }
      } catch (err) {
        failedDetails.push({
          name: item.name,
          error: err instanceof Error ? err.message : 'Netzwerkfehler',
        });
      }
    }

    // Refresh roster after creating students
    invalidateStudents(undefined, classId);
    await fetchData();

    setBulkResult({
      added: addedCount,
      skipped: skippedCount,
      failed: failedDetails.length,
      failedDetails,
    });

    setBulkStep('result');
    setBulkLoading(false);
  };

  // ADD Student
  const handleAddStudent = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newStudentName.trim()) {
      setStudentActionError('Bitte gib einen Namen an.');
      return;
    }

    setStudentActionLoading(true);
    setStudentActionError('');

    try {
      const res = await fetch(`/api/classes/${classId}/students`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newStudentName }),
      });

      if (!res.ok) {
        const errorMsg = await getErrorMessage(
          res,
          'Schüler/in konnte nicht eingeschrieben werden.'
        );
        setStudentActionError(errorMsg);
        return;
      }

      setOpenAddStudent(false);
      setNewStudentName('');
      invalidateStudents(undefined, classId);
      await fetchData(); // Refresh data
    } catch (err) {
      setStudentActionError(err instanceof Error ? err.message : 'Fehler beim Hinzufügen.');
    } finally {
      setStudentActionLoading(false);
    }
  };

  // TRANSFER Student
  const handleTransferStudent = async () => {
    if (!selectedStudent) return;
    if (!targetClassId) {
      setStudentActionError('Bitte wähle eine Zielklasse aus.');
      return;
    }

    setStudentActionLoading(true);
    setStudentActionError('');

    try {
      const res = await fetch(`/api/students/${selectedStudent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: targetClassId }),
      });

      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Transfer fehlgeschlagen.');
        setStudentActionError(errorMsg);
        return;
      }

      setOpenTransfer(false);
      setSelectedStudent(null);
      setTargetClassId('');
      invalidateStudents(selectedStudent.id, classId);
      invalidateClasses(targetClassId);
      await fetchData(); // Refresh
    } catch (err) {
      setStudentActionError(err instanceof Error ? err.message : 'Fehler beim Transfer.');
    } finally {
      setStudentActionLoading(false);
    }
  };

  // DELETE Student
  const handleDeleteStudent = async () => {
    if (!selectedStudent) return;
    setStudentActionLoading(true);
    setStudentActionError('');

    try {
      const res = await fetch(`/api/students/${selectedStudent.id}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Löschen fehlgeschlagen.');
        setStudentActionError(errorMsg);
        return;
      }

      setOpenDeleteStudent(false);
      setSelectedStudent(null);
      invalidateStudents(selectedStudent.id, classId);
      invalidateSubmissions(undefined, undefined, classId, selectedStudent.id);
      await fetchData(); // Refresh
    } catch (err) {
      setStudentActionError(err instanceof Error ? err.message : 'Fehler beim Löschen.');
    } finally {
      setStudentActionLoading(false);
    }
  };

  // DELETE Class (only allowed for archived classes with type-confirmation)
  const handleDeleteClass = async () => {
    if (!isArchived) {
      setDeleteClassError(
        'Aktive Klassen können nicht direkt gelöscht werden. Bitte archiviere die Klasse zuerst.'
      );
      return;
    }
    if (!isDeleteNameConfirmed) {
      setDeleteClassError(
        `Bitte gib zur Bestätigung den exakten Klassennamen „${classData?.name || ''}“ ein.`
      );
      return;
    }

    setStudentActionLoading(true);
    setDeleteClassError('');
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmName: deleteConfirmName.trim() }),
      });
      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Klasse konnte nicht gelöscht werden.');
        setDeleteClassError(errorMsg);
        return;
      }
      const resData = await res.json().catch(() => null);
      const completionMessage =
        resData?.message ||
        formatClassDeletedCompletionMessage(classData?.name || '', deletionImpact);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('pruefli_class_deleted_notice', completionMessage);
      }
      invalidateClasses(classId);
      invalidateExams(undefined, classId);
      invalidateSubmissions(undefined, undefined, classId);
      setOpenDeleteClass(false);
      setDeleteConfirmName('');
      router.push('/classes');
    } catch (err) {
      setDeleteClassError(err instanceof Error ? err.message : 'Fehler beim Löschen der Klasse.');
    } finally {
      setStudentActionLoading(false);
    }
  };

  // EDIT Class Name
  const handleEditClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = editedClassName.trim();
    if (!trimmed) {
      setEditClassError('Klassenname ist erforderlich.');
      return;
    }
    if (trimmed.length > 100) {
      setEditClassError('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
      return;
    }

    setStudentActionLoading(true);
    setEditClassError('');
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, subjects: editedClassSubjects }),
      });
      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Klassenname konnte nicht geändert werden.');
        setEditClassError(errorMsg);
        return;
      }
      setOpenEditClass(false);
      invalidateClasses(classId);
      invalidateExams(undefined, classId);
      invalidateSubmissions(undefined, undefined, classId);
      await fetchData();
    } catch (err) {
      setEditClassError(err instanceof Error ? err.message : 'Fehler beim Ändern des Namens.');
    } finally {
      setStudentActionLoading(false);
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
          <Link href="/classes" passHref style={{ textDecoration: 'none' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', fontWeight: 650, color: 'text.secondary' }}
            >
              Zurück zur Klassenübersicht
            </Button>
          </Link>
          <ErrorState
            title="Fehler beim Laden der Klassendetails"
            message={error}
            onRetry={() => {
              fetchData();
            }}
          />
        </Box>
      </DashboardLayout>
    );
  }

  // Pre-process grade distribution for MUI Charts
  const distributionKeys = ['1.0-2.0', '2.0-3.0', '3.0-4.0', '4.0-5.0', '5.0-6.0'];
  const chartData = stats?.gradeDistribution
    ? distributionKeys.map((key) => stats.gradeDistribution[key] || 0)
    : [0, 0, 0, 0, 0];

  return (
    <DashboardLayout>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Navigation back and Class Title */}
        <Stack spacing={2}>
          <Link href="/classes" passHref style={{ textDecoration: 'none' }}>
            <Button
              startIcon={<ArrowBackIcon />}
              sx={{ textTransform: 'none', fontWeight: 650, color: 'text.secondary' }}
            >
              Zurück zur Klassenübersicht
            </Button>
          </Link>

          <Box
            sx={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: { xs: 'flex-start', sm: 'center' },
              flexWrap: 'wrap',
              gap: 2,
              width: '100%',
              minWidth: 0,
            }}
          >
            <Box sx={{ minWidth: 0, flex: '1 1 300px', maxWidth: '100%' }}>
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ alignItems: 'center', flexWrap: 'wrap', mb: 0.5 }}
              >
                <Typography
                  variant="h4"
                  sx={{
                    fontWeight: 800,
                    color: '#0f172a',
                    letterSpacing: '-0.02em',
                    wordBreak: 'break-word',
                    overflowWrap: 'anywhere',
                  }}
                >
                  {classData?.name}
                </Typography>
                {isArchived && (
                  <Chip
                    icon={<ArchiveIcon sx={{ fontSize: '0.95rem !important' }} />}
                    label="Archiviert (Lesemodus)"
                    size="small"
                    sx={{
                      fontWeight: 700,
                      backgroundColor: '#e2e8f0',
                      color: '#334155',
                      borderRadius: '6px',
                    }}
                  />
                )}
              </Stack>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                Erstellt am {classData?.createdAt} • {students.length} Schüler/innen eingeschrieben
                {isArchived && classData?.archivedAt
                  ? ` • Archiviert am ${new Date(classData.archivedAt).toLocaleDateString('de-CH')}`
                  : ''}
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                flexShrink: 0,
                alignItems: 'center',
                flexWrap: 'wrap',
                position: 'relative',
                zIndex: 1,
              }}
            >
              {!isArchived ? (
                <>
                  <Button
                    variant="outlined"
                    startIcon={<EditIcon />}
                    onClick={handleOpenEditClass}
                    sx={{
                      borderRadius: '8px',
                      textTransform: 'none',
                      fontWeight: 650,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Name ändern
                  </Button>
                  <Button
                    variant="outlined"
                    startIcon={<ArchiveIcon />}
                    onClick={() => {
                      setArchiveClassError('');
                      setOpenArchiveClass(true);
                    }}
                    sx={{
                      borderRadius: '8px',
                      textTransform: 'none',
                      fontWeight: 650,
                      whiteSpace: 'nowrap',
                      color: '#334155',
                      borderColor: '#cbd5e1',
                      '&:hover': { backgroundColor: '#f8fafc', borderColor: '#94a3b8' },
                    }}
                  >
                    Klasse archivieren
                  </Button>
                </>
              ) : (
                <>
                  <Button
                    variant="contained"
                    startIcon={
                      studentActionLoading ? (
                        <CircularProgress size={16} color="inherit" />
                      ) : (
                        <UnarchiveIcon />
                      )
                    }
                    disabled={studentActionLoading}
                    onClick={() => handleArchiveToggle(false)}
                    sx={{
                      borderRadius: '8px',
                      textTransform: 'none',
                      fontWeight: 700,
                      whiteSpace: 'nowrap',
                      backgroundColor: '#1b77d1',
                    }}
                  >
                    Wiederherstellen
                  </Button>
                  <Button
                    variant="outlined"
                    color="error"
                    startIcon={<DeleteIcon />}
                    onClick={() => {
                      setDeleteClassError('');
                      setDeleteConfirmName('');
                      void fetchData();
                      setOpenDeleteClass(true);
                    }}
                    sx={{
                      borderRadius: '8px',
                      textTransform: 'none',
                      fontWeight: 650,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Endgültig löschen
                  </Button>
                </>
              )}
            </Stack>
          </Box>
        </Stack>

        {isArchived && (
          <Alert
            severity="info"
            icon={<ArchiveIcon sx={{ color: '#0369a1' }} />}
            sx={{
              borderRadius: '12px',
              border: '1px solid #bae6fd',
              backgroundColor: '#f0f9ff',
              color: '#0c4a6e',
            }}
          >
            <strong>Archivierte Klasse (Schuljahreswechsel):</strong> Alle Schülerprofile,
            Prüfungen, Noten und KI-Rückmeldungen dieser Klasse sind im Lesemodus vollständig
            einsehbar. Sie fliesst nicht in die laufenden Statistiken deiner aktiven Klassen ein und
            bleibt zeitlich unbegrenzt gespeichert (kein automatischer Ablauf / keine Auto-Löschung
            nach Frist). Um Änderungen vorzunehmen oder neue Prüfungen durchzuführen, kannst du die
            Klasse jederzeit über <strong>Wiederherstellen</strong> reaktivieren.
          </Alert>
        )}
        {archiveClassError && !openArchiveClass && (
          <Alert
            severity="error"
            onClose={() => setArchiveClassError('')}
            sx={{ borderRadius: '8px' }}
          >
            {archiveClassError}
          </Alert>
        )}

        {/* 1. Statistics Summary Grid */}
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
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline' }}>
                    <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                      {stats?.averageGrade}
                    </Typography>
                    {stats?.averageGrade !== 'N/A' && (
                      <Typography
                        variant="caption"
                        sx={{ color: 'success.main', fontWeight: 'bold' }}
                      >
                        Schweizer Note
                      </Typography>
                    )}
                  </Stack>
                </Box>
              </CardContent>
            </Card>
          </Grid>

          {/* Card 2: Passing Rate */}
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

          {/* Card 4: Standard Deviation */}
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
                    Standardabweichung
                  </Typography>
                  <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a' }}>
                    ±{stats?.stdDev}
                  </Typography>
                </Box>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* 2. Visual Analytics Section: Grade Histogram and Quick Actions */}
        <Grid container spacing={4}>
          <Grid size={{ xs: 12, md: 6 }}>
            <Card
              sx={{
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: 'none',
                height: '100%',
              }}
            >
              <CardContent sx={{ p: 3 }}>
                <Typography variant="h6" sx={{ fontWeight: 800, color: '#0f172a', mb: 2 }}>
                  Notenverteilung (Klassenweit)
                </Typography>
                {stats?.totalSubmissions === 0 ? (
                  <Typography
                    variant="body2"
                    sx={{
                      color: 'text.secondary',
                      fontStyle: 'italic',
                      py: 4,
                      textAlign: 'center',
                    }}
                  >
                    Noch keine bewerteten Prüfungsarbeiten für diese Klasse vorhanden.
                  </Typography>
                ) : (
                  <Box sx={{ display: 'flex', justifyContent: 'center' }}>
                    <BarChart
                      xAxis={[
                        {
                          scaleType: 'band',
                          data: ['1.0-2.0', '2.0-3.0', '3.0-4.0', '4.0-5.0', '5.0-6.0'],
                        },
                      ]}
                      series={[{ data: chartData, label: 'Anzahl Arbeiten', color: '#1b77d1' }]}
                      width={480}
                      height={260}
                      margin={{ top: 20, bottom: 30, left: 30, right: 10 }}
                    />
                  </Box>
                )}
              </CardContent>
            </Card>
          </Grid>

          <Grid size={{ xs: 12, md: 6 }}>
            <Card
              sx={{
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: 'none',
                height: '100%',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              <CardContent sx={{ p: 4, textAlign: 'center' }}>
                <Box
                  sx={{
                    width: '60px',
                    height: '60px',
                    borderRadius: '12px',
                    backgroundColor: '#f0f7ff',
                    color: '#1b77d1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    mx: 'auto',
                    mb: 2,
                  }}
                >
                  <GroupIcon sx={{ fontSize: '2rem' }} />
                </Box>
                <Typography variant="h5" sx={{ fontWeight: 800, color: '#0f172a', mb: 1 }}>
                  Prüfung korrigieren
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', maxWidth: '380px', mx: 'auto', mb: 3 }}
                >
                  Du möchtest eine handschriftliche Arbeit eines Schülers aus dieser Klasse
                  bewerten? Navigiere zum Workspace.
                </Typography>
                <Link
                  href="/dashboard"
                  passHref
                  style={{ textDecoration: 'none', pointerEvents: isArchived ? 'none' : 'auto' }}
                >
                  <Button
                    variant="contained"
                    endIcon={<ArrowForwardIcon />}
                    disabled={isArchived}
                    sx={{
                      padding: '10px 24px',
                      borderRadius: '8px',
                      fontWeight: 700,
                      textTransform: 'none',
                      backgroundColor: '#1b77d1',
                    }}
                  >
                    Korrektur-Workspace starten
                  </Button>
                </Link>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* 2b. Class Subjects & Subject Grade Breakdown Card */}
        <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
          <CardContent sx={{ p: 3 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2,
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Stack spacing={0.5}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <SchoolIcon sx={{ color: '#0f172a' }} />
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 850, color: '#0f172a', letterSpacing: '-0.01em' }}
                  >
                    Fächer & Fachschnitte dieser Klasse
                  </Typography>
                  <Chip
                    label={
                      classData?.subjects && classData.subjects.length > 0
                        ? `${classData.subjects.length} Fächer zugewiesen`
                        : 'Keine Einschränkung (Alle „Meine Fächer“)'
                    }
                    size="small"
                    sx={{
                      fontWeight: 700,
                      fontSize: '0.72rem',
                      backgroundColor:
                        classData?.subjects && classData.subjects.length > 0
                          ? '#eff6ff'
                          : '#f1f5f9',
                      color:
                        classData?.subjects && classData.subjects.length > 0
                          ? '#1d4ed8'
                          : '#475569',
                      border:
                        classData?.subjects && classData.subjects.length > 0
                          ? '1px solid #bfdbfe'
                          : '1px solid #cbd5e1',
                    }}
                  />
                </Stack>
                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 550 }}>
                  Fachbezogene Schnitte und Statistiken aus den vorhandenen Prüfungsdaten dieser
                  Klasse. Der Unterstützungsstatus pro Fach bleibt unverändert; Organisation
                  impliziert keine Korrekturqualität.
                </Typography>
              </Stack>
              <Button
                variant="outlined"
                size="small"
                startIcon={<EditIcon />}
                disabled={isArchived}
                onClick={handleOpenEditClass}
                sx={{
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 650,
                  fontSize: '0.85rem',
                }}
              >
                Fächer der Klasse bearbeiten
              </Button>
            </Box>

            {classSubjectBreakdown.length === 0 ? (
              <Box sx={{ py: 3, textAlign: 'center' }}>
                <Typography variant="body2" sx={{ color: 'text.secondary', fontStyle: 'italic' }}>
                  Noch keine Fächer-Teilmenge zugewiesen und noch keine Prüfungen in dieser Klasse
                  vorhanden.
                </Typography>
              </Box>
            ) : (
              <TableContainer
                component={Box}
                sx={{ border: '1px solid #f1f5f9', borderRadius: '8px' }}
              >
                <Table size="small">
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Fach</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Unterstützungsstatus</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Prüfungen in Klasse</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Bewertete Arbeiten</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Fachschnitt (Ø)</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {classSubjectBreakdown.map((item) => {
                      const supportInfo = item.supportInfo;
                      const isAssignedToClass = (classData?.subjects || []).some(
                        (s) => normalizeSubjectValue(s).toLowerCase() === item.value.toLowerCase()
                      );
                      return (
                        <TableRow
                          key={item.value}
                          sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                        >
                          <TableCell sx={{ fontWeight: 700, color: '#0f172a' }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <span>{item.label}</span>
                              {isAssignedToClass && (
                                <Chip
                                  label="Klassen-Fach"
                                  size="small"
                                  sx={{
                                    height: '20px',
                                    fontSize: '0.68rem',
                                    fontWeight: 700,
                                    backgroundColor: '#eff6ff',
                                    color: '#1d4ed8',
                                  }}
                                />
                              )}
                            </Stack>
                          </TableCell>
                          <TableCell>
                            <Tooltip title={supportInfo.supportDescription} arrow>
                              <Chip
                                label={supportInfo.supportBadge}
                                size="small"
                                sx={{
                                  height: '22px',
                                  fontSize: '0.72rem',
                                  fontWeight: 700,
                                  backgroundColor:
                                    supportInfo.supportLevel === 'VERIFIED_MODALITY'
                                      ? '#dcfce7'
                                      : supportInfo.supportLevel === 'FOCUS_PROFILE'
                                        ? '#e0f2fe'
                                        : '#f1f5f9',
                                  color:
                                    supportInfo.supportLevel === 'VERIFIED_MODALITY'
                                      ? '#15803d'
                                      : supportInfo.supportLevel === 'FOCUS_PROFILE'
                                        ? '#0369a1'
                                        : '#475569',
                                }}
                              />
                            </Tooltip>
                          </TableCell>
                          <TableCell>{item.examsCount} Prüfungen</TableCell>
                          <TableCell>{item.submissionsCount} bewertet</TableCell>
                          <TableCell>
                            {item.averageGrade !== 'N/A' ? (
                              <Chip
                                label={item.averageGrade}
                                size="small"
                                sx={{
                                  backgroundColor:
                                    parseFloat(item.averageGrade) >= 4.0 ? '#dcfce7' : '#fee2e2',
                                  color:
                                    parseFloat(item.averageGrade) >= 4.0 ? '#15803d' : '#b91c1c',
                                  fontWeight: 'bold',
                                  borderRadius: '6px',
                                }}
                              />
                            ) : (
                              <Typography
                                variant="body2"
                                sx={{
                                  color: 'text.secondary',
                                  fontStyle: 'italic',
                                  fontSize: '0.85rem',
                                }}
                              >
                                Keine Noten
                              </Typography>
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

        {/* 3. Students Roster Card */}
        <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
          <CardContent sx={{ p: 3 }}>
            <Box
              sx={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                mb: 2.5,
                flexWrap: 'wrap',
                gap: 2,
              }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <PersonIcon sx={{ color: '#0f172a' }} />
                <Typography
                  variant="h6"
                  sx={{ fontWeight: 850, color: '#0f172a', letterSpacing: '-0.01em' }}
                >
                  Klassenliste (Schüler/innen)
                </Typography>
              </Stack>
              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={isArchived}
                  onClick={() => setOpenAddStudent(true)}
                  sx={{
                    borderRadius: '8px',
                    textTransform: 'none',
                    fontWeight: 650,
                    fontSize: '0.85rem',
                  }}
                >
                  Schüler/in hinzufügen
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<GroupAddIcon />}
                  disabled={isArchived}
                  onClick={handleOpenBulkAdd}
                  sx={{
                    borderRadius: '8px',
                    textTransform: 'none',
                    fontWeight: 650,
                    fontSize: '0.85rem',
                  }}
                >
                  Mehrere Schüler hinzufügen
                </Button>
              </Stack>
            </Box>

            {students.length === 0 ? (
              <Box sx={{ py: 4, textAlign: 'center' }}>
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', fontStyle: 'italic', mb: 2 }}
                >
                  Bisher sind keine Schüler/innen eingeschrieben.
                </Typography>
                {!isArchived && (
                  <Stack direction="row" spacing={1.5} sx={{ justifyContent: 'center' }}>
                    <Button
                      variant="contained"
                      startIcon={<AddIcon />}
                      onClick={() => setOpenAddStudent(true)}
                      sx={{
                        borderRadius: '8px',
                        textTransform: 'none',
                        fontWeight: 650,
                        backgroundColor: '#1b77d1',
                      }}
                    >
                      Schüler/in hinzufügen
                    </Button>
                    <Button
                      variant="outlined"
                      startIcon={<GroupAddIcon />}
                      onClick={handleOpenBulkAdd}
                      sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 650 }}
                    >
                      Mehrere Schüler hinzufügen
                    </Button>
                  </Stack>
                )}
              </Box>
            ) : (
              <TableContainer
                component={Box}
                sx={{ border: '1px solid #f1f5f9', borderRadius: '8px' }}
              >
                <Table>
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Name</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Bewertete Arbeiten</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Persönlicher Schnitt (Ø)</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', textAlign: 'right' }}>
                        Aktionen
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {students.map((student) => (
                      <TableRow
                        key={student.id}
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                      >
                        <TableCell sx={{ fontWeight: 600 }}>
                          <Link
                            href={`/students/${student.id}`}
                            style={{ textDecoration: 'none', color: '#1b77d1', fontWeight: 700 }}
                          >
                            {student.name}
                          </Link>
                        </TableCell>
                        <TableCell>{student.totalExamsCorrected} Arbeiten</TableCell>
                        <TableCell>
                          {student.averageGrade !== 'N/A' ? (
                            <Chip
                              label={student.averageGrade}
                              size="small"
                              sx={{
                                backgroundColor:
                                  parseFloat(student.averageGrade) >= 4.0 ? '#dcfce7' : '#fee2e2',
                                color:
                                  parseFloat(student.averageGrade) >= 4.0 ? '#15803d' : '#b91c1c',
                                fontWeight: 'bold',
                                borderRadius: '6px',
                              }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{
                                color: 'text.secondary',
                                fontStyle: 'italic',
                                fontSize: '0.85rem',
                              }}
                            >
                              Keine Noten
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                            <Link
                              href={`/students/${student.id}`}
                              passHref
                              style={{ textDecoration: 'none' }}
                            >
                              <Button
                                variant="text"
                                size="small"
                                sx={{ textTransform: 'none', fontWeight: 650 }}
                              >
                                Profil öffnen
                              </Button>
                            </Link>
                            {!isArchived && (
                              <>
                                <IconButton
                                  size="small"
                                  color="primary"
                                  onClick={() => {
                                    setSelectedStudent(student);
                                    setTargetClassId(classId);
                                    setOpenTransfer(true);
                                  }}
                                >
                                  <SwapHorizIcon />
                                </IconButton>
                                <IconButton
                                  size="small"
                                  color="error"
                                  onClick={() => {
                                    setSelectedStudent(student);
                                    setOpenDeleteStudent(true);
                                  }}
                                >
                                  <DeleteIcon />
                                </IconButton>
                              </>
                            )}
                          </Stack>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* 4. Exams History Card */}
        <Card sx={{ borderRadius: '12px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
          <CardContent sx={{ p: 3 }}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', mb: 2.5 }}>
              <AssessmentIcon sx={{ color: '#0f172a' }} />
              <Typography
                variant="h6"
                sx={{ fontWeight: 850, color: '#0f172a', letterSpacing: '-0.01em' }}
              >
                Durchgeführte Prüfungen
              </Typography>
            </Stack>

            {exams.length === 0 ? (
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', fontStyle: 'italic', py: 4, textAlign: 'center' }}
              >
                Bisher wurden keine Prüfungen für diese Klasse erstellt.
              </Typography>
            ) : (
              <TableContainer
                component={Box}
                sx={{ border: '1px solid #f1f5f9', borderRadius: '8px' }}
              >
                <Table>
                  <TableHead sx={{ backgroundColor: '#f8fafc' }}>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 'bold' }}>Titel</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Fach</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Max. Punkte</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Korrekturen abgeschlossen</TableCell>
                      <TableCell sx={{ fontWeight: 'bold' }}>Klassenschnitt (Ø)</TableCell>
                      <TableCell sx={{ fontWeight: 'bold', textAlign: 'right' }}>
                        Aktionen
                      </TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {exams.map((exam) => (
                      <TableRow
                        key={exam.id}
                        sx={{ '&:last-child td, &:last-child th': { border: 0 } }}
                      >
                        <TableCell sx={{ fontWeight: 650 }}>
                          <Link
                            href={`/exams/${exam.id}`}
                            style={{ textDecoration: 'none', color: '#1b77d1', fontWeight: 700 }}
                          >
                            {exam.title}
                          </Link>
                        </TableCell>
                        <TableCell>
                          <Chip
                            label={exam.subject}
                            size="small"
                            sx={{ backgroundColor: '#f1f5f9', color: '#475569', fontWeight: 600 }}
                          />
                        </TableCell>
                        <TableCell>{exam.maxPoints} P.</TableCell>
                        <TableCell>{exam.submissionsCount} bewertet</TableCell>
                        <TableCell sx={{ fontWeight: 'bold' }}>
                          {exam.averageGrade !== 'N/A' ? (
                            <Chip
                              label={exam.averageGrade}
                              size="small"
                              sx={{
                                backgroundColor:
                                  parseFloat(exam.averageGrade) >= 4.0 ? '#dcfce7' : '#fee2e2',
                                color: parseFloat(exam.averageGrade) >= 4.0 ? '#15803d' : '#b91c1c',
                                fontWeight: 'bold',
                                borderRadius: '6px',
                              }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{
                                color: 'text.secondary',
                                fontStyle: 'italic',
                                fontSize: '0.85rem',
                              }}
                            >
                              Keine Noten
                            </Typography>
                          )}
                        </TableCell>
                        <TableCell sx={{ textAlign: 'right' }}>
                          <Link
                            href={`/exams/${exam.id}`}
                            passHref
                            style={{ textDecoration: 'none' }}
                          >
                            <Button
                              variant="text"
                              size="small"
                              sx={{ textTransform: 'none', fontWeight: 650 }}
                            >
                              Analyse öffnen
                            </Button>
                          </Link>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </CardContent>
        </Card>

        {/* --- Dialogs --- */}

        {/* Bulk Add Students Dialog */}
        <Dialog
          open={openBulkAdd}
          onClose={(_e, reason) => {
            if (bulkLoading || reason === 'backdropClick') return;
            setOpenBulkAdd(false);
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
            Mehrere Schüler hinzufügen
          </DialogTitle>
          <DialogContent>
            {bulkStep === 'input' && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {bulkError && <Alert severity="error">{bulkError}</Alert>}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Füge hier eine Liste von Namen ein (ein Name pro Zeile). Leere Zeilen und
                  umgebende Leerzeichen werden automatisch ignoriert.
                </Typography>
                <TextField
                  label="Schülernamen (ein Name pro Zeile)"
                  placeholder="Anna Meier&#10;Lukas Keller&#10;Sophie Müller"
                  multiline
                  rows={8}
                  fullWidth
                  variant="outlined"
                  value={bulkInputText}
                  onChange={(e) => setBulkInputText(e.target.value)}
                  autoFocus
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />
              </Stack>
            )}

            {bulkStep === 'preview' && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                {bulkError && <Alert severity="error">{bulkError}</Alert>}
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Überprüfe die erkannten Namen. Mögliche Duplikate sind hervorgehoben – wähle pro
                  markiertem Schüler bewusst, ob dieser trotzdem hinzugefügt oder übersprungen
                  werden soll.
                </Typography>

                <Box
                  sx={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: 1,
                  }}
                >
                  <Typography variant="subtitle2" sx={{ fontWeight: 700, color: '#334155' }}>
                    Vorschau: {bulkParsedItems.length} Namen erkannt
                  </Typography>
                  <Stack direction="row" spacing={1}>
                    <Button
                      size="small"
                      onClick={() => {
                        setBulkParsedItems((prev) =>
                          prev.map((item) => ({ ...item, decision: 'add' }))
                        );
                      }}
                      sx={{ textTransform: 'none', fontSize: '0.8rem' }}
                    >
                      Alle hinzufügen
                    </Button>
                    <Button
                      size="small"
                      onClick={() => {
                        setBulkParsedItems((prev) =>
                          prev.map((item) => ({
                            ...item,
                            decision:
                              item.isExistingDuplicate || item.isInputDuplicate ? 'skip' : 'add',
                          }))
                        );
                      }}
                      sx={{ textTransform: 'none', fontSize: '0.8rem' }}
                    >
                      Duplikate überspringen
                    </Button>
                  </Stack>
                </Box>

                <Box
                  sx={{
                    maxHeight: '360px',
                    overflowY: 'auto',
                    border: '1px solid #e2e8f0',
                    borderRadius: '8px',
                    p: 1.5,
                  }}
                >
                  <Stack spacing={1.5}>
                    {bulkParsedItems.map((item) => {
                      const isFlagged = item.isExistingDuplicate || item.isInputDuplicate;
                      return (
                        <Box
                          key={item.id}
                          sx={{
                            p: 1.5,
                            borderRadius: '8px',
                            border: isFlagged ? '1px solid #fcd34d' : '1px solid #f1f5f9',
                            backgroundColor: isFlagged ? '#fffbeb' : '#f8fafc',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            flexWrap: 'wrap',
                            gap: 1.5,
                          }}
                        >
                          <Box sx={{ minWidth: '180px' }}>
                            <Typography sx={{ fontWeight: 700, color: '#0f172a' }}>
                              {item.name}
                            </Typography>
                            {item.isExistingDuplicate && (
                              <Chip
                                label="Bereits in dieser Klasse vorhanden"
                                size="small"
                                color="warning"
                                sx={{ mt: 0.5, mr: 0.5, fontSize: '0.7rem', height: '22px' }}
                              />
                            )}
                            {item.isInputDuplicate && (
                              <Chip
                                label="Mehrfach in dieser Eingabe enthalten"
                                size="small"
                                color="warning"
                                sx={{ mt: 0.5, fontSize: '0.7rem', height: '22px' }}
                              />
                            )}
                          </Box>

                          <ButtonGroup size="small">
                            <Button
                              variant={item.decision === 'add' ? 'contained' : 'outlined'}
                              color={item.decision === 'add' ? 'primary' : 'inherit'}
                              onClick={() => {
                                setBulkParsedItems((prev) =>
                                  prev.map((i) =>
                                    i.id === item.id ? { ...i, decision: 'add' } : i
                                  )
                                );
                              }}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 650,
                                fontSize: '0.8rem',
                              }}
                              title="Trotzdem hinzufügen (add anyway)"
                            >
                              {isFlagged ? 'Trotzdem hinzufügen' : 'Hinzufügen'}
                            </Button>
                            <Button
                              variant={item.decision === 'skip' ? 'contained' : 'outlined'}
                              color={item.decision === 'skip' ? 'warning' : 'inherit'}
                              onClick={() => {
                                setBulkParsedItems((prev) =>
                                  prev.map((i) =>
                                    i.id === item.id ? { ...i, decision: 'skip' } : i
                                  )
                                );
                              }}
                              sx={{
                                textTransform: 'none',
                                fontWeight: 650,
                                fontSize: '0.8rem',
                              }}
                              title="Überspringen (skip)"
                            >
                              Überspringen
                            </Button>
                          </ButtonGroup>
                        </Box>
                      );
                    })}
                  </Stack>
                </Box>

                <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                  Auswahl: {bulkParsedItems.filter((i) => i.decision === 'add').length} werden
                  hinzugefügt, {bulkParsedItems.filter((i) => i.decision === 'skip').length} werden
                  übersprungen.
                </Typography>
              </Stack>
            )}

            {bulkStep === 'result' && bulkResult && (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Alert
                  severity={
                    bulkResult.failed > 0 ? 'warning' : bulkResult.added > 0 ? 'success' : 'info'
                  }
                  sx={{ fontWeight: 600 }}
                >
                  <Typography variant="body1" sx={{ fontWeight: 700, mb: 0.5 }}>
                    {bulkResult.added} hinzugefügt, {bulkResult.skipped} übersprungen,{' '}
                    {bulkResult.failed} fehlgeschlagen
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    ({bulkResult.added} added, {bulkResult.skipped} skipped by choice,{' '}
                    {bulkResult.failed} failed)
                  </Typography>
                </Alert>

                {bulkResult.failedDetails.length > 0 && (
                  <Box sx={{ mt: 1 }}>
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 700, color: '#b91c1c', mb: 1 }}
                    >
                      Fehlgeschlagene Schüler/innen:
                    </Typography>
                    <Stack spacing={1}>
                      {bulkResult.failedDetails.map((f, i) => (
                        <Alert key={i} severity="error" sx={{ py: 0.5, px: 2 }}>
                          <strong>{f.name}</strong>: {f.error}
                        </Alert>
                      ))}
                    </Stack>
                  </Box>
                )}
              </Stack>
            )}
          </DialogContent>

          <DialogActions sx={{ p: 2, pt: 0 }}>
            {bulkStep === 'input' && (
              <>
                <Button
                  onClick={() => setOpenBulkAdd(false)}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Abbrechen
                </Button>
                <Button
                  variant="contained"
                  onClick={handleParseBulkInput}
                  disabled={!bulkInputText.trim()}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    borderRadius: '8px',
                  }}
                >
                  Vorschau anzeigen
                </Button>
              </>
            )}

            {bulkStep === 'preview' && (
              <>
                <Button
                  onClick={() => setBulkStep('input')}
                  disabled={bulkLoading}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Zurück zur Eingabe
                </Button>
                <Button
                  variant="contained"
                  onClick={handleConfirmBulkAdd}
                  disabled={
                    bulkLoading || bulkParsedItems.filter((i) => i.decision === 'add').length === 0
                  }
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    borderRadius: '8px',
                  }}
                >
                  {bulkLoading ? (
                    <CircularProgress size={20} color="inherit" />
                  ) : (
                    `${bulkParsedItems.filter((i) => i.decision === 'add').length} Schüler/innen hinzufügen`
                  )}
                </Button>
              </>
            )}

            {bulkStep === 'result' && (
              <Button
                variant="contained"
                onClick={() => {
                  setOpenBulkAdd(false);
                  setBulkStep('input');
                  setBulkResult(null);
                }}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#1b77d1',
                  borderRadius: '8px',
                }}
              >
                Fertig
              </Button>
            )}
          </DialogActions>
        </Dialog>

        {/* Add Student Dialog */}
        <Dialog
          open={openAddStudent}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenAddStudent(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <form onSubmit={handleAddStudent}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
              Schüler/in einschreiben
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {studentActionError && <Alert severity="error">{studentActionError}</Alert>}
                <TextField
                  label="Name des Schülers / der Schülerin"
                  placeholder="z.B. Max Mustermann"
                  fullWidth
                  variant="outlined"
                  value={newStudentName}
                  onChange={(e) => setNewStudentName(e.target.value)}
                  autoFocus
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, pt: 0 }}>
              <Button
                onClick={() => setOpenAddStudent(false)}
                sx={{ textTransform: 'none', fontWeight: 650 }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={studentActionLoading}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#1b77d1',
                  borderRadius: '8px',
                }}
              >
                {studentActionLoading ? <CircularProgress size={20} /> : 'Einschreiben'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>

        {/* Transfer Student Dialog */}
        <Dialog
          open={openTransfer}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenTransfer(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
            Schüler/in umteilen (Klassentransfer)
          </DialogTitle>
          <DialogContent>
            <Stack spacing={2.5} sx={{ mt: 1 }}>
              {studentActionError && <Alert severity="error">{studentActionError}</Alert>}
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Teile den Schüler <strong>{selectedStudent?.name}</strong> in eine andere Klasse um.
                Alle seine Korrekturen und Noten werden mitgenommen.
              </Typography>
              <FormControl fullWidth>
                <InputLabel id="transfer-class-label">Zielklasse</InputLabel>
                <Select
                  labelId="transfer-class-label"
                  value={targetClassId}
                  label="Zielklasse"
                  onChange={(e) => setTargetClassId(e.target.value)}
                  sx={{ borderRadius: '8px' }}
                >
                  {allClasses.filter((c) => c.id !== classId).length === 0 ? (
                    <MenuItem value="" disabled>
                      Keine weiteren Klassen vorhanden
                    </MenuItem>
                  ) : (
                    allClasses
                      .filter((c) => c.id !== classId)
                      .map((c) => (
                        <MenuItem key={c.id} value={c.id}>
                          {c.name}
                        </MenuItem>
                      ))
                  )}
                </Select>
              </FormControl>
              {allClasses.filter((c) => c.id !== classId).length === 0 && (
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                  Es existiert keine weitere Klasse für einen Transfer. Lege zuerst eine weitere
                  Klasse unter &quot;Klassen&quot; an.
                </Typography>
              )}
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => setOpenTransfer(false)}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleTransferStudent}
              variant="contained"
              disabled={studentActionLoading || !targetClassId}
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: '#1b77d1',
                borderRadius: '8px',
              }}
            >
              {studentActionLoading ? <CircularProgress size={20} /> : 'Umteilen'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Student Dialog */}
        <Dialog
          open={openDeleteStudent}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenDeleteStudent(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
            Schüler/in austragen?
          </DialogTitle>
          <DialogContent>
            <Stack spacing={1.5}>
              {studentActionError && <Alert severity="error">{studentActionError}</Alert>}
              <Typography variant="body2" sx={{ color: 'text.primary' }}>
                Möchtest du <strong>{selectedStudent?.name}</strong> wirklich dauerhaft aus dieser
                Klasse austragen?
              </Typography>
              <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
                Achtung: Dies löscht unwiderruflich all seine Prüfungen, KI-Rückmeldungen und
                Korrekturergebnisse!
              </Typography>
            </Stack>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => setOpenDeleteStudent(false)}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={handleDeleteStudent}
              variant="contained"
              color="error"
              disabled={studentActionLoading}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
            >
              {studentActionLoading ? <CircularProgress size={20} /> : 'Austragen'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Archive Class Dialog */}
        <Dialog
          open={openArchiveClass}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenArchiveClass(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>Klasse archivieren?</DialogTitle>
          <DialogContent>
            {archiveClassError && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>
                {archiveClassError}
              </Alert>
            )}
            <Typography variant="body2" sx={{ color: 'text.primary', mb: 1.5 }}>
              Möchtest du die Klasse <strong>{classData?.name}</strong> für das Archiv ablegen?
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.5, mb: 1.5 }}>
              Alle Schülerprofile, durchgeführten Prüfungen, Noten und KI-Rückmeldungen bleiben
              zeitlich unbegrenzt im Lesemodus erhalten (kein automatischer Ablauf / keine
              Auto-Löschung nach Frist). Die Klasse erscheint nicht mehr in den aktiven
              Auswahllisten oder laufenden Statistiken und kann jederzeit wiederhergestellt werden.
            </Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              Hinweis: Ein endgültiges Löschen der Klasse ist zum Schutz deiner Daten
              ausschliesslich im Archiv-Bereich möglich.
            </Typography>
          </DialogContent>
          <DialogActions sx={{ p: 2, pt: 0 }}>
            <Button
              onClick={() => setOpenArchiveClass(false)}
              disabled={studentActionLoading}
              sx={{ textTransform: 'none', fontWeight: 650 }}
            >
              Abbrechen
            </Button>
            <Button
              onClick={() => handleArchiveToggle(true)}
              variant="contained"
              disabled={studentActionLoading}
              startIcon={
                studentActionLoading ? <CircularProgress size={16} color="inherit" /> : undefined
              }
              sx={{
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: '8px',
                backgroundColor: '#0f172a',
                '&:hover': { backgroundColor: '#1e293b' },
              }}
            >
              Klasse archivieren
            </Button>
          </DialogActions>
        </Dialog>

        {/* Delete Class Dialog (Protected Consequence & Type-Confirmation Dialog in Archive) */}
        <Dialog
          open={openDeleteClass}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenDeleteClass(false);
            setDeleteConfirmName('');
          }}
          maxWidth="sm"
          fullWidth
        >
          {!isArchived ? (
            <>
              <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
                Klasse archivieren statt auflösen
              </DialogTitle>
              <DialogContent>
                <Typography variant="body2" sx={{ color: 'text.primary', mb: 1.5 }}>
                  Aktive Klassen können nicht direkt gelöscht werden. Archiviere die Klasse{' '}
                  <strong>{classData?.name}</strong> stattdessen nicht-destruktiv für den
                  Schuljahreswechsel.
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Im Archiv bleiben alle Daten im Lesemodus erhalten (ohne automatischen Ablauf) und
                  können jederzeit wiederhergestellt oder dort bewusst endgültig gelöscht werden.
                </Typography>
              </DialogContent>
              <DialogActions sx={{ p: 2, pt: 0 }}>
                <Button
                  onClick={() => setOpenDeleteClass(false)}
                  disabled={studentActionLoading}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Abbrechen
                </Button>
                <Button
                  onClick={() => {
                    setOpenDeleteClass(false);
                    void handleArchiveToggle(true);
                  }}
                  variant="contained"
                  disabled={studentActionLoading}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: '8px',
                    backgroundColor: '#0f172a',
                  }}
                >
                  Archivieren
                </Button>
              </DialogActions>
            </>
          ) : (
            <>
              <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>
                Archivierte Klasse endgültig löschen?
              </DialogTitle>
              <DialogContent>
                <Stack spacing={2} sx={{ mt: 0.5 }}>
                  {deleteClassError && (
                    <Alert severity="error" sx={{ borderRadius: '8px' }}>
                      {deleteClassError}
                    </Alert>
                  )}
                  <Typography variant="body2" sx={{ color: 'text.primary' }}>
                    Du bist dabei, die archivierte Klasse <strong>{classData?.name}</strong>{' '}
                    endgültig und unwiderruflich aufzulösen.
                  </Typography>

                  <Alert
                    severity="error"
                    sx={{
                      borderRadius: '10px',
                      border: '1px solid #fecaca',
                      backgroundColor: '#fef2f2',
                      color: '#7f1d1d',
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.75 }}>
                      Unwiderruflicher Datenverlust (aktuelle Bestandszahlen):
                    </Typography>
                    <Typography variant="body2" sx={{ fontWeight: 700, mb: 1 }}>
                      {formatClassDeletionConsequences(deletionImpact)}
                    </Typography>
                    <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: '0.82rem' }}>
                      <li>
                        <strong>{deletionImpact.studentsCount} Schüler/innen</strong> inklusive
                        sämtlicher Schülerprofile und Notenverläufe
                      </li>
                      <li>
                        <strong>
                          {deletionImpact.examsCount === 1
                            ? '1 Prüfung'
                            : `${deletionImpact.examsCount} Prüfungen`}
                        </strong>{' '}
                        inklusive Aufgabenblätter, Musterlösungen und Bewertungsraster
                      </li>
                      <li>
                        <strong>
                          {deletionImpact.submissionsCount === 1
                            ? '1 Korrektur inkl. aller gespeicherten Scans'
                            : `${deletionImpact.submissionsCount} Korrekturen inkl. aller gespeicherten Scans`}
                        </strong>{' '}
                        im Dateispeicher (Storage) und in der Datenbank
                      </li>
                    </Box>
                  </Alert>

                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 650, color: '#0f172a', mb: 1 }}>
                      Bitte tippe zur Bestätigung den Klassennamen{' '}
                      <strong>{classData?.name}</strong> ein:
                    </Typography>
                    <TextField
                      label="Klassenname zur Bestätigung"
                      placeholder={classData?.name || ''}
                      fullWidth
                      size="small"
                      value={deleteConfirmName}
                      onChange={(e) => {
                        setDeleteConfirmName(e.target.value);
                        if (deleteClassError) setDeleteClassError('');
                      }}
                      autoFocus
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Box>
                </Stack>
              </DialogContent>
              <DialogActions sx={{ p: 2, pt: 0 }}>
                <Button
                  onClick={() => {
                    setOpenDeleteClass(false);
                    setDeleteConfirmName('');
                  }}
                  disabled={studentActionLoading}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Abbrechen
                </Button>
                <Button
                  onClick={handleDeleteClass}
                  variant="contained"
                  color="error"
                  disabled={studentActionLoading || !isDeleteNameConfirmed}
                  sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                >
                  {studentActionLoading ? <CircularProgress size={20} /> : 'Endgültig löschen'}
                </Button>
              </DialogActions>
            </>
          )}
        </Dialog>

        {/* Edit Class Dialog */}
        <Dialog
          open={openEditClass}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenEditClass(false);
            setEditedClassName(classData?.name || '');
          }}
          maxWidth="sm"
          fullWidth
        >
          <form onSubmit={handleEditClass}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>Klasse bearbeiten</DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                {editClassError && (
                  <Alert severity="error" sx={{ borderRadius: '8px' }}>
                    {editClassError}
                  </Alert>
                )}
                <TextField
                  label="Neuer Klassenname"
                  fullWidth
                  variant="outlined"
                  value={editedClassName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setEditedClassName(val);
                    if (val.trim().length > 100) {
                      setEditClassError(
                        'Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.'
                      );
                    } else if (editClassError) {
                      setEditClassError('');
                    }
                  }}
                  error={!!editClassError || editedClassName.trim().length > 100}
                  helperText={
                    editClassError ||
                    (editedClassName.trim().length > 100
                      ? 'Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.'
                      : `${editedClassName.length}/100 Zeichen`)
                  }
                  autoFocus
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />

                <Box>
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 0.75,
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Typography variant="subtitle2" sx={{ fontWeight: 750, color: '#0f172a' }}>
                      Fächer dieser Klasse (Teilmenge aus „Meine Fächer“)
                    </Typography>
                    {editedClassSubjects.length > 0 && (
                      <Button
                        size="small"
                        onClick={() => setEditedClassSubjects([])}
                        sx={{ textTransform: 'none', fontWeight: 650, fontSize: '0.75rem', py: 0 }}
                      >
                        Keine Einschränkung
                      </Button>
                    )}
                  </Stack>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', display: 'block', mb: 1.25 }}
                  >
                    Wähle die für diese Klasse relevanten Fächer aus deiner Liste „Meine Fächer“
                    (Mehrfachauswahl, leer = keine Einschränkung). Der Unterstützungsstatus pro Fach
                    bleibt unverändert.
                  </Typography>
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {Array.from(new Set([...mySubjects, ...editedClassSubjects])).map((subj) => {
                      const isSelected = editedClassSubjects.some(
                        (s) => s.toLowerCase() === subj.toLowerCase()
                      );
                      const supportInfo = getSubjectSupportInfo(subj);
                      return (
                        <Tooltip
                          key={subj}
                          title={`${supportInfo.supportBadge}: ${supportInfo.supportDescription}`}
                          arrow
                        >
                          <Chip
                            label={`${subj} · ${supportInfo.supportBadge}`}
                            clickable
                            onClick={() => handleToggleEditedSubject(subj)}
                            color={isSelected ? 'primary' : 'default'}
                            variant={isSelected ? 'filled' : 'outlined'}
                            sx={{
                              fontWeight: 650,
                              fontSize: '0.78rem',
                              borderRadius: '8px',
                            }}
                          />
                        </Tooltip>
                      );
                    })}
                  </Stack>
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2, pt: 0 }}>
              <Button
                onClick={() => {
                  setOpenEditClass(false);
                  setEditedClassName(classData?.name || '');
                }}
                disabled={studentActionLoading}
                sx={{ textTransform: 'none', fontWeight: 650 }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={
                  studentActionLoading ||
                  !editedClassName.trim() ||
                  editedClassName.trim().length > 100
                }
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#1b77d1',
                  borderRadius: '8px',
                }}
              >
                {studentActionLoading ? <CircularProgress size={20} /> : 'Speichern'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Box>
    </DashboardLayout>
  );
}
