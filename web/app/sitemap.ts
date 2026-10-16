import type { MetadataRoute } from 'next';
import { SITE_URL, CONTENT_REVIEWED } from '@/lib/marketing/site';
import { STATES } from '@/lib/marketing/states';
import { AUDIENCES } from '@/lib/marketing/audiences';
import { RESOURCES } from '@/lib/marketing/resources';

// Public marketing pages only. /privacy is omitted while it's a draft
// (noindex) — add it back when the policy is finalised.
export default function sitemap(): MetadataRoute.Sitemap {
  const page = (path: string, priority: number, lastModified = CONTENT_REVIEWED) => ({
    url: `${SITE_URL}${path}`,
    lastModified,
    priority,
  });

  return [
    page('/', 1),
    page('/check', 0.9),
    page('/check-builder-licence', 0.9),
    ...STATES.map((s) => page(`/check-builder-licence/${s.slug}`, s.covered ? 0.9 : 0.7)),
    page('/how-it-works', 0.7),
    page('/sample-report', 0.7),
    ...AUDIENCES.map((a) => page(`/for/${a.slug}`, 0.7)),
    page('/resources', 0.6),
    ...RESOURCES.map((r) => page(r.href, 0.6, r.published)),
    page('/fundsight', 0.4),
    page('/retention-trust', 0.4),
    page('/about', 0.4),
    page('/terms', 0.2),
  ];
}
