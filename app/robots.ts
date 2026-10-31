import type { MetadataRoute } from 'next';
import { getBaseUrl } from '@/lib/seo-url';

export default function robots(): MetadataRoute.Robots {
  const baseUrl = getBaseUrl();

  return {
    rules: [
      {
        userAgent: '*',
        allow: ['/$'],
        disallow: [
          '/dashboard',
          '/dashboard/',
          '/classes',
          '/classes/',
          '/exams',
          '/exams/',
          '/submissions',
          '/submissions/',
          '/correct',
          '/correct/',
          '/logs',
          '/logs/',
          '/students',
          '/students/',
          '/scan',
          '/scan/',
          '/login',
          '/login/',
          '/register',
          '/register/',
          '/api',
          '/api/',
        ],
      },
    ],
    ...(baseUrl ? { sitemap: `${baseUrl}/sitemap.xml` } : {}),
  };
}
