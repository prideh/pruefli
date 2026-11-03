'use client';

import * as React from 'react';
import { useState, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  Box,
  Drawer,
  AppBar,
  Toolbar,
  List,
  Typography,
  Divider,
  IconButton,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Avatar,
  Stack,
  CircularProgress,
  Button,
  Alert,
} from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';
import SchoolIcon from '@mui/icons-material/School';
import DashboardIcon from '@mui/icons-material/Dashboard';
import GroupIcon from '@mui/icons-material/Group';
import AssignmentIcon from '@mui/icons-material/Assignment';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import HistoryIcon from '@mui/icons-material/History';
import LogoutIcon from '@mui/icons-material/Logout';
import MarkEmailUnreadIcon from '@mui/icons-material/MarkEmailUnread';
import {
  getCachedTeacher,
  setCachedTeacher,
  clearSessionCache,
  buildLoginRedirectUrl,
  type SessionLifecycleMetadata,
} from '@/lib/sessionCache';

const drawerWidth = 260;

interface DashboardLayoutProps {
  children: React.ReactNode;
}

export default function DashboardLayout({ children }: DashboardLayoutProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [teacher, setTeacher] = useState<{
    name: string;
    email: string;
    isEmailVerified?: boolean;
    emailVerificationRequired?: boolean;
    isGrandfathered?: boolean;
    liveSendingEnabled?: boolean;
    session?: SessionLifecycleMetadata | null;
  } | null>(getCachedTeacher());
  const [loading, setLoading] = useState(!getCachedTeacher());
  const [authError, setAuthError] = useState<string | null>(null);
  const [verificationDismissed, setVerificationDismissed] = useState(false);
  const [expiryWarningDismissed, setExpiryWarningDismissed] = useState(false);
  const [resendingVerification, setResendingVerification] = useState(false);
  const [resendNotification, setResendNotification] = useState<string | null>(null);
  const [resendSeverity, setResendSeverity] = useState<'info' | 'success' | 'warning' | 'error'>(
    'info'
  );

  const handleResendVerification = async () => {
    setResendingVerification(true);
    setResendNotification(null);
    try {
      const res = await fetch('/api/auth/resend-verification', {
        method: 'POST',
      });
      const data = await res.json();
      if (!res.ok) {
        setResendSeverity('error');
        setResendNotification(data.error || data.message || 'Fehler beim Senden.');
      } else if (
        data.liveSendingEnabled === false ||
        data.simulated === true ||
        data.sent === false
      ) {
        setResendSeverity('warning');
        setResendNotification(
          data.message ||
            'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine Bestätigungs-E-Mail versendet.'
        );
        setTeacher((prev) => (prev ? { ...prev, liveSendingEnabled: false } : prev));
      } else if (data.success) {
        setResendSeverity('success');
        setResendNotification(data.message || 'Bestätigungs-Link wurde erfolgreich gesendet.');
      } else {
        setResendSeverity('error');
        setResendNotification(data.error || data.message || 'Fehler beim Senden.');
      }
    } catch {
      setResendSeverity('error');
      setResendNotification('Fehler beim Senden der Bestätigungs-Mail.');
    } finally {
      setResendingVerification(false);
    }
  };

  // Proactively check auth and fetch profile with resilience against cold-starts and network glitches
  useEffect(() => {
    let isMounted = true;

    async function checkAuth() {
      const maxRetries = 2;
      let attempt = 0;

      while (isMounted) {
        try {
          const res = await fetch('/api/auth/me');

          if (res.ok) {
            const data = await res.json();
            if (isMounted) {
              const teacherData = data.teacher
                ? {
                    ...data.teacher,
                    isEmailVerified:
                      typeof data.isEmailVerified === 'boolean'
                        ? data.isEmailVerified
                        : data.teacher.isEmailVerified,
                    emailVerificationRequired:
                      typeof data.emailVerificationRequired === 'boolean'
                        ? data.emailVerificationRequired
                        : data.teacher.emailVerificationRequired,
                    isGrandfathered:
                      typeof data.isGrandfathered === 'boolean'
                        ? data.isGrandfathered
                        : data.teacher.isGrandfathered,
                    liveSendingEnabled:
                      typeof data.liveSendingEnabled === 'boolean'
                        ? data.liveSendingEnabled
                        : data.teacher.liveSendingEnabled,
                    session: data.session ?? data.teacher.session ?? null,
                  }
                : null;
              setTeacher(teacherData);
              setCachedTeacher(teacherData);
              setAuthError(null);
              setLoading(false);
            }
            return;
          }

          if (res.status === 401) {
            // If 401, retry once after a short delay in case of transient cookie race on fresh login
            if (attempt < 1) {
              attempt++;
              await new Promise((resolve) => setTimeout(resolve, 300));
              continue;
            }

            if (isMounted) {
              clearSessionCache();
              const currentPath =
                typeof window !== 'undefined'
                  ? `${window.location.pathname}${window.location.search || ''}`
                  : '/dashboard';
              router.replace(buildLoginRedirectUrl(currentPath));
            }
            return;
          }

          // Transient server error (5xx, 429, etc.)
          if (attempt < maxRetries) {
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
            continue;
          }

          // If all retries failed with 5xx
          if (isMounted) {
            if (getCachedTeacher()) {
              setLoading(false);
              return;
            }
            setAuthError('Die Verbindung zum Server konnte nicht hergestellt werden.');
            setLoading(false);
          }
          return;
        } catch (err) {
          console.error('Failed to authenticate (transient network error):', err);
          if (attempt < maxRetries) {
            attempt++;
            await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
            continue;
          }

          if (isMounted) {
            if (getCachedTeacher()) {
              setLoading(false);
              return;
            }
            setAuthError('Netzwerkfehler beim Laden der Sitzung.');
            setLoading(false);
          }
          return;
        }
      }
    }

    checkAuth();

    return () => {
      isMounted = false;
    };
  }, [router]);

  // Auto-dismiss any active dropdown/menu/popover when scrolling the page
  useEffect(() => {
    const handleScroll = (event: Event) => {
      const target = event.target as HTMLElement | null;
      // Do not close if scrolling inside the dropdown list, popover, or modal dialog itself
      if (
        target &&
        (target.closest?.('.MuiMenu-list') ||
          target.closest?.('.MuiPopover-root') ||
          target.closest?.('.MuiDialog-root') ||
          target.closest?.('.MuiAutocomplete-popper'))
      ) {
        return;
      }

      // Only dismiss when an actual select menu or autocomplete popper is open
      const openMenu = document.querySelector('.MuiMenu-list, .MuiAutocomplete-popper');
      if (!openMenu) {
        return;
      }

      // Close any active select dropdown/menu/popover
      const activeElement = document.activeElement as HTMLElement;
      if (activeElement && activeElement !== document.body) {
        const escEvent = new KeyboardEvent('keydown', {
          key: 'Escape',
          code: 'Escape',
          keyCode: 27,
          which: 27,
          bubbles: true,
          cancelable: true,
        });
        activeElement.dispatchEvent(escEvent);
        document.dispatchEvent(escEvent);
        activeElement.blur();
      }
    };

    window.addEventListener('scroll', handleScroll, true);
    return () => {
      window.removeEventListener('scroll', handleScroll, true);
    };
  }, []);

  const handleDrawerToggle = () => {
    setMobileOpen(!mobileOpen);
  };

  const handleLogout = async () => {
    try {
      const res = await fetch('/api/auth/logout', { method: 'POST' });
      if (res.ok) {
        clearSessionCache();
        router.push('/');
      }
    } catch (err) {
      console.error('Logout failed:', err);
    }
  };

  const menuItems = [
    { text: 'Übersicht', icon: <DashboardIcon />, path: '/dashboard' },
    { text: 'Klassen', icon: <GroupIcon />, path: '/classes' },
    { text: 'Prüfungen', icon: <AssignmentIcon />, path: '/exams' },
    { text: 'Fächer', icon: <MenuBookIcon />, path: '/subjects' },
    { text: 'Korrekturen', icon: <HistoryIcon />, path: '/submissions' },
  ];

  const drawerContent = (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        backgroundColor: '#ffffff',
        borderRight: '1px solid #e2e8f0',
      }}
    >
      {/* Brand Header */}
      <Box sx={{ p: '24px 20px', display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box
          sx={{
            width: '36px',
            height: '36px',
            borderRadius: '10px',
            backgroundColor: '#1b77d1',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 10px rgba(27, 119, 209, 0.25)',
          }}
        >
          <SchoolIcon sx={{ color: 'white', fontSize: '1.2rem' }} />
        </Box>
        <Typography
          variant="h6"
          sx={{
            fontWeight: 850,
            letterSpacing: '-0.03em',
            color: '#0f172a',
          }}
        >
          prüefli
        </Typography>
      </Box>

      <Divider sx={{ borderColor: '#f1f5f9' }} />

      {/* Nav Menu Items */}
      <List sx={{ px: 1.5, py: 2, flexGrow: 1 }}>
        {menuItems.map((item) => {
          // Check active state
          const isActive =
            pathname === item.path ||
            (item.path !== '/dashboard' && pathname.startsWith(item.path));

          return (
            <ListItem key={item.text} disablePadding sx={{ mb: 0.5 }}>
              <Link href={item.path} passHref style={{ textDecoration: 'none', width: '100%' }}>
                <ListItemButton
                  sx={{
                    borderRadius: '8px',
                    p: '10px 16px',
                    backgroundColor: isActive ? '#f0f7ff' : 'transparent',
                    color: isActive ? '#1b77d1' : '#475569',
                    transition: 'all 0.2s ease',
                    '&:hover': {
                      backgroundColor: isActive ? '#f0f7ff' : '#f8fafc',
                      color: isActive ? '#1b77d1' : '#0f172a',
                      '& .MuiListItemIcon-root': {
                        color: isActive ? '#1b77d1' : '#0f172a',
                      },
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: '36px',
                      color: isActive ? '#1b77d1' : '#64748b',
                      transition: 'color 0.2s ease',
                    }}
                  >
                    {item.icon}
                  </ListItemIcon>
                  <ListItemText>
                    <Typography
                      sx={{
                        fontSize: '0.925rem',
                        fontWeight: isActive ? 700 : 550,
                        letterSpacing: '-0.01em',
                      }}
                    >
                      {item.text}
                    </Typography>
                  </ListItemText>
                </ListItemButton>
              </Link>
            </ListItem>
          );
        })}
      </List>

      <Divider sx={{ borderColor: '#f1f5f9' }} />

      {/* Teacher Profile Info & Logout */}
      <Box sx={{ p: 2 }}>
        {teacher ? (
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', p: 1 }}>
              <Avatar
                sx={{
                  width: '38px',
                  height: '38px',
                  bgcolor: '#1b77d1',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '0.95rem',
                }}
              >
                {teacher.name.charAt(0)}
              </Avatar>
              <Box sx={{ overflow: 'hidden' }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 700, color: '#0f172a' }}>
                  {teacher.name}
                </Typography>
                <Typography
                  variant="caption"
                  noWrap
                  sx={{ color: 'text.secondary', display: 'block' }}
                >
                  {teacher.email}
                </Typography>
              </Box>
            </Stack>

            <Button
              onClick={handleLogout}
              variant="outlined"
              fullWidth
              startIcon={<LogoutIcon />}
              sx={{
                borderRadius: '8px',
                p: '8px 16px',
                borderColor: '#e2e8f0',
                color: '#475569',
                textTransform: 'none',
                fontWeight: 650,
                fontSize: '0.85rem',
                '&:hover': {
                  borderColor: 'error.light',
                  color: 'error.main',
                  backgroundColor: '#fef2f2',
                },
              }}
            >
              Abmelden
            </Button>
          </Stack>
        ) : (
          <CircularProgress size={20} />
        )}
      </Box>
    </Box>
  );

  if (loading) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '16px',
        }}
      >
        <CircularProgress size={40} thickness={4} sx={{ color: 'primary.main' }} />
        <Typography variant="body2" sx={{ color: 'text.secondary', fontWeight: 600 }}>
          Sitzung wird geladen...
        </Typography>
      </Box>
    );
  }

  if (authError && !teacher) {
    return (
      <Box
        sx={{
          minHeight: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <Box
          sx={{
            maxWidth: 420,
            width: '100%',
            p: 4,
            textAlign: 'center',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e2e8f0',
          }}
        >
          <Typography variant="h6" sx={{ fontWeight: 800, mb: 1, color: '#0f172a' }}>
            Verbindungsfehler
          </Typography>
          <Typography variant="body2" sx={{ color: 'text.secondary', mb: 3 }}>
            {authError}
          </Typography>
          <Stack spacing={1.5}>
            <Button
              variant="contained"
              onClick={() => {
                setLoading(true);
                setAuthError(null);
                window.location.reload();
              }}
              sx={{
                backgroundColor: '#1b77d1',
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: '8px',
                p: '10px 16px',
              }}
            >
              Erneut versuchen
            </Button>
            <Button
              variant="text"
              onClick={() => {
                clearSessionCache();
                router.replace('/login');
              }}
              sx={{ color: '#64748b', textTransform: 'none', fontWeight: 600 }}
            >
              Zurück zur Anmeldung
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

  if (teacher && teacher.isEmailVerified === false && teacher.emailVerificationRequired) {
    return (
      <Box
        data-testid="email-verification-gate"
        sx={{
          minHeight: '100vh',
          background: 'linear-gradient(135deg, #f1f5f9 0%, #e2e8f0 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          p: 3,
        }}
      >
        <Stack
          direction="row"
          spacing={1.5}
          sx={{ justifyContent: 'center', alignItems: 'center', mb: 4 }}
        >
          <Box
            sx={{
              width: '40px',
              height: '40px',
              borderRadius: '10px',
              backgroundColor: '#1b77d1',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 10px rgba(27, 119, 209, 0.3)',
            }}
          >
            <SchoolIcon sx={{ color: 'white', fontSize: '1.4rem' }} />
          </Box>
          <Typography
            variant="h4"
            component="span"
            sx={{ fontWeight: 900, letterSpacing: '-0.03em', color: '#0f172a' }}
          >
            prüefli
          </Typography>
        </Stack>

        <Box
          sx={{
            maxWidth: 500,
            width: '100%',
            p: { xs: 3, sm: 5 },
            textAlign: 'center',
            borderRadius: '16px',
            backgroundColor: '#ffffff',
            boxShadow: '0 10px 25px -5px rgba(0, 0, 0, 0.05), 0 8px 10px -6px rgba(0, 0, 0, 0.05)',
            border: '1px solid #e2e8f0',
          }}
        >
          <Box
            sx={{
              width: 64,
              height: 64,
              borderRadius: '50%',
              backgroundColor: '#eff6ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              mx: 'auto',
              mb: 2.5,
            }}
          >
            <MarkEmailUnreadIcon sx={{ fontSize: '2rem', color: '#1b77d1' }} />
          </Box>

          <Typography variant="h5" sx={{ fontWeight: 800, mb: 1.5, color: '#0f172a' }}>
            E-Mail bestätigen
          </Typography>

          <Typography variant="body1" sx={{ color: '#475569', mb: 3, lineHeight: 1.6 }}>
            Wir haben eine Bestätigungs-E-Mail an <strong>{teacher.email}</strong> gesendet. Bitte
            klicke auf den Bestätigungslink in der E-Mail, um dein prüefli-Konto vollständig
            freizuschalten.
          </Typography>

          {resendNotification && (
            <Alert
              severity={resendSeverity}
              sx={{ mb: 3, borderRadius: '10px', textAlign: 'left' }}
            >
              {resendNotification}
            </Alert>
          )}

          <Stack spacing={1.5}>
            <Button
              variant="contained"
              fullWidth
              onClick={handleResendVerification}
              disabled={resendingVerification}
              sx={{
                backgroundColor: '#1b77d1',
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: '10px',
                p: '12px 16px',
                fontSize: '0.95rem',
                '&:hover': { backgroundColor: '#1565c0' },
              }}
            >
              {resendingVerification ? 'Wird gesendet...' : 'Bestätigung erneut senden'}
            </Button>

            <Button
              variant="outlined"
              fullWidth
              onClick={handleLogout}
              startIcon={<LogoutIcon />}
              sx={{
                borderRadius: '10px',
                p: '10px 16px',
                borderColor: '#e2e8f0',
                color: '#475569',
                textTransform: 'none',
                fontWeight: 650,
                fontSize: '0.9rem',
                '&:hover': {
                  borderColor: 'error.light',
                  color: 'error.main',
                  backgroundColor: '#fef2f2',
                },
              }}
            >
              Abmelden
            </Button>
          </Stack>
        </Box>
      </Box>
    );
  }

  return (
    <Box
      sx={{
        display: 'flex',
        minHeight: '100vh',
        width: '100%',
        maxWidth: '100vw',
        overflowX: 'hidden',
        backgroundColor: '#f8fafc',
      }}
    >
      {/* AppBar for mobile displays */}
      <AppBar
        position="fixed"
        elevation={0}
        sx={{
          width: { md: `calc(100% - ${drawerWidth}px)` },
          ml: { md: `${drawerWidth}px` },
          backgroundColor: '#ffffff',
          borderBottom: '1px solid #e2e8f0',
          display: { md: 'none' },
        }}
      >
        <Toolbar sx={{ justifyContent: 'space-between' }}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center' }}>
            <Box
              sx={{
                width: '30px',
                height: '30px',
                borderRadius: '8px',
                backgroundColor: '#1b77d1',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <SchoolIcon sx={{ color: 'white', fontSize: '0.9rem' }} />
            </Box>
            <Typography
              variant="h6"
              component="span"
              sx={{ fontWeight: 800, color: '#0f172a', fontSize: '1.1rem' }}
            >
              prüefli
            </Typography>
          </Stack>
          <IconButton
            color="inherit"
            aria-label="open drawer"
            edge="start"
            onClick={handleDrawerToggle}
            sx={{ color: '#0f172a' }}
          >
            <MenuIcon />
          </IconButton>
        </Toolbar>
      </AppBar>

      {/* Sidebar Drawer Container */}
      <Box
        component="nav"
        sx={{ width: { md: drawerWidth }, flexShrink: { md: 0 } }}
        aria-label="mailbox folders"
      >
        {/* Mobile side navigation drawer */}
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={handleDrawerToggle}
          ModalProps={{
            keepMounted: true, // Better open performance on mobile.
          }}
          sx={{
            display: { xs: 'block', sm: 'block', md: 'none' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
        >
          {drawerContent}
        </Drawer>

        {/* Desktop side navigation drawer */}
        <Drawer
          variant="permanent"
          sx={{
            display: { xs: 'none', sm: 'none', md: 'block' },
            '& .MuiDrawer-paper': { boxSizing: 'border-box', width: drawerWidth },
          }}
          open
        >
          {drawerContent}
        </Drawer>
      </Box>

      {/* Main content viewport */}
      <Box
        component="main"
        sx={{
          flexGrow: 1,
          minWidth: 0,
          p: { xs: 2, sm: 3, md: 4 },
          width: { xs: '100%', md: `calc(100% - ${drawerWidth}px)` },
          maxWidth: '100%',
          boxSizing: 'border-box',
          mt: { xs: 7, md: 0 },
        }}
      >
        {teacher?.session?.expiringSoon && !expiryWarningDismissed && (
          <Alert
            severity="warning"
            sx={{ mb: 3, borderRadius: '10px' }}
            action={
              <Button
                color="inherit"
                size="small"
                onClick={async () => {
                  try {
                    await fetch('/api/auth/logout', { method: 'POST' });
                  } catch {
                    // Proceed to login even if logout request fails
                  }
                  clearSessionCache();
                  router.push(buildLoginRedirectUrl(pathname));
                }}
                sx={{ textTransform: 'none', fontWeight: 700 }}
              >
                Jetzt neu anmelden
              </Button>
            }
            onClose={() => setExpiryWarningDismissed(true)}
          >
            Deine Sitzung läuft in Kürze ab. Bitte melde dich rechtzeitig neu an, damit deine Arbeit
            nicht unterbrochen wird.
          </Alert>
        )}
        {teacher && teacher.isEmailVerified === false && !verificationDismissed && (
          <Alert
            severity={
              resendNotification
                ? resendSeverity
                : teacher.liveSendingEnabled === false
                  ? 'warning'
                  : 'info'
            }
            sx={{ mb: 3, borderRadius: '10px' }}
            action={
              teacher.liveSendingEnabled !== false ? (
                <Button
                  color="inherit"
                  size="small"
                  onClick={handleResendVerification}
                  disabled={resendingVerification}
                  sx={{ textTransform: 'none', fontWeight: 700 }}
                >
                  {resendingVerification ? 'Wird gesendet...' : 'Bestätigung erneut senden'}
                </Button>
              ) : undefined
            }
            onClose={() => setVerificationDismissed(true)}
          >
            {resendNotification ||
              (teacher.liveSendingEnabled === false
                ? 'Der E-Mail-Versand ist derzeit nicht aktiv. Es wurde keine Bestätigungs-E-Mail versendet — du kannst dein prüefli-Konto dennoch ohne Einschränkung nutzen.'
                : `Bitte bestätige deine E-Mail-Adresse (${teacher.email}), um dein prüefli-Konto vollständig zu aktivieren.`)}
          </Alert>
        )}
        {children}
      </Box>
    </Box>
  );
}
