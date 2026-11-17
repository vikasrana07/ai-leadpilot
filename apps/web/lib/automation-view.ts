'use client';

import { useSyncExternalStore } from 'react';

/**
 * Canvas | Outline choice. Remembered in localStorage when it is available; if it is not (private window, blocked storage) the choice still
 * works for the rest of the session. Server and first render say "outline" so hydration agrees.
 */
export type EditorView = 'outline' | 'canvas';
const KEY = 'lp:automation-view';
let current: EditorView | null = null;
let picked = false;
const listeners = new Set<() => void>();

function stored(): EditorView { try { return window.localStorage.getItem(KEY) === 'canvas' ? 'canvas' : 'outline'; } catch { return 'outline'; } }
const snapshot = (): EditorView => current ?? stored();
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

export function chooseView(v: EditorView): void {
  current = v; picked = true;
  try { window.localStorage.setItem(KEY, v); } catch { /* storage unavailable: the choice lasts for this session */ }
  listeners.forEach((l) => l());
}

/** On a phone the remembered choice is ignored until the person picks the canvas themselves (it is view-only there). */
export function useEditorView(desktop: boolean): EditorView {
  const v = useSyncExternalStore(subscribe, snapshot, () => 'outline' as EditorView);
  return v === 'canvas' && (desktop || picked) ? 'canvas' : 'outline';
}
