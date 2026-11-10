'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Stack,
  Chip,
  CircularProgress,
  Alert,
  TextField,
  IconButton,
  Tooltip,
  Divider,
  useMediaQuery,
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import PhotoCameraIcon from '@mui/icons-material/PhotoCamera';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import EmailVerificationAiBanner, {
  useTeacherSession,
} from '@/components/EmailVerificationAiBanner';
import { deduplicateRelayFiles } from '@/lib/relay-dedup';

export type QrTargetMode =
  | 'SUBMISSION'
  | 'RUBRIC'
  | 'EXAM_TEMPLATE'
  | 'REPLACE_SUBMISSION'
  | 'APPEND_SUBMISSION';

export function isMobileScannerClient(
  userAgent?: string,
  isCoarseOrNarrowViewport?: boolean
): boolean {
  if (isCoarseOrNarrowViewport) return true;
  if (!userAgent) return false;
  return /Android|iPhone|iPad|iPod|Windows Phone|Mobile/i.test(userAgent);
}

export function getSameDeviceUploadCopy(
  targetMode: QrTargetMode,
  studentName?: string | null
): { title: string; subtitle: string } {
  if (targetMode === 'RUBRIC') {
    return {
      title: 'Musterlösung direkt erfassen',
      subtitle: 'Kamera, Bilder oder PDF direkt auf diesem Gerät wählen.',
    };
  }
  if (targetMode === 'EXAM_TEMPLATE') {
    return {
      title: 'Vorlage direkt erfassen',
      subtitle: 'Kamera, Bilder oder PDF direkt auf diesem Gerät wählen.',
    };
  }
  if (targetMode === 'APPEND_SUBMISSION') {
    return {
      title: studentName ? `Seite(n) für ${studentName} anhängen` : 'Fehlende Seite(n) anhängen',
      subtitle: 'Aufnahme oder Datei wird an die Korrektur angehängt.',
    };
  }
  if (targetMode === 'REPLACE_SUBMISSION') {
    return {
      title: studentName ? `Scan für ${studentName} ersetzen` : 'Scan direkt ersetzen',
      subtitle: 'Bestehender Scan wird durch neue Aufnahme oder Datei ersetzt.',
    };
  }
  return {
    title: studentName
      ? `Datei(en) für ${studentName} auswählen`
      : 'PDF oder Bilder direkt hochladen',
    subtitle: 'Mehrere Bilder werden als mehrseitige Prüfung zusammengefasst.',
  };
}

interface QrScannerDialogProps {
  open: boolean;
  onClose: () => void;
  targetMode?: QrTargetMode;
  classId?: string | null;
  className?: string | null;
  examId?: string | null;
  examTitle?: string | null;
  studentId?: string | null;
  studentName?: string | null;
  submissionId?: string | null;
  showDevOptions?: boolean;
  onRefreshSubmissions?: () => void;
  onDocumentScanned?: (
    payload: string,
    pageCount: number,
    targetMode: 'RUBRIC' | 'EXAM_TEMPLATE'
  ) => void;
}

export default function QrScannerDialog({
  open,
  onClose,
  targetMode = 'SUBMISSION',
  classId,
  className,
  examId,
  examTitle,
  studentId,
  studentName,
  submissionId,
  showDevOptions,
  onRefreshSubmissions,
  onDocumentScanned,
}: QrScannerDialogProps) {
  const { isUnverified } = useTeacherSession();
  const isCoarseOrNarrow = useMediaQuery('(max-width: 600px), (pointer: coarse)');
  const isMobileDevice = isMobileScannerClient(
    typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
    isCoarseOrNarrow
  );
  const isPaidSubmissionScan = targetMode !== 'RUBRIC' && targetMode !== 'EXAM_TEMPLATE';
  const isDevMode =
    typeof showDevOptions === 'boolean'
      ? showDevOptions
      : process.env.NODE_ENV === 'development' ||
        process.env.NEXT_PUBLIC_ENABLE_QR_DEV_OPTIONS === 'true';
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [token, setToken] = useState('');
  const [qrDataUrl, setQrDataUrl] = useState('');
  const [scanUrl, setScanUrl] = useState('');
  const [copied, setCopied] = useState(false);
  const [customOrigin, setCustomOrigin] = useState('');
  const [receivedDocInfo, setReceivedDocInfo] = useState<{
    pageCount: number;
    mode: string;
  } | null>(null);
  const [pcUploading, setPcUploading] = useState(false);
  const [pcUploadSuccess, setPcUploadSuccess] = useState('');
  const [pendingOverrideFiles, setPendingOverrideFiles] = useState<File[]>([]);
  const [canOverrideError, setCanOverrideError] = useState(false);

  const lastHandledDocIdRef = useRef<string | null>(null);
  const pcFileInputRef = useRef<HTMLInputElement | null>(null);
  const cameraFileInputRef = useRef<HTMLInputElement | null>(null);

  const generateQrSession = useCallback(
    async (originOverride?: string) => {
      setLoading(true);
      setError('');
      setCanOverrideError(false);
      setPendingOverrideFiles([]);
      setReceivedDocInfo(null);
      setPcUploadSuccess('');
      try {
        const res = await fetch('/api/mobile-relay', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetMode,
            classId: classId || null,
            examId: examId || null,
            studentId: studentId || null,
            submissionId: submissionId || null,
            customOrigin: originOverride !== undefined ? originOverride : customOrigin || undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.error || 'QR-Code konnte nicht erstellt werden.');
          return;
        }
        setToken(data.token || '');
        setQrDataUrl(data.qrDataUrl);
        setScanUrl(data.scanUrl);
      } catch {
        setError('Netzwerkfehler beim Erstellen des QR-Codes.');
      } finally {
        setLoading(false);
      }
    },
    [targetMode, classId, examId, studentId, submissionId, customOrigin]
  );

  useEffect(() => {
    if (!open) return;
    lastHandledDocIdRef.current = null;
    Promise.resolve().then(() => {
      generateQrSession();
    });
  }, [open, generateQrSession]);

  const pollRelayStatus = useCallback(async () => {
    if (!open || !token) return;
    if (onRefreshSubmissions) {
      onRefreshSubmissions();
    }
    if (targetMode === 'RUBRIC' || targetMode === 'EXAM_TEMPLATE') {
      try {
        const res = await fetch(`/api/mobile-relay?token=${encodeURIComponent(token)}`);
        if (res.ok) {
          const data = await res.json();
          if (data.scannedDocument && data.scannedDocument.id !== lastHandledDocIdRef.current) {
            lastHandledDocIdRef.current = data.scannedDocument.id;
            setReceivedDocInfo({
              pageCount: data.scannedDocument.pageCount,
              mode: data.scannedDocument.targetMode,
            });
            if (onDocumentScanned) {
              onDocumentScanned(
                data.scannedDocument.payload,
                data.scannedDocument.pageCount,
                data.scannedDocument.targetMode
              );
            }
          }
        }
      } catch {
        // Ignore polling error
      }
    }
  }, [open, token, targetMode, onRefreshSubmissions, onDocumentScanned]);

  // Poll desktop submissions & scanned reference documents while modal is open (and on tab return)
  useEffect(() => {
    if (!open || !token) return;

    const interval = setInterval(() => {
      void pollRelayStatus();
    }, 2500);

    const handleVisibilityOrFocus = () => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        void pollRelayStatus();
      }
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [open, token, pollRelayStatus]);

  const handleCopyUrl = async () => {
    if (!scanUrl) return;
    try {
      await navigator.clipboard.writeText(scanUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Ignore clipboard error
    }
  };

  const uploadPcFiles = async (files: File[], allowOverride = false) => {
    if (files.length === 0 || !token) return;

    setPcUploading(true);
    setError('');
    setPcUploadSuccess('');
    if (!allowOverride) {
      setCanOverrideError(false);
      setPendingOverrideFiles([]);
    }
    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('targetMode', targetMode);
      if (allowOverride) {
        formData.append('overrideDocumentType', 'true');
      }
      if (examId) formData.append('examId', examId);
      if (studentId) formData.append('studentId', studentId);
      if (submissionId) formData.append('submissionId', submissionId);
      files.forEach((f) => formData.append('pages', f));

      const res = await fetch('/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data?.canOverride) {
          setCanOverrideError(true);
          setPendingOverrideFiles(files);
        } else {
          setCanOverrideError(false);
          setPendingOverrideFiles([]);
        }
        setError(data?.error || 'Upload fehlgeschlagen.');
        return;
      }

      setCanOverrideError(false);
      setPendingOverrideFiles([]);
      const effectiveCount = typeof data?.pagesCount === 'number' ? data.pagesCount : files.length;

      if (targetMode === 'RUBRIC' || targetMode === 'EXAM_TEMPLATE') {
        const scannedDoc = data?.scannedDocument;
        if (scannedDoc?.id) {
          lastHandledDocIdRef.current = scannedDoc.id;
        }
        setReceivedDocInfo({
          pageCount: effectiveCount,
          mode: targetMode,
        });
        if (scannedDoc?.payload && onDocumentScanned) {
          onDocumentScanned(scannedDoc.payload, effectiveCount, targetMode);
        } else {
          await pollRelayStatus();
        }
        return;
      }

      if (targetMode === 'APPEND_SUBMISSION') {
        setPcUploadSuccess(
          `${effectiveCount} ${effectiveCount === 1 ? 'Seite' : 'Seiten'} angehängt — KI-Korrektur läuft!`
        );
      } else if (targetMode === 'REPLACE_SUBMISSION') {
        setPcUploadSuccess(
          `Scan ersetzt (${effectiveCount} ${effectiveCount === 1 ? 'Datei' : 'Dateien'}) — KI-Korrektur läuft!`
        );
      } else {
        setPcUploadSuccess(
          studentName
            ? `Arbeit für ${studentName} (${effectiveCount} ${effectiveCount === 1 ? 'Datei' : 'Dateien'}) hochgeladen — KI-Korrektur gestartet!`
            : `${effectiveCount} ${effectiveCount === 1 ? 'Datei' : 'Dateien'} erfolgreich hochgeladen — KI-Korrektur läuft!`
        );
      }
      if (onRefreshSubmissions) {
        onRefreshSubmissions();
      }
    } catch (err) {
      setCanOverrideError(false);
      setPendingOverrideFiles([]);
      setError(err instanceof Error ? err.message : 'Fehler beim Datei-Upload.');
    } finally {
      setPcUploading(false);
    }
  };

  const handlePcFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    const files = deduplicateRelayFiles(rawFiles);
    if (files.length === 0 || !token) return;
    await uploadPcFiles(files, false);
  };

  const getModeHeader = () => {
    if (targetMode === 'RUBRIC') {
      return {
        title: 'Musterlösung (Stufe 2) erfassen',
        description:
          'Musterlösung (1 oder mehrere Seiten) per Kamera oder Datei erfassen und automatisch in Aufgaben zerlegen.',
        bg: '#eff6ff',
        border: '#bfdbfe',
        color: '#1d4ed8',
      };
    }
    if (targetMode === 'EXAM_TEMPLATE') {
      return {
        title: 'Vorlagenprüfung (Stufe 1) erfassen',
        description:
          'Leeres Aufgabenblatt per Kamera oder Datei erfassen, damit Aufgabenstellung und Maximalpunkte bekannt sind.',
        bg: '#f5f3ff',
        border: '#ddd6fe',
        color: '#6d28d9',
      };
    }
    if (targetMode === 'REPLACE_SUBMISSION' || targetMode === 'APPEND_SUBMISSION') {
      return {
        title: `Scan ersetzen oder Seite anhängen${studentName ? `: ${studentName}` : ''}`,
        description:
          'Fehlende Prüfungsseite zum Anhängen aufnehmen oder den gesamten Scan dieser Korrektur ersetzen.',
        bg: '#fff7ed',
        border: '#fed7aa',
        color: '#c2410c',
      };
    }
    if (studentId && studentName) {
      return {
        title: `Schüler-Scan: ${studentName} (${examTitle || 'Prüfung'})`,
        description: `Alle Aufnahmen oder hochgeladenen Dateien werden direkt ${studentName} zugeordnet – ideal auch ohne Namen auf dem Blatt.`,
        bg: '#f0fdf4',
        border: '#bbf7d0',
        color: '#15803d',
      };
    }
    if (examId) {
      return {
        title: `Prüfungs-Modus: ${className || 'Klasse'} · ${examTitle}`,
        description:
          'Alle erfassten Seiten werden dieser Prüfung zugeordnet. Die KI liest den Schülernamen automatisch ab.',
        bg: '#f0f7ff',
        border: '#bae6fd',
        color: '#0369a1',
      };
    }
    return {
      title: 'Universal-Scan-Modus (Automatische KI-Erkennung)',
      description:
        'Beliebige Schülerprüfungen oder Musterlösungen erfassen. Die KI erkennt Klasse, Prüfung und Schüler/in automatisch.',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      color: '#15803d',
    };
  };

  const modeHeader = getModeHeader();
  const sameDeviceCopy = getSameDeviceUploadCopy(targetMode, studentName);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      sx={{
        '& .MuiDialog-paper': {
          m: { xs: 1.5, sm: 4 },
          width: { xs: 'calc(100% - 24px)', sm: '100%' },
        },
      }}
    >
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <QrCodeScannerIcon color="primary" />
        {targetMode === 'RUBRIC'
          ? 'Musterlösung per QR-Kamera scannen'
          : targetMode === 'EXAM_TEMPLATE'
            ? 'Vorlagenprüfung per QR-Kamera scannen'
            : studentName
              ? `Arbeit einscannen: ${studentName}`
              : 'Smartphone-Kamera als Scanner verbinden'}
      </DialogTitle>
      <DialogContent>
        <Stack spacing={2.25} sx={{ pt: 0.5 }}>
          <Box
            sx={{
              backgroundColor: modeHeader.bg,
              border: `1px solid ${modeHeader.border}`,
              borderRadius: '12px',
              p: 1.75,
            }}
          >
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 0.5 }}>
              <AutoAwesomeIcon sx={{ fontSize: '1.1rem', color: modeHeader.color }} />
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: modeHeader.color }}>
                {modeHeader.title}
              </Typography>
            </Stack>
            <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
              {modeHeader.description}
            </Typography>
          </Box>

          {receivedDocInfo && (
            <Alert
              icon={<CheckCircleIcon fontSize="inherit" />}
              severity="success"
              sx={{ borderRadius: '10px', fontWeight: 700 }}
            >
              {receivedDocInfo.mode === 'RUBRIC' ? 'Musterlösung' : 'Vorlagenprüfung'} (
              {receivedDocInfo.pageCount} {receivedDocInfo.pageCount === 1 ? 'Seite' : 'Seiten'})
              wurde erfolgreich vom Smartphone übernommen!
            </Alert>
          )}

          {pcUploadSuccess && (
            <Alert severity="success" sx={{ borderRadius: '10px', fontWeight: 600 }}>
              {pcUploadSuccess}
            </Alert>
          )}

          {error && (
            <Alert
              severity="error"
              sx={{
                borderRadius: '10px',
                '& .MuiAlert-message': { width: '100%', minWidth: 0 },
              }}
            >
              <Stack spacing={1.25}>
                <Typography variant="body2" sx={{ color: 'inherit', lineHeight: 1.45 }}>
                  {error}
                </Typography>
                <Stack
                  direction={{ xs: 'column', sm: 'row' }}
                  spacing={1}
                  useFlexGap
                  sx={{
                    alignItems: { xs: 'stretch', sm: 'center' },
                    flexWrap: 'wrap',
                    width: '100%',
                  }}
                >
                  {canOverrideError && pendingOverrideFiles.length > 0 && (
                    <Button
                      color="inherit"
                      size="small"
                      variant="outlined"
                      disabled={pcUploading}
                      onClick={() => void uploadPcFiles(pendingOverrideFiles, true)}
                      sx={{
                        textTransform: 'none',
                        fontWeight: 700,
                        fontSize: { xs: '0.8rem', sm: '0.85rem' },
                        px: { xs: 1.5, sm: 2 },
                        py: 0.75,
                        lineHeight: 1.3,
                        width: { xs: '100%', sm: 'auto' },
                        maxWidth: '100%',
                        whiteSpace: { xs: 'normal', sm: 'nowrap' },
                        borderColor: 'currentColor',
                      }}
                    >
                      Trotzdem als Prüfung behandeln
                    </Button>
                  )}
                  <Button
                    color="inherit"
                    size="small"
                    variant="outlined"
                    disabled={pcUploading}
                    onClick={() =>
                      pendingOverrideFiles.length > 0
                        ? void uploadPcFiles(pendingOverrideFiles, false)
                        : void generateQrSession()
                    }
                    sx={{
                      textTransform: 'none',
                      fontWeight: 700,
                      fontSize: { xs: '0.8rem', sm: '0.85rem' },
                      px: { xs: 1.5, sm: 2 },
                      py: 0.75,
                      lineHeight: 1.3,
                      width: { xs: '100%', sm: 'auto' },
                      maxWidth: '100%',
                      whiteSpace: { xs: 'normal', sm: 'nowrap' },
                      borderColor: 'currentColor',
                    }}
                  >
                    Erneut versuchen
                  </Button>
                </Stack>
              </Stack>
            </Alert>
          )}

          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: '#f8fafc',
              border: '1px dashed #cbd5e1',
              borderRadius: '16px',
              p: 2.5,
              minHeight: 250,
            }}
          >
            {loading ? (
              <CircularProgress />
            ) : qrDataUrl ? (
              <>
                <Box
                  sx={{
                    p: 1.5,
                    backgroundColor: '#ffffff',
                    borderRadius: '14px',
                    border: '1px solid #e2e8f0',
                    boxShadow: '0 4px 12px rgba(0,0,0,0.06)',
                  }}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrDataUrl}
                    alt="QR-Code für Smartphone-Kamera"
                    style={{ width: 210, height: 210, display: 'block' }}
                  />
                </Box>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mt: 1.5 }}>
                  <Chip
                    label="1. QR-Code mit Handy scannen"
                    size="small"
                    sx={{ fontWeight: 700, backgroundColor: '#e2e8f0' }}
                  />
                  <Chip
                    label="2. Seiten abfotografieren"
                    size="small"
                    sx={{ fontWeight: 700, backgroundColor: '#e2e8f0' }}
                  />
                </Stack>
              </>
            ) : null}
          </Box>

          {/* Direct PC Upload fallback when scanning for a specific exam or student */}
          {isPaidSubmissionScan && (
            <EmailVerificationAiBanner
              compact
              featureLabel="Das Einscannen und Hochladen von Schülerarbeiten"
            />
          )}
          <Divider sx={{ fontSize: '0.75rem', color: 'text.secondary', fontWeight: 700 }}>
            {isMobileDevice
              ? 'DIREKT AUF DIESEM GERÄT'
              : 'AUF DIESEM GERÄT ODER DATEI HOCHLADEN'}
          </Divider>
          <Box
            data-testid="same-device-scan-section"
            sx={{
              display: 'flex',
              flexDirection: 'column',
              gap: 1.25,
              p: 1.5,
              borderRadius: '12px',
              border: isMobileDevice ? '2px solid #1b77d1' : '1px solid #cbd5e1',
              backgroundColor: isMobileDevice ? '#f0f7ff' : '#ffffff',
            }}
          >
            <Box>
              <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                {sameDeviceCopy.title}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                {sameDeviceCopy.subtitle}
              </Typography>
            </Box>
            <input
              ref={cameraFileInputRef}
              data-testid="same-device-camera-input"
              type="file"
              accept="image/*"
              capture="environment"
              onChange={handlePcFilesSelected}
              style={{ display: 'none' }}
            />
            <input
              ref={pcFileInputRef}
              data-testid="same-device-file-input"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              multiple
              onChange={handlePcFilesSelected}
              style={{ display: 'none' }}
            />
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              useFlexGap
              sx={{
                alignItems: { xs: 'stretch', sm: 'center' },
                flexWrap: 'wrap',
                width: '100%',
              }}
            >
              <Button
                data-testid="same-device-scan-button"
                component="a"
                href={scanUrl || undefined}
                target="_blank"
                rel="noopener noreferrer"
                variant={isMobileDevice ? 'contained' : 'outlined'}
                startIcon={<OpenInNewIcon />}
                disabled={(isPaidSubmissionScan && isUnverified) || loading || !scanUrl}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: '8px',
                  flex: { xs: '1 1 auto', sm: '0 0 auto' },
                }}
              >
                Auf diesem Gerät scannen
              </Button>
              <Button
                data-testid="same-device-camera-button"
                variant="outlined"
                startIcon={pcUploading ? <CircularProgress size={16} /> : <PhotoCameraIcon />}
                disabled={(isPaidSubmissionScan && isUnverified) || pcUploading || !token}
                onClick={() => cameraFileInputRef.current?.click()}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: '8px',
                  flex: { xs: '1 1 auto', sm: '0 0 auto' },
                }}
              >
                Kamera
              </Button>
              <Button
                data-testid="same-device-upload-button"
                variant="outlined"
                startIcon={pcUploading ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                disabled={(isPaidSubmissionScan && isUnverified) || pcUploading || !token}
                onClick={() => pcFileInputRef.current?.click()}
                sx={{
                  textTransform: 'none',
                  fontWeight: 700,
                  borderRadius: '8px',
                  flex: { xs: '1 1 auto', sm: '0 0 auto' },
                }}
              >
                {pcUploading ? 'Lädt...' : 'Datei wählen'}
              </Button>
            </Stack>
          </Box>

          {scanUrl && (
            <Stack spacing={1} data-testid="same-device-direct-link">
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Direktlink (gültig für 2 Std.):
              </Typography>
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <TextField
                  size="small"
                  fullWidth
                  value={scanUrl}
                  slotProps={{ htmlInput: { readOnly: true } }}
                  sx={{
                    '& .MuiOutlinedInput-root': {
                      fontFamily: 'monospace',
                      fontSize: '0.8rem',
                      backgroundColor: '#f8fafc',
                    },
                  }}
                />
                <Tooltip title={copied ? 'Kopiert!' : 'Link kopieren'}>
                  <IconButton
                    aria-label="Link kopieren"
                    color={copied ? 'success' : 'primary'}
                    onClick={handleCopyUrl}
                    sx={{ border: '1px solid #cbd5e1', borderRadius: '8px' }}
                  >
                    {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Neuen QR-Code generieren">
                  <IconButton
                    aria-label="Neuen QR-Code generieren"
                    onClick={() => generateQrSession()}
                    sx={{ border: '1px solid #cbd5e1', borderRadius: '8px' }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
              {isDevMode && (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', pt: 0.5 }}>
                  <TextField
                    size="small"
                    fullWidth
                    placeholder="Optional: Eigene Server-URL / WLAN-IP (z. B. http://192.168.1.50:3000)"
                    value={customOrigin}
                    onChange={(e) => setCustomOrigin(e.target.value)}
                    sx={{
                      '& .MuiOutlinedInput-root': {
                        fontSize: '0.78rem',
                      },
                    }}
                  />
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={() => generateQrSession(customOrigin)}
                    sx={{ textTransform: 'none', fontWeight: 600, flexShrink: 0 }}
                  >
                    URL anwenden
                  </Button>
                </Stack>
              )}
            </Stack>
          )}
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 2.5 }}>
        <Button
          onClick={onClose}
          variant="contained"
          sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '8px' }}
        >
          Fertig
        </Button>
      </DialogActions>
    </Dialog>
  );
}
