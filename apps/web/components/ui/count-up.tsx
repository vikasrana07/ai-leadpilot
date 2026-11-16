'use client';

import { animate, useReducedMotion } from 'motion/react';
import { useEffect, useState } from 'react';

/** Counts up to `value`. With reduced motion the final value is shown immediately (no animation, no effect-driven state). */
export function CountUp({ value, duration = 0.8, format = (n: number) => Math.round(n).toLocaleString('en-IN') }: { value: number; duration?: number; format?: (n: number) => string }) {
  const reduce = useReducedMotion();
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (reduce) return;
    const controls = animate(0, value, { duration, ease: [0.2, 0, 0, 1], onUpdate: setShown });
    return () => controls.stop();
  }, [value, duration, reduce]);
  return <span className="num">{format(reduce ? value : shown)}</span>;
}
