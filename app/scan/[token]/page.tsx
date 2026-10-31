'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Box,
  Typography,
  Button,
  Card,
  CardContent,
  Stack,
  Chip,
  CircularProgress,
  Alert,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  IconButton,
  Switch,
  FormControlLabel,
  Divider,
} from '@mui/material';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import CollectionsIcon from '@mui/icons-material/Collections';
import SendIcon from '@mui/icons-material/Send';
import DeleteIcon from '@mui/icons-material/Delete';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import AddPhotoAlternateIcon from '@mui/icons-material/AddPhotoAlternate';
import { deduplicateRelayFiles, assembleCapturedPages } from '@/lib/relay-dedup';
import { parseRelaySessionResponse, getRelayNetworkErrorMessage } from '@/lib/relay-session';

interface RelayStudentOption {
  id: string;
  name: string;
}

interface RelayExamOption {
  id: string;
  title: string;
  subject: string;
  classId: string;
  className: string;
  students: RelayStudentOption[];
}

interface RecentMobileUpload {
  id: string;
  studentName: string;
  examTitle: string;
  className: string;
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  grade: string | null;
  earnedPoints?: number | null;
  maxPoints?: number | null;
  uncertainStepsCount?: number;
  isExamMatchUncertain: boolean;
  isStudentMatchUncertain: boolean;
  time: string;
}

interface CapturedPage {
  id: string;
  file: File;
  previewUrl: string;
}

type ActiveScanMode =
  | 'SUBMISSION'
  | 'RUBRIC'
  | 'EXAM_TEMPLATE'
  | 'APPEND_SUBMISSION'
  | 'REPLACE_SUBMISSION';

// High-resolution image optimization (max 2200px, 0.88 quality) to keep math indices sharp while speeding up mobile uploads
async function optimizeMobileImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file;
  return new Promise((resolve) => {
    const img = new window.Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const maxDim = 2200;
      let { width, height } = img;
      if (width <= maxDim && height <= maxDim && file.size <= 1.8 * 1024 * 1024) {
        resolve(file);
        return;
      }
      if (width > height && width > maxDim) {
        height = Math.round((height * maxDim) / width);
        width = maxDim;
      } else if (height >= width && height > maxDim) {
        width = Math.round((width * maxDim) / height);
        height = maxDim;
      }
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        resolve(file);
        return;
      }
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => {
          if (!blob) {
            resolve(file);
            return;
          }
          const cleanName = file.name.replace(/\.[^.]+$/, '') + '.jpg';
          resolve(new File([blob], cleanName, { type: 'image/jpeg' }));
        },
        'image/jpeg',
        0.88
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(file);
    };
    img.src = url;
  });
}

export default function MobileScanRelayPage() {
  const params = useParams();
  const token = params?.token as string;

  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState('');
  const [isTokenExpired, setIsTokenExpired] = useState(false);
  const [teacherName, setTeacherName] = useState('');
  const [exams, setExams] = useState<RelayExamOption[]>([]);
  const [selectedExamId, setSelectedExamId] = useState<string>('AUTO');
  const [selectedStudentId, setSelectedStudentId] = useState<string>('AUTO');
  const [lockedStudentId, setLockedStudentId] = useState<string | null>(null);
  const [lockedStudentName, setLockedStudentName] = useState<string | null>(null);
  const [lockedSubmissionId, setLockedSubmissionId] = useState<string | null>(null);
  const [activeMode, setActiveMode] = useState<ActiveScanMode>('SUBMISSION');
  const [recentUploads, setRecentUploads] = useState<RecentMobileUpload[]>([]);

  // Capture mode: false = multi-page per student, true = 1 photo immediately sends
  const [quickSinglePageMode, setQuickSinglePageMode] = useState(false);
  const [capturedPages, setCapturedPages] = useState<CapturedPage[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadSuccessMsg, setUploadSuccessMsg] = useState('');
  const [uploadErrorMsg, setUploadErrorMsg] = useState('');

  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const hasInitializedSession = useRef(false);

  const fetchSessionData = useCallback(async () => {
    if (!token) return;
    try {
      let res: Response;
      try {
        res = await fetch(`/api/mobile-relay?token=${encodeURIComponent(token)}`);
      } catch {
        setSessionError(getRelayNetworkErrorMessage());
        setIsTokenExpired(false);
        return;
      }

      const result = await parseRelaySessionResponse(res);
      if (!result.success) {
        setSessionError(result.error || 'Fehler beim Laden der Sitzungsdaten.');
        setIsTokenExpired(Boolean(result.isTokenExpired));
        return;
      }

      // Successful poll: clear previous transient error and reset token expired flag
      setSessionError('');
      setIsTokenExpired(false);

      const data = result.data || {};
      setTeacherName(data.teacherName || 'Lehrperson');
      setExams(data.exams || []);
      setRecentUploads(data.recentUploads || []);

      if (!hasInitializedSession.current) {
        hasInitializedSession.current = true;
        if (data.lockedExamId) {
          setSelectedExamId(data.lockedExamId);
        } else {
          setSelectedExamId('AUTO');
        }
        if (data.lockedStudentId) {
          setLockedStudentId(data.lockedStudentId);
          setLockedStudentName(data.lockedStudentName || null);
          setSelectedStudentId(data.lockedStudentId);
        }
        if (data.lockedSubmissionId) {
          setLockedSubmissionId(data.lockedSubmissionId);
          setActiveMode('APPEND_SUBMISSION');
        } else if (
          data.targetMode === 'RUBRIC' ||
          data.targetMode === 'EXAM_TEMPLATE' ||
          data.targetMode === 'SUBMISSION'
        ) {
          setActiveMode(data.targetMode);
        }
      }
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => {
    Promise.resolve().then(() => {
      fetchSessionData();
    });
    const interval = setInterval(() => {
      fetchSessionData();
    }, 3500);
    return () => clearInterval(interval);
  }, [fetchSessionData]);

  const activeExamObj = exams.find((e) => e.id === selectedExamId) || null;
  const availableStudents = activeExamObj?.students || [];

  const submitPages = async (pagesToSubmit: File[]) => {
    const distinctPages = deduplicateRelayFiles(pagesToSubmit);
    if (distinctPages.length === 0) return;
    setUploading(true);
    setUploadErrorMsg('');
    setUploadSuccessMsg('');

    try {
      const optimizedFiles = await Promise.all(distinctPages.map((f) => optimizeMobileImage(f)));
      const formData = new FormData();
      formData.append('token', token);
      formData.append('targetMode', activeMode);
      if (selectedExamId && selectedExamId !== 'AUTO') {
        formData.append('examId', selectedExamId);
      }
      if (selectedStudentId && selectedStudentId !== 'AUTO') {
        formData.append('studentId', selectedStudentId);
      }
      if (lockedSubmissionId) {
        formData.append('submissionId', lockedSubmissionId);
      }
      for (const file of optimizedFiles) {
        formData.append('pages', file);
      }

      const res = await fetch('/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });
      let data: { error?: string; pagesCount?: number } | null = null;
      try {
        data = await res.json();
      } catch {
        data = null;
      }

      if (!res.ok) {
        setUploadErrorMsg(data?.error || `Upload fehlgeschlagen (HTTP ${res.status}).`);
      } else {
        capturedPages.forEach((p) => URL.revokeObjectURL(p.previewUrl));
        setCapturedPages([]);

        const effectiveCount =
          typeof data?.pagesCount === 'number' ? data.pagesCount : distinctPages.length;
        const pageLabel = effectiveCount === 1 ? 'Seite' : 'Seiten';

        if (activeMode === 'RUBRIC') {
          setUploadSuccessMsg(
            `Musterlösung (${effectiveCount} ${pageLabel}) an Desktop übertragen!`
          );
        } else if (activeMode === 'EXAM_TEMPLATE') {
          setUploadSuccessMsg(
            `Vorlagenprüfung (${effectiveCount} ${pageLabel}) an Desktop übertragen!`
          );
        } else if (activeMode === 'APPEND_SUBMISSION') {
          setUploadSuccessMsg(
            `${effectiveCount} ${pageLabel} angehängt! KI aktualisiert die Korrektur.`
          );
        } else if (activeMode === 'REPLACE_SUBMISSION') {
          setUploadSuccessMsg(`Scan ersetzt (${effectiveCount} ${pageLabel})! KI korrigiert neu.`);
        } else {
          setUploadSuccessMsg(
            `Prüfung (${effectiveCount} ${pageLabel}) gesendet! KI-Korrektur läuft.`
          );
          // Reset manual student override back to AUTO unless locked to a specific student
          if (!lockedStudentId) {
            setSelectedStudentId('AUTO');
          }
        }
        fetchSessionData();
      }
    } catch {
      setUploadErrorMsg('Netzwerkfehler beim Senden der Fotos.');
    } finally {
      setUploading(false);
    }
  };

  const handleFileCapture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;
    const filesArray = Array.from(fileList);
    e.target.value = '';

    setUploadSuccessMsg('');
    setUploadErrorMsg('');

    const distinctIncoming = deduplicateRelayFiles(filesArray);
    if (distinctIncoming.length === 0) return;

    if (quickSinglePageMode) {
      await submitPages(distinctIncoming);
      return;
    }

    const newEntries: CapturedPage[] = distinctIncoming.map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    setCapturedPages((prev) => {
      const { pages, droppedCount } = assembleCapturedPages(prev, newEntries);
      if (droppedCount > 0) {
        const keptIds = new Set(pages.map((p) => p.id));
        for (const entry of newEntries) {
          if (!keptIds.has(entry.id)) {
            URL.revokeObjectURL(entry.previewUrl);
          }
        }
      }
      return pages;
    });
  };

  const handleRemovePage = (id: string) => {
    setCapturedPages((prev) => {
      const target = prev.find((p) => p.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  };

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          p: 3,
          gap: 2,
        }}
      >
        <CircularProgress />
        <Typography variant="body1" sx={{ fontWeight: 600, color: 'text.secondary' }}>
          Smartphone-Kamera-Relay wird verbunden...
        </Typography>
      </Box>
    );
  }

  if (sessionError) {
    const isExpired =
      isTokenExpired ||
      sessionError.toLowerCase().includes('abgelaufen') ||
      sessionError.toLowerCase().includes('ungültig');

    return (
      <Box
        sx={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f8fafc',
          p: 3,
        }}
      >
        <Card sx={{ maxWidth: 420, width: '100%', borderRadius: '16px', p: 1 }}>
          <CardContent>
            <Alert severity="error" sx={{ borderRadius: '10px', mb: 2 }}>
              {sessionError}
            </Alert>
            {isExpired ? (
              <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                Bitte öffne das prüefli-Dashboard auf deinem Computer und klicke erneut auf{' '}
                <strong>&quot;Smartphone-Kamera (QR-Scan)&quot;</strong>.
              </Typography>
            ) : (
              <Stack spacing={2} sx={{ mt: 1 }}>
                <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
                  <CircularProgress size={18} />
                  <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    Automatischer Wiederverbindungsversuch läuft...
                  </Typography>
                </Stack>
                <Button
                  variant="outlined"
                  size="small"
                  onClick={() => fetchSessionData()}
                  sx={{ textTransform: 'none', fontWeight: 600, alignSelf: 'flex-start' }}
                >
                  Jetzt erneut versuchen
                </Button>
              </Stack>
            )}
          </CardContent>
        </Card>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        minHeight: '100vh',
        backgroundColor: '#f1f5f9',
        pb: 6,
      }}
    >
      {/* Top Mobile App Bar */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #0f172a 0%, #1e3a8a 100%)',
          color: '#ffffff',
          px: 2.5,
          py: 2,
          boxShadow: '0 2px 10px rgba(0,0,0,0.15)',
        }}
      >
        <Stack direction="row" sx={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <Box>
            <Typography variant="subtitle1" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
              prüefli · Smartphone-Scanner
            </Typography>
            <Typography variant="caption" sx={{ color: '#93c5fd', fontWeight: 600 }}>
              Verbunden mit {teacherName}
            </Typography>
          </Box>
          <Chip
            label="Live-Sync aktiv"
            size="small"
            sx={{
              backgroundColor: 'rgba(34, 197, 94, 0.2)',
              color: '#86efac',
              border: '1px solid rgba(134, 239, 172, 0.4)',
              fontWeight: 700,
              fontSize: '0.7rem',
            }}
          />
        </Stack>
      </Box>

      <Box sx={{ maxWidth: 520, mx: 'auto', px: 2, pt: 2.5 }}>
        <Stack spacing={2.5}>
          {/* Mode & Context Selector Card */}
          <Card sx={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
            <CardContent sx={{ p: '16px !important' }}>
              <Stack spacing={1.5}>
                {/* Document Type Switcher */}
                {lockedSubmissionId ? (
                  <Stack spacing={1}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                      KORREKTUR-AKTION FÜR {lockedStudentName || 'AKTUELLE PRÜFUNG'}:
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        fullWidth
                        variant={activeMode === 'APPEND_SUBMISSION' ? 'contained' : 'outlined'}
                        onClick={() => setActiveMode('APPEND_SUBMISSION')}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                      >
                        + Seite(n) anhängen
                      </Button>
                      <Button
                        size="small"
                        fullWidth
                        color="warning"
                        variant={activeMode === 'REPLACE_SUBMISSION' ? 'contained' : 'outlined'}
                        onClick={() => setActiveMode('REPLACE_SUBMISSION')}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                      >
                        Scan komplett ersetzen
                      </Button>
                    </Stack>
                  </Stack>
                ) : (
                  <Stack spacing={0.75}>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: 'text.secondary' }}>
                      WAS MÖCHTEST DU FOTOGRAFIEREN?
                    </Typography>
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        fullWidth
                        variant={activeMode === 'SUBMISSION' ? 'contained' : 'outlined'}
                        onClick={() => setActiveMode('SUBMISSION')}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                      >
                        Schülerarbeit
                      </Button>
                      <Button
                        size="small"
                        fullWidth
                        variant={activeMode === 'RUBRIC' ? 'contained' : 'outlined'}
                        onClick={() => setActiveMode('RUBRIC')}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                      >
                        Musterlösung
                      </Button>
                      <Button
                        size="small"
                        fullWidth
                        variant={activeMode === 'EXAM_TEMPLATE' ? 'contained' : 'outlined'}
                        onClick={() => setActiveMode('EXAM_TEMPLATE')}
                        sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
                      >
                        Vorlage
                      </Button>
                    </Stack>
                  </Stack>
                )}

                {/* Exam Selector (shown when not locked to a submission replacement) */}
                {!lockedSubmissionId &&
                  (exams.length > 0 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel>Prüfung & Klasse</InputLabel>
                      <Select
                        value={selectedExamId}
                        label="Prüfung & Klasse"
                        onChange={(e) => {
                          setSelectedExamId(e.target.value);
                          if (!lockedStudentId) {
                            setSelectedStudentId('AUTO');
                          }
                        }}
                        sx={{ borderRadius: '10px', fontWeight: 600 }}
                      >
                        {activeMode === 'SUBMISSION' && (
                          <MenuItem value="AUTO">
                            ✨ Automatisch erkennen (KI erkennt Klasse, Prüfung & Schüler/in)
                          </MenuItem>
                        )}
                        {exams.map((ex) => (
                          <MenuItem key={ex.id} value={ex.id}>
                            {ex.className} · {ex.title} ({ex.subject})
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: '10px',
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fde68a',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 700, color: '#92400e', display: 'block', mb: 0.5 }}
                      >
                        PRÜFUNG & KLASSE
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#92400e', fontSize: '0.85rem' }}>
                        Noch keine Prüfungen angelegt. Bitte erstelle zuerst eine Prüfung auf dem
                        Desktop im Dashboard oder unter Prüfungen.
                      </Typography>
                    </Box>
                  ))}

                {/* Optional Student Selector when scanning student exams for a known class */}
                {activeMode === 'SUBMISSION' &&
                  selectedExamId !== 'AUTO' &&
                  (availableStudents.length > 0 ? (
                    <FormControl fullWidth size="small">
                      <InputLabel>Schüler/in (optional bei fehlendem Namen)</InputLabel>
                      <Select
                        value={selectedStudentId}
                        label="Schüler/in (optional bei fehlendem Namen)"
                        onChange={(e) => setSelectedStudentId(e.target.value)}
                        sx={{ borderRadius: '10px', fontWeight: 600 }}
                      >
                        <MenuItem value="AUTO">
                          ✨ Automatisch per Handschrift erkennen (KI)
                        </MenuItem>
                        {availableStudents.map((st) => (
                          <MenuItem key={st.id} value={st.id}>
                            {st.name}
                          </MenuItem>
                        ))}
                      </Select>
                    </FormControl>
                  ) : (
                    <Box
                      sx={{
                        p: 1.5,
                        borderRadius: '10px',
                        backgroundColor: '#fffbeb',
                        border: '1px solid #fde68a',
                      }}
                    >
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 700, color: '#92400e', display: 'block', mb: 0.5 }}
                      >
                        SCHÜLER-ZUORDNUNG
                      </Typography>
                      <Typography variant="body2" sx={{ color: '#92400e', fontSize: '0.85rem' }}>
                        Keine Schüler/innen in dieser Klasse gefunden. Füge Schüler/innen auf dem
                        Desktop unter &quot;Klassen&quot; hinzu.
                      </Typography>
                    </Box>
                  ))}

                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 1,
                    backgroundColor: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: '8px',
                    px: 1.5,
                    py: 1,
                  }}
                >
                  <AutoAwesomeIcon sx={{ color: '#0284c7', fontSize: '1.1rem', flexShrink: 0 }} />
                  <Typography variant="caption" sx={{ color: '#0369a1', fontWeight: 600 }}>
                    {activeMode === 'RUBRIC'
                      ? 'Musterlösungs-Modus: Fotografiere alle Seiten deiner Musterlösung. Der Desktop übernimmt sie automatisch und extrahiert die Aufgabenstruktur.'
                      : activeMode === 'EXAM_TEMPLATE'
                        ? 'Vorlagen-Modus: Fotografiere das leere Prüfungsblatt (Stufe 1) für verbindliche Aufgabenstellungen.'
                        : activeMode === 'APPEND_SUBMISSION'
                          ? 'Ergänzungs-Modus: Fotografiere die fehlende(n) Prüfungsseite(n). Sie werden an die bestehende Korrektur angehängt und neu ausgewertet.'
                          : activeMode === 'REPLACE_SUBMISSION'
                            ? 'Ersetzungs-Modus: Der bisherige Scan dieser Korrektur wird durch die neuen Fotos ersetzt.'
                            : selectedStudentId !== 'AUTO'
                              ? `Feste Zuordnung aktiv: Diese Aufnahme wird direkt dem ausgewählten Schülerprofil zugeordnet.`
                              : selectedExamId === 'AUTO'
                                ? 'Universal-Modus: Die KI erkennt Klasse, Prüfung und Schülername automatisch auf dem Blatt.'
                                : 'Schülername wird automatisch auf dem Blatt abgelesen (oder wähle oben manuell eine/n Schüler/in, falls kein Name auf dem Blatt steht).'}
                  </Typography>
                </Box>

                <Divider />

                <FormControlLabel
                  control={
                    <Switch
                      checked={quickSinglePageMode}
                      onChange={(e) => setQuickSinglePageMode(e.target.checked)}
                      color="primary"
                      size="small"
                    />
                  }
                  label={
                    <Typography variant="body2" sx={{ fontWeight: 600, color: 'text.primary' }}>
                      Schnellmodus (1 Foto = sofort absenden)
                    </Typography>
                  }
                />
              </Stack>
            </CardContent>
          </Card>

          {uploadSuccessMsg && (
            <Alert
              severity="success"
              icon={<CheckCircleIcon fontSize="inherit" />}
              sx={{ borderRadius: '12px', fontWeight: 600 }}
            >
              {uploadSuccessMsg}
            </Alert>
          )}

          {uploadErrorMsg && (
            <Alert severity="error" sx={{ borderRadius: '12px', fontWeight: 600 }}>
              {uploadErrorMsg}
            </Alert>
          )}

          {/* Hidden File Inputs for Camera & Gallery */}
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            onChange={handleFileCapture}
            style={{ display: 'none' }}
          />
          <input
            ref={galleryInputRef}
            type="file"
            accept="image/*,application/pdf"
            multiple
            onChange={handleFileCapture}
            style={{ display: 'none' }}
          />

          {/* Camera Action Card */}
          <Card
            sx={{
              borderRadius: '16px',
              border: '2px solid #1b77d1',
              backgroundColor: '#ffffff',
              boxShadow: '0 4px 16px rgba(27, 119, 209, 0.1)',
            }}
          >
            <CardContent sx={{ p: '20px !important' }}>
              <Stack spacing={2}>
                <Typography
                  variant="subtitle1"
                  sx={{ fontWeight: 800, color: '#0f172a', textAlign: 'center' }}
                >
                  {capturedPages.length === 0
                    ? activeMode === 'RUBRIC'
                      ? 'Musterlösung fotografieren'
                      : activeMode === 'EXAM_TEMPLATE'
                        ? 'Vorlagenprüfung fotografieren'
                        : 'Schülerprüfung fotografieren'
                    : `Aktuelle Aufnahme (${capturedPages.length} ${capturedPages.length === 1 ? 'Seite' : 'Seiten'})`}
                </Typography>

                {/* Preview of Staged Pages in Multi-Page Mode */}
                {capturedPages.length > 0 && (
                  <Stack spacing={1.5}>
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, 1fr)',
                        gap: 1.5,
                      }}
                    >
                      {capturedPages.map((p, idx) => (
                        <Box
                          key={p.id}
                          sx={{
                            position: 'relative',
                            borderRadius: '10px',
                            overflow: 'hidden',
                            border: '1px solid #cbd5e1',
                            backgroundColor: '#f8fafc',
                            aspectRatio: '3 / 4',
                          }}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={p.previewUrl}
                            alt={`Seite ${idx + 1}`}
                            style={{
                              width: '100%',
                              height: '100%',
                              objectFit: 'cover',
                              display: 'block',
                            }}
                          />
                          <Chip
                            label={`Seite ${idx + 1}`}
                            size="small"
                            sx={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              backgroundColor: 'rgba(15, 23, 42, 0.8)',
                              color: '#ffffff',
                              fontWeight: 700,
                              fontSize: '0.7rem',
                            }}
                          />
                          <IconButton
                            size="small"
                            onClick={() => handleRemovePage(p.id)}
                            sx={{
                              position: 'absolute',
                              top: 6,
                              right: 6,
                              backgroundColor: 'rgba(220, 38, 38, 0.9)',
                              color: '#ffffff',
                              '&:hover': { backgroundColor: '#b91c1c' },
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Box>
                      ))}
                    </Box>
                  </Stack>
                )}

                <Stack spacing={1.25}>
                  <Button
                    variant="contained"
                    size="large"
                    fullWidth
                    disabled={uploading}
                    startIcon={
                      capturedPages.length === 0 ? <PhotoCameraIcon /> : <AddPhotoAlternateIcon />
                    }
                    onClick={() => cameraInputRef.current?.click()}
                    sx={{
                      py: 1.75,
                      borderRadius: '12px',
                      fontWeight: 800,
                      fontSize: '1rem',
                      textTransform: 'none',
                      backgroundColor: capturedPages.length === 0 ? '#1b77d1' : '#0284c7',
                    }}
                  >
                    {capturedPages.length === 0
                      ? 'Kamera öffnen & Seite scannen'
                      : '+ Weitere Seite hinzufügen'}
                  </Button>

                  <Button
                    variant="outlined"
                    size="medium"
                    fullWidth
                    disabled={uploading}
                    startIcon={<CollectionsIcon />}
                    onClick={() => galleryInputRef.current?.click()}
                    sx={{
                      py: 1,
                      borderRadius: '10px',
                      fontWeight: 700,
                      textTransform: 'none',
                    }}
                  >
                    Aus Fotomediathek / Dateien wählen
                  </Button>

                  {capturedPages.length > 0 && (
                    <Button
                      variant="contained"
                      color="success"
                      size="large"
                      fullWidth
                      disabled={uploading}
                      startIcon={
                        uploading ? <CircularProgress size={18} color="inherit" /> : <SendIcon />
                      }
                      onClick={() => submitPages(capturedPages.map((p) => p.file))}
                      sx={{
                        mt: 1,
                        py: 1.75,
                        borderRadius: '12px',
                        fontWeight: 800,
                        fontSize: '1rem',
                        textTransform: 'none',
                        backgroundColor: '#16a34a',
                        '&:hover': { backgroundColor: '#15803d' },
                      }}
                    >
                      {uploading
                        ? 'Wird gesendet...'
                        : activeMode === 'RUBRIC'
                          ? `Musterlösung an Desktop senden (${capturedPages.length} S.)`
                          : activeMode === 'EXAM_TEMPLATE'
                            ? `Vorlagenprüfung an Desktop senden (${capturedPages.length} S.)`
                            : activeMode === 'APPEND_SUBMISSION'
                              ? `Seite(n) an Korrektur anhängen (${capturedPages.length} S.)`
                              : activeMode === 'REPLACE_SUBMISSION'
                                ? `Scan ersetzen & neu bewerten (${capturedPages.length} S.)`
                                : `Prüfung absenden & Nächste/r (${capturedPages.length} S.)`}
                    </Button>
                  )}
                </Stack>
              </Stack>
            </CardContent>
          </Card>

          {/* Live Recent Uploads List */}
          <Card sx={{ borderRadius: '14px', border: '1px solid #e2e8f0', boxShadow: 'none' }}>
            <CardContent sx={{ p: '16px !important' }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 1.5, color: '#0f172a' }}>
                Aktuelle Übertragungen & Live-Noten ({recentUploads.length})
              </Typography>
              {recentUploads.length === 0 ? (
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                  Noch keine Prüfungen in dieser Sitzung gescannt.
                </Typography>
              ) : (
                <Stack spacing={1}>
                  {recentUploads.map((item) => (
                    <Box
                      key={item.id}
                      sx={{
                        p: 1.25,
                        borderRadius: '10px',
                        backgroundColor: '#f8fafc',
                        border: '1px solid #e2e8f0',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        gap: 1,
                      }}
                    >
                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="body2"
                          sx={{
                            fontWeight: 700,
                            color: '#0f172a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {item.studentName}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ color: 'text.secondary', display: 'block' }}
                        >
                          {item.className} · {item.examTitle} · {item.time}
                        </Typography>
                        {item.status === 'COMPLETED' &&
                          item.earnedPoints !== null &&
                          item.earnedPoints !== undefined && (
                            <Typography
                              variant="caption"
                              sx={{ color: '#334155', fontWeight: 700 }}
                            >
                              {item.earnedPoints} / {item.maxPoints} P.
                              {(item.uncertainStepsCount ?? 0) > 0
                                ? ` · ⚠ ${item.uncertainStepsCount} unsicher`
                                : ''}
                            </Typography>
                          )}
                      </Box>
                      <Box sx={{ flexShrink: 0 }}>
                        {item.status === 'PENDING' || item.status === 'PROCESSING' ? (
                          <Chip
                            label="KI korrigiert..."
                            size="small"
                            sx={{
                              backgroundColor: '#e0f2fe',
                              color: '#0369a1',
                              fontWeight: 700,
                              fontSize: '0.7rem',
                            }}
                          />
                        ) : item.status === 'COMPLETED' ? (
                          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                            {(item.isExamMatchUncertain || item.isStudentMatchUncertain) && (
                              <Chip
                                label="⚠ Zuordnen"
                                size="small"
                                sx={{
                                  backgroundColor: '#fef3c7',
                                  color: '#b45309',
                                  fontWeight: 700,
                                  fontSize: '0.7rem',
                                }}
                              />
                            )}
                            <Chip
                              label={`Note ${item.grade}`}
                              size="small"
                              sx={{
                                backgroundColor:
                                  parseFloat(item.grade || '1') >= 4.0 ? '#1b77d1' : '#dc2626',
                                color: '#ffffff',
                                fontWeight: 700,
                                fontSize: '0.75rem',
                              }}
                            />
                          </Stack>
                        ) : (
                          <Chip label="Fehler" size="small" color="error" />
                        )}
                      </Box>
                    </Box>
                  ))}
                </Stack>
              )}
            </CardContent>
          </Card>
        </Stack>
      </Box>
    </Box>
  );
}
