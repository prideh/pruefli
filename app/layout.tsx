import type { Metadata } from 'next';
import ThemeRegistry from '@/lib/ThemeRegistry';
import { buildRootMetadata } from '@/lib/seo-url';
import './globals.css';

export const metadata: Metadata = buildRootMetadata();

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="de">
      <body>
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
