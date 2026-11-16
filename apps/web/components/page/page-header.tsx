import { ChevronRight } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function PageHeader({ title, description, actions, breadcrumbs }: { title: string; description?: string; actions?: ReactNode; breadcrumbs?: { label: string; href?: string }[] }) {
  return (
    <div className="mb-6">
      {breadcrumbs ? (
        <nav aria-label="Breadcrumb" className="text-helper mb-2 flex items-center gap-1">
          {breadcrumbs.map((b, i) => (
            <span key={b.label} className="flex items-center gap-1">
              {i > 0 ? <ChevronRight className="h-3 w-3" aria-hidden /> : null}
              {b.href ? <Link href={b.href} className="hover:text-foreground">{b.label}</Link> : <span aria-current="page">{b.label}</span>}
            </span>
          ))}
        </nav>
      ) : null}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="text-title">{title}</h1>{description ? <p className="text-helper mt-1 !text-[13px]">{description}</p> : null}</div>
        {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
      </div>
    </div>
  );
}
