import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/seo-url';

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = getBaseUrl();
  if (!baseUrl) {
    return [];
  }

  return [
    {
      url: `${baseUrl}/`,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
  ];
}
