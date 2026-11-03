import type { Metadata } from 'next';
import { getUiEnabledProviders } from '@/lib/oauth';
import { OAuthProvidersProvider } from '@/components/SocialLoginButtons';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  robots: {
    index: false,
    follow: false,
  },
};

export default function RegisterLayout({ children }: { children: React.ReactNode }) {
  const providers = getUiEnabledProviders();
  return <OAuthProvidersProvider providers={providers}>{children}</OAuthProvidersProvider>;
}
