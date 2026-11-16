'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

/** Smooth area sparkline. `tone` picks the semantic colour token, so it follows light/dark automatically. */
export function Sparkline({ data, tone = 'success', width = 120, height = 48 }: { data: number[]; tone?: 'success' | 'danger' | 'primary'; width?: number; height?: number }) {
  const id = useId();
  if (data.length < 2) return null;
  const min = Math.min(...data), max = Math.max(...data), span = max - min || 1;
  const pts = data.map((v, i) => [(i / (data.length - 1)) * width, height - 4 - ((v - min) / span) * (height - 10)] as const);
  const d = pts.reduce((acc, [x, y], i, a) => {
    if (i === 0) return `M${x},${y}`;
    const [px, py] = a[i - 1]!;
    const cx = (px + x) / 2;
    return `${acc} C${cx},${py} ${cx},${y} ${x},${y}`;
  }, '');
  const color = `var(--${tone})`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden>
      <defs><linearGradient id={id} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity="0.22" /><stop offset="100%" stopColor={color} stopOpacity="0" /></linearGradient></defs>
      <path d={`${d} L${width},${height} L0,${height} Z`} fill={`url(#${id})`} />
      <motion.path d={d} fill="none" stroke={color} strokeWidth="1.75" strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: [0.2, 0, 0, 1] }} />
    </svg>
  );
}
