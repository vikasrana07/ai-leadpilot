import { Skeleton } from '@/components/ui/skeleton';

export default function InvoiceLoading() {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading invoice"
      className="min-h-dvh bg-neutral-100 p-4"
    >
      <span className="sr-only">Loading invoice...</span>
      <div className="mx-auto mb-3 flex max-w-3xl justify-end">
        <Skeleton className="h-9 w-36 rounded-md" />
      </div>
      <article className="mx-auto max-w-3xl rounded-lg bg-white p-8 shadow-sm space-y-6">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-neutral-200 pb-4">
          <div className="space-y-1">
            <Skeleton className="h-6 w-32" />
            <Skeleton className="h-3.5 w-40" />
          </div>
          <div className="space-y-1 text-right">
            <Skeleton className="h-4 w-36 ml-auto" />
            <Skeleton className="h-3.5 w-24 ml-auto" />
          </div>
        </header>

        <section className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-3.5 w-48" />
            <Skeleton className="h-3 w-56" />
          </div>
        </section>

        <div className="space-y-3 border-y border-neutral-200 py-4">
          <div className="flex justify-between">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>

        <div className="ml-auto w-full max-w-xs space-y-2">
          <div className="flex justify-between">
            <Skeleton className="h-3.5 w-24" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex justify-between">
            <Skeleton className="h-3.5 w-20" />
            <Skeleton className="h-3.5 w-16" />
          </div>
          <div className="flex justify-between border-t border-neutral-300 pt-2">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-5 w-24" />
          </div>
        </div>
      </article>
    </div>
  );
}
