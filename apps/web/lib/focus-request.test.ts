import { describe, expect, it, vi } from 'vitest';
import { scheduleStepFocus, shouldApplyFocus, shouldCorrectFocus, type FocusSnapshot } from './focus-request';

const snap = (over: Partial<FocusSnapshot>): FocusSnapshot => ({ isBodyOrNone: false, isTarget: false, isMenuTrigger: false, isOrigin: false, ...over });

describe('focus after an edit: the rule', () => {
  it('moves focus when the user has not moved it since the request (still on the pressed button, dropped to the page, or on a menu trigger)', () => {
    for (const where of [{ isOrigin: true }, { isBodyOrNone: true }, { isMenuTrigger: true }] as Partial<FocusSnapshot>[]) {
      expect(shouldApplyFocus(snap(where))).toBe(true);
      expect(shouldCorrectFocus(snap(where))).toBe(true);
    }
  });
  it('leaves focus alone when the target already has it', () => {
    expect(shouldApplyFocus(snap({ isTarget: true, isOrigin: true }))).toBe(false);
    expect(shouldCorrectFocus(snap({ isTarget: true }))).toBe(false);
  });
  it('never takes focus from anywhere the user moved it to (step settings, another button, an input)', () => {
    expect(shouldApplyFocus(snap({}))).toBe(false);
    expect(shouldCorrectFocus(snap({}))).toBe(false);
  });
});

/** A tiny fake page: one element has focus; "elements" are plain labelled objects. */
function fakePage(origin: string) {
  const state = { active: origin };
  const els: Record<string, HTMLElement> = {};
  const el = (name: string) => (els[name] ??= { name } as unknown as HTMLElement);
  const nameOf = (e: unknown) => (e as { name: string }).name;
  const snapshot = (target: Element | null): FocusSnapshot => ({
    isBodyOrNone: state.active === 'body', isTarget: !!target && nameOf(target) === state.active,
    isMenuTrigger: state.active === 'menu-trigger', isOrigin: state.active === origin && origin !== 'body',
  });
  const focus = (e: HTMLElement) => { state.active = nameOf(e); };
  return { state, el, snapshot, focus };
}
const timers = () => ({ setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms) as unknown as number, clearTimeout: (id: number) => clearTimeout(id as unknown as NodeJS.Timeout) });
const run = (pg: ReturnType<typeof fakePage>, done: () => void, over: { firstMs?: number; lateMs?: number } = {}) =>
  scheduleStepFocus({ find: () => pg.el('step4'), snapshot: pg.snapshot, focus: pg.focus, done, timers: timers(), firstMs: over.firstMs ?? 0, lateMs: over.lateMs ?? 260 });

describe('step focus request (fake timers)', () => {
  it('puts focus on the new step and undoes a menu handing focus back to its trigger', () => {
    vi.useFakeTimers();
    const pg = fakePage('menu-item'); const done = vi.fn();
    run(pg, done);
    pg.state.active = 'body';                           // the menu item that was pressed is gone
    vi.advanceTimersByTime(1); expect(pg.state.active).toBe('step4');
    pg.state.active = 'menu-trigger';                   // Radix gives focus back to the menu trigger
    vi.advanceTimersByTime(300); expect(pg.state.active).toBe('step4'); expect(done).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('REGRESSION (spec 12, timing 1): the late re-check of an earlier request does not steal focus from the settings the user opened 150 ms later', () => {
    vi.useFakeTimers();
    const pg = fakePage('add-action-button'); const done = vi.fn();
    run(pg, done);
    vi.advanceTimersByTime(1); expect(pg.state.active).toBe('step4');
    vi.advanceTimersByTime(150);
    pg.state.active = 'settings-heading';               // Enter on another step: focus moves to its settings
    vi.advanceTimersByTime(200);                        // the old request's late check fires now
    expect(pg.state.active).toBe('settings-heading');   // the old code pulled focus back to step4 here
    expect(done).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('REGRESSION (spec 12, timing 2): the FIRST attempt does not take focus when the user already focused another button after pressing Add', () => {
    vi.useFakeTimers();
    const pg = fakePage('add-action-button'); const done = vi.fn();
    run(pg, done);                                      // "Add action" was pressed; the request is pending
    pg.state.active = 'add-wait-button';                // before the first attempt fires, the user focuses the next button
    vi.advanceTimersByTime(1000);
    expect(pg.state.active).toBe('add-wait-button');    // the old code moved focus to the new step here, so Enter pressed the wrong control
    expect(done).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a cancelled request does nothing', () => {
    vi.useFakeTimers();
    const pg = fakePage('add-action-button'); const done = vi.fn();
    const cancel = run(pg, done);
    cancel(); vi.advanceTimersByTime(1000);
    expect(pg.state.active).toBe('add-action-button'); expect(done).not.toHaveBeenCalled();
    vi.useRealTimers();
  });
});
