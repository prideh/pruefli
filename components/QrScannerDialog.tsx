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
} from '@mui/material';
import QrCodeScannerIcon from '@mui/icons-material/QrCodeScanner';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import CheckIcon from '@mui/icons-material/Check';
import RefreshIcon from '@mui/icons-material/Refresh';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { deduplicateRelayFiles } from '@/lib/relay-dedup';

export type QrTargetMode =
  | 'SUBMISSION'
  | 'RUBRIC'
  | 'EXAM_TEMPLATE'
  | 'REPLACE_SUBMISSION'
  | 'APPEND_SUBMISSION';

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

  const lastHandledDocIdRef = useRef<string | null>(null);
  const pcFileInputRef = useRef<HTMLInputElement | null>(null);

  const generateQrSession = useCallback(
    async (originOverride?: string) => {
      setLoading(true);
      setError('');
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

  // Poll desktop submissions & scanned reference documents while modal is open
  useEffect(() => {
    if (!open || !token) return;

    const interval = setInterval(async () => {
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
    }, 2500);

    return () => clearInterval(interval);
  }, [open, token, targetMode, onRefreshSubmissions, onDocumentScanned]);

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

  const handlePcFilesSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const rawFiles = e.target.files ? Array.from(e.target.files) : [];
    e.target.value = '';
    const files = deduplicateRelayFiles(rawFiles);
    if (files.length === 0 || !token) return;

    setPcUploading(true);
    setError('');
    setPcUploadSuccess('');
    try {
      const formData = new FormData();
      formData.append('token', token);
      formData.append('targetMode', targetMode);
      if (examId) formData.append('examId', examId);
      if (studentId) formData.append('studentId', studentId);
      if (submissionId) formData.append('submissionId', submissionId);
      files.forEach((f) => formData.append('pages', f));

      const res = await fetch('/api/mobile-relay/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Upload fehlgeschlagen.');
      }

      const effectiveCount = typeof data?.pagesCount === 'number' ? data.pagesCount : files.length;
      setPcUploadSuccess(
        studentName
          ? `Arbeit für ${studentName} (${effectiveCount} ${effectiveCount === 1 ? 'Datei' : 'Dateien'}) hochgeladen — KI-Korrektur gestartet!`
          : `${effectiveCount} ${effectiveCount === 1 ? 'Datei' : 'Dateien'} erfolgreich hochgeladen — KI-Korrektur läuft!`
      );
      if (onRefreshSubmissions) {
        onRefreshSubmissions();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Datei-Upload.');
    } finally {
      setPcUploading(false);
    }
  };

  const getModeHeader = () => {
    if (targetMode === 'RUBRIC') {
      return {
        title: 'Musterlösung (Stufe 2) per Smartphone abfotografieren',
        description:
          'Fotografiere deine handschriftliche oder gedruckte Musterlösung (1 oder mehrere Seiten). Sie wird sofort auf den Desktop übertragen und auf Wunsch automatisch in Aufgaben zerlegt.',
        bg: '#eff6ff',
        border: '#bfdbfe',
        color: '#1d4ed8',
      };
    }
    if (targetMode === 'EXAM_TEMPLATE') {
      return {
        title: 'Vorlagenprüfung (Stufe 1) per Smartphone abfotografieren',
        description:
          'Fotografiere das leere Aufgabenblatt (Vorlagenprüfung), damit die KI die exakte Aufgabenstellung und Maximalpunkte kennt.',
        bg: '#f5f3ff',
        border: '#ddd6fe',
        color: '#6d28d9',
      };
    }
    if (targetMode === 'REPLACE_SUBMISSION' || targetMode === 'APPEND_SUBMISSION') {
      return {
        title: `Scan ersetzen oder Seite anhängen${studentName ? `: ${studentName}` : ''}`,
        description:
          'Fotografiere mit dem Smartphone eine fehlende Prüfungsseite zum Anhängen oder ersetze den gesamten Scan dieser Korrektur.',
        bg: '#fff7ed',
        border: '#fed7aa',
        color: '#c2410c',
      };
    }
    if (studentId && studentName) {
      return {
        title: `Schüler-Scan: ${studentName} (${examTitle || 'Prüfung'})`,
        description: `Alle Aufnahmen oder hochgeladenen Dateien werden direkt ${studentName} zugeordnet – ideal auch dann, wenn auf dem Blatt kein Name steht.`,
        bg: '#f0fdf4',
        border: '#bbf7d0',
        color: '#15803d',
      };
    }
    if (examId) {
      return {
        title: `Prüfungs-Modus: ${className || 'Klasse'} · ${examTitle}`,
        description:
          'Alle mit dem Smartphone fotografierten Seiten werden dieser Prüfung zugeordnet. Die KI liest den Schülernamen automatisch ab (oder du wählst ihn direkt auf dem Handy).',
        bg: '#f0f7ff',
        border: '#bae6fd',
        color: '#0369a1',
      };
    }
    return {
      title: 'Universal-Scan-Modus (Automatische KI-Erkennung)',
      description:
        'Fotografiere beliebige Schülerprüfungen oder Musterlösungen mit deinem Smartphone. Die KI erkennt Klasse, Prüfung und Schüler/in automatisch.',
      bg: '#f0fdf4',
      border: '#bbf7d0',
      color: '#15803d',
    };
  };

  const modeHeader = getModeHeader();

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
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
              sx={{ borderRadius: '10px' }}
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={() => generateQrSession()}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  Erneut versuchen
                </Button>
              }
            >
              {error}
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
          {(targetMode === 'SUBMISSION' || targetMode === 'REPLACE_SUBMISSION') && examId && (
            <>
              <Divider sx={{ fontSize: '0.75rem', color: 'text.secondary', fontWeight: 700 }}>
                ODER DIREKT VOM COMPUTER HOCHLADEN
              </Divider>
              <Box
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 2,
                  p: 1.5,
                  borderRadius: '10px',
                  border: '1px solid #cbd5e1',
                  backgroundColor: '#ffffff',
                }}
              >
                <Box>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#0f172a' }}>
                    {studentName
                      ? `Datei(en) für ${studentName} auswählen`
                      : 'PDF oder Bilder direkt vom PC hochladen'}
                  </Typography>
                  <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    Mehrere ausgewählte Bilder werden als mehrseitige Prüfung zusammengefasst.
                  </Typography>
                </Box>
                <input
                  ref={pcFileInputRef}
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  multiple
                  onChange={handlePcFilesSelected}
                  style={{ display: 'none' }}
                />
                <Button
                  variant="outlined"
                  startIcon={pcUploading ? <CircularProgress size={16} /> : <CloudUploadIcon />}
                  disabled={pcUploading || !token}
                  onClick={() => pcFileInputRef.current?.click()}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: '8px',
                    flexShrink: 0,
                  }}
                >
                  {pcUploading ? 'Lädt...' : 'Datei wählen'}
                </Button>
              </Box>
            </>
          )}

          {isDevMode && scanUrl && (
            <Stack spacing={1}>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                Direktlink für Smartphone (gültig für 2 Stunden):
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
                    color={copied ? 'success' : 'primary'}
                    onClick={handleCopyUrl}
                    sx={{ border: '1px solid #cbd5e1', borderRadius: '8px' }}
                  >
                    {copied ? <CheckIcon fontSize="small" /> : <ContentCopyIcon fontSize="small" />}
                  </IconButton>
                </Tooltip>
                <Tooltip title="Neuen QR-Code generieren">
                  <IconButton
                    onClick={() => generateQrSession()}
                    sx={{ border: '1px solid #cbd5e1', borderRadius: '8px' }}
                  >
                    <RefreshIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              </Stack>
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
