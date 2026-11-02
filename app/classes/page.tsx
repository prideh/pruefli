'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
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
  IconButton,
  Tooltip,
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import EditIcon from '@mui/icons-material/Edit';
import GroupIcon from '@mui/icons-material/Group';
import SchoolIcon from '@mui/icons-material/School';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import { getErrorMessage } from '@/lib/api-error';
import StarIcon from '@mui/icons-material/Star';
import StarBorderIcon from '@mui/icons-material/StarBorder';
import DashboardLayout from '@/components/DashboardLayout';
import ErrorState from '@/components/ErrorState';
import {
  useDataCache,
  invalidateClasses,
  invalidateExams,
  invalidateSubmissions,
} from '@/lib/dataCache';
import {
  resolveTeacherSubjects,
  getSubjectSupportInfo,
  normalizeSubjectValue,
} from '@/lib/grading';

interface PrismaClassInfo {
  id: string;
  name: string;
  createdAt: string;
  subjects?: string[];
  isArchived?: boolean;
  archivedAt?: string | null;
  _count: {
    students: number;
  };
}

interface ClassListItem extends PrismaClassInfo {
  totalExams: number;
  averageGrade: string;
  subjects: string[];
  isArchived: boolean;
  archivedAt: string | null;
}

export default function ClassesPage() {
  const fetchClassesApi = React.useCallback(async () => {
    const res = await fetch('/api/classes?includeArchived=true');
    if (!res.ok) throw new Error('Fehler beim Laden der Klassen.');
    const data = await res.json();

    const loadedClasses: ClassListItem[] = (data.classes || []).map(
      (
        cls: PrismaClassInfo & {
          totalExams?: number;
          averageGrade?: string;
          subjects?: string[];
          isArchived?: boolean;
          archivedAt?: string | null;
        }
      ) => ({
        ...cls,
        totalExams: cls.totalExams ?? 0,
        averageGrade: cls.averageGrade || 'N/A',
        subjects: Array.isArray(cls.subjects) ? cls.subjects : [],
        isArchived: Boolean(cls.isArchived),
        archivedAt: cls.archivedAt ?? null,
      })
    );

    return loadedClasses;
  }, []);

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
      resolveTeacherSubjects(
        cachedSubjectsData?.savedSubjects ?? null,
        cachedSubjectsData?.existingExamSubjects ?? []
      ).map((item) => item.value),
    [cachedSubjectsData]
  );

  const {
    data: cachedClasses,
    loading,
    error,
    revalidate: fetchClasses,
  } = useDataCache<ClassListItem[] | { classes?: ClassListItem[] }>(
    '/api/classes?includeArchived=true',
    fetchClassesApi
  );

  const classes = React.useMemo(() => {
    const raw = Array.isArray(cachedClasses) ? cachedClasses : cachedClasses?.classes || [];
    return raw.map(
      (
        cls: ClassListItem & {
          studentsCount?: number;
          subjects?: string[];
          isArchived?: boolean;
          archivedAt?: string | null;
        }
      ) => ({
        ...cls,
        _count: {
          students: cls._count?.students ?? cls.studentsCount ?? 0,
        },
        totalExams: cls.totalExams ?? 0,
        averageGrade: cls.averageGrade || 'N/A',
        subjects: Array.isArray(cls.subjects) ? cls.subjects : [],
        isArchived: Boolean(cls.isArchived),
        archivedAt: cls.archivedAt ?? null,
      })
    );
  }, [cachedClasses]);

  const [statusFilter, setStatusFilter] = useState<'active' | 'archived'>('active');
  const [unarchiveLoadingId, setUnarchiveLoadingId] = useState<string | null>(null);
  const [unarchiveError, setUnarchiveError] = useState<string>('');

  const activeClasses = React.useMemo(() => classes.filter((cls) => !cls.isArchived), [classes]);
  const archivedClasses = React.useMemo(() => classes.filter((cls) => cls.isArchived), [classes]);
  const displayedClasses = statusFilter === 'archived' ? archivedClasses : activeClasses;

  const handleUnarchiveClass = async (classId: string) => {
    setUnarchiveLoadingId(classId);
    setUnarchiveError('');
    try {
      const res = await fetch(`/api/classes/${classId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ archived: false }),
      });
      if (!res.ok) {
        const msg = await getErrorMessage(res, 'Klasse konnte nicht wiederhergestellt werden.');
        setUnarchiveError(msg);
        return;
      }
      invalidateClasses(classId);
      invalidateExams(undefined, classId);
      invalidateSubmissions(undefined, undefined, classId);
      await fetchClasses();
    } catch (err) {
      setUnarchiveError(
        err instanceof Error ? err.message : 'Klasse konnte nicht wiederhergestellt werden.'
      );
    } finally {
      setUnarchiveLoadingId(null);
    }
  };

  const [defaultClassId, setDefaultClassId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('pruefli_default_class_id') ||
        localStorage.getItem('gradeai_default_class_id')
      );
    }
    return null;
  });

  const handleToggleDefaultClass = (classId: string) => {
    if (defaultClassId === classId) {
      localStorage.removeItem('pruefli_default_class_id');
      localStorage.removeItem('gradeai_default_class_id');
      setDefaultClassId(null);
    } else {
      localStorage.setItem('pruefli_default_class_id', classId);
      setDefaultClassId(classId);
    }
  };

  // Dialog State
  const [openCreate, setOpenCreate] = useState(false);
  const [newClassName, setNewClassName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Rename / Edit Class Dialog State
  const [openRename, setOpenRename] = useState(false);
  const [renameTargetClass, setRenameTargetClass] = useState<ClassListItem | null>(null);
  const [renamedClassName, setRenamedClassName] = useState('');
  const [renamedClassSubjects, setRenamedClassSubjects] = useState<string[]>([]);
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState('');

  const handleOpenRename = (cls: ClassListItem) => {
    setRenameTargetClass(cls);
    setRenamedClassName(cls.name); // Prefill current class name
    setRenamedClassSubjects(
      Array.isArray(cls.subjects)
        ? cls.subjects.map((s) => normalizeSubjectValue(s)).filter(Boolean)
        : []
    );
    if (cls.name.trim().length > 100) {
      setRenameError('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
    } else {
      setRenameError('');
    }
    setOpenRename(true);
  };

  const handleToggleClassSubject = (subject: string) => {
    const normalized = normalizeSubjectValue(subject);
    if (!normalized) return;
    setRenamedClassSubjects((prev) => {
      const exists = prev.some((s) => s.toLowerCase() === normalized.toLowerCase());
      if (exists) {
        return prev.filter((s) => s.toLowerCase() !== normalized.toLowerCase());
      }
      return [...prev, normalized];
    });
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = renamedClassName.trim();
    if (!renameTargetClass || !trimmed) {
      setRenameError('Bitte gib einen Klassennamen an.');
      return;
    }
    if (trimmed.length > 100) {
      setRenameError('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
      return;
    }
    setRenameLoading(true);
    setRenameError('');
    try {
      const res = await fetch(`/api/classes/${renameTargetClass.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, subjects: renamedClassSubjects }),
      });
      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Klassenname konnte nicht geändert werden.');
        setRenameError(errorMsg);
        return;
      }
      setOpenRename(false);
      setRenameTargetClass(null);
      setRenamedClassName('');
      setRenamedClassSubjects([]);
      invalidateClasses(renameTargetClass.id);
      await fetchClasses();
    } catch (err) {
      setRenameError(
        err instanceof Error ? err.message : 'Klassenname konnte nicht geändert werden.'
      );
    } finally {
      setRenameLoading(false);
    }
  };

  const handleCreateClass = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newClassName.trim();
    if (!trimmed) {
      setCreateError('Bitte gib einen Klassennamen an.');
      return;
    }
    if (trimmed.length > 100) {
      setCreateError('Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.');
      return;
    }

    setCreateLoading(true);
    setCreateError('');

    try {
      const res = await fetch('/api/classes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });

      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Klasse konnte nicht erstellt werden.');
        setCreateError(errorMsg);
        return;
      }

      setOpenCreate(false);
      setNewClassName('');
      invalidateClasses();
      await fetchClasses();
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Klasse konnte nicht erstellt werden.');
    } finally {
      setCreateLoading(false);
    }
  };

  return (
    <DashboardLayout>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Header Action Block */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Box>
            <Typography
              variant="h4"
              sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', mb: 1 }}
            >
              Klassenverwaltung
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', fontWeight: 550 }}>
              Erstelle und verwalte deine Schulklassen und verfolge deren Gesamtleistungen.
            </Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddIcon />}
            disabled={loading || !!error}
            onClick={() => {
              setCreateError('');
              setOpenCreate(true);
            }}
            sx={{
              padding: '10px 20px',
              borderRadius: '8px',
              fontWeight: 700,
              textTransform: 'none',
              backgroundColor: '#1b77d1',
              boxShadow: '0 4px 10px rgba(27, 119, 209, 0.2)',
              '&:hover': { backgroundColor: '#1565c0' },
            }}
          >
            Klasse erstellen
          </Button>
        </Box>

        {/* Filter Tabs: Aktive Klassen vs. Archiviert */}
        {!loading && !error && (
          <Stack
            direction="row"
            spacing={1}
            sx={{
              alignItems: 'center',
              borderBottom: '1px solid #e2e8f0',
              pb: 1.5,
              flexWrap: 'wrap',
            }}
          >
            <Button
              variant={statusFilter === 'active' ? 'contained' : 'text'}
              onClick={() => setStatusFilter('active')}
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: statusFilter === 'active' ? '#0f172a' : 'transparent',
                color: statusFilter === 'active' ? '#ffffff' : '#475569',
                '&:hover': {
                  backgroundColor: statusFilter === 'active' ? '#1e293b' : '#f1f5f9',
                },
              }}
            >
              Aktive Klassen ({activeClasses.length})
            </Button>
            <Button
              variant={statusFilter === 'archived' ? 'contained' : 'text'}
              startIcon={<ArchiveIcon sx={{ fontSize: '1.1rem' }} />}
              onClick={() => setStatusFilter('archived')}
              sx={{
                borderRadius: '8px',
                textTransform: 'none',
                fontWeight: 700,
                backgroundColor: statusFilter === 'archived' ? '#0f172a' : 'transparent',
                color: statusFilter === 'archived' ? '#ffffff' : '#475569',
                '&:hover': {
                  backgroundColor: statusFilter === 'archived' ? '#1e293b' : '#f1f5f9',
                },
              }}
            >
              Archiviert ({archivedClasses.length})
            </Button>
          </Stack>
        )}

        {unarchiveError && (
          <Alert
            severity="error"
            onClose={() => setUnarchiveError('')}
            sx={{ borderRadius: '8px' }}
          >
            {unarchiveError}
          </Alert>
        )}

        {error ? (
          <ErrorState
            title="Fehler beim Laden der Klassen"
            message={error}
            onRetry={() => {
              fetchClasses();
            }}
          />
        ) : loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : displayedClasses.length === 0 ? (
          statusFilter === 'archived' ? (
            <Card
              sx={{
                borderRadius: '16px',
                border: '2px dashed #cbd5e1',
                boxShadow: 'none',
                backgroundColor: 'transparent',
                p: 6,
                textAlign: 'center',
              }}
            >
              <ArchiveIcon sx={{ fontSize: '4rem', color: '#94a3b8', mb: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#475569', mb: 1 }}>
                Keine archivierten Klassen vorhanden
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', maxWidth: '460px', mx: 'auto' }}
              >
                Archivierte Klassen eines vergangenen Schuljahres werden hier im Lesemodus abgelegt
                und können jederzeit wiederhergestellt werden.
              </Typography>
            </Card>
          ) : (
            <Card
              sx={{
                borderRadius: '16px',
                border: '2px dashed #cbd5e1',
                boxShadow: 'none',
                backgroundColor: 'transparent',
                p: 6,
                textAlign: 'center',
              }}
            >
              <GroupIcon sx={{ fontSize: '4rem', color: '#94a3b8', mb: 2 }} />
              <Typography variant="h6" sx={{ fontWeight: 700, color: '#475569', mb: 1 }}>
                Keine Klassen gefunden
              </Typography>
              <Typography
                variant="body2"
                sx={{ color: 'text.secondary', maxWidth: '400px', mx: 'auto', mb: 3 }}
              >
                Erstelle deine erste Schulklasse, um Schüler hinzuzufügen und handschriftliche
                Prüfungen korrigieren zu können.
              </Typography>
              <Button
                variant="outlined"
                startIcon={<AddIcon />}
                onClick={() => {
                  setCreateError('');
                  setOpenCreate(true);
                }}
                sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 650 }}
              >
                Erste Klasse erstellen
              </Button>
            </Card>
          )
        ) : (
          <Grid container spacing={3}>
            {displayedClasses.map((cls) => (
              <Grid size={{ xs: 12, sm: 6, md: 4 }} key={cls.id}>
                <Card
                  sx={{
                    borderRadius: '12px',
                    border:
                      !cls.isArchived && cls.id === defaultClassId
                        ? '2px solid #1b77d1'
                        : '1px solid #e2e8f0',
                    backgroundColor: cls.isArchived ? '#f8fafc' : '#ffffff',
                    boxShadow: 'none',
                    transition: 'all 0.25s ease',
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    justifyContent: 'space-between',
                    '&:hover': {
                      transform: 'translateY(-2px)',
                      borderColor: '#1b77d1',
                      boxShadow: '0 10px 20px -10px rgba(0,0,0,0.05)',
                    },
                  }}
                >
                  <CardContent sx={{ p: 3, pb: 1 }}>
                    <Stack
                      direction="row"
                      sx={{ justifyContent: 'space-between', alignItems: 'flex-start', mb: 2.5 }}
                    >
                      <Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
                          <Link
                            href={`/classes/${cls.id}`}
                            passHref
                            style={{ textDecoration: 'none', color: 'inherit' }}
                          >
                            <Typography
                              variant="h6"
                              sx={{
                                fontWeight: 800,
                                color: '#0f172a',
                                transition: 'color 0.15s ease',
                                cursor: 'pointer',
                                wordBreak: 'break-word',
                                overflowWrap: 'anywhere',
                                '&:hover': {
                                  color: '#1b77d1',
                                  textDecoration: 'underline',
                                },
                              }}
                            >
                              {cls.name}
                            </Typography>
                          </Link>
                          {cls.isArchived ? (
                            <Chip
                              label="Archiviert"
                              size="small"
                              sx={{
                                height: '20px',
                                fontSize: '0.65rem',
                                fontWeight: 700,
                                backgroundColor: '#e2e8f0',
                                color: '#475569',
                                borderRadius: '4px',
                              }}
                            />
                          ) : (
                            cls.id === defaultClassId && (
                              <Chip
                                label="Standard"
                                size="small"
                                sx={{
                                  height: '20px',
                                  fontSize: '0.65rem',
                                  fontWeight: 700,
                                  backgroundColor: '#1b77d1',
                                  color: '#ffffff',
                                  borderRadius: '4px',
                                }}
                              />
                            )
                          )}
                        </Stack>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', fontWeight: 600 }}
                        >
                          Erstellt am {new Date(cls.createdAt).toLocaleDateString('de-CH')}
                          {cls.isArchived && cls.archivedAt
                            ? ` • Archiviert am ${new Date(cls.archivedAt).toLocaleDateString('de-CH')}`
                            : ''}
                        </Typography>
                      </Box>
                      <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                        {!cls.isArchived && (
                          <>
                            <Tooltip
                              title={
                                cls.id === defaultClassId
                                  ? 'Standardklasse entfernen'
                                  : 'Als Standardklasse festlegen'
                              }
                            >
                              <IconButton
                                size="small"
                                onClick={() => handleToggleDefaultClass(cls.id)}
                                sx={{
                                  color: cls.id === defaultClassId ? '#eab308' : '#94a3b8',
                                  padding: '4px',
                                  '&:hover': {
                                    color: cls.id === defaultClassId ? '#ca8a04' : '#64748b',
                                    backgroundColor: '#f1f5f9',
                                  },
                                }}
                              >
                                {cls.id === defaultClassId ? (
                                  <StarIcon sx={{ fontSize: '1.5rem' }} />
                                ) : (
                                  <StarBorderIcon sx={{ fontSize: '1.5rem' }} />
                                )}
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="Klassenname ändern">
                              <IconButton
                                size="small"
                                onClick={() => handleOpenRename(cls)}
                                sx={{
                                  color: '#94a3b8',
                                  padding: '4px',
                                  '&:hover': {
                                    color: '#1b77d1',
                                    backgroundColor: '#f1f5f9',
                                  },
                                }}
                              >
                                <EditIcon sx={{ fontSize: '1.25rem' }} />
                              </IconButton>
                            </Tooltip>
                          </>
                        )}
                        <Box
                          sx={{
                            width: '40px',
                            height: '40px',
                            borderRadius: '8px',
                            backgroundColor: cls.isArchived
                              ? '#e2e8f0'
                              : cls.id === defaultClassId
                                ? '#fef9c3'
                                : '#f0f7ff',
                            color: cls.isArchived
                              ? '#64748b'
                              : cls.id === defaultClassId
                                ? '#ca8a04'
                                : '#1b77d1',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                          }}
                        >
                          {cls.isArchived ? (
                            <ArchiveIcon sx={{ fontSize: '1.25rem' }} />
                          ) : (
                            <SchoolIcon sx={{ fontSize: '1.25rem' }} />
                          )}
                        </Box>
                      </Box>
                    </Stack>

                    <Divider sx={{ mb: 2, borderColor: '#f1f5f9' }} />

                    <Grid container spacing={2}>
                      <Grid size={{ xs: 6 }}>
                        <Stack spacing={0.25}>
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', fontWeight: 600 }}
                          >
                            Schüler/innen
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: '#334155' }}>
                            {cls._count.students} Schüler
                          </Typography>
                        </Stack>
                      </Grid>
                      <Grid size={{ xs: 6 }}>
                        <Stack spacing={0.25}>
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', fontWeight: 600 }}
                          >
                            Prüfungen
                          </Typography>
                          <Typography variant="body2" sx={{ fontWeight: 700, color: '#334155' }}>
                            {cls.totalExams} Prüfungen
                          </Typography>
                        </Stack>
                      </Grid>
                      <Grid size={{ xs: 12 }} sx={{ mt: 1 }}>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', fontWeight: 600 }}
                          >
                            Notenschnitt (Ø):
                          </Typography>
                          {cls.averageGrade !== 'N/A' ? (
                            <Chip
                              label={cls.averageGrade}
                              size="small"
                              sx={{
                                backgroundColor:
                                  parseFloat(cls.averageGrade) >= 4.0 ? '#dcfce7' : '#fee2e2',
                                color: parseFloat(cls.averageGrade) >= 4.0 ? '#15803d' : '#b91c1c',
                                fontWeight: 'bold',
                                borderRadius: '6px',
                                fontSize: '0.8rem',
                              }}
                            />
                          ) : (
                            <Typography
                              variant="body2"
                              sx={{ fontWeight: 600, color: 'text.secondary', fontSize: '0.85rem' }}
                            >
                              Keine Noten
                            </Typography>
                          )}
                        </Stack>
                      </Grid>
                      <Grid size={{ xs: 12 }} sx={{ mt: 0.5 }}>
                        <Stack spacing={0.5}>
                          <Typography
                            variant="caption"
                            sx={{ color: 'text.secondary', fontWeight: 600 }}
                          >
                            Klassen-Fächer:
                          </Typography>
                          {cls.subjects && cls.subjects.length > 0 ? (
                            <Stack
                              direction="row"
                              spacing={0.5}
                              useFlexGap
                              sx={{ flexWrap: 'wrap' }}
                            >
                              {cls.subjects.map((subj) => {
                                const supportInfo = getSubjectSupportInfo(subj);
                                return (
                                  <Tooltip
                                    key={subj}
                                    title={`${supportInfo.supportBadge}: ${supportInfo.supportDescription}`}
                                    arrow
                                  >
                                    <Chip
                                      label={subj}
                                      size="small"
                                      sx={{
                                        height: '22px',
                                        fontSize: '0.72rem',
                                        fontWeight: 650,
                                        backgroundColor: '#eff6ff',
                                        color: '#1d4ed8',
                                        border: '1px solid #bfdbfe',
                                      }}
                                    />
                                  </Tooltip>
                                );
                              })}
                            </Stack>
                          ) : (
                            <Typography
                              variant="caption"
                              sx={{ color: 'text.secondary', fontWeight: 550 }}
                            >
                              Keine Einschränkung (Alle „Meine Fächer“)
                            </Typography>
                          )}
                        </Stack>
                      </Grid>
                    </Grid>
                  </CardContent>

                  <CardActions
                    sx={{ p: 2, pt: 0, justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}
                  >
                    {cls.isArchived ? (
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={
                          unarchiveLoadingId === cls.id ? (
                            <CircularProgress size={14} color="inherit" />
                          ) : (
                            <UnarchiveIcon sx={{ fontSize: '1rem' }} />
                          )
                        }
                        disabled={unarchiveLoadingId === cls.id}
                        onClick={() => handleUnarchiveClass(cls.id)}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          borderRadius: '6px',
                          borderColor: '#cbd5e1',
                          color: '#0f172a',
                          '&:hover': { backgroundColor: '#f1f5f9', borderColor: '#94a3b8' },
                        }}
                      >
                        Wiederherstellen
                      </Button>
                    ) : (
                      <span />
                    )}
                    <Link href={`/classes/${cls.id}`} passHref style={{ textDecoration: 'none' }}>
                      <Button
                        size="small"
                        endIcon={<ArrowForwardIcon />}
                        sx={{
                          textTransform: 'none',
                          fontWeight: 700,
                          color: '#1b77d1',
                          '&:hover': { backgroundColor: '#f0f7ff' },
                        }}
                      >
                        Details & Klassenliste
                      </Button>
                    </Link>
                  </CardActions>
                </Card>
              </Grid>
            ))}
          </Grid>
        )}

        {/* Dialog for Create Class */}
        <Dialog
          open={openCreate}
          onClose={(_e, reason) => {
            if (createLoading || reason === 'backdropClick') return;
            setOpenCreate(false);
          }}
          maxWidth="xs"
          fullWidth
        >
          <form onSubmit={handleCreateClass}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              Neue Klasse erstellen
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2} sx={{ mt: 1 }}>
                {createError && <Alert severity="error">{createError}</Alert>}
                <TextField
                  label="Klassenname"
                  placeholder="z.B. Klasse 9c"
                  fullWidth
                  variant="outlined"
                  value={newClassName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setNewClassName(val);
                    if (val.trim().length > 100) {
                      setCreateError(
                        'Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.'
                      );
                    } else if (createError) {
                      setCreateError('');
                    }
                  }}
                  error={!!createError || newClassName.trim().length > 100}
                  helperText={
                    createError ||
                    (newClassName.trim().length > 100
                      ? 'Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.'
                      : `${newClassName.length}/100 Zeichen`)
                  }
                  autoFocus
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                    },
                  }}
                />
              </Stack>
            </DialogContent>
            <DialogActions
              sx={{
                p: 2,
                pt: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 1.5,
              }}
            >
              {createError && (
                <Alert severity="error" sx={{ borderRadius: '8px' }}>
                  {createError}
                </Alert>
              )}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', width: '100%' }}>
                <Button
                  onClick={() => setOpenCreate(false)}
                  disabled={createLoading}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={
                    createLoading || !newClassName.trim() || newClassName.trim().length > 100
                  }
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    borderRadius: '8px',
                  }}
                >
                  {createLoading ? <CircularProgress size={20} /> : 'Erstellen'}
                </Button>
              </Stack>
            </DialogActions>
          </form>
        </Dialog>

        {/* Dialog for Rename / Edit Class */}
        <Dialog
          open={openRename}
          onClose={(_e, reason) => {
            if (renameLoading || reason === 'backdropClick') return;
            setOpenRename(false);
            setRenameTargetClass(null);
          }}
          maxWidth="sm"
          fullWidth
        >
          <form onSubmit={handleRenameSubmit}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              Klasse bearbeiten
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                <TextField
                  label="Klassenname"
                  fullWidth
                  variant="outlined"
                  value={renamedClassName}
                  onChange={(e) => {
                    const val = e.target.value;
                    setRenamedClassName(val);
                    if (val.trim().length > 100) {
                      setRenameError(
                        'Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.'
                      );
                    } else if (renameError) {
                      setRenameError('');
                    }
                  }}
                  error={!!renameError || renamedClassName.trim().length > 100}
                  helperText={
                    renameError ||
                    (renamedClassName.trim().length > 100
                      ? 'Der Klassenname ist zu lang. Maximal 100 Zeichen sind erlaubt.'
                      : `${renamedClassName.length}/100 Zeichen`)
                  }
                  autoFocus
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      borderRadius: '8px',
                    },
                  }}
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
                    {renamedClassSubjects.length > 0 && (
                      <Button
                        size="small"
                        onClick={() => setRenamedClassSubjects([])}
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
                    Wähle die für diese Klasse relevanten Fächer aus (Mehrfachauswahl). Leer = keine
                    Einschränkung (volle Lehrerliste „Meine Fächer“ verfügbar). Organisation
                    impliziert keine Korrekturqualität; der Unterstützungsstatus pro Fach bleibt
                    unverändert.
                  </Typography>
                  <Stack direction="row" spacing={0.75} useFlexGap sx={{ flexWrap: 'wrap' }}>
                    {Array.from(new Set([...mySubjects, ...renamedClassSubjects])).map((subj) => {
                      const isSelected = renamedClassSubjects.some(
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
                            onClick={() => handleToggleClassSubject(subj)}
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
            <DialogActions
              sx={{
                p: 2,
                pt: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'stretch',
                gap: 1.5,
              }}
            >
              {renameError && (
                <Alert severity="error" sx={{ borderRadius: '8px' }}>
                  {renameError}
                </Alert>
              )}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', width: '100%' }}>
                <Button
                  onClick={() => {
                    setOpenRename(false);
                    setRenameTargetClass(null);
                  }}
                  disabled={renameLoading}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={
                    renameLoading ||
                    !renamedClassName.trim() ||
                    renamedClassName.trim().length > 100
                  }
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    borderRadius: '8px',
                  }}
                >
                  {renameLoading ? <CircularProgress size={20} /> : 'Speichern'}
                </Button>
              </Stack>
            </DialogActions>
          </form>
        </Dialog>
      </Box>
    </DashboardLayout>
  );
}
