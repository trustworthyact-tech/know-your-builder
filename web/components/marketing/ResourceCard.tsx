import Link from 'next/link';
import { TYPE_LABELS, type Resource } from '@/lib/marketing/resources';

export function ResourceCard({ r }: { r: Resource }) {
  return (
    <Link
      href={r.href}
      className="group grid h-full content-start gap-3 rounded-2xl border border-brand-line bg-white p-6 transition-shadow hover:shadow-md focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-navy"
    >
      <span className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-ochre-text">{TYPE_LABELS[r.type]}</span>
      <span className="text-lg font-bold leading-snug text-brand-navy group-hover:underline group-hover:decoration-brand-ochre group-hover:decoration-2 group-hover:underline-offset-4">
        {r.title}
      </span>
      <span className="text-[15px] leading-relaxed text-brand-slate">{r.description}</span>
    </Link>
  );
}
