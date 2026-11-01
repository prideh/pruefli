'use client';

import * as React from 'react';
import { useState, useMemo } from 'react';
import Link from 'next/link';
import {
  Box,
  Typography,
  Button,
  Grid,
  Card,
  CardContent,
  CardActions,
  Stack,
  CircularProgress,
  Alert,
  AlertTitle,
  Chip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  InputAdornment,
  Divider,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Checkbox,
  Collapse,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import CalculateIcon from '@mui/icons-material/Calculate';
import ArchitectureIcon from '@mui/icons-material/Architecture';
import SpeedIcon from '@mui/icons-material/Speed';
import ScienceIcon from '@mui/icons-material/Science';
import BiotechIcon from '@mui/icons-material/Biotech';
import TerminalIcon from '@mui/icons-material/Terminal';
import AccountBalanceIcon from '@mui/icons-material/AccountBalance';
import TranslateIcon from '@mui/icons-material/Translate';
import CategoryIcon from '@mui/icons-material/Category';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import AddIcon from '@mui/icons-material/Add';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import TuneIcon from '@mui/icons-material/Tune';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import DashboardLayout from '@/components/DashboardLayout';
import ErrorState from '@/components/ErrorState';
import { useDataCache, invalidateSubjects } from '@/lib/dataCache';
import {
  SUBJECT_PROFILES,
  getSubjectSupportInfo,
  normalizeSubjectValue,
  resolveTeacherSubjects,
  resolveFilterAndViewSubjects,
  type TeacherSubjectItem,
} from '@/lib/grading';

interface SimpleClass {
  id: string;
  name: string;
  studentsCount: number;
}

interface ExamItem {
  id: string;
  title: string;
  subject: string;
  maxPoints: number;
  classId: string;
  className: string;
  submissionsCount: number;
  gradeRawSum?: number;
  averageGrade: string;
  createdAt: string;
}

interface TeacherSubjectsResponse {
  hasConfigured?: boolean;
  savedSubjects?: string[] | null;
  existingExamSubjects?: string[];
  mySubjects?: TeacherSubjectItem[];
  filterAndViewSubjects?: TeacherSubjectItem[];
}

function getSubjectIcon(subjectName: string) {
  const norm = (subjectName || '').toLowerCase();
  if (norm.includes('mathe') || norm.includes('arithmetik') || norm.includes('algebra')) {
    return <CalculateIcon sx={{ fontSize: '1.5rem', color: '#1b77d1' }} />;
  }
  if (norm.includes('geometrie')) {
    return <ArchitectureIcon sx={{ fontSize: '1.5rem', color: '#0284c7' }} />;
  }
  if (norm.includes('physik')) {
    return <SpeedIcon sx={{ fontSize: '1.5rem', color: '#7c3aed' }} />;
  }
  if (norm.includes('chemie')) {
    return <ScienceIcon sx={{ fontSize: '1.5rem', color: '#059669' }} />;
  }
  if (norm.includes('biologie')) {
    return <BiotechIcon sx={{ fontSize: '1.5rem', color: '#16a34a' }} />;
  }
  if (norm.includes('informatik') || norm.includes('ict')) {
    return <TerminalIcon sx={{ fontSize: '1.5rem', color: '#ea580c' }} />;
  }
  if (norm.includes('wirtschaft') || norm.includes('recht')) {
    return <AccountBalanceIcon sx={{ fontSize: '1.5rem', color: '#b45309' }} />;
  }
  if (
    norm.includes('sprache') ||
    norm.includes('deutsch') ||
    norm.includes('englisch') ||
    norm.includes('franz')
  ) {
    return <TranslateIcon sx={{ fontSize: '1.5rem', color: '#dc2626' }} />;
  }
  return <CategoryIcon sx={{ fontSize: '1.5rem', color: '#475569' }} />;
}

export default function SubjectsPage() {
  const [selectedClassId, setSelectedClassId] = useState<string>('ALL');
  const [selectedSubject, setSelectedSubject] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [openManageSubjects, setOpenManageSubjects] = useState<boolean>(false);
  const [selectedCatalogValues, setSelectedCatalogValues] = useState<string[]>([]);
  const [customSubjectNames, setCustomSubjectNames] = useState<string[]>([]);
  const [newCustomSubject, setNewCustomSubject] = useState<string>('');
  const [savingSubjects, setSavingSubjects] = useState<boolean>(false);
  const [subjectsSaveError, setSubjectsSaveError] = useState<string>('');
  const [showMoreSubjects, setShowMoreSubjects] = useState<boolean>(false);

  const fetchExamsApi = React.useCallback(async () => {
    const res = await fetch('/api/exams');
    if (!res.ok) throw new Error('Fehler beim Laden der Prüfungen.');
    const data = await res.json();
    return (data.exams || []).map((ex: ExamItem & { averageGrade?: string }) => ({
      ...ex,
      averageGrade: ex.averageGrade || 'N/A',
    }));
  }, []);

  const fetchClassesApi = React.useCallback(async () => {
    const res = await fetch('/api/classes');
    if (!res.ok) throw new Error('Fehler beim Laden der Klassen.');
    const data = await res.json();
    return (data.classes || []).map(
      (cls: { id: string; name: string; _count?: { students?: number } }) => ({
        id: cls.id,
        name: cls.name,
        studentsCount: cls._count?.students || 0,
      })
    );
  }, []);

  const fetchSubjectsApi = React.useCallback(async (): Promise<TeacherSubjectsResponse> => {
    const res = await fetch('/api/subjects');
    if (!res.ok) throw new Error('Fehler beim Laden der Fächerliste.');
    return res.json();
  }, []);

  const {
    data: cachedExams,
    loading: examsLoading,
    error: examsError,
    revalidate: revalidateExams,
  } = useDataCache<ExamItem[] | { exams?: ExamItem[] }>('/api/exams', fetchExamsApi);

  const {
    data: cachedClasses,
    loading: classesLoading,
    error: classesError,
    revalidate: revalidateClasses,
  } = useDataCache<SimpleClass[] | { classes?: SimpleClass[] }>('/api/classes', fetchClassesApi);

  const {
    data: cachedSubjectsData,
    revalidate: revalidateSubjects,
    mutate: mutateSubjects,
  } = useDataCache<TeacherSubjectsResponse>('/api/subjects', fetchSubjectsApi);

  const exams: ExamItem[] = useMemo(() => {
    const raw = Array.isArray(cachedExams) ? cachedExams : cachedExams?.exams || [];
    return raw.map((ex: ExamItem) => ({
      ...ex,
      averageGrade: ex.averageGrade || 'N/A',
    }));
  }, [cachedExams]);

  const classes: SimpleClass[] = useMemo(() => {
    const raw = Array.isArray(cachedClasses) ? cachedClasses : cachedClasses?.classes || [];
    return raw;
  }, [cachedClasses]);

  const loading = (examsLoading && !cachedExams) || (classesLoading && !cachedClasses);
  const error = examsError || classesError || '';

  const handleRetry = async () => {
    await Promise.all([revalidateExams(), revalidateClasses(), revalidateSubjects()]);
  };

  const savedSubjects = cachedSubjectsData?.savedSubjects ?? null;

  // Massgebliche Fächerliste der Lehrperson ("Meine Fächer") mit Erstbefüllung aus bestehenden Prüfungen
  const mySubjects = useMemo(() => {
    return resolveTeacherSubjects(
      savedSubjects,
      exams.map((ex) => ex.subject)
    );
  }, [savedSubjects, exams]);

  // Fächer für Anzeige und Filter auf der Fächer-Seite: "Meine Fächer" + tatsächlich in Prüfungen vorkommende Fächer
  const allSubjects = useMemo(() => {
    return resolveFilterAndViewSubjects(
      savedSubjects,
      exams.map((ex) => ex.subject)
    );
  }, [savedSubjects, exams]);

  // Nicht ausgewählte Katalog-Presets (erscheinen nicht als leere 0-Prüfungen-Karten im Hauptbereich, sondern unter "Weitere Fächer hinzufügen")
  const unselectedCatalogProfiles = useMemo(() => {
    return SUBJECT_PROFILES.filter(
      (p) => !allSubjects.some((s) => s.value.toLowerCase() === p.value.toLowerCase())
    ).map((p) => ({
      value: p.value,
      label: p.label,
      isCatalog: true,
      supportInfo: getSubjectSupportInfo(p.value),
    }));
  }, [allSubjects]);

  const handleOpenManageSubjects = () => {
    const catalogVals = mySubjects.filter((s) => s.isCatalog).map((s) => s.value);
    const customVals = mySubjects.filter((s) => !s.isCatalog).map((s) => s.value);
    setSelectedCatalogValues(catalogVals);
    setCustomSubjectNames(customVals);
    setNewCustomSubject('');
    setSubjectsSaveError('');
    setOpenManageSubjects(true);
  };

  const handleToggleCatalogSubject = (catalogValue: string) => {
    setSelectedCatalogValues((prev) =>
      prev.includes(catalogValue) ? prev.filter((v) => v !== catalogValue) : [...prev, catalogValue]
    );
  };

  const handleAddCustomSubject = () => {
    const normalized = normalizeSubjectValue(newCustomSubject);
    if (!normalized) return;

    const matchingCatalog = SUBJECT_PROFILES.find(
      (p) => p.value.toLowerCase() === normalized.toLowerCase()
    );
    if (matchingCatalog) {
      if (!selectedCatalogValues.includes(matchingCatalog.value)) {
        setSelectedCatalogValues((prev) => [...prev, matchingCatalog.value]);
      }
      setNewCustomSubject('');
      return;
    }

    if (!customSubjectNames.some((c) => c.toLowerCase() === normalized.toLowerCase())) {
      setCustomSubjectNames((prev) => [...prev, normalized]);
    }
    setNewCustomSubject('');
  };

  const handleRemoveCustomSubject = (customValue: string) => {
    setCustomSubjectNames((prev) => prev.filter((c) => c !== customValue));
  };

  const persistTeacherSubjects = async (nextSubjectsList: string[]) => {
    setSavingSubjects(true);
    setSubjectsSaveError('');
    try {
      const res = await fetch('/api/subjects', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ subjects: nextSubjectsList }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Fehler beim Speichern der Fächerliste.');
      }
      await mutateSubjects(data, false);
      invalidateSubjects();
      setOpenManageSubjects(false);
    } catch (err) {
      setSubjectsSaveError(
        err instanceof Error ? err.message : 'Fehler beim Speichern der Fächerliste.'
      );
    } finally {
      setSavingSubjects(false);
    }
  };

  const handleSaveManagedSubjects = async (e: React.FormEvent) => {
    e.preventDefault();
    const pendingCustom = normalizeSubjectValue(newCustomSubject);
    let nextCatalog = [...selectedCatalogValues];
    let nextCustom = [...customSubjectNames];

    if (pendingCustom) {
      const matchingCatalog = SUBJECT_PROFILES.find(
        (p) => p.value.toLowerCase() === pendingCustom.toLowerCase()
      );
      if (matchingCatalog) {
        if (!nextCatalog.includes(matchingCatalog.value)) {
          nextCatalog = [...nextCatalog, matchingCatalog.value];
        }
      } else if (!nextCustom.some((c) => c.toLowerCase() === pendingCustom.toLowerCase())) {
        nextCustom = [...nextCustom, pendingCustom];
      }
    }

    await persistTeacherSubjects([...nextCatalog, ...nextCustom]);
  };

  const handleQuickAddSubject = async (subjectValue: string) => {
    const currentValues = mySubjects.map((s) => s.value);
    if (currentValues.some((v) => v.toLowerCase() === subjectValue.toLowerCase())) return;
    await persistTeacherSubjects([...currentValues, subjectValue]);
  };

  // Aggregate stats per subject (respecting class filter if chosen)
  const subjectStats = useMemo(() => {
    const stats: Record<
      string,
      {
        examsCount: number;
        submissionsCount: number;
        gradeSum: number;
        gradeCount: number;
      }
    > = {};

    allSubjects.forEach((s) => {
      stats[s.value] = { examsCount: 0, submissionsCount: 0, gradeSum: 0, gradeCount: 0 };
    });

    exams.forEach((ex) => {
      if (selectedClassId !== 'ALL' && ex.classId !== selectedClassId) return;

      const exSubTrimmed = (ex.subject || '').trim();
      const support = getSubjectSupportInfo(exSubTrimmed);
      const matched = allSubjects.find(
        (s) =>
          s.value.toLowerCase() === exSubTrimmed.toLowerCase() ||
          s.label.toLowerCase() === exSubTrimmed.toLowerCase() ||
          (support.matchedProfile && s.value === support.matchedProfile.value)
      );

      const key = matched ? matched.value : exSubTrimmed || 'Mathematik';
      if (!stats[key]) {
        stats[key] = { examsCount: 0, submissionsCount: 0, gradeSum: 0, gradeCount: 0 };
      }
      stats[key].examsCount += 1;
      const gradedCount = ex.submissionsCount || 0;
      stats[key].submissionsCount += gradedCount;
      if (
        typeof ex.gradeRawSum === 'number' &&
        Number.isFinite(ex.gradeRawSum) &&
        gradedCount > 0
      ) {
        stats[key].gradeSum += ex.gradeRawSum;
        stats[key].gradeCount += gradedCount;
      } else if (ex.averageGrade && ex.averageGrade !== 'N/A') {
        const num = parseFloat(ex.averageGrade);
        if (!isNaN(num)) {
          const weight = gradedCount > 0 ? gradedCount : 1;
          stats[key].gradeSum += num * weight;
          stats[key].gradeCount += weight;
        }
      }
    });

    return stats;
  }, [allSubjects, exams, selectedClassId]);

  // Filtered exams according to class, subject, and text search
  const filteredExams = useMemo(() => {
    return exams.filter((ex) => {
      if (selectedClassId !== 'ALL' && ex.classId !== selectedClassId) return false;
      if (selectedSubject !== 'ALL') {
        const exSubTrimmed = (ex.subject || '').trim();
        const selectedSubTrimmed = selectedSubject.trim();
        const support = getSubjectSupportInfo(exSubTrimmed);
        const selectedSupport = getSubjectSupportInfo(selectedSubTrimmed);
        const matchesSubject =
          exSubTrimmed.toLowerCase() === selectedSubTrimmed.toLowerCase() ||
          support.matchedProfile?.value.toLowerCase() === selectedSubTrimmed.toLowerCase() ||
          (selectedSupport.matchedProfile &&
            support.matchedProfile?.value === selectedSupport.matchedProfile.value);
        if (!matchesSubject) return false;
      }
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim();
        const matchesTitle = ex.title.toLowerCase().includes(query);
        const matchesClass = ex.className.toLowerCase().includes(query);
        const matchesSubject = (ex.subject || '').toLowerCase().includes(query);
        if (!matchesTitle && !matchesClass && !matchesSubject) return false;
      }
      return true;
    });
  }, [exams, selectedClassId, selectedSubject, searchQuery]);

  return (
    <DashboardLayout>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Header Section */}
        <Box
          sx={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            flexWrap: 'wrap',
            gap: 2,
          }}
        >
          <Box>
            <Typography
              variant="h4"
              sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.02em', mb: 1 }}
            >
              Fächer & KI-Profile
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', fontWeight: 550 }}>
              Organisiere deine Prüfungen nach Fach und sieh den verifizierten Qualifikationsstatus
              aller Korrekturprofile.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            <Button
              variant="outlined"
              startIcon={<TuneIcon />}
              onClick={handleOpenManageSubjects}
              sx={{
                padding: '10px 20px',
                borderRadius: '8px',
                fontWeight: 750,
                textTransform: 'none',
                borderColor: '#cbd5e1',
                color: '#0f172a',
                '&:hover': { backgroundColor: '#f8fafc', borderColor: '#94a3b8' },
              }}
            >
              Meine Fächer verwalten
            </Button>
            <Link href="/exams" passHref style={{ textDecoration: 'none' }}>
              <Button
                variant="contained"
                startIcon={<AddIcon />}
                sx={{
                  padding: '10px 20px',
                  borderRadius: '8px',
                  fontWeight: 750,
                  textTransform: 'none',
                  backgroundColor: '#1b77d1',
                  boxShadow: '0 4px 10px rgba(27, 119, 209, 0.25)',
                  '&:hover': { backgroundColor: '#1565c0' },
                }}
              >
                Neue Prüfung anlegen
              </Button>
            </Link>
          </Stack>
        </Box>

        {/* Qualification Transparency Alert */}
        <Alert
          severity="info"
          icon={<InfoOutlinedIcon sx={{ color: '#1b77d1' }} />}
          sx={{
            borderRadius: '12px',
            backgroundColor: '#f0f7ff',
            border: '1px solid #bae6fd',
            color: '#0c4a6e',
            '& .MuiAlert-message': { width: '100%' },
          }}
        >
          <AlertTitle sx={{ fontWeight: 800, color: '#0369a1', mb: 0.5 }}>
            Transparente KI-Korrekturqualität pro Fach
          </AlertTitle>
          <Typography variant="body2" sx={{ lineHeight: 1.6, color: '#0369a1' }}>
            <strong>Mathematik</strong> verfügt über eine voll verifizierte Folgefehler-Modalität
            mit automatischer Zwischenwert-Nachrechnung. Für weitere <strong>7 Schulfächer</strong>{' '}
            ist ein gezieltes <strong>Fokus-Profil</strong> aktiv, das Bewertungskriterien wie
            Formeln, Fachterminologie oder algorithmische Logik steuert. Unbekannte Fächer nutzen
            das universelle <strong>Basis-Korrekturprofil</strong>. Tiefere fachspezifische
            Spezialmodalitäten (z. B. geometrische Konstruktionsprüfungen) befinden sich fortlaufend
            in Entwicklung.
          </Typography>
        </Alert>

        {error ? (
          <ErrorState
            title="Fehler beim Laden der Fächerübersicht"
            message={error}
            onRetry={handleRetry}
          />
        ) : loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Filter and Control Bar */}
            <Card
              sx={{
                p: 2.5,
                borderRadius: '12px',
                border: '1px solid #e2e8f0',
                boxShadow: 'none',
                backgroundColor: '#ffffff',
              }}
            >
              <Grid container spacing={2} sx={{ alignItems: 'center' }}>
                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <FormControl fullWidth size="small">
                    <InputLabel id="class-filter-label">Klasse filtern</InputLabel>
                    <Select
                      labelId="class-filter-label"
                      value={selectedClassId}
                      label="Klasse filtern"
                      onChange={(e) => setSelectedClassId(e.target.value)}
                      sx={{ borderRadius: '8px' }}
                    >
                      <MenuItem value="ALL">Alle Klassen ({classes.length})</MenuItem>
                      {classes.map((cls) => (
                        <MenuItem key={cls.id} value={cls.id}>
                          {cls.name} ({cls.studentsCount} Schüler)
                        </MenuItem>
                      ))}
                    </Select>
                  </FormControl>
                </Grid>

                <Grid size={{ xs: 12, sm: 6, md: 4 }}>
                  <TextField
                    placeholder="Prüfungen oder Fächer suchen..."
                    size="small"
                    fullWidth
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <SearchIcon sx={{ color: '#94a3b8', fontSize: '1.2rem' }} />
                          </InputAdornment>
                        ),
                      },
                    }}
                    sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                  />
                </Grid>

                <Grid size={{ xs: 12, md: 4 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{
                      justifyContent: { xs: 'flex-start', md: 'flex-end' },
                      alignItems: 'center',
                    }}
                  >
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
                      Gefiltert: {filteredExams.length}{' '}
                      {filteredExams.length === 1 ? 'Prüfung' : 'Prüfungen'}
                    </Typography>
                    {selectedSubject !== 'ALL' && (
                      <Chip
                        label="Filter zurücksetzen"
                        size="small"
                        onDelete={() => setSelectedSubject('ALL')}
                        onClick={() => setSelectedSubject('ALL')}
                        sx={{ fontWeight: 650 }}
                      />
                    )}
                  </Stack>
                </Grid>
              </Grid>
            </Card>

            {/* Subject Profile Cards Deck */}
            <Box>
              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                  flexWrap: 'wrap',
                  gap: 1.5,
                }}
              >
                <Typography
                  variant="h6"
                  sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}
                >
                  Meine Fächer ({allSubjects.length})
                </Typography>
                <Button
                  size="small"
                  variant="text"
                  startIcon={<TuneIcon sx={{ fontSize: '1rem' }} />}
                  onClick={handleOpenManageSubjects}
                  sx={{ textTransform: 'none', fontWeight: 700, color: '#1b77d1' }}
                >
                  Fächerliste anpassen
                </Button>
              </Stack>

              <Grid container spacing={2.5}>
                {allSubjects.map((item) => {
                  const stat = subjectStats[item.value] || {
                    examsCount: 0,
                    submissionsCount: 0,
                    gradeSum: 0,
                    gradeCount: 0,
                  };
                  const isSelected = selectedSubject === item.value;
                  const avgGrade =
                    stat.gradeCount > 0 ? (stat.gradeSum / stat.gradeCount).toFixed(2) : null;
                  const isVerified = item.supportInfo.supportLevel === 'VERIFIED_MODALITY';
                  const isFocus = item.supportInfo.supportLevel === 'FOCUS_PROFILE';

                  return (
                    <Grid size={{ xs: 12, sm: 6, md: 4, lg: 3 }} key={item.value}>
                      <Card
                        onClick={() => {
                          setSelectedSubject((prev) => (prev === item.value ? 'ALL' : item.value));
                        }}
                        sx={{
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          borderRadius: '12px',
                          border: '2px solid',
                          borderColor: isSelected ? '#1b77d1' : isVerified ? '#bbf7d0' : '#e2e8f0',
                          backgroundColor: isSelected ? '#f0f7ff' : '#ffffff',
                          boxShadow: isSelected
                            ? '0 8px 20px -6px rgba(27, 119, 209, 0.25)'
                            : '0 2px 6px rgba(0, 0, 0, 0.02)',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          '&:hover': {
                            transform: 'translateY(-2px)',
                            borderColor: '#1b77d1',
                            boxShadow: '0 8px 18px -4px rgba(0, 0, 0, 0.08)',
                          },
                        }}
                      >
                        <CardContent sx={{ p: 2.5, pb: 1.5 }}>
                          <Stack spacing={1.5}>
                            {/* Card Top: Icon & Badge */}
                            <Stack
                              direction="row"
                              sx={{
                                justifyContent: 'space-between',
                                alignItems: 'center',
                              }}
                            >
                              <Box
                                sx={{
                                  width: '42px',
                                  height: '42px',
                                  borderRadius: '10px',
                                  backgroundColor: '#f8fafc',
                                  display: 'flex',
                                  alignItems: 'center',
                                  justifyContent: 'center',
                                  border: '1px solid #f1f5f9',
                                }}
                              >
                                {getSubjectIcon(item.value)}
                              </Box>

                              <Tooltip title={item.supportInfo.supportDescription} arrow>
                                <Chip
                                  icon={
                                    isVerified ? (
                                      <CheckCircleIcon sx={{ fontSize: '0.9rem !important' }} />
                                    ) : (
                                      <TuneIcon sx={{ fontSize: '0.9rem !important' }} />
                                    )
                                  }
                                  label={item.supportInfo.supportBadge}
                                  size="small"
                                  sx={{
                                    height: '22px',
                                    fontSize: '0.72rem',
                                    fontWeight: 750,
                                    backgroundColor: isVerified
                                      ? '#dcfce7'
                                      : isFocus
                                        ? '#e0f2fe'
                                        : '#f1f5f9',
                                    color: isVerified ? '#15803d' : isFocus ? '#0369a1' : '#475569',
                                    borderRadius: '6px',
                                  }}
                                />
                              </Tooltip>
                            </Stack>

                            {/* Subject Title */}
                            <Box>
                              <Typography
                                variant="h6"
                                sx={{
                                  fontWeight: 800,
                                  color: '#0f172a',
                                  letterSpacing: '-0.01em',
                                  fontSize: '1.1rem',
                                }}
                              >
                                {item.label}
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{
                                  color: 'text.secondary',
                                  fontWeight: 550,
                                  display: '-webkit-box',
                                  WebkitLineClamp: 2,
                                  WebkitBoxOrient: 'vertical',
                                  overflow: 'hidden',
                                  minHeight: '36px',
                                  lineHeight: 1.4,
                                  mt: 0.5,
                                }}
                              >
                                {item.supportInfo.profileFocus}
                              </Typography>
                            </Box>

                            <Divider sx={{ borderColor: '#f1f5f9' }} />

                            {/* Metrics Strip */}
                            <Grid container spacing={1}>
                              <Grid size={{ xs: 6 }}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    fontWeight: 600,
                                    display: 'block',
                                  }}
                                >
                                  Prüfungen
                                </Typography>
                                <Typography
                                  variant="body2"
                                  sx={{ fontWeight: 800, color: '#0f172a' }}
                                >
                                  {stat.examsCount}
                                </Typography>
                              </Grid>
                              <Grid size={{ xs: 6 }}>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    fontWeight: 600,
                                    display: 'block',
                                  }}
                                >
                                  Notenschnitt
                                </Typography>
                                <Typography
                                  variant="body2"
                                  sx={{
                                    fontWeight: 800,
                                    color:
                                      avgGrade && parseFloat(avgGrade) >= 4.0
                                        ? '#15803d'
                                        : avgGrade
                                          ? '#b91c1c'
                                          : 'text.secondary',
                                  }}
                                >
                                  {avgGrade || '–'}
                                </Typography>
                              </Grid>
                            </Grid>
                          </Stack>
                        </CardContent>

                        <CardActions sx={{ p: 2, pt: 0, justifyContent: 'space-between' }}>
                          <Typography
                            variant="caption"
                            sx={{
                              fontWeight: 700,
                              color: isSelected ? '#1b77d1' : '#64748b',
                            }}
                          >
                            {isSelected ? 'Aktiv ausgewählt' : 'Klicken zum Filtern'}
                          </Typography>
                          <ArrowForwardIcon
                            sx={{
                              fontSize: '1rem',
                              color: isSelected ? '#1b77d1' : '#94a3b8',
                              transform: isSelected ? 'rotate(90deg)' : 'none',
                              transition: 'transform 0.2s ease',
                            }}
                          />
                        </CardActions>
                      </Card>
                    </Grid>
                  );
                })}
              </Grid>

              {/* Collapsible section: Weitere Fächer hinzufügen */}
              <Box sx={{ mt: 2.5 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setShowMoreSubjects((prev) => !prev)}
                  endIcon={showMoreSubjects ? <KeyboardArrowUpIcon /> : <KeyboardArrowDownIcon />}
                  sx={{
                    borderRadius: '8px',
                    textTransform: 'none',
                    fontWeight: 700,
                    borderColor: '#cbd5e1',
                    color: '#334155',
                    '&:hover': { backgroundColor: '#f8fafc', borderColor: '#94a3b8' },
                  }}
                >
                  Weitere Fächer hinzufügen
                  {unselectedCatalogProfiles.length > 0
                    ? ` (${unselectedCatalogProfiles.length} Katalog-Profile ausgeblendet)`
                    : ' (Katalog & eigene Fächer)'}
                </Button>

                <Collapse in={showMoreSubjects}>
                  <Card
                    sx={{
                      mt: 2,
                      p: 2.5,
                      borderRadius: '12px',
                      border: '1px dashed #cbd5e1',
                      backgroundColor: '#f8fafc',
                      boxShadow: 'none',
                    }}
                  >
                    <Stack spacing={2}>
                      <Stack
                        direction="row"
                        sx={{
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          flexWrap: 'wrap',
                          gap: 1.5,
                        }}
                      >
                        <Box>
                          <Typography
                            variant="subtitle2"
                            sx={{ fontWeight: 800, color: '#0f172a' }}
                          >
                            Nicht ausgewählte Katalog-Profile & eigene Fächer
                          </Typography>
                          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            Füge weitere Katalog-Profile mit einem Klick zu &quot;Meine Fächer&quot;
                            hinzu oder erfasse eigene Fächer mit freiem Namen.
                          </Typography>
                        </Box>
                        <Button
                          size="small"
                          variant="contained"
                          startIcon={<TuneIcon />}
                          onClick={handleOpenManageSubjects}
                          sx={{
                            borderRadius: '8px',
                            textTransform: 'none',
                            fontWeight: 700,
                            backgroundColor: '#0f172a',
                            '&:hover': { backgroundColor: '#1e293b' },
                          }}
                        >
                          Meine Fächer verwalten
                        </Button>
                      </Stack>

                      {unselectedCatalogProfiles.length > 0 ? (
                        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                          {unselectedCatalogProfiles.map((preset) => (
                            <Chip
                              key={preset.value}
                              icon={<AddIcon />}
                              label={`${preset.label} (${preset.supportInfo.supportBadge})`}
                              onClick={() => handleQuickAddSubject(preset.value)}
                              disabled={savingSubjects}
                              sx={{
                                fontWeight: 700,
                                backgroundColor: '#ffffff',
                                border: '1px solid #cbd5e1',
                                cursor: 'pointer',
                                '&:hover': {
                                  backgroundColor: '#eff6ff',
                                  borderColor: '#1b77d1',
                                },
                              }}
                            />
                          ))}
                        </Stack>
                      ) : (
                        <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                          Alle 8 Katalog-Profile sind bereits in &quot;Meine Fächer&quot; aktiv.
                          Über &quot;Meine Fächer verwalten&quot; kannst du Katalog-Profile abwählen
                          oder eigene Fächer (Basis-Korrektur) hinzufügen.
                        </Typography>
                      )}
                    </Stack>
                  </Card>
                </Collapse>
              </Box>
            </Box>

            {/* Organized Exams List */}
            <Box sx={{ mt: 1 }}>
              <Stack
                direction="row"
                sx={{
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  mb: 2,
                  flexWrap: 'wrap',
                  gap: 1.5,
                }}
              >
                <Box>
                  <Typography
                    variant="h6"
                    sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}
                  >
                    Prüfungen{' '}
                    {selectedSubject !== 'ALL'
                      ? `im Fach ${allSubjects.find((s) => s.value === selectedSubject)?.label || selectedSubject}`
                      : 'aller Fächer'}
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 550 }}>
                    {filteredExams.length} {filteredExams.length === 1 ? 'Prüfung' : 'Prüfungen'}{' '}
                    geordnet nach Fach und Klasse.
                  </Typography>
                </Box>

                {selectedSubject !== 'ALL' && (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setSelectedSubject('ALL')}
                    sx={{ textTransform: 'none', fontWeight: 700, color: '#1b77d1' }}
                  >
                    Alle Fächer anzeigen
                  </Button>
                )}
              </Stack>

              {filteredExams.length === 0 ? (
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
                  <AssignmentIcon sx={{ fontSize: '3.5rem', color: '#94a3b8', mb: 2 }} />
                  <Typography variant="h6" sx={{ fontWeight: 700, color: '#475569', mb: 1 }}>
                    Keine Prüfungen gefunden
                  </Typography>
                  <Typography
                    variant="body2"
                    sx={{ color: 'text.secondary', maxWidth: '460px', mx: 'auto', mb: 3 }}
                  >
                    {selectedSubject !== 'ALL'
                      ? `Es wurden noch keine Prüfungen für das Fach "${allSubjects.find((s) => s.value === selectedSubject)?.label || selectedSubject}" angelegt.`
                      : 'Es wurden keine Prüfungen gefunden, die den gewählten Suchkriterien entsprechen.'}
                  </Typography>
                  <Link href="/exams" passHref style={{ textDecoration: 'none' }}>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 700 }}
                    >
                      Neue Prüfung anlegen
                    </Button>
                  </Link>
                </Card>
              ) : (
                <Grid container spacing={2.5}>
                  {filteredExams.map((ex) => {
                    const support = getSubjectSupportInfo(ex.subject);
                    const isVerified = support.supportLevel === 'VERIFIED_MODALITY';

                    return (
                      <Grid size={{ xs: 12, sm: 6, md: 4 }} key={ex.id}>
                        <Card
                          sx={{
                            borderRadius: '12px',
                            border: '1px solid #e2e8f0',
                            boxShadow: 'none',
                            transition: 'all 0.2s ease',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            height: '100%',
                            '&:hover': {
                              transform: 'translateY(-2px)',
                              borderColor: '#1b77d1',
                              boxShadow: '0 8px 16px -4px rgba(0, 0, 0, 0.06)',
                            },
                          }}
                        >
                          <CardContent sx={{ p: 2.5, pb: 1 }}>
                            <Stack spacing={1.5}>
                              {/* Subject Badge & Support Pill */}
                              <Stack
                                direction="row"
                                spacing={1}
                                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                              >
                                <Chip
                                  label={ex.subject}
                                  size="small"
                                  sx={{
                                    backgroundColor: '#e3f2fd',
                                    color: '#1b77d1',
                                    fontWeight: 750,
                                    fontSize: '0.75rem',
                                  }}
                                />
                                <Tooltip title={support.supportDescription} arrow>
                                  <Chip
                                    label={support.supportBadge}
                                    size="small"
                                    variant="outlined"
                                    sx={{
                                      fontSize: '0.72rem',
                                      fontWeight: 650,
                                      borderColor: isVerified ? '#86efac' : '#cbd5e1',
                                      color: isVerified ? '#15803d' : '#475569',
                                    }}
                                  />
                                </Tooltip>
                              </Stack>

                              {/* Title */}
                              <Box>
                                <Typography
                                  variant="subtitle1"
                                  sx={{
                                    fontWeight: 800,
                                    color: '#0f172a',
                                    lineHeight: 1.3,
                                    display: '-webkit-box',
                                    WebkitLineClamp: 2,
                                    WebkitBoxOrient: 'vertical',
                                    overflow: 'hidden',
                                  }}
                                >
                                  {ex.title}
                                </Typography>
                              </Box>

                              <Divider sx={{ borderColor: '#f1f5f9' }} />

                              {/* Details Grid */}
                              <Grid container spacing={1.5}>
                                <Grid size={{ xs: 6 }}>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: 'text.secondary',
                                      fontWeight: 600,
                                      display: 'block',
                                    }}
                                  >
                                    Klasse
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 700, color: '#334155' }}
                                  >
                                    {ex.className}
                                  </Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: 'text.secondary',
                                      fontWeight: 600,
                                      display: 'block',
                                    }}
                                  >
                                    Max. Punkte
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 700, color: '#334155' }}
                                  >
                                    {ex.maxPoints} Punkte
                                  </Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: 'text.secondary',
                                      fontWeight: 600,
                                      display: 'block',
                                    }}
                                  >
                                    Korrekturen
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{ fontWeight: 700, color: '#334155' }}
                                  >
                                    {ex.submissionsCount}{' '}
                                    {ex.submissionsCount === 1 ? 'Arbeit' : 'Arbeiten'}
                                  </Typography>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                  <Typography
                                    variant="caption"
                                    sx={{
                                      color: 'text.secondary',
                                      fontWeight: 600,
                                      display: 'block',
                                    }}
                                  >
                                    Notenschnitt
                                  </Typography>
                                  <Typography
                                    variant="body2"
                                    sx={{
                                      fontWeight: 800,
                                      color:
                                        ex.averageGrade !== 'N/A' &&
                                        parseFloat(ex.averageGrade) >= 4.0
                                          ? '#15803d'
                                          : ex.averageGrade !== 'N/A'
                                            ? '#b91c1c'
                                            : 'text.secondary',
                                    }}
                                  >
                                    {ex.averageGrade}
                                  </Typography>
                                </Grid>
                              </Grid>
                            </Stack>
                          </CardContent>

                          <CardActions sx={{ p: 2, pt: 1 }}>
                            <Link
                              href={`/exams/${ex.id}`}
                              passHref
                              style={{ textDecoration: 'none', width: '100%' }}
                            >
                              <Button
                                variant="outlined"
                                fullWidth
                                endIcon={<ArrowForwardIcon />}
                                sx={{
                                  borderRadius: '8px',
                                  textTransform: 'none',
                                  fontWeight: 700,
                                  borderColor: '#e2e8f0',
                                  color: '#0f172a',
                                  '&:hover': {
                                    borderColor: '#1b77d1',
                                    color: '#1b77d1',
                                    backgroundColor: '#f0f7ff',
                                  },
                                }}
                              >
                                Prüfung öffnen
                              </Button>
                            </Link>
                          </CardActions>
                        </Card>
                      </Grid>
                    );
                  })}
                </Grid>
              )}
            </Box>
          </>
        )}

        {/* Dialog: Meine Fächer verwalten (Katalog-Auswahl + eigene Fächer) */}
        <Dialog
          open={openManageSubjects}
          onClose={() => {
            if (!savingSubjects) setOpenManageSubjects(false);
          }}
          maxWidth="md"
          fullWidth
        >
          <form onSubmit={handleSaveManagedSubjects}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              Meine Fächer verwalten
            </DialogTitle>
            <DialogContent dividers>
              <Stack spacing={3}>
                {subjectsSaveError && <Alert severity="error">{subjectsSaveError}</Alert>}

                <Alert
                  severity="info"
                  icon={<InfoOutlinedIcon sx={{ color: '#1b77d1' }} />}
                  sx={{
                    borderRadius: '10px',
                    backgroundColor: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#334155',
                  }}
                >
                  <Typography variant="body2" sx={{ lineHeight: 1.55 }}>
                    Wähle die Fächer aus, die du unterrichtest. Deine Auswahl bestimmt die
                    verfügbaren Fächer in den Prüfungs-Anlegedialogen, den Fächer-Filtern und auf
                    der Fächer-Seite. Der KI-Qualifikationsstatus (
                    <strong>Verifizierte Modalität</strong>, <strong>Fokus-Profil</strong> oder{' '}
                    <strong>Basis-Korrektur</strong>) bleibt unverändert — eigene Fächer nutzen
                    immer die <strong>Basis-Korrektur</strong>.
                  </Typography>
                </Alert>

                {/* 1. Katalog-Profile auswählen */}
                <Box>
                  <Stack
                    direction="row"
                    sx={{
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      mb: 1.5,
                      flexWrap: 'wrap',
                      gap: 1,
                    }}
                  >
                    <Typography variant="subtitle1" sx={{ fontWeight: 800, color: '#0f172a' }}>
                      1. Katalog-Profile auswählen ({selectedCatalogValues.length} /{' '}
                      {SUBJECT_PROFILES.length})
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        variant="text"
                        onClick={() =>
                          setSelectedCatalogValues(SUBJECT_PROFILES.map((p) => p.value))
                        }
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Alle auswählen
                      </Button>
                      <Button
                        size="small"
                        variant="text"
                        color="inherit"
                        onClick={() => setSelectedCatalogValues([])}
                        sx={{ textTransform: 'none', fontWeight: 600, color: 'text.secondary' }}
                      >
                        Auswahl leeren
                      </Button>
                    </Stack>
                  </Stack>

                  <Grid container spacing={1.5}>
                    {SUBJECT_PROFILES.map((profile) => {
                      const checked = selectedCatalogValues.includes(profile.value);
                      const isVerified = profile.supportLevel === 'VERIFIED_MODALITY';

                      return (
                        <Grid size={{ xs: 12, sm: 6 }} key={profile.value}>
                          <Card
                            onClick={() => handleToggleCatalogSubject(profile.value)}
                            sx={{
                              p: 1.5,
                              borderRadius: '10px',
                              border: '2px solid',
                              borderColor: checked ? '#1b77d1' : '#e2e8f0',
                              backgroundColor: checked ? '#f0f7ff' : '#ffffff',
                              boxShadow: 'none',
                              cursor: 'pointer',
                              transition: 'all 0.15s ease',
                              '&:hover': {
                                borderColor: '#1b77d1',
                              },
                            }}
                          >
                            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'flex-start' }}>
                              <Checkbox
                                checked={checked}
                                onChange={() => handleToggleCatalogSubject(profile.value)}
                                onClick={(e) => e.stopPropagation()}
                                size="small"
                                sx={{ p: 0.25, mt: 0.25 }}
                              />
                              <Box sx={{ flex: 1, minWidth: 0 }}>
                                <Stack
                                  direction="row"
                                  spacing={1}
                                  sx={{
                                    alignItems: 'center',
                                    justifyContent: 'space-between',
                                    flexWrap: 'wrap',
                                    mb: 0.5,
                                  }}
                                >
                                  <Typography
                                    variant="subtitle2"
                                    sx={{ fontWeight: 800, color: '#0f172a' }}
                                  >
                                    {profile.label}
                                  </Typography>
                                  <Chip
                                    label={profile.supportBadge}
                                    size="small"
                                    sx={{
                                      height: '20px',
                                      fontSize: '0.68rem',
                                      fontWeight: 700,
                                      backgroundColor: isVerified ? '#dcfce7' : '#e0f2fe',
                                      color: isVerified ? '#15803d' : '#0369a1',
                                    }}
                                  />
                                </Stack>
                                <Typography
                                  variant="caption"
                                  sx={{
                                    color: 'text.secondary',
                                    display: 'block',
                                    lineHeight: 1.35,
                                  }}
                                >
                                  {profile.profileFocus}
                                </Typography>
                              </Box>
                            </Stack>
                          </Card>
                        </Grid>
                      );
                    })}
                  </Grid>
                </Box>

                <Divider />

                {/* 2. Eigene Fächer hinzufügen & entfernen */}
                <Box>
                  <Typography
                    variant="subtitle1"
                    sx={{ fontWeight: 800, color: '#0f172a', mb: 0.5 }}
                  >
                    2. Eigene Fächer (Basis-Korrektur)
                  </Typography>
                  <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1.5 }}>
                    Füge eigene Fächer ausserhalb des Katalogs mit freiem Namen hinzu (z. B.
                    Geschichte, Französisch, Geografie, Musik).
                  </Typography>

                  <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ mb: 2 }}>
                    <TextField
                      label="Eigenes Fach hinzufügen"
                      placeholder="z. B. Geschichte, Französisch, Musik"
                      size="small"
                      fullWidth
                      value={newCustomSubject}
                      onChange={(e) => setNewCustomSubject(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddCustomSubject();
                        }
                      }}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                    <Button
                      type="button"
                      variant="outlined"
                      startIcon={<AddIcon />}
                      onClick={handleAddCustomSubject}
                      disabled={!newCustomSubject.trim()}
                      sx={{
                        borderRadius: '8px',
                        textTransform: 'none',
                        fontWeight: 700,
                        whiteSpace: 'nowrap',
                        px: 2.5,
                      }}
                    >
                      Hinzufügen
                    </Button>
                  </Stack>

                  {customSubjectNames.length === 0 ? (
                    <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                      Noch keine eigenen Fächer erfasst.
                    </Typography>
                  ) : (
                    <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                      {customSubjectNames.map((customName) => (
                        <Chip
                          key={customName}
                          label={`${customName} (Basis-Korrektur)`}
                          onDelete={() => handleRemoveCustomSubject(customName)}
                          sx={{
                            fontWeight: 700,
                            backgroundColor: '#f1f5f9',
                            color: '#0f172a',
                            border: '1px solid #cbd5e1',
                          }}
                        />
                      ))}
                    </Stack>
                  )}
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ px: 3, py: 2 }}>
              <Button
                type="button"
                onClick={() => setOpenManageSubjects(false)}
                disabled={savingSubjects}
                sx={{ textTransform: 'none', fontWeight: 600, color: 'text.secondary' }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={savingSubjects}
                sx={{
                  borderRadius: '8px',
                  textTransform: 'none',
                  fontWeight: 750,
                  backgroundColor: '#1b77d1',
                  px: 3,
                  '&:hover': { backgroundColor: '#1565c0' },
                }}
              >
                {savingSubjects ? 'Speichert...' : 'Meine Fächer speichern'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>
      </Box>
    </DashboardLayout>
  );
}
