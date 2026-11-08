'use client';

import * as React from 'react';
import { Box, CircularProgress } from '@mui/material';
import ExamPrintFeedbackContent from '@/components/ExamPrintFeedbackContent';

export default function ExamPrintFeedbackPage() {
  return (
    <React.Suspense
      fallback={
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 12 }}>
          <CircularProgress size={40} />
        </Box>
      }
    >
      <ExamPrintFeedbackContent />
    </React.Suspense>
  );
}
