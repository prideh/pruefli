'use client';

import React, { useState, useEffect, useMemo } from 'react';
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
  Alert,
  Grid,
  CircularProgress,
} from '@mui/material';
import ContentCutIcon from '@mui/icons-material/ContentCut';
import FlagIcon from '@mui/icons-material/Flag';
import SubdirectoryArrowRightIcon from '@mui/icons-material/SubdirectoryArrowRight';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import {
  computeSegmentsFromStartPages,
  computeEveryNPagesStartPages,
  detectPageOneHeaderStarts,
  toggleStartPageMarker,
  splitPdfFileToFiles,
  rasterizePdfPageToDataUrl,
  type PdfPageInfo,
  type SplitPdfWork,
} from '@/lib/pdf-batch';

export interface PdfBatchSplitDialogProps {
  open: boolean;
  file: File | null;
  pages: PdfPageInfo[];
  onCancel: () => void;
  onConfirmSplit: (result: { files: File[]; works: SplitPdfWork[]; startPages: number[] }) => void;
}

export default function PdfBatchSplitDialog(props: PdfBatchSplitDialogProps) {
  const fileKey = props.file
    ? `${props.file.name}-${props.file.size}-${props.file.lastModified}`
    : 'no-file';
  return <PdfBatchSplitDialogContent key={fileKey} {...props} />;
}

function PdfBatchSplitDialogContent({
  open,
  file,
  pages,
  onCancel,
  onConfirmSplit,
}: PdfBatchSplitDialogProps) {
  const totalPages = pages.length;
  const [startPages, setStartPages] = useState<number[]>([1]);
  const [splitting, setSplitting] = useState(false);
  const [splitError, setSplitError] = useState('');
  const [rasterizedThumbnails, setRasterizedThumbnails] = useState<Record<number, string>>({});

  // Rasterisiere jede PDF-Seite clientseitig als Bild-Data-URL (Canvas PNG / SVG),
  // damit kein Browser-PDF-Plugin-Platzhalter entsteht.
  useEffect(() => {
    if (!open || pages.length === 0) return;
    let cancelled = false;

    void (async () => {
      const nextMap: Record<number, string> = {};
      for (const page of pages) {
        if (cancelled) return;
        const dataUrl = await rasterizePdfPageToDataUrl(page);
        if (!cancelled && dataUrl) {
          nextMap[page.pageNumber] = dataUrl;
        }
      }
      if (!cancelled) {
        setRasterizedThumbnails(nextMap);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, pages]);

  const segments = useMemo(
    () => computeSegmentsFromStartPages(totalPages, startPages),
    [totalPages, startPages]
  );

  const pageToWorkMap = useMemo(() => {
    const map = new Map<
      number,
      {
        workIndex: number;
        isStartPage: boolean;
        startPage: number;
        endPage: number;
        pageCount: number;
      }
    >();
    for (const seg of segments) {
      for (const p of seg.pageNumbers) {
        map.set(p, {
          workIndex: seg.workIndex,
          isStartPage: p === seg.startPage,
          startPage: seg.startPage,
          endPage: seg.endPage,
          pageCount: seg.pageCount,
        });
      }
    }
    return map;
  }, [segments]);

  const handleTogglePage = (pageNumber: number) => {
    if (pageNumber <= 1 || splitting) return;
    setStartPages((prev) => toggleStartPageMarker(totalPages, prev, pageNumber));
  };

  const handleEveryPageNewWork = () => {
    if (splitting) return;
    setStartPages(computeEveryNPagesStartPages(totalPages, 1));
  };

  const handleEveryTwoPagesNewWork = () => {
    if (splitting) return;
    setStartPages(computeEveryNPagesStartPages(totalPages, 2));
  };

  const handleEveryThreePagesNewWork = () => {
    if (splitting) return;
    setStartPages(computeEveryNPagesStartPages(totalPages, 3));
  };

  const handleEveryFourPagesNewWork = () => {
    if (splitting) return;
    setStartPages(computeEveryNPagesStartPages(totalPages, 4));
  };

  const detectedHeaderStarts = useMemo(() => detectPageOneHeaderStarts(pages), [pages]);

  const handleApplyDetectedHeaders = () => {
    if (splitting || detectedHeaderStarts.length <= 1) return;
    setStartPages(detectedHeaderStarts);
  };

  const handleKeepSingleWork = () => {
    if (splitting) return;
    setStartPages([1]);
  };

  const handleConfirm = async () => {
    if (!file || splitting) return;
    setSplitting(true);
    setSplitError('');
    try {
      const { works, files } = await splitPdfFileToFiles(file, startPages);
      onConfirmSplit({ files, works, startPages });
    } catch (err) {
      setSplitError(
        err instanceof Error ? err.message : 'Fehler beim Aufteilen des PDF-Klassensatzes.'
      );
    } finally {
      setSplitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={(_e, reason) => {
        if (splitting || reason === 'backdropClick') return;
        onCancel();
      }}
      maxWidth="lg"
      fullWidth
      data-testid="pdf-batch-split-dialog"
    >
      <DialogTitle sx={{ fontWeight: 800, display: 'flex', alignItems: 'center', gap: 1.5, pb: 1 }}>
        <ContentCutIcon color="primary" />
        PDF-Klassensatz zerlegen: Blattgrenzen markieren (Seitenübersicht)
      </DialogTitle>

      <DialogContent dividers sx={{ backgroundColor: '#f8fafc' }}>
        <Stack spacing={2.5}>
          <Alert
            severity="info"
            sx={{
              borderRadius: '10px',
              backgroundColor: '#eff6ff',
              border: '1px solid #bfdbfe',
              color: '#1e3a8a',
            }}
          >
            <Typography variant="subtitle2" sx={{ fontWeight: 800, mb: 0.5 }}>
              Mehrseitiges PDF erkannt: {file?.name} ({totalPages} Seiten)
            </Typography>
            <Typography variant="body2">
              Klicke in der Seitenübersicht auf jede Seite, auf der die Arbeit einer neuen Schülerin
              oder eines neuen Schülers beginnt. Nicht markierte Folgeseiten bleiben automatisch mit
              der vorangehenden Startseite zu einer mehrseitigen Arbeit gruppiert.
            </Typography>
          </Alert>

          {splitError && (
            <Alert severity="error" sx={{ borderRadius: '10px' }}>
              {splitError}
            </Alert>
          )}

          {/* Schnellwahl & Zusammenfassung der entstehenden Arbeiten */}
          <Box
            sx={{
              p: 2,
              borderRadius: '12px',
              backgroundColor: '#ffffff',
              border: '1px solid #e2e8f0',
            }}
          >
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              sx={{
                justifyContent: 'space-between',
                alignItems: { xs: 'flex-start', md: 'center' },
                mb: 1.5,
              }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a' }}>
                Resultierende Arbeiten ({segments.length}{' '}
                {segments.length === 1 ? 'Arbeit' : 'Arbeiten'} aus {totalPages} Seiten):
              </Typography>

              <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  onClick={handleEveryPageNewWork}
                  disabled={splitting}
                  sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.78rem' }}
                >
                  Jede Seite = 1 Arbeit (1-seitig)
                </Button>
                {totalPages >= 2 && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleEveryTwoPagesNewWork}
                    disabled={splitting}
                    sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.78rem' }}
                  >
                    Alle 2 Seiten = 1 Arbeit (2-seitig)
                  </Button>
                )}
                {totalPages >= 3 && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleEveryThreePagesNewWork}
                    disabled={splitting}
                    sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.78rem' }}
                  >
                    Alle 3 Seiten = 1 Arbeit (3-seitig)
                  </Button>
                )}
                {totalPages >= 4 && (
                  <Button
                    size="small"
                    variant="outlined"
                    onClick={handleEveryFourPagesNewWork}
                    disabled={splitting}
                    sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.78rem' }}
                  >
                    Alle 4 Seiten = 1 Arbeit (4-seitig)
                  </Button>
                )}
                {detectedHeaderStarts.length > 1 && (
                  <Button
                    size="small"
                    variant="outlined"
                    color="secondary"
                    onClick={handleApplyDetectedHeaders}
                    disabled={splitting}
                    sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.78rem' }}
                  >
                    Seitenköpfe («Blatt 1 / Name») übernehmen ({detectedHeaderStarts.length})
                  </Button>
                )}
                <Button
                  size="small"
                  variant="text"
                  onClick={handleKeepSingleWork}
                  disabled={splitting || startPages.length === 1}
                  sx={{ textTransform: 'none', fontWeight: 600, fontSize: '0.78rem' }}
                >
                  Nicht trennen (1 Arbeit)
                </Button>
              </Stack>
            </Stack>

            <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', gap: 1 }}>
              {segments.map((seg) => (
                <Chip
                  key={seg.workIndex}
                  icon={<CheckCircleIcon sx={{ fontSize: '1rem !important' }} />}
                  label={`Arbeit ${seg.workIndex}: ${
                    seg.startPage === seg.endPage
                      ? `Seite ${seg.startPage}`
                      : `Seiten ${seg.startPage}–${seg.endPage}`
                  } (${seg.pageCount} ${seg.pageCount === 1 ? 'Seite' : 'Seiten'})`}
                  color="primary"
                  variant={seg.workIndex % 2 === 1 ? 'filled' : 'outlined'}
                  size="small"
                  sx={{ fontWeight: 700, borderRadius: '6px' }}
                />
              ))}
            </Stack>
          </Box>

          {/* Seitenübersicht (Thumbnails aller Seiten) */}
          <Grid container spacing={2}>
            {pages.map((page) => {
              const info = pageToWorkMap.get(page.pageNumber) || {
                workIndex: 1,
                isStartPage: page.pageNumber === 1,
                startPage: 1,
                endPage: totalPages,
                pageCount: totalPages,
              };
              const isStart = info.isStartPage;
              const isFirstPage = page.pageNumber === 1;
              const previewUrl = rasterizedThumbnails[page.pageNumber] || page.thumbnailDataUrl;

              return (
                <Grid key={page.pageNumber} size={{ xs: 12, sm: 6, md: 4, lg: 3 }}>
                  <Box
                    data-testid={`pdf-page-thumbnail-${page.pageNumber}`}
                    onClick={() => handleTogglePage(page.pageNumber)}
                    sx={{
                      borderRadius: '12px',
                      border: isStart ? '2px solid #1b77d1' : '1px solid #cbd5e1',
                      backgroundColor: '#ffffff',
                      overflow: 'hidden',
                      cursor: isFirstPage ? 'default' : 'pointer',
                      transition: 'all 0.15s ease',
                      boxShadow: isStart
                        ? '0 4px 12px rgba(27, 119, 209, 0.14)'
                        : '0 1px 3px rgba(15, 23, 42, 0.05)',
                      '&:hover': isFirstPage
                        ? {}
                        : {
                            borderColor: '#1b77d1',
                            transform: 'translateY(-2px)',
                          },
                    }}
                  >
                    {/* Kopfzeile der Seitenkarte */}
                    <Stack
                      direction="row"
                      sx={{
                        px: 1.5,
                        py: 1,
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        backgroundColor: isStart ? '#eff6ff' : '#f1f5f9',
                        borderBottom: '1px solid #e2e8f0',
                      }}
                    >
                      <Typography variant="subtitle2" sx={{ fontWeight: 800, color: '#0f172a' }}>
                        Seite {page.pageNumber}
                      </Typography>
                      <Chip
                        icon={
                          isStart ? (
                            <FlagIcon sx={{ fontSize: '0.85rem !important' }} />
                          ) : (
                            <SubdirectoryArrowRightIcon sx={{ fontSize: '0.85rem !important' }} />
                          )
                        }
                        label={
                          isStart
                            ? `Start Arbeit ${info.workIndex}`
                            : `Zu Arbeit ${info.workIndex} (S. ${info.startPage}–${info.endPage})`
                        }
                        size="small"
                        color={isStart ? 'primary' : 'default'}
                        sx={{
                          fontWeight: 700,
                          fontSize: '0.72rem',
                          height: '22px',
                        }}
                      />
                    </Stack>

                    {/* Visuelle Seiten-Vorschau (Client-seitig gerastertes Bild-Thumbnail ohne PDF-iframe) */}
                    <Box
                      sx={{
                        position: 'relative',
                        height: 240,
                        backgroundColor: '#f8fafc',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        p: 1.25,
                      }}
                    >
                      <Box
                        sx={{
                          width: '100%',
                          height: '100%',
                          backgroundColor: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          position: 'relative',
                          overflow: 'hidden',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          boxShadow: '0 1px 2px rgba(15, 23, 42, 0.06)',
                        }}
                      >
                        <Box
                          component="img"
                          src={previewUrl}
                          alt={
                            page.extractedTextPreview
                              ? `Seiten-Vorschau Seite ${page.pageNumber}: ${page.extractedTextPreview}`
                              : `Seiten-Vorschau Seite ${page.pageNumber}`
                          }
                          data-testid={`pdf-page-thumbnail-img-${page.pageNumber}`}
                          sx={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'contain',
                            display: 'block',
                            userSelect: 'none',
                            pointerEvents: 'none',
                          }}
                        />
                      </Box>
                    </Box>

                    {/* Manuelle Blattgrenzen-Aktion */}
                    <Box sx={{ p: 1.25, borderTop: '1px solid #f1f5f9', textAlign: 'center' }}>
                      {isFirstPage ? (
                        <Button
                          size="small"
                          fullWidth
                          variant="contained"
                          disabled
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            borderRadius: '6px',
                          }}
                        >
                          Startseite Arbeit 1 (Beginn)
                        </Button>
                      ) : (
                        <Button
                          size="small"
                          fullWidth
                          variant={isStart ? 'contained' : 'outlined'}
                          color={isStart ? 'primary' : 'inherit'}
                          onClick={(e) => {
                            e.stopPropagation();
                            handleTogglePage(page.pageNumber);
                          }}
                          sx={{
                            textTransform: 'none',
                            fontWeight: 700,
                            fontSize: '0.78rem',
                            borderRadius: '6px',
                          }}
                        >
                          {isStart
                            ? '★ Startseite (Klicken zum Gruppieren)'
                            : `Neue Arbeit ab Seite ${page.pageNumber}`}
                        </Button>
                      )}
                    </Box>
                  </Box>
                </Grid>
              );
            })}
          </Grid>
        </Stack>
      </DialogContent>

      <DialogActions sx={{ px: 3, py: 2, justifyContent: 'space-between' }}>
        <Button
          onClick={onCancel}
          disabled={splitting}
          sx={{ textTransform: 'none', fontWeight: 650, color: 'text.secondary' }}
        >
          Abbrechen
        </Button>
        <Button
          variant="contained"
          onClick={handleConfirm}
          disabled={splitting || totalPages === 0}
          startIcon={
            splitting ? <CircularProgress size={18} color="inherit" /> : <ContentCutIcon />
          }
          data-testid="pdf-batch-confirm-button"
          sx={{
            textTransform: 'none',
            fontWeight: 700,
            borderRadius: '8px',
            backgroundColor: '#1b77d1',
            px: 2.5,
          }}
        >
          {splitting
            ? 'PDF wird zerlegt...'
            : segments.length === 1
              ? `Als 1 Arbeit übernehmen (Seiten 1–${totalPages})`
              : `In ${segments.length} Arbeiten zerlegen & übernehmen`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
