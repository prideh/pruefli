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

interface ClassData {
  id: string;
  name: string;
  createdAt: string;
  teacherId: string;
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
  stats: ClassStats;
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
  const students = cachedDetails?.students || [];
  const exams = cachedDetails?.exams || [];

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
  const [openEditClass, setOpenEditClass] = useState(false);
  const [editedClassName, setEditedClassName] = useState('');
  const [editClassError, setEditClassError] = useState('');

  const handleOpenEditClass = () => {
    setEditClassError('');
    setEditedClassName(classData?.name || '');
    if ((classData?.name || '').trim().length > 100) {
      setEditClassError('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
    }
    setOpenEditClass(true);
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

  // DELETE Class
  const handleDeleteClass = async () => {
    setStudentActionLoading(true);
    setDeleteClassError('');
    try {
      const res = await fetch(`/api/classes/${classId}`, { method: 'DELETE' });
      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Klasse konnte nicht aufgelöst werden.');
        setDeleteClassError(errorMsg);
        return;
      }
      invalidateClasses(classId);
      invalidateExams(undefined, classId);
      invalidateSubmissions(undefined, undefined, classId);
      setOpenDeleteClass(false);
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
        body: JSON.stringify({ name: trimmed }),
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
                {classData?.name}
              </Typography>
              <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                Erstellt am {classData?.createdAt} • {students.length} Schüler/innen eingeschrieben
              </Typography>
            </Box>

            <Stack
              direction="row"
              spacing={1.5}
              sx={{
                flexShrink: 0,
                alignItems: 'center',
                position: 'relative',
                zIndex: 1,
              }}
            >
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
                color="error"
                startIcon={<DeleteIcon />}
                onClick={() => {
                  setDeleteClassError('');
                  setOpenDeleteClass(true);
                }}
                sx={{
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 650,
                  whiteSpace: 'nowrap',
                }}
              >
                Klasse auflösen
              </Button>
            </Stack>
          </Box>
        </Stack>

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
                <Link href="/dashboard" passHref style={{ textDecoration: 'none' }}>
                  <Button
                    variant="contained"
                    endIcon={<ArrowForwardIcon />}
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

        {/* Delete Class Dialog */}
        <Dialog
          open={openDeleteClass}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenDeleteClass(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>Klasse auflösen?</DialogTitle>
          <DialogContent>
            {deleteClassError && (
              <Alert severity="error" sx={{ mb: 2, borderRadius: '8px' }}>
                {deleteClassError}
              </Alert>
            )}
            <Typography variant="body2" sx={{ color: 'text.primary', mb: 1 }}>
              Möchtest du die Klasse <strong>{classData?.name}</strong> wirklich auflösen?
            </Typography>
            <Typography variant="caption" sx={{ color: 'error.main', fontWeight: 600 }}>
              Dabei werden alle eingeschriebenen Schüler, Prüfungen und Korrekturdaten dauerhaft
              gelöscht!
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
              onClick={handleDeleteClass}
              variant="contained"
              color="error"
              disabled={studentActionLoading}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
            >
              {studentActionLoading ? <CircularProgress size={20} /> : 'Klasse auflösen'}
            </Button>
          </DialogActions>
        </Dialog>

        {/* Edit Class Dialog */}
        <Dialog
          open={openEditClass}
          onClose={(_e, reason) => {
            if (studentActionLoading || reason === 'backdropClick') return;
            setOpenEditClass(false);
            setEditedClassName(classData?.name || '');
          }}
          maxWidth="xs"
          fullWidth
        >
          <form onSubmit={handleEditClass}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a' }}>Klassenname ändern</DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
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
