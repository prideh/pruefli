/**
 * Returns the fully qualified public base URL of the application.
 * Falls back to localhost in development and https://pruefli.ch in production.
 */
export function getAppUrl(): string {
  const envUrl = process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL;
  if (envUrl && typeof envUrl === 'string' && envUrl.trim().length > 0) {
    return envUrl.trim().replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return 'https://pruefli.ch';
  }
  return 'http://localhost:3000';
}
