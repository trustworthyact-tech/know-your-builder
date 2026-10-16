import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/marketing/site';

// App pages (reports, accounts, auth, live search results) are per-user and
// must not be indexed; marketing pages are.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/account', '/auth/', '/report/', '/search', '/compare'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
