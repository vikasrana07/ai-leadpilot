'use client';

import { summarizeGraph, type AutomationGraph } from '@leadpilot/validation';
import { useMemo } from 'react';
import { useDebounce } from '@/hooks/use-debounce';
import { useTerms } from '@/lib/pack';

/**
 * Plain-English description of the whole automation. It lives in a polite live region, but follows the graph with a delay so a screen reader
 * hears the result of an edit once, not every keystroke.
 */
export function Summary({ graph, valid }: { graph: AutomationGraph; valid: boolean }) {
  const settled = useDebounce(graph, 1200);
  const terms = useTerms();
  const lines = useMemo(() => { if (!valid) return []; try { return summarizeGraph(settled, terms.summary); } catch { return []; } }, [settled, valid, terms]);
  return (
    <section aria-labelledby="summary-h" className="rounded-lg border border-border bg-card p-4">
      <h2 id="summary-h" className="text-heading mb-2">What this automation does</h2>
      <div aria-live="polite" role="status" data-testid="summary">
        {!valid ? <p className="text-helper">Fix the problems listed above to see a plain-English summary.</p> : (
          <ul className="space-y-1 text-[13px]">{lines.map((l, i) => { const indent = (l.match(/^ */) ?? [''])[0].length; return <li key={i} style={{ paddingLeft: `${indent * 8}px` }} className={i === 0 ? 'font-medium' : undefined}>{l.trim().replace(/^- /, '')}</li>; })}</ul>
        )}
      </div>
    </section>
  );
}
