'use client';

import * as React from 'react';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  FormHelperText,
  Switch,
  FormControlLabel,
} from '@mui/material';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AddIcon from '@mui/icons-material/Add';
import AssignmentIcon from '@mui/icons-material/Assignment';
import ArrowForwardIcon from '@mui/icons-material/ArrowForward';
import StarsIcon from '@mui/icons-material/Stars';
import StarIcon from '@mui/icons-material/Star';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import { getErrorMessage } from '@/lib/api-error';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloseIcon from '@mui/icons-material/Close';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import DashboardLayout from '@/components/DashboardLayout';
import EmailVerificationAiBanner, {
  useTeacherSession,
} from '@/components/EmailVerificationAiBanner';
import ErrorState from '@/components/ErrorState';
import QrScannerDialog from '@/components/QrScannerDialog';
import { useDataCache, invalidateExams } from '@/lib/dataCache';
import {
  canCreateExamWithClasses,
  isValidMaxPointsInput,
  normalizeMaxPointsInput,
  parseMaxPointsInput,
  resolveCreateExamDisabledHint,
} from '@/lib/ux-polish';
import {
  GRADING_FORMULA_OPTIONS,
  GRADE_ROUNDING_OPTIONS,
  getSubjectSupportInfo,
  normalizeSubjectValue,
  toTeacherSubjectItem,
  resolveTeacherSubjects,
  resolveFilterAndViewSubjects,
  resolveClassSubjectOptions,
  resolveDefaultExamSubjectForClass,
  isSerializedDocumentPayload,
  type GradingFormula,
  type GradeRounding,
  type TeacherSubjectItem,
} from '@/lib/grading';

interface SimpleClass {
  id: string;
  name: string;
  studentsCount: number;
  totalExams: number;
  averageGrade: string;
  subjects?: string[];
}

interface PrismaExamItem {
  id: string;
  title: string;
  subject: string;
  maxPoints: number;
  classId: string;
  className: string;
  rubricText: string;
  examTemplateText?: string | null;
  gradingNotes?: string | null;
  gradingFormula?: string;
  gradeRounding?: string;
  submissionsCount: number;
  isGenerated?: boolean;
  isApproved?: boolean;
  approvedAt?: string | null;
  tasks?: { taskId: string; title: string; maxPoints: number; sourceReference?: string | null }[];
}

interface ExamListItem extends PrismaExamItem {
  averageGrade: string;
}

interface TeacherSubjectsResponse {
  hasConfigured?: boolean;
  savedSubjects?: string[] | null;
  existingExamSubjects?: string[];
  mySubjects?: TeacherSubjectItem[];
  filterAndViewSubjects?: TeacherSubjectItem[];
}

interface SubjectComboboxProps {
  id?: string;
  value: string;
  options: TeacherSubjectItem[];
  onChange: (newValue: string) => void;
  label?: string;
}

function SubjectCombobox({
  id,
  value,
  options,
  onChange,
  label = 'Fach (KI-Profil)',
}: SubjectComboboxProps) {
  const effectiveOptions = React.useMemo(() => {
    if (options.length > 0) return options;
    const trimmed = (value || '').trim();
    return [toTeacherSubjectItem(trimmed || 'Mathematik')];
  }, [options, value]);

  const effectiveValue = React.useMemo(() => {
    const trimmed = (value || '').trim();
    const matched = effectiveOptions.find(
      (opt) => opt.value.toLowerCase() === trimmed.toLowerCase()
    );
    return matched ? matched.value : (effectiveOptions[0]?.value ?? '');
  }, [effectiveOptions, value]);

  const supportInfo = getSubjectSupportInfo(effectiveValue);
  const isVerified = supportInfo.supportLevel === 'VERIFIED_MODALITY';
  const isFallback = supportInfo.supportLevel === 'GENERIC_FALLBACK';
  const labelId = id ? `${id}-label` : 'subject-select-label';

  return (
    <FormControl fullWidth>
      <InputLabel id={labelId}>{label}</InputLabel>
      <Select
        id={id}
        labelId={labelId}
        value={effectiveValue}
        label={label}
        onChange={(e) => onChange(e.target.value)}
        sx={{ borderRadius: '8px' }}
        MenuProps={{ disablePortal: true }}
      >
        {effectiveOptions.map((item) => (
          <MenuItem key={item.value} value={item.value}>
            {item.label} ({item.supportInfo.supportBadge})
          </MenuItem>
        ))}
      </Select>
      <FormHelperText
        component="div"
        sx={{
          fontSize: '0.73rem',
          color: 'text.secondary',
          mt: 0.5,
          mx: 1.75,
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          flexWrap: 'wrap',
        }}
      >
        <Chip
          label={supportInfo.supportBadge}
          size="small"
          variant="outlined"
          sx={{
            height: 20,
            fontSize: '0.68rem',
            fontWeight: 700,
            borderColor: isVerified ? '#86efac' : isFallback ? '#cbd5e1' : '#93c5fd',
            backgroundColor: isVerified ? '#f0fdf4' : isFallback ? '#f8fafc' : '#eff6ff',
            color: isVerified ? '#15803d' : isFallback ? '#475569' : '#1d4ed8',
          }}
        />
        <span>
          {supportInfo.supportBadge}: {supportInfo.profileFocus}
        </span>
        <Link
          href="/subjects"
          style={{ color: '#1b77d1', fontWeight: 700, textDecoration: 'none' }}
        >
          Meine Fächer verwalten
        </Link>
      </FormHelperText>
    </FormControl>
  );
}

export default function ExamsPage() {
  const router = useRouter();

  const fetchExamsApi = React.useCallback(async () => {
    const res = await fetch('/api/exams');
    if (!res.ok) throw new Error('Fehler beim Laden der Prüfungen.');
    const examsData = await res.json();
    return (examsData.exams || []).map((ex: PrismaExamItem & { averageGrade?: string }) => ({
      ...ex,
      averageGrade: ex.averageGrade || 'N/A',
    }));
  }, []);

  const fetchClassesApi = React.useCallback(async () => {
    const res = await fetch('/api/classes');
    if (!res.ok) throw new Error('Fehler beim Laden der Klassen.');
    const classesData = await res.json();
    return (classesData.classes || []).map(
      (cls: {
        id: string;
        name: string;
        createdAt?: string;
        _count?: { students?: number };
        totalExams?: number;
        averageGrade?: string;
        subjects?: string[];
      }) => ({
        ...cls,
        id: cls.id,
        name: cls.name,
        _count: {
          students: cls._count?.students || 0,
        },
        studentsCount: cls._count?.students || 0,
        totalExams: cls.totalExams ?? 0,
        averageGrade: cls.averageGrade || 'N/A',
        subjects: Array.isArray(cls.subjects) ? cls.subjects : [],
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
  } = useDataCache<ExamListItem[] | { exams?: ExamListItem[] }>('/api/exams', fetchExamsApi);

  const {
    data: cachedClasses,
    loading: classesLoading,
    error: classesError,
    revalidate: revalidateClasses,
  } = useDataCache<SimpleClass[] | { classes?: SimpleClass[] }>('/api/classes', fetchClassesApi);

  const { data: cachedSubjectsData, revalidate: revalidateSubjects } =
    useDataCache<TeacherSubjectsResponse>('/api/subjects', fetchSubjectsApi);

  const exams = React.useMemo(() => {
    const raw = Array.isArray(cachedExams) ? cachedExams : cachedExams?.exams || [];
    return raw.map((ex: ExamListItem) => ({
      ...ex,
      averageGrade: ex.averageGrade || 'N/A',
    }));
  }, [cachedExams]);

  const classes = React.useMemo(() => {
    const raw = Array.isArray(cachedClasses) ? cachedClasses : cachedClasses?.classes || [];
    return raw.map(
      (cls: SimpleClass & { _count?: { students?: number }; subjects?: string[] }) => ({
        ...cls,
        studentsCount: cls.studentsCount ?? cls._count?.students ?? 0,
        totalExams: cls.totalExams ?? 0,
        averageGrade: cls.averageGrade || 'N/A',
        subjects: Array.isArray(cls.subjects) ? cls.subjects : [],
      })
    );
  }, [cachedClasses]);
  const classesInitialLoading = classesLoading && !cachedClasses;
  const loading = (examsLoading && !cachedExams) || classesInitialLoading;
  const error = examsError || classesError || '';
  const canCreateExam = canCreateExamWithClasses({
    classesLoading: classesInitialLoading,
    classesError,
    classesCount: classes.length,
  });

  const savedSubjects = cachedSubjectsData?.savedSubjects ?? null;
  const mySubjects = React.useMemo(
    () =>
      resolveTeacherSubjects(
        savedSubjects,
        exams.map((ex) => ex.subject)
      ),
    [savedSubjects, exams]
  );

  const fetchData = React.useCallback(async () => {
    await Promise.all([revalidateExams(), revalidateClasses(), revalidateSubjects()]);
  }, [revalidateExams, revalidateClasses, revalidateSubjects]);

  const [activeTabClassId, setActiveTabClassId] = useState<string>('');
  const activeClassId = React.useMemo(() => {
    if (activeTabClassId && classes.some((c) => c.id === activeTabClassId)) {
      return activeTabClassId;
    }
    const defaultId =
      typeof window !== 'undefined'
        ? localStorage.getItem('pruefli_default_class_id') ||
          localStorage.getItem('gradeai_default_class_id')
        : null;
    const hasDefault = defaultId && classes.some((c) => c.id === defaultId);
    return hasDefault ? (defaultId as string) : (classes[0]?.id ?? '');
  }, [classes, activeTabClassId]);

  const [dialogClassId, setDialogClassId] = useState<string>('');
  const selectedClassId = React.useMemo(() => {
    if (dialogClassId && classes.some((c) => c.id === dialogClassId)) {
      return dialogClassId;
    }
    return activeClassId || (classes[0]?.id ?? '');
  }, [classes, dialogClassId, activeClassId]);

  const selectedClass = React.useMemo(
    () => classes.find((c) => c.id === selectedClassId) || null,
    [classes, selectedClassId]
  );

  const createDialogSubjectOptions = React.useMemo(
    () => resolveClassSubjectOptions(mySubjects, selectedClass?.subjects),
    [mySubjects, selectedClass]
  );

  const [classSelectionPrompt, setClassSelectionPrompt] = useState<string>('');

  const [defaultClassId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return (
        localStorage.getItem('pruefli_default_class_id') ||
        localStorage.getItem('gradeai_default_class_id')
      );
    }
    return null;
  });

  // Dialog State
  const [openCreate, setOpenCreate] = useState(false);
  const [qrRubricOpen, setQrRubricOpen] = useState(false);
  const [examTitle, setExamTitle] = useState('');

  // Generate Exam State (Feature: generate exams from uploaded teaching material)
  const [openGenerate, setOpenGenerate] = useState(false);
  const [genTitle, setGenTitle] = useState('');
  const [genClassId, setGenClassId] = useState('');
  const [genSubject, setGenSubject] = useState('Mathematik');
  const [genTopic, setGenTopic] = useState('');
  const [genStufe, setGenStufe] = useState('Sekundarstufe I (7.–9. Klasse)');
  const [genDifficulty, setGenDifficulty] = useState('Standard (Mittelschwer)');
  const [genTotalPoints, setGenTotalPoints] = useState<number>(20);
  const [genTaskCount, setGenTaskCount] = useState<number>(4);
  const [genEnableQrSheet, setGenEnableQrSheet] = useState<boolean>(false);
  const [genMaterialPayload, setGenMaterialPayload] = useState<{
    mimeType: string;
    data: string;
  } | null>(null);
  const [genMaterialText, setGenMaterialText] = useState('');
  const [genMaterialFileName, setGenMaterialFileName] = useState('');
  const [genLoading, setGenLoading] = useState(false);
  const [genError, setGenError] = useState('');

  const handleGenMaterialFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setGenMaterialFileName(file.name);
      setGenError('');

      const reader = new FileReader();
      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (dataUrl) {
            const base64Data = dataUrl.split(',')[1];
            setGenMaterialPayload({
              mimeType: file.type || 'application/pdf',
              data: base64Data,
            });
            setGenMaterialText('');
          }
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (event) => {
          const text = event.target?.result as string;
          if (text) {
            setGenMaterialText(text);
            setGenMaterialPayload(null);
          }
        };
        reader.readAsText(file);
      }
    }
  };

  const handleGenerateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    const effectiveMaterial =
      genMaterialPayload || (genMaterialText.trim() ? genMaterialText : null);

    // Mandatory material upload check
    if (!effectiveMaterial) {
      setGenError(
        'Das Hochladen von Unterrichtsmaterial ist erforderlich. prüefli generiert Prüfungen ausschliesslich auf Basis Ihrer Unterlagen.'
      );
      return;
    }

    const targetClass = genClassId || selectedClassId;
    if (!targetClass) {
      setGenError('Bitte wähle eine Klasse aus.');
      return;
    }

    if (!genSubject.trim()) {
      setGenError('Bitte gib ein Fach an.');
      return;
    }

    setGenLoading(true);
    setGenError('');

    try {
      const res = await fetch('/api/exams/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          material: effectiveMaterial,
          classId: targetClass,
          title: genTitle.trim() || undefined,
          subject: genSubject.trim(),
          topic: genTopic.trim() || undefined,
          stufe: genStufe,
          difficulty: genDifficulty,
          totalPoints: Number(genTotalPoints) || 20,
          taskCount: Number(genTaskCount) || 4,
          enableQrSheet: genEnableQrSheet,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Fehler bei der Generierung der Prüfung.');
      }

      setOpenGenerate(false);
      invalidateExams(data.examId || data.exam?.id, targetClass);
      router.push(`/exams/${data.examId || data.exam?.id}`);
    } catch (err) {
      setGenError(err instanceof Error ? err.message : 'Fehler bei der Generierung.');
    } finally {
      setGenLoading(false);
    }
  };

  // Copy Exam State
  const [openCopy, setOpenCopy] = useState(false);
  const [copySourceExam, setCopySourceExam] = useState<ExamListItem | null>(null);
  const [copyTitle, setCopyTitle] = useState('');
  const [copySubject, setCopySubject] = useState('');
  const [copyMaxPoints, setCopyMaxPoints] = useState<string>('20');
  const [copyRubric, setCopyRubric] = useState('');
  const [copyGradingNotes, setCopyGradingNotes] = useState('');
  const [copyGradingFormula, setCopyGradingFormula] = useState<GradingFormula>('LINEAR_60');
  const [copyGradeRounding, setCopyGradeRounding] = useState<GradeRounding>('0.1');
  const [copyTargetClassId, setCopyTargetClassId] = useState('');
  const [copyLoading, setCopyLoading] = useState(false);
  const [copyError, setCopyError] = useState('');
  const [examSubject, setExamSubject] = useState('Mathematik');
  const [examMaxPoints, setExamMaxPoints] = useState<string>('20');
  const [examRubric, setExamRubric] = useState('');
  const [examGradingNotes, setExamGradingNotes] = useState('');
  const [examGradingFormula, setExamGradingFormula] = useState<GradingFormula>('LINEAR_60');
  const [examGradeRounding, setExamGradeRounding] = useState<GradeRounding>('0.1');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [parsingRubric, setParsingRubric] = useState(false);
  const [rubricOverridePrompt, setRubricOverridePrompt] = useState<{
    reason: string;
    summary?: string;
  } | null>(null);
  const [rubricOverrideConfirmed, setRubricOverrideConfirmed] = useState(false);
  const [parsedTasks, setParsedTasks] = useState<
    { taskId: string; title: string; maxPoints: number }[]
  >([]);

  const { isUnverified } = useTeacherSession();
  const generateExamDisabledHint = resolveCreateExamDisabledHint({
    isUnverified,
    forAiGeneration: true,
    classesLoading: classesInitialLoading,
    classesError,
    classesCount: classes.length,
  });
  const manualCreateExamDisabledHint = resolveCreateExamDisabledHint({
    classesLoading: classesInitialLoading,
    classesError,
    classesCount: classes.length,
  });

  const autoParseRubric = async (rubricValue: string, allowOverride = false) => {
    if (isUnverified || !rubricValue || rubricValue.trim() === '') return;
    setParsingRubric(true);
    setCreateError('');
    if (!allowOverride && !rubricOverrideConfirmed) {
      setRubricOverridePrompt(null);
    }
    try {
      const res = await fetch('/api/exams/parse-rubric', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rubricText: rubricValue,
          overrideDocumentType: allowOverride || rubricOverrideConfirmed,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.canOverride) {
          setRubricOverridePrompt({
            reason: data.error || 'Nicht-Prüfungsdokument erkannt.',
            summary: data.classification?.detectedSummary,
          });
          setRubricOverrideConfirmed(false);
        }
        throw new Error(data.error || 'Fehler beim Parsen.');
      }
      setRubricOverridePrompt(null);
      if (allowOverride) {
        setRubricOverrideConfirmed(true);
      }
      setParsedTasks(data.tasks || []);
      const totalPoints = (data.tasks || []).reduce(
        (sum: number, t: { maxPoints?: number | string }) => sum + (Number(t.maxPoints) || 0),
        0
      );
      setExamMaxPoints(String(totalPoints));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Fehler bei der Analyse.');
    } finally {
      setParsingRubric(false);
    }
  };

  const handleParseRubric = () => {
    autoParseRubric(examRubric);
  };

  const handleConfirmRubricOverride = async () => {
    setRubricOverrideConfirmed(true);
    setRubricOverridePrompt(null);
    setCreateError('');
    if (examRubric) {
      await autoParseRubric(examRubric, true);
    }
  };

  const handleRubricFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setUploadedFileName(file.name);
      setRubricOverrideConfirmed(false);
      setRubricOverridePrompt(null);
      setCreateError('');

      const reader = new FileReader();
      if (file.type.startsWith('image/') || file.type === 'application/pdf') {
        reader.onload = (event) => {
          const dataUrl = event.target?.result as string;
          if (dataUrl) {
            const base64Data = dataUrl.split(',')[1];
            const rubricPayload = JSON.stringify({
              mimeType: file.type,
              data: base64Data,
              name: file.name,
            });
            setExamRubric(rubricPayload);
            autoParseRubric(rubricPayload);
          }
        };
        reader.readAsDataURL(file);
      } else {
        reader.onload = (event) => {
          const text = event.target?.result as string;
          if (text) {
            setExamRubric(text);
            autoParseRubric(text);
          }
        };
        reader.readAsText(file);
      }
    }
  };

  const handleResetRubric = () => {
    setExamRubric('');
    setUploadedFileName('');
    setParsedTasks([]);
    setExamMaxPoints('20');
    setRubricOverridePrompt(null);
    setRubricOverrideConfirmed(false);
    setCreateError('');
  };

  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  const copyTargetClass = React.useMemo(
    () => classes.find((c) => c.id === copyTargetClassId) || null,
    [classes, copyTargetClassId]
  );

  const copyDialogSubjectOptions = React.useMemo(
    () => resolveClassSubjectOptions(mySubjects, copyTargetClass?.subjects),
    [mySubjects, copyTargetClass]
  );

  const genTargetClass = React.useMemo(
    () => classes.find((c) => c.id === (genClassId || selectedClassId)) || null,
    [classes, genClassId, selectedClassId]
  );

  const genDialogSubjectOptions = React.useMemo(
    () => resolveClassSubjectOptions(mySubjects, genTargetClass?.subjects),
    [mySubjects, genTargetClass]
  );

  const handleOpenCreateExam = React.useCallback(() => {
    const targetClassId = activeClassId || selectedClassId || classes[0]?.id || '';
    if (!targetClassId) {
      setClassSelectionPrompt(
        'Zuerst eine Klasse wählen: Bitte wähle oben eine Klasse aus, um eine Prüfung anzulegen.'
      );
      return;
    }
    setClassSelectionPrompt('');
    setActiveTabClassId(targetClassId);
    setDialogClassId(targetClassId);
    const targetClass = classes.find((c) => c.id === targetClassId) || null;
    const targetClassExams = exams.filter((ex) => ex.classId === targetClassId);
    const classOptions = resolveClassSubjectOptions(mySubjects, targetClass?.subjects);
    setExamSubject(resolveDefaultExamSubjectForClass(classOptions, targetClassExams));
    setCreateError('');
    setRubricOverrideConfirmed(false);
    setRubricOverridePrompt(null);
    setOpenCreate(true);
  }, [activeClassId, selectedClassId, classes, exams, mySubjects]);

  const handleCreateExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!examTitle.trim() || !examSubject.trim() || !selectedClassId) {
      setCreateError('Bitte fülle alle Pflichtfelder aus.');
      return;
    }
    const resolvedMaxPoints = parseMaxPointsInput(examMaxPoints);
    if (resolvedMaxPoints === null) {
      setCreateError('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.');
      return;
    }

    setCreateLoading(true);
    setCreateError('');

    try {
      const res = await fetch('/api/exams', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: examTitle.trim(),
          subject: examSubject.trim(),
          maxPoints: resolvedMaxPoints,
          rubricText: examRubric || 'Standard Musterlösung',
          gradingNotes: examGradingNotes || null,
          gradingFormula: examGradingFormula,
          gradeRounding: examGradeRounding,
          classId: selectedClassId,
          tasks: parsedTasks.length > 0 ? parsedTasks : undefined,
          overrideDocumentType: rubricOverrideConfirmed,
        }),
      });

      if (!res.ok) {
        let errorMsg = 'Prüfung konnte nicht erstellt werden.';
        try {
          const data = await res.json();
          errorMsg = data.error || errorMsg;
          if (data.canOverride) {
            setRubricOverridePrompt({
              reason: data.error || 'Nicht-Prüfungsdokument erkannt.',
              summary: data.classification?.detectedSummary,
            });
          }
        } catch {
          // Fallback for non-JSON response
        }
        setCreateError(errorMsg);
        return;
      }

      setOpenCreate(false);
      setExamTitle('');
      setExamRubric('');
      setExamGradingNotes('');
      setUploadedFileName('');
      setParsedTasks([]);
      setRubricOverridePrompt(null);
      setRubricOverrideConfirmed(false);
      setActiveTabClassId(selectedClassId); // Automatically select the tab of the class for the new exam
      invalidateExams(undefined, selectedClassId);
      await fetchData(); // Refresh list
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Prüfung konnte nicht erstellt werden.');
    } finally {
      setCreateLoading(false);
    }
  };

  const handleOpenCopy = (exam: ExamListItem) => {
    setCopySourceExam(exam);
    setCopyTitle(`${exam.title} (Kopie)`);
    setCopySubject(exam.subject);
    setCopyMaxPoints(String(exam.maxPoints));
    setCopyRubric(exam.rubricText || 'Standard Musterlösung');
    setCopyGradingNotes(exam.gradingNotes || '');
    setCopyGradingFormula((exam.gradingFormula as GradingFormula) || 'LINEAR_60');
    setCopyGradeRounding((exam.gradeRounding as GradeRounding) || '0.1');
    setCopyTargetClassId(exam.classId); // Target class: same class by default
    setCopyError('');
    setOpenCopy(true);
  };

  const handleCopyExam = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!copySourceExam) return;
    if (!copyTitle.trim() || !copySubject.trim() || !copyTargetClassId) {
      setCopyError('Bitte fülle alle Pflichtfelder aus.');
      return;
    }
    const resolvedCopyMaxPoints = parseMaxPointsInput(copyMaxPoints);
    if (resolvedCopyMaxPoints === null) {
      setCopyError('Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.');
      return;
    }

    setCopyLoading(true);
    setCopyError('');

    try {
      const res = await fetch(`/api/exams/${copySourceExam.id}/duplicate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: copyTitle.trim(),
          targetClassId: copyTargetClassId,
          subject: copySubject.trim(),
          maxPoints: resolvedCopyMaxPoints,
          rubricText: copyRubric,
          gradingNotes: copyGradingNotes || null,
          gradingFormula: copyGradingFormula,
          gradeRounding: copyGradeRounding,
        }),
      });

      if (!res.ok) {
        const errorMsg = await getErrorMessage(res, 'Prüfung konnte nicht dupliziert werden.');
        setCopyError(errorMsg);
        return;
      }

      const data = await res.json();
      setOpenCopy(false);
      setCopySourceExam(null);

      invalidateExams(undefined, copyTargetClassId);
      const newExamId = data.id || data.exam?.id;
      if (newExamId) {
        router.push(`/exams/${newExamId}`);
      } else {
        await fetchData();
      }
    } catch (err) {
      setCopyError(err instanceof Error ? err.message : 'Prüfung konnte nicht dupliziert werden.');
    } finally {
      setCopyLoading(false);
    }
  };

  const [selectedSubjectFilter, setSelectedSubjectFilter] = useState<string>('ALL');

  const classExams = React.useMemo(
    () => exams.filter((ex) => ex.classId === activeClassId),
    [exams, activeClassId]
  );

  const activeClass = React.useMemo(
    () => classes.find((c) => c.id === activeClassId) || null,
    [classes, activeClassId]
  );

  const availableSubjects = React.useMemo(() => {
    const counts: Record<string, number> = {};
    const hasClassSubset = Array.isArray(activeClass?.subjects) && activeClass.subjects.length > 0;
    const baseSubjects = hasClassSubset
      ? resolveClassSubjectOptions(mySubjects, activeClass?.subjects)
      : resolveFilterAndViewSubjects(
          savedSubjects,
          exams.map((ex) => ex.subject)
        );
    baseSubjects.forEach((s) => {
      counts[s.value] = 0;
    });
    classExams.forEach((ex) => {
      const s = normalizeSubjectValue(ex.subject || 'Allgemein') || 'Allgemein';
      counts[s] = (counts[s] || 0) + 1;
    });
    return Object.entries(counts).map(([name, count]) => ({ name, count }));
  }, [activeClass, mySubjects, savedSubjects, exams, classExams]);

  const effectiveSubjectFilter = React.useMemo(() => {
    if (selectedSubjectFilter === 'ALL') return 'ALL';
    const exists = availableSubjects.some((s) => s.name === selectedSubjectFilter);
    return exists ? selectedSubjectFilter : 'ALL';
  }, [availableSubjects, selectedSubjectFilter]);

  const filteredExams = React.useMemo(() => {
    return classExams.filter((ex) => {
      const exSubject = normalizeSubjectValue(ex.subject || 'Allgemein') || 'Allgemein';
      if (effectiveSubjectFilter !== 'ALL' && exSubject !== effectiveSubjectFilter) {
        return false;
      }
      return true;
    });
  }, [classExams, effectiveSubjectFilter]);

  return (
    <DashboardLayout>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '32px' }}>
        {/* Header Section */}
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
              Prüfungsverwaltung
            </Typography>
            <Typography variant="body1" sx={{ color: 'text.secondary', fontWeight: 550 }}>
              Definiere Prüfungen, passe Erwartungshorizonte an und vergleiche Klassenleistungen.
            </Typography>
          </Box>
          <Stack direction="row" spacing={1.5} sx={{ flexWrap: 'wrap' }}>
            <Tooltip title={generateExamDisabledHint}>
              <span>
                <Button
                  variant="contained"
                  startIcon={<AutoAwesomeIcon />}
                  disabled={isUnverified || !canCreateExam}
                  onClick={() => {
                    setGenError('');
                    const targetId = activeClassId || (classes[0]?.id ?? '');
                    setGenClassId(targetId);
                    const targetClass = classes.find((c) => c.id === targetId) || null;
                    const targetClassExams = exams.filter((ex) => ex.classId === targetId);
                    const classOptions = resolveClassSubjectOptions(
                      mySubjects,
                      targetClass?.subjects
                    );
                    setGenSubject(
                      resolveDefaultExamSubjectForClass(classOptions, targetClassExams)
                    );
                    setOpenGenerate(true);
                  }}
                  sx={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    textTransform: 'none',
                    backgroundColor: '#0f172a',
                    boxShadow: '0 4px 10px rgba(15, 23, 42, 0.2)',
                    '&:hover': { backgroundColor: '#1e293b' },
                  }}
                >
                  Prüfung generieren
                </Button>
              </span>
            </Tooltip>
            <Tooltip title={manualCreateExamDisabledHint}>
              <span>
                <Button
                  variant="outlined"
                  startIcon={<AddIcon />}
                  disabled={!canCreateExam}
                  onClick={handleOpenCreateExam}
                  sx={{
                    padding: '10px 20px',
                    borderRadius: '8px',
                    fontWeight: 700,
                    textTransform: 'none',
                    borderColor: '#cbd5e1',
                    color: '#0f172a',
                    '&:hover': { backgroundColor: '#f8fafc', borderColor: '#94a3b8' },
                  }}
                >
                  Manuell anlegen
                </Button>
              </span>
            </Tooltip>
          </Stack>
        </Box>

        <EmailVerificationAiBanner featureLabel="Die KI-Prüfungserstellung und automatische Aufgabenanalyse" />

        {error ? (
          <ErrorState
            title="Fehler beim Laden der Prüfungen"
            message={error}
            onRetry={() => {
              fetchData();
            }}
          />
        ) : loading ? (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 8 }}>
            <CircularProgress />
          </Box>
        ) : (
          <>
            {/* Class Selector Deck */}
            {classes.length > 0 && (
              <Stack spacing={1.5}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                  Wähle eine Klasse, um deren Prüfungen anzuzeigen:
                </Typography>
                <Stack
                  direction="row"
                  spacing={2}
                  sx={{
                    overflowX: 'auto',
                    pb: 1.5,
                    pt: 0.5,
                    px: 0.5,
                    '&::-webkit-scrollbar': { height: '6px' },
                    '&::-webkit-scrollbar-thumb': {
                      backgroundColor: '#cbd5e1',
                      borderRadius: '3px',
                    },
                  }}
                >
                  {classes.map((cls) => {
                    const isActive = cls.id === activeClassId;
                    return (
                      <Card
                        key={cls.id}
                        onClick={() => {
                          setActiveTabClassId(cls.id);
                          setDialogClassId(cls.id);
                          setClassSelectionPrompt('');
                          setSelectedSubjectFilter('ALL');
                        }}
                        sx={{
                          minWidth: '220px',
                          flexShrink: 0,
                          borderRadius: '12px',
                          border: '2px solid',
                          borderColor: isActive ? '#1b77d1' : '#e2e8f0',
                          boxShadow: isActive
                            ? '0 10px 20px -10px rgba(27, 119, 209, 0.3)'
                            : 'none',
                          cursor: 'pointer',
                          transition: 'all 0.2s ease',
                          backgroundColor: isActive ? '#f0f7ff' : '#ffffff',
                          '&:hover': {
                            borderColor: '#1b77d1',
                            transform: 'translateY(-2px)',
                            boxShadow: '0 8px 16px -8px rgba(0,0,0,0.1)',
                          },
                        }}
                      >
                        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                          <Stack spacing={0.75}>
                            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center' }}>
                              <Typography
                                variant="subtitle1"
                                sx={{
                                  fontWeight: 800,
                                  color: isActive ? '#1b77d1' : '#0f172a',
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {cls.name}
                              </Typography>
                              {cls.id === defaultClassId && (
                                <StarIcon
                                  sx={{ color: '#eab308', fontSize: '1rem', flexShrink: 0 }}
                                />
                              )}
                              {isActive && (
                                <Chip
                                  label="Ausgewählt"
                                  size="small"
                                  sx={{
                                    height: '18px',
                                    fontSize: '0.65rem',
                                    fontWeight: 700,
                                    backgroundColor: '#dbeafe',
                                    color: '#1b77d1',
                                    borderRadius: '4px',
                                    ml: 'auto',
                                  }}
                                />
                              )}
                            </Stack>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                              <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary', fontWeight: 600 }}
                              >
                                {cls.studentsCount} Schüler
                              </Typography>
                              <Typography variant="caption" sx={{ color: '#cbd5e1' }}>
                                •
                              </Typography>
                              <Typography
                                variant="caption"
                                sx={{ color: 'text.secondary', fontWeight: 600 }}
                              >
                                {cls.totalExams} {cls.totalExams === 1 ? 'Prüfung' : 'Prüfungen'}
                              </Typography>
                            </Stack>
                            {cls.averageGrade !== 'N/A' && (
                              <Stack
                                direction="row"
                                spacing={0.75}
                                sx={{ alignItems: 'center', mt: 0.5 }}
                              >
                                <Typography
                                  variant="caption"
                                  sx={{ color: 'text.secondary', fontWeight: 600 }}
                                >
                                  Klassenschnitt:
                                </Typography>
                                <Chip
                                  label={cls.averageGrade}
                                  size="small"
                                  sx={{
                                    height: '18px',
                                    fontSize: '0.7rem',
                                    fontWeight: 700,
                                    backgroundColor:
                                      parseFloat(cls.averageGrade) >= 4.0 ? '#dcfce7' : '#fee2e2',
                                    color:
                                      parseFloat(cls.averageGrade) >= 4.0 ? '#15803d' : '#b91c1c',
                                    borderRadius: '4px',
                                  }}
                                />
                              </Stack>
                            )}
                          </Stack>
                        </CardContent>
                      </Card>
                    );
                  })}
                </Stack>
              </Stack>
            )}

            {classes.length === 0 ? (
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
                <AssignmentIcon sx={{ fontSize: '4rem', color: '#94a3b8', mb: 2 }} />
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#475569', mb: 1 }}>
                  Keine Klassen gefunden
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', maxWidth: '400px', mx: 'auto', mb: 3 }}
                >
                  Erstelle zuerst eine Schulklasse in der Klassenverwaltung, um Prüfungen für sie
                  anlegen zu können.
                </Typography>
                <Link href="/classes" passHref style={{ textDecoration: 'none' }}>
                  <Button
                    variant="contained"
                    startIcon={<AddIcon />}
                    sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 650 }}
                  >
                    Klassenverwaltung öffnen
                  </Button>
                </Link>
              </Card>
            ) : classExams.length === 0 ? (
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
                <AssignmentIcon sx={{ fontSize: '4rem', color: '#94a3b8', mb: 2 }} />
                <Typography variant="h6" sx={{ fontWeight: 700, color: '#475569', mb: 1 }}>
                  Keine Prüfungen gefunden
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ color: 'text.secondary', maxWidth: '400px', mx: 'auto', mb: 3 }}
                >
                  {activeClassId
                    ? `Erstelle deine erste Prüfung für ${
                        classes.find((c) => c.id === activeClassId)?.name || 'diese Klasse'
                      }, um einen Erwartungshorizont für die automatische Folgefehler-Korrektur zu hinterlegen.`
                    : 'Zuerst eine Klasse wählen: Bitte wähle oben eine Klasse aus, um deren Prüfungen anzuzeigen oder eine neue Prüfung anzulegen.'}
                </Typography>
                {classSelectionPrompt && (
                  <Alert
                    severity="info"
                    sx={{ maxWidth: '420px', mx: 'auto', mb: 2, borderRadius: '8px' }}
                  >
                    {classSelectionPrompt}
                  </Alert>
                )}
                <Tooltip title={!activeClassId ? 'Zuerst eine Klasse wählen' : ''}>
                  <span>
                    <Button
                      variant="outlined"
                      startIcon={<AddIcon />}
                      disabled={!activeClassId}
                      onClick={handleOpenCreateExam}
                      sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 650 }}
                    >
                      Erste Prüfung anlegen
                    </Button>
                  </span>
                </Tooltip>
                {!activeClassId && (
                  <Typography
                    variant="caption"
                    sx={{ display: 'block', mt: 1, color: 'text.secondary', fontWeight: 600 }}
                  >
                    Zuerst eine Klasse wählen
                  </Typography>
                )}
              </Card>
            ) : (
              <Stack spacing={2.5}>
                {/* Subject Filter Bar */}
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 1.5,
                    p: 1.5,
                    px: 2,
                    borderRadius: '10px',
                    backgroundColor: '#ffffff',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', alignItems: 'center' }}
                  >
                    <Typography
                      variant="caption"
                      sx={{ fontWeight: 750, color: 'text.secondary', mr: 0.5 }}
                    >
                      Nach Fach filtern:
                    </Typography>
                    <Chip
                      label={`Alle Fächer (${classExams.length})`}
                      size="small"
                      onClick={() => setSelectedSubjectFilter('ALL')}
                      sx={{
                        fontWeight: effectiveSubjectFilter === 'ALL' ? 750 : 550,
                        backgroundColor: effectiveSubjectFilter === 'ALL' ? '#1b77d1' : '#f1f5f9',
                        color: effectiveSubjectFilter === 'ALL' ? '#ffffff' : '#334155',
                        cursor: 'pointer',
                      }}
                    />
                    {availableSubjects.map((sub) => (
                      <Chip
                        key={sub.name}
                        label={`${sub.name} (${sub.count})`}
                        size="small"
                        onClick={() => setSelectedSubjectFilter(sub.name)}
                        sx={{
                          fontWeight: effectiveSubjectFilter === sub.name ? 750 : 550,
                          backgroundColor:
                            effectiveSubjectFilter === sub.name ? '#1b77d1' : '#f1f5f9',
                          color: effectiveSubjectFilter === sub.name ? '#ffffff' : '#334155',
                          cursor: 'pointer',
                        }}
                      />
                    ))}
                  </Stack>

                  <Link href="/subjects" passHref style={{ textDecoration: 'none' }}>
                    <Button
                      size="small"
                      variant="text"
                      startIcon={<MenuBookIcon sx={{ fontSize: '1.05rem' }} />}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        color: '#1b77d1',
                        fontSize: '0.825rem',
                      }}
                    >
                      Fächer-Ansicht öffnen
                    </Button>
                  </Link>
                </Box>

                {filteredExams.length === 0 ? (
                  <Card
                    sx={{
                      borderRadius: '12px',
                      border: '1px dashed #cbd5e1',
                      p: 4,
                      textAlign: 'center',
                      backgroundColor: '#ffffff',
                    }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{ fontWeight: 700, color: '#475569', mb: 1 }}
                    >
                      Keine Prüfungen für das Fach &quot;{effectiveSubjectFilter}&quot; in dieser
                      Klasse gefunden.
                    </Typography>
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setSelectedSubjectFilter('ALL')}
                      sx={{ textTransform: 'none', fontWeight: 650, borderRadius: '8px' }}
                    >
                      Filter zurücksetzen
                    </Button>
                  </Card>
                ) : (
                  <Grid container spacing={3}>
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
                                sx={{
                                  justifyContent: 'space-between',
                                  alignItems: 'flex-start',
                                  mb: 2,
                                }}
                              >
                                <Box>
                                  <Typography
                                    variant="h6"
                                    sx={{
                                      fontWeight: 800,
                                      color: '#0f172a',
                                      mb: 0.5,
                                      lineClamp: 2,
                                    }}
                                  >
                                    {ex.title}
                                  </Typography>
                                  <Stack
                                    direction="row"
                                    spacing={1}
                                    sx={{ flexWrap: 'wrap', mb: 1, alignItems: 'center' }}
                                  >
                                    <Chip
                                      label={ex.subject}
                                      size="small"
                                      sx={{
                                        backgroundColor: '#e3f2fd',
                                        color: '#1b77d1',
                                        fontWeight: 700,
                                        fontSize: '0.75rem',
                                      }}
                                    />
                                    <Tooltip title={support.supportDescription} arrow>
                                      <Chip
                                        label={support.supportBadge}
                                        size="small"
                                        variant="outlined"
                                        sx={{
                                          fontSize: '0.7rem',
                                          fontWeight: 650,
                                          height: 24,
                                          borderColor: isVerified ? '#86efac' : '#cbd5e1',
                                          color: isVerified ? '#15803d' : '#475569',
                                        }}
                                      />
                                    </Tooltip>
                                    {ex.isGenerated && !ex.isApproved && (
                                      <Chip
                                        label="Entwurf: Freigabe erforderlich"
                                        size="small"
                                        color="warning"
                                        sx={{ fontWeight: 700, fontSize: '0.72rem', height: 24 }}
                                      />
                                    )}
                                    {ex.isApproved && ex.isGenerated && (
                                      <Chip
                                        label="Freigegeben & Eingefroren"
                                        size="small"
                                        sx={{
                                          backgroundColor: '#dcfce7',
                                          color: '#15803d',
                                          fontWeight: 700,
                                          fontSize: '0.72rem',
                                          height: 24,
                                        }}
                                      />
                                    )}
                                  </Stack>
                                </Box>
                                <Box
                                  sx={{
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '8px',
                                    backgroundColor: '#fff7ed',
                                    color: '#ea580c',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    flexShrink: 0,
                                  }}
                                >
                                  <AssignmentIcon sx={{ fontSize: '1.25rem' }} />
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
                                      Klasse
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{ fontWeight: 700, color: '#334155' }}
                                    >
                                      {ex.className}
                                    </Typography>
                                  </Stack>
                                </Grid>
                                <Grid size={{ xs: 6 }}>
                                  <Stack spacing={0.25}>
                                    <Typography
                                      variant="caption"
                                      sx={{ color: 'text.secondary', fontWeight: 600 }}
                                    >
                                      Max. Punkte
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{ fontWeight: 700, color: '#334155' }}
                                    >
                                      {ex.maxPoints} Punkte
                                    </Typography>
                                  </Stack>
                                </Grid>
                                <Grid size={{ xs: 6 }} sx={{ mt: 1 }}>
                                  <Stack spacing={0.25}>
                                    <Typography
                                      variant="caption"
                                      sx={{ color: 'text.secondary', fontWeight: 600 }}
                                    >
                                      Korrekturen
                                    </Typography>
                                    <Typography
                                      variant="body2"
                                      sx={{ fontWeight: 700, color: '#334155' }}
                                    >
                                      {ex.submissionsCount} bewertet
                                    </Typography>
                                  </Stack>
                                </Grid>
                                <Grid size={{ xs: 6 }} sx={{ mt: 1 }}>
                                  <Stack
                                    direction="row"
                                    spacing={0.75}
                                    sx={{ alignItems: 'center' }}
                                  >
                                    <Typography
                                      variant="caption"
                                      sx={{ color: 'text.secondary', fontWeight: 600 }}
                                    >
                                      Schnitt (Ø):
                                    </Typography>
                                    {ex.averageGrade !== 'N/A' ? (
                                      <Chip
                                        label={ex.averageGrade}
                                        size="small"
                                        sx={{
                                          backgroundColor:
                                            parseFloat(ex.averageGrade) >= 4.0
                                              ? '#dcfce7'
                                              : '#fee2e2',
                                          color:
                                            parseFloat(ex.averageGrade) >= 4.0
                                              ? '#15803d'
                                              : '#b91c1c',
                                          fontWeight: 'bold',
                                          borderRadius: '6px',
                                          fontSize: '0.75rem',
                                        }}
                                      />
                                    ) : (
                                      <Typography
                                        variant="body2"
                                        sx={{
                                          fontWeight: 600,
                                          color: 'text.secondary',
                                          fontSize: '0.8rem',
                                        }}
                                      >
                                        Keine Noten
                                      </Typography>
                                    )}
                                  </Stack>
                                </Grid>
                              </Grid>
                            </CardContent>

                            <CardActions sx={{ p: 2, pt: 0, justifyContent: 'space-between' }}>
                              <Button
                                size="small"
                                startIcon={<ContentCopyIcon />}
                                onClick={() => handleOpenCopy(ex)}
                                sx={{
                                  textTransform: 'none',
                                  fontWeight: 650,
                                  color: 'text.secondary',
                                  '&:hover': { backgroundColor: '#f1f5f9', color: '#0f172a' },
                                }}
                              >
                                Prüfung duplizieren
                              </Button>
                              <Link
                                href={`/exams/${ex.id}`}
                                passHref
                                style={{ textDecoration: 'none' }}
                              >
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
                                  Musterlösung & Statistiken
                                </Button>
                              </Link>
                            </CardActions>
                          </Card>
                        </Grid>
                      );
                    })}
                  </Grid>
                )}
              </Stack>
            )}
          </>
        )}

        {/* Dialog for Create Exam */}
        <Dialog
          open={openCreate}
          onClose={(_e, reason) => {
            if (createLoading || reason === 'backdropClick') return;
            setOpenCreate(false);
          }}
          maxWidth="sm"
          fullWidth
        >
          <form onSubmit={handleCreateExam}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              Neue Prüfung anlegen
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 8 }}>
                    <TextField
                      label="Prüfungstitel"
                      placeholder="z.B. Klassenarbeit 1: Lineare Gleichungen"
                      fullWidth
                      variant="outlined"
                      value={examTitle}
                      onChange={(e) => {
                        const val = e.target.value;
                        setExamTitle(val);
                        if (val.trim()) {
                          setCreateError((prev) =>
                            prev === 'Prüfungstitel ist erforderlich.' ||
                            (prev === 'Bitte gib einen Prüfungstitel und ein Fach an.' &&
                              Boolean(examSubject.trim()))
                              ? ''
                              : prev
                          );
                        }
                      }}
                      required
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <SubjectCombobox
                      id="subject-combobox"
                      value={examSubject}
                      options={createDialogSubjectOptions}
                      onChange={(val) => {
                        setExamSubject(val);
                        if (val.trim()) {
                          setCreateError((prev) =>
                            prev === 'Fach ist erforderlich.' ||
                            prev === 'Bitte gib ein Fach an.' ||
                            (prev === 'Bitte gib einen Prüfungstitel und ein Fach an.' &&
                              Boolean(examTitle.trim()))
                              ? ''
                              : prev
                          );
                        }
                      }}
                      label="Fach (KI-Profil)"
                    />
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth>
                      <InputLabel id="class-label">Zielklasse</InputLabel>
                      <Select
                        labelId="class-label"
                        value={selectedClassId}
                        label="Zielklasse"
                        onChange={(e) => {
                          const nextClassId = e.target.value;
                          setDialogClassId(nextClassId);
                          const nextClass = classes.find((c) => c.id === nextClassId) || null;
                          const nextClassExams = exams.filter((ex) => ex.classId === nextClassId);
                          const nextOptions = resolveClassSubjectOptions(
                            mySubjects,
                            nextClass?.subjects
                          );
                          setExamSubject(
                            resolveDefaultExamSubjectForClass(nextOptions, nextClassExams)
                          );
                        }}
                        required
                        sx={{ borderRadius: '8px' }}
                      >
                        {classes.length === 0 ? (
                          <MenuItem value="" disabled>
                            Keine Klassen vorhanden
                          </MenuItem>
                        ) : (
                          classes.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.name}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Maximale Punkte"
                      type="number"
                      fullWidth
                      variant="outlined"
                      value={examMaxPoints}
                      onChange={(e) => {
                        const nextVal = normalizeMaxPointsInput(e.target.value);
                        if (e.target.value !== nextVal) {
                          e.target.value = nextVal;
                        }
                        setExamMaxPoints(nextVal);
                        if (isValidMaxPointsInput(nextVal)) {
                          setCreateError((prev) =>
                            prev === 'Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.' ||
                            prev === 'Maximale Punktzahl muss eine positive Zahl sein.'
                              ? ''
                              : prev
                          );
                        }
                      }}
                      onBlur={(e) => {
                        const nextVal = normalizeMaxPointsInput(e.target.value);
                        if (e.target.value !== nextVal) {
                          e.target.value = nextVal;
                        }
                        setExamMaxPoints(nextVal);
                      }}
                      required
                      disabled={parsedTasks.length > 0}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="create-formula-label">Notenformel (CH)</InputLabel>
                      <Select
                        labelId="create-formula-label"
                        value={examGradingFormula}
                        label="Notenformel (CH)"
                        onChange={(e) => setExamGradingFormula(e.target.value as GradingFormula)}
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
                      <InputLabel id="create-rounding-label">Notenrundung</InputLabel>
                      <Select
                        labelId="create-rounding-label"
                        value={examGradeRounding}
                        label="Notenrundung"
                        onChange={(e) => setExamGradeRounding(e.target.value as GradeRounding)}
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

                {uploadedFileName || isSerializedDocumentPayload(examRubric) ? (
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
                      <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                        {uploadedFileName || 'Bild-Musterlösung geladen'}
                      </Typography>
                    </Stack>
                    <Button size="small" color="error" onClick={handleResetRubric}>
                      Zurücksetzen
                    </Button>
                  </Box>
                ) : (
                  <Stack spacing={1.5}>
                    <TextField
                      label="Erwartungshorizont / Musterlösung"
                      placeholder="Gib Formeln, richtige Ergebnisse oder Teilschritte ein. Je präziser deine Musterlösung, desto genauer bewertet die KI."
                      multiline
                      rows={4}
                      fullWidth
                      variant="outlined"
                      value={examRubric}
                      onChange={(e) => {
                        setExamRubric(e.target.value);
                        setRubricOverrideConfirmed(false);
                        setRubricOverridePrompt(null);
                      }}
                      onBlur={() => autoParseRubric(examRubric)}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
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
                        id="dialogRubricFile"
                        onChange={handleRubricFileChange}
                        style={{ display: 'none' }}
                      />
                      <Button
                        component="label"
                        htmlFor="dialogRubricFile"
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
                        onClick={() => setQrRubricOpen(true)}
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

                <TextField
                  label="Zusätzliche Bewertungshinweise & Kontext (Stufe 3, optional)"
                  placeholder="z.B. Teilpunkte für richtige Formel ohne Einheiten vergeben..."
                  helperText="Stufe 3 der KI-Korrektur: Individuelle Bewertungsregeln der Lehrperson (nach Stufe 1: Handschrifterkennung und Stufe 2: Folgefehlerprüfung), z.B. für Teilpunkte oder alternative Lösungswege."
                  multiline
                  rows={2}
                  fullWidth
                  size="small"
                  variant="outlined"
                  value={examGradingNotes}
                  onChange={(e) => setExamGradingNotes(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />

                {examRubric && parsedTasks.length === 0 && !parsingRubric && (
                  <Stack spacing={1}>
                    <EmailVerificationAiBanner
                      compact
                      featureLabel="Die automatische KI-Aufgabenanalyse"
                    />
                    <Button
                      variant="outlined"
                      color="primary"
                      startIcon={<AutoAwesomeIcon />}
                      disabled={isUnverified}
                      onClick={handleParseRubric}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        borderRadius: '8px',
                        borderColor: 'primary.main',
                        alignSelf: 'flex-start',
                      }}
                    >
                      Aufgabenstruktur mit KI analysieren
                    </Button>
                  </Stack>
                )}

                {parsingRubric && (
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <CircularProgress size={20} thickness={4} />
                    <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 650 }}>
                      Aufgaben werden aus der Musterlösung extrahiert...
                    </Typography>
                  </Box>
                )}

                {parsedTasks.length > 0 && (
                  <Box
                    sx={{
                      border: '1px solid #e2e8f0',
                      borderRadius: '8px',
                      padding: '16px',
                      backgroundColor: '#f8fafc',
                    }}
                  >
                    <Typography
                      variant="subtitle2"
                      sx={{ fontWeight: 'bold', mb: 1.5, color: '#0f172a' }}
                    >
                      Vordefinierte Aufgaben-Struktur (Template)
                    </Typography>
                    <Stack spacing={1.5}>
                      {parsedTasks.map((task, index) => (
                        <Grid container spacing={1.5} key={index} sx={{ alignItems: 'center' }}>
                          <Grid size={{ xs: 3 }}>
                            <TextField
                              size="small"
                              label="ID"
                              value={task.taskId}
                              onChange={(e) => {
                                const newTasks = [...parsedTasks];
                                newTasks[index].taskId = e.target.value;
                                setParsedTasks(newTasks);
                              }}
                              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '6px' } }}
                            />
                          </Grid>
                          <Grid size={{ xs: 5 }}>
                            <TextField
                              size="small"
                              label="Titel"
                              value={task.title}
                              onChange={(e) => {
                                const newTasks = [...parsedTasks];
                                newTasks[index].title = e.target.value;
                                setParsedTasks(newTasks);
                              }}
                              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '6px' } }}
                            />
                          </Grid>
                          <Grid size={{ xs: 3 }}>
                            <TextField
                              size="small"
                              label="Punkte"
                              type="number"
                              value={task.maxPoints}
                              onChange={(e) => {
                                const newTasks = [...parsedTasks];
                                newTasks[index].maxPoints = Number(e.target.value);
                                setParsedTasks(newTasks);
                                const totalPoints = newTasks.reduce(
                                  (sum, t) => sum + (t.maxPoints || 0),
                                  0
                                );
                                setExamMaxPoints(String(totalPoints));
                              }}
                              sx={{ '& .MuiOutlinedInput-root': { borderRadius: '6px' } }}
                            />
                          </Grid>
                          <Grid size={{ xs: 1 }} sx={{ display: 'flex', justifyContent: 'center' }}>
                            <IconButton
                              size="small"
                              color="error"
                              onClick={() => {
                                const newTasks = parsedTasks.filter((_, i) => i !== index);
                                setParsedTasks(newTasks);
                                const totalPoints = newTasks.reduce(
                                  (sum, t) => sum + (t.maxPoints || 0),
                                  0
                                );
                                setExamMaxPoints(String(totalPoints));
                              }}
                            >
                              <CloseIcon sx={{ fontSize: '1.2rem' }} />
                            </IconButton>
                          </Grid>
                        </Grid>
                      ))}

                      <Button
                        size="small"
                        startIcon={<AddIcon />}
                        onClick={() => {
                          const nextId = String(parsedTasks.length + 1);
                          const newTasks = [
                            ...parsedTasks,
                            { taskId: nextId, title: `Aufgabe ${nextId}`, maxPoints: 5.0 },
                          ];
                          setParsedTasks(newTasks);
                          const totalPoints = newTasks.reduce(
                            (sum, t) => sum + (t.maxPoints || 0),
                            0
                          );
                          setExamMaxPoints(String(totalPoints));
                        }}
                        sx={{
                          alignSelf: 'flex-start',
                          textTransform: 'none',
                          fontWeight: 650,
                          color: 'primary.main',
                        }}
                      >
                        Aufgabe hinzufügen
                      </Button>
                    </Stack>
                  </Box>
                )}
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
              {rubricOverrideConfirmed && (
                <Alert
                  severity="warning"
                  sx={{ borderRadius: '8px' }}
                  onClose={() => setRubricOverrideConfirmed(false)}
                >
                  Ausnahmegenehmigung aktiv: Dokument wird trotz Erkennungswarnung als Musterlösung
                  verwendet.
                </Alert>
              )}
              {createError && (
                <Alert
                  severity="error"
                  sx={{ borderRadius: '8px' }}
                  action={
                    rubricOverridePrompt ? (
                      <Button
                        color="inherit"
                        size="small"
                        variant="outlined"
                        onClick={handleConfirmRubricOverride}
                        sx={{ textTransform: 'none', fontWeight: 700 }}
                      >
                        Trotzdem als Musterlösung verwenden
                      </Button>
                    ) : undefined
                  }
                >
                  <Typography variant="body2" sx={{ fontWeight: 600 }}>
                    {createError}
                  </Typography>
                  {rubricOverridePrompt?.summary && (
                    <Typography variant="caption" sx={{ display: 'block', mt: 0.5, opacity: 0.9 }}>
                      Erkannter Dokumenttyp: {rubricOverridePrompt.summary}
                    </Typography>
                  )}
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
                  disabled={createLoading}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    borderRadius: '8px',
                  }}
                >
                  {createLoading ? <CircularProgress size={20} color="inherit" /> : 'Anlegen'}
                </Button>
              </Stack>
            </DialogActions>
          </form>
        </Dialog>

        {/* Dialog for Copy Exam */}
        <Dialog
          open={openCopy}
          onClose={(_e, reason) => {
            if (copyLoading || reason === 'backdropClick') return;
            setOpenCopy(false);
          }}
          maxWidth="sm"
          fullWidth
        >
          <form onSubmit={handleCopyExam}>
            <DialogTitle sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em' }}>
              Prüfung duplizieren
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                {copyError && <Alert severity="error">{copyError}</Alert>}

                <Typography variant="body2" sx={{ color: 'text.secondary', mb: 1 }}>
                  Dupliziere die Prüfung <strong>{copySourceExam?.title}</strong>. Alle
                  Einstellungen, Aufgaben und der Erwartungshorizont werden übernommen (ohne
                  Schülerabgaben).
                </Typography>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 8 }}>
                    <TextField
                      label="Neuer Prüfungstitel"
                      placeholder="z.B. Klassenarbeit 1: Lineare Gleichungen"
                      fullWidth
                      variant="outlined"
                      value={copyTitle}
                      onChange={(e) => setCopyTitle(e.target.value)}
                      required
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 4 }}>
                    <SubjectCombobox
                      id="copy-subject-combobox"
                      value={copySubject}
                      options={copyDialogSubjectOptions}
                      onChange={setCopySubject}
                      label="Fach (KI-Profil)"
                    />
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth>
                      <InputLabel id="copy-class-label">Zielklasse</InputLabel>
                      <Select
                        labelId="copy-class-label"
                        value={copyTargetClassId}
                        label="Zielklasse"
                        onChange={(e) => {
                          const nextClassId = e.target.value;
                          setCopyTargetClassId(nextClassId);
                          const nextClass = classes.find((c) => c.id === nextClassId) || null;
                          const nextOptions = resolveClassSubjectOptions(
                            mySubjects,
                            nextClass?.subjects
                          );
                          if (
                            !nextOptions.some(
                              (opt) => opt.value.toLowerCase() === copySubject.toLowerCase()
                            )
                          ) {
                            const nextClassExams = exams.filter((ex) => ex.classId === nextClassId);
                            setCopySubject(
                              resolveDefaultExamSubjectForClass(nextOptions, nextClassExams)
                            );
                          }
                        }}
                        required
                        sx={{ borderRadius: '8px' }}
                        MenuProps={{ disablePortal: true }}
                      >
                        {classes.length === 0 ? (
                          <MenuItem value="" disabled>
                            Keine Klassen vorhanden
                          </MenuItem>
                        ) : (
                          classes.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.name} {c.id === copySourceExam?.classId && '(Aktuelle Klasse)'}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Maximale Punkte"
                      type="number"
                      fullWidth
                      variant="outlined"
                      value={copyMaxPoints}
                      onChange={(e) => {
                        const nextVal = normalizeMaxPointsInput(e.target.value);
                        if (e.target.value !== nextVal) {
                          e.target.value = nextVal;
                        }
                        setCopyMaxPoints(nextVal);
                        if (isValidMaxPointsInput(nextVal)) {
                          setCopyError((prev) =>
                            prev === 'Bitte gib eine gültige Maximalpunktzahl grösser als 0 an.' ||
                            prev === 'Maximale Punktzahl muss eine positive Zahl sein.'
                              ? ''
                              : prev
                          );
                        }
                      }}
                      onBlur={(e) => {
                        const nextVal = normalizeMaxPointsInput(e.target.value);
                        if (e.target.value !== nextVal) {
                          e.target.value = nextVal;
                        }
                        setCopyMaxPoints(nextVal);
                      }}
                      required
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="copy-formula-label">Notenformel (CH)</InputLabel>
                      <Select
                        labelId="copy-formula-label"
                        value={copyGradingFormula}
                        label="Notenformel (CH)"
                        onChange={(e) => setCopyGradingFormula(e.target.value as GradingFormula)}
                        sx={{ borderRadius: '8px' }}
                        MenuProps={{ disablePortal: true }}
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
                      <InputLabel id="copy-rounding-label">Notenrundung</InputLabel>
                      <Select
                        labelId="copy-rounding-label"
                        value={copyGradeRounding}
                        label="Notenrundung"
                        onChange={(e) => setCopyGradeRounding(e.target.value as GradeRounding)}
                        sx={{ borderRadius: '8px' }}
                        MenuProps={{ disablePortal: true }}
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

                <TextField
                  label="Erwartungshorizont / Musterlösung"
                  multiline
                  rows={4}
                  fullWidth
                  variant="outlined"
                  value={copyRubric}
                  onChange={(e) => setCopyRubric(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                />

                <TextField
                  label="Zusätzliche Bewertungshinweise & Kontext (Stufe 3, optional)"
                  placeholder="z.B. Teilpunkte für richtige Formel ohne Einheiten vergeben..."
                  helperText="Stufe 3 der KI-Korrektur: Individuelle Bewertungsregeln der Lehrperson (nach Stufe 1: Handschrifterkennung und Stufe 2: Folgefehlerprüfung), z.B. für Teilpunkte oder alternative Lösungswege."
                  multiline
                  rows={2}
                  fullWidth
                  size="small"
                  variant="outlined"
                  value={copyGradingNotes}
                  onChange={(e) => setCopyGradingNotes(e.target.value)}
                  sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
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
              {copyError && (
                <Alert severity="error" sx={{ borderRadius: '8px' }}>
                  {copyError}
                </Alert>
              )}
              <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', width: '100%' }}>
                <Button
                  onClick={() => setOpenCopy(false)}
                  disabled={copyLoading}
                  sx={{ textTransform: 'none', fontWeight: 650 }}
                >
                  Abbrechen
                </Button>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={copyLoading}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    backgroundColor: '#1b77d1',
                    borderRadius: '8px',
                  }}
                >
                  {copyLoading ? <CircularProgress size={20} /> : 'Duplizieren'}
                </Button>
              </Stack>
            </DialogActions>
          </form>
        </Dialog>

        {/* Dialog for Generate Exam from Teaching Material */}
        <Dialog
          open={openGenerate}
          onClose={(_e, reason) => {
            if (genLoading || reason === 'backdropClick') return;
            setOpenGenerate(false);
          }}
          maxWidth="md"
          fullWidth
        >
          <form onSubmit={handleGenerateExam}>
            <DialogTitle
              sx={{ fontWeight: 800, color: '#0f172a', letterSpacing: '-0.01em', pb: 1 }}
            >
              <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                <AutoAwesomeIcon sx={{ color: '#0f172a' }} />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                  Prüfung aus Unterrichtsmaterial generieren
                </Typography>
              </Stack>
            </DialogTitle>
            <DialogContent>
              <Stack spacing={2.5} sx={{ mt: 1 }}>
                <EmailVerificationAiBanner compact featureLabel="Die KI-Prüfungsgenerierung" />
                <Alert severity="info" sx={{ borderRadius: '8px' }}>
                  <strong>Determinismus & Grounding:</strong> prüefli generiert die
                  Aufgabenstellung, Musterlösung und Punkteverteilung ausschliesslich aus deinem
                  hochgeladenen Unterrichtsmaterial. Das Hochladen von Material ist verpflichtend.
                </Alert>

                {genError && (
                  <Alert severity="error" sx={{ borderRadius: '8px' }}>
                    {genError}
                  </Alert>
                )}

                {/* 1. Mandatory Material Upload */}
                <Box
                  sx={{
                    p: 2.5,
                    border: '2px dashed',
                    borderColor: genMaterialFileName || genMaterialText ? '#16a34a' : '#cbd5e1',
                    borderRadius: '8px',
                    backgroundColor: genMaterialFileName || genMaterialText ? '#f0fdf4' : '#f8fafc',
                  }}
                >
                  <Typography
                    variant="subtitle2"
                    sx={{ fontWeight: 800, color: '#0f172a', mb: 0.5 }}
                  >
                    Unterrichtsmaterial (Pflichtfeld) *
                  </Typography>
                  <Typography
                    variant="caption"
                    sx={{ color: 'text.secondary', display: 'block', mb: 2 }}
                  >
                    Lade das im Unterricht behandelte Material hoch (PDF, Skript, Arbeitsblätter
                    oder Fotos).
                  </Typography>

                  {genMaterialFileName ? (
                    <Box
                      sx={{
                        p: 1.5,
                        backgroundColor: '#ffffff',
                        border: '1px solid #bbf7d0',
                        borderRadius: '6px',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                      }}
                    >
                      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <StarsIcon sx={{ color: '#16a34a' }} />
                        <Typography variant="body2" sx={{ fontWeight: 700, color: '#166534' }}>
                          {genMaterialFileName}
                        </Typography>
                      </Stack>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => {
                          setGenMaterialFileName('');
                          setGenMaterialPayload(null);
                          setGenMaterialText('');
                        }}
                      >
                        Entfernen
                      </Button>
                    </Box>
                  ) : (
                    <Stack spacing={1.5}>
                      <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                        <input
                          type="file"
                          accept="application/pdf,image/*,text/plain"
                          id="genMaterialFileInput"
                          onChange={handleGenMaterialFileChange}
                          style={{ display: 'none' }}
                        />
                        <Button
                          component="label"
                          htmlFor="genMaterialFileInput"
                          variant="contained"
                          sx={{
                            backgroundColor: '#0f172a',
                            textTransform: 'none',
                            fontWeight: 700,
                            borderRadius: '6px',
                            '&:hover': { backgroundColor: '#1e293b' },
                          }}
                        >
                          Datei auswählen (PDF / Bilder)
                        </Button>
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                          PDF, PNG, JPG oder Text
                        </Typography>
                      </Stack>
                      <Typography
                        variant="caption"
                        sx={{ color: 'text.secondary', fontStyle: 'italic' }}
                      >
                        Oder füge den Materialtext direkt ein:
                      </Typography>
                      <TextField
                        placeholder="Alternativ: Text des Unterrichtsmaterials hier einfügen..."
                        multiline
                        rows={3}
                        fullWidth
                        size="small"
                        value={genMaterialText}
                        onChange={(e) => {
                          setGenMaterialText(e.target.value);
                          if (e.target.value.trim()) setGenError('');
                        }}
                        sx={{
                          '& .MuiOutlinedInput-root': {
                            borderRadius: '6px',
                            backgroundColor: '#ffffff',
                          },
                        }}
                      />
                    </Stack>
                  )}
                </Box>

                {/* 2. Metadata Inputs */}
                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 7 }}>
                    <TextField
                      label="Prüfungstitel (optional)"
                      placeholder="z.B. Geometrie Klassenarbeit: Satz des Pythagoras"
                      fullWidth
                      value={genTitle}
                      onChange={(e) => setGenTitle(e.target.value)}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                      helperText="Wird automatisch anhand des Themas benannt, falls leer."
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 5 }}>
                    <FormControl fullWidth>
                      <InputLabel id="gen-class-label">Zielklasse *</InputLabel>
                      <Select
                        labelId="gen-class-label"
                        value={genClassId || selectedClassId}
                        label="Zielklasse *"
                        onChange={(e) => {
                          const nextClassId = e.target.value;
                          setGenClassId(nextClassId);
                          const nextClass = classes.find((c) => c.id === nextClassId) || null;
                          const nextClassExams = exams.filter((ex) => ex.classId === nextClassId);
                          const nextOptions = resolveClassSubjectOptions(
                            mySubjects,
                            nextClass?.subjects
                          );
                          setGenSubject(
                            resolveDefaultExamSubjectForClass(nextOptions, nextClassExams)
                          );
                        }}
                        required
                        sx={{ borderRadius: '8px' }}
                      >
                        {classes.length === 0 ? (
                          <MenuItem value="" disabled>
                            Keine Klassen vorhanden
                          </MenuItem>
                        ) : (
                          classes.map((c) => (
                            <MenuItem key={c.id} value={c.id}>
                              {c.name}
                            </MenuItem>
                          ))
                        )}
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <SubjectCombobox
                      id="gen-subject-combobox"
                      value={genSubject}
                      options={genDialogSubjectOptions}
                      onChange={(val) => {
                        setGenSubject(val);
                        if (val.trim()) {
                          setGenError((prev) =>
                            prev === 'Fach ist erforderlich.' || prev === 'Bitte gib ein Fach an.'
                              ? ''
                              : prev
                          );
                        }
                      }}
                      label="Fach (KI-Profil)"
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Thema / Stoffeingrenzung"
                      placeholder="z.B. Lineare Gleichungen mit zwei Variablen"
                      fullWidth
                      value={genTopic}
                      onChange={(e) => setGenTopic(e.target.value)}
                      helperText="Grenzt die Auswahl innerhalb des Materials ein."
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="gen-stufe-label">Schulstufe</InputLabel>
                      <Select
                        labelId="gen-stufe-label"
                        value={genStufe}
                        label="Schulstufe"
                        onChange={(e) => setGenStufe(e.target.value)}
                        sx={{ borderRadius: '8px' }}
                      >
                        <MenuItem value="Primarstufe (5./6. Klasse)">
                          Primarstufe (5./6. Klasse)
                        </MenuItem>
                        <MenuItem value="Sekundarstufe I (7.–9. Klasse)">
                          Sekundarstufe I (7.–9. Klasse)
                        </MenuItem>
                        <MenuItem value="Sekundarstufe II / Gymnasium">
                          Sekundarstufe II / Gymnasium
                        </MenuItem>
                        <MenuItem value="Berufsfachschule / Weiterbildung">
                          Berufsfachschule / Weiterbildung
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <FormControl fullWidth size="small">
                      <InputLabel id="gen-diff-label">Schwierigkeitsgrad</InputLabel>
                      <Select
                        labelId="gen-diff-label"
                        value={genDifficulty}
                        label="Schwierigkeitsgrad"
                        onChange={(e) => setGenDifficulty(e.target.value)}
                        sx={{ borderRadius: '8px' }}
                      >
                        <MenuItem value="Basis">Basis</MenuItem>
                        <MenuItem value="Standard (Mittelschwer)">Standard (Mittelschwer)</MenuItem>
                        <MenuItem value="Erweitert / Anspruchsvoll">
                          Erweitert / Anspruchsvoll
                        </MenuItem>
                        <MenuItem value="Differenziert (gemischt)">
                          Differenziert (gemischt)
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Grid>
                </Grid>

                <Grid container spacing={2}>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Ziel-Gesamtpunkte"
                      type="number"
                      fullWidth
                      size="small"
                      value={genTotalPoints}
                      onChange={(e) => setGenTotalPoints(Math.max(1, Number(e.target.value)))}
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                  <Grid size={{ xs: 12, sm: 6 }}>
                    <TextField
                      label="Anzahl Aufgaben"
                      type="number"
                      fullWidth
                      size="small"
                      value={genTaskCount}
                      onChange={(e) =>
                        setGenTaskCount(Math.max(1, Math.min(10, Number(e.target.value))))
                      }
                      sx={{ '& .MuiOutlinedInput-root': { borderRadius: '8px' } }}
                    />
                  </Grid>
                </Grid>

                <Box
                  sx={{
                    p: 1.5,
                    borderRadius: '8px',
                    border: '1px solid #e2e8f0',
                    backgroundColor: '#f8fafc',
                  }}
                >
                  <FormControlLabel
                    control={
                      <Switch
                        checked={genEnableQrSheet}
                        onChange={(e) => setGenEnableQrSheet(e.target.checked)}
                        color="primary"
                      />
                    }
                    label={
                      <Box>
                        <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                          QR-Code auf Aufgabenblatt einbetten (optional)
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', display: 'block' }}
                        >
                          Standardmässig deaktiviert. Wenn aktiviert, wird beim Drucken des
                          Aufgabenblatts ein maschinenlesbarer Prüfungs-QR-Code eingeblendet.
                        </Typography>
                      </Box>
                    }
                    sx={{ m: 0, alignItems: 'flex-start', gap: 1 }}
                  />
                </Box>
              </Stack>
            </DialogContent>
            <DialogActions sx={{ p: 2.5, pt: 1, justifyContent: 'space-between' }}>
              <Button
                onClick={() => setOpenGenerate(false)}
                disabled={genLoading}
                sx={{ textTransform: 'none', fontWeight: 650 }}
              >
                Abbrechen
              </Button>
              <Button
                type="submit"
                variant="contained"
                disabled={isUnverified || genLoading}
                startIcon={
                  genLoading ? <CircularProgress size={18} color="inherit" /> : <AutoAwesomeIcon />
                }
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  backgroundColor: '#0f172a',
                  borderRadius: '8px',
                  px: 3,
                  py: 1,
                  '&:hover': { backgroundColor: '#1e293b' },
                }}
              >
                {genLoading ? 'Prüfung wird generiert...' : 'Prüfung jetzt generieren'}
              </Button>
            </DialogActions>
          </form>
        </Dialog>

        <QrScannerDialog
          open={qrRubricOpen}
          onClose={() => setQrRubricOpen(false)}
          targetMode="RUBRIC"
          classId={selectedClassId}
          className={classes.find((c) => c.id === selectedClassId)?.name || null}
          examTitle={examTitle || 'Neue Prüfung'}
          onDocumentScanned={(payload, pageCount) => {
            setUploadedFileName(
              `Smartphone-Musterlösung (${pageCount} ${pageCount === 1 ? 'Seite' : 'Seiten'})`
            );
            setExamRubric(payload);
            setRubricOverrideConfirmed(false);
            setRubricOverridePrompt(null);
            setCreateError('');
            autoParseRubric(payload);
          }}
        />
      </Box>
    </DashboardLayout>
  );
}
