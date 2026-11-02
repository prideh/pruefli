'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { Box, Button, Stack, Divider, Typography } from '@mui/material';

interface SocialLoginButtonsProps {
  labelPrefix?: 'anmelden' | 'registrieren';
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
      />
    </svg>
  );
}

function MicrosoftIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 21 21" aria-hidden="true">
      <rect x="1" y="1" width="9" height="9" fill="#f25022" />
      <rect x="11" y="1" width="9" height="9" fill="#7fba00" />
      <rect x="1" y="11" width="9" height="9" fill="#00a4ef" />
      <rect x="11" y="11" width="9" height="9" fill="#ffb900" />
    </svg>
  );
}

export default function SocialLoginButtons({ labelPrefix = 'anmelden' }: SocialLoginButtonsProps) {
  const [providers, setProviders] = useState<{ google: boolean; microsoft: boolean } | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/auth/oauth/providers', { signal: controller.signal })
      .then((res) => {
        if (res.ok) {
          return res.json();
        }
        return { providers: { google: false, microsoft: false } };
      })
      .then((data) => {
        const activeProviders = data.ui || data.providers || { google: false, microsoft: false };
        setProviders(activeProviders);
      })
      .catch(() => {
        setProviders({ google: false, microsoft: false });
      });

    return () => {
      controller.abort();
    };
  }, []);

  // While loading or if no providers are enabled for the UI, render nothing
  if (!providers || (!providers.google && !providers.microsoft)) {
    return null;
  }

  const actionText = labelPrefix === 'registrieren' ? 'registrieren' : 'anmelden';

  return (
    <Box sx={{ mt: 3, mb: 1, width: '100%' }}>
      <Divider sx={{ mb: 2.5 }}>
        <Typography
          variant="caption"
          sx={{ color: '#94a3b8', fontWeight: 600, textTransform: 'uppercase' }}
        >
          ODER
        </Typography>
      </Divider>

      <Stack spacing={1.5}>
        {/* Reihenfolge: Zuerst Google */}
        {providers.google && (
          <Button
            component="a"
            href="/api/auth/oauth/google"
            variant="outlined"
            fullWidth
            startIcon={<GoogleIcon />}
            sx={{
              padding: '10px 16px',
              borderRadius: '10px',
              fontSize: '0.925rem',
              fontWeight: 650,
              textTransform: 'none',
              borderColor: '#e2e8f0',
              backgroundColor: '#ffffff',
              color: '#1e293b',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              '&:hover': {
                borderColor: '#cbd5e1',
                backgroundColor: '#f8fafc',
              },
            }}
          >
            Mit Google {actionText}
          </Button>
        )}

        {/* Reihenfolge: Dann Microsoft */}
        {providers.microsoft && (
          <Button
            component="a"
            href="/api/auth/oauth/microsoft"
            variant="outlined"
            fullWidth
            startIcon={<MicrosoftIcon />}
            sx={{
              padding: '10px 16px',
              borderRadius: '10px',
              fontSize: '0.925rem',
              fontWeight: 650,
              textTransform: 'none',
              borderColor: '#e2e8f0',
              backgroundColor: '#ffffff',
              color: '#1e293b',
              boxShadow: '0 1px 2px rgba(0, 0, 0, 0.05)',
              '&:hover': {
                borderColor: '#cbd5e1',
                backgroundColor: '#f8fafc',
              },
            }}
          >
            Mit Microsoft {actionText}
          </Button>
        )}
      </Stack>
    </Box>
  );
}
