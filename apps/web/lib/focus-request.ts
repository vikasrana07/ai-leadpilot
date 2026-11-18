/**
 * Moving focus to a step after an edit (add, delete, move, connect).
 *
 * Why this exists: after an edit the editor asks for focus on a step, and a menu that just closed may hand focus back to its own trigger
 * a moment later. So the request is applied at once and checked again shortly afterwards. The second, late check must ONLY undo that menu
 * hand-back. If it also fought any other focus change it would be a stale request taking focus away from something the user chose in the
 * meantime (for example opening a step's settings with Enter), and a keyboard or screen-reader user would lose their place.
 *
 * Kept free of React and the DOM so the rules are unit-tested.
 */
export interface FocusSnapshot {
  /** document.body or null: nothing in particular has focus. */
  isBodyOrNone: boolean;
  /** The element that has focus is the step the request is for. */
  isTarget: boolean;
  /** The element that has focus is the trigger of a menu (a button that opens a menu). */
  isMenuTrigger: boolean;
  /** The element that has focus is the one that had focus when the request was made (the button the user pressed, still on screen). */
  isOrigin: boolean;
}

/**
 * The one rule: a request may move focus only if the user has NOT moved it since the request was made. Focus is then either where it
 * was when the request was made (the pressed button, still mounted), on the page (the pressed element was removed), or on a menu trigger
 * (a menu that just closed handed focus back to it). Anywhere else the user has chosen a new place on purpose (they opened a step's
 * settings, focused another button...) and the request is stale: it must not take focus away.
 */
function userHasNotMovedFocus(active: FocusSnapshot): boolean {
  return active.isOrigin || active.isBodyOrNone || active.isMenuTrigger;
}

/** First attempt, right after the render that added the step. */
export function shouldApplyFocus(active: FocusSnapshot): boolean {
  return !active.isTarget && userHasNotMovedFocus(active);
}

/** Late check, after a closing menu has had its turn. Same rule: it only undoes the menu's hand-back, never a choice of the user. */
export function shouldCorrectFocus(active: FocusSnapshot): boolean {
  return !active.isTarget && userHasNotMovedFocus(active);
}

/** Reads the facts the rules above need from the live document. `origin` is the element that had focus when the request was made. */
export function snapshotFocus(target: Element | null, origin: Element | null = null): FocusSnapshot {
  const el = typeof document === 'undefined' ? null : document.activeElement;
  return {
    isBodyOrNone: !el || el === document.body,
    isTarget: !!el && el === target,
    isMenuTrigger: !!el && el.closest('[aria-haspopup="menu"]') !== null,
    isOrigin: !!el && !!origin && el === origin && el !== document.body,
  };
}

export interface FocusTimers { setTimeout: (fn: () => void, ms: number) => number; clearTimeout: (id: number) => void }
export interface StepFocusOptions {
  /** Looks the step element up again each time (it may not exist yet at the first call). */
  find: () => HTMLElement | null;
  /** Facts about the current focus for a target. */
  snapshot: (target: Element | null) => FocusSnapshot;
  focus: (el: HTMLElement) => void;
  /** Called once, after the late check: the request is finished and the editor may forget it. */
  done: () => void;
  timers: FocusTimers;
  /** First attempt (right after the render) and the late check (after a closing menu has had its turn). */
  firstMs: number;
  lateMs: number;
}

/**
 * Applies one focus request in two steps and returns a function that cancels it. The caller cancels it whenever a newer request or the
 * component's unmount arrives, so a request can never outlive the screen state it was made for.
 */
export function scheduleStepFocus(o: StepFocusOptions): () => void {
  const t1 = o.timers.setTimeout(() => { const el = o.find(); if (el && shouldApplyFocus(o.snapshot(el))) o.focus(el); }, o.firstMs);
  const t2 = o.timers.setTimeout(() => { const el = o.find(); if (el && shouldCorrectFocus(o.snapshot(el))) o.focus(el); o.done(); }, o.lateMs);
  return () => { o.timers.clearTimeout(t1); o.timers.clearTimeout(t2); };
}

export const browserTimers: FocusTimers = { setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id) };
