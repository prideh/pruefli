'use client';

import React from 'react';
import { Card, Typography, Button, Box } from '@mui/material';
import ErrorOutlinedIcon from '@mui/icons-material/ErrorOutlined';
import RefreshIcon from '@mui/icons-material/Refresh';
import { resolveErrorStateMessage } from '@/lib/ux-polish';

export interface ErrorStateProps {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
}

export default function ErrorState({
  title = 'Fehler beim Laden',
  message,
  onRetry,
  retryLabel = 'Erneut versuchen',
}: ErrorStateProps) {
  const displayMessage = resolveErrorStateMessage(title, message);

  return (
    <Card
      sx={{
        borderRadius: '16px',
        border: '1px solid #fee2e2',
        backgroundColor: '#fff5f5',
        p: 6,
        textAlign: 'center',
        boxShadow: 'none',
      }}
    >
      <Box sx={{ display: 'flex', justifyContent: 'center', mb: 2 }}>
        <ErrorOutlinedIcon sx={{ fontSize: '3.5rem', color: '#ef4444' }} />
      </Box>
      <Typography variant="h6" sx={{ fontWeight: 700, color: '#991b1b', mb: 1 }}>
        {title}
      </Typography>
      <Typography
        variant="body2"
        sx={{ color: '#b91c1c', maxWidth: '480px', mx: 'auto', mb: onRetry ? 3 : 0 }}
      >
        {displayMessage}
      </Typography>
      {onRetry && (
        <Button
          variant="contained"
          color="error"
          startIcon={<RefreshIcon />}
          onClick={onRetry}
          sx={{ borderRadius: '8px', textTransform: 'none', fontWeight: 650 }}
        >
          {retryLabel}
        </Button>
      )}
    </Card>
  );
}
