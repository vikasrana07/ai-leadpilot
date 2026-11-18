import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { audioReady, beepAllowed, beepGain, clampVolume, DEFAULT_ALERT_SETTINGS, isAway, parseLive, playBeep, resetAudioForTests, resetBeepLimiterForTests, shouldToast, showDesktop, soundForNotification, unlockAudio, withUnreadTitle, type AlertSettings } from './alerts';

describe('parseLive', () => {
  it('reads a notification and keeps only safe, internal links', () => {
    expect(parseLive(JSON.stringify({ id: 'n1', type: 'new_message', title: 'New chat from Riya', body: 'Hi', link: '/inbox?c=abc' }))).toEqual({ id: 'n1', type: 'new_message', title: 'New chat from Riya', body: 'Hi', link: '/inbox?c=abc' });
    expect(parseLive(JSON.stringify({ title: 'T', link: 'https://evil.example' }))?.link).toBeNull();      // never an outside address
    for (const off of ['//evil.example', '/\\evil.example', 'javascript:alert(1)', 'inbox']) expect(parseLive(JSON.stringify({ title: 'T', link: off }))?.link, off).toBeNull(); // protocol-relative and other off-site forms
    expect(parseLive(JSON.stringify({ title: 'T' }))).toEqual({ title: 'T', body: null, link: null });
  });
  it('ignores anything unusable instead of throwing', () => { for (const bad of ['', 'nope', 'null', '[]', '{}', '{"title":""}', '{"title":5}']) expect(parseLive(bad), bad).toBeNull(); });
});

describe('shouldToast', () => {
  it('pops up for everything, except a new message while the Inbox is open and in front', () => {
    const msg = { type: 'new_message', title: 'x' };
    expect(shouldToast(msg, '/dashboard', false)).toBe(true);
    expect(shouldToast(msg, '/inbox', false)).toBe(false);
    expect(shouldToast(msg, '/inbox', true)).toBe(true);          // the tab is in the background: still tell them
    expect(shouldToast({ type: 'hot_lead', title: 'x' }, '/inbox', false)).toBe(true);
    expect(shouldToast({ title: '' }, '/leads', false)).toBe(false);
  });
});

describe('withUnreadTitle', () => {
  it('adds, updates and removes the count, without stacking prefixes', () => {
    expect(withUnreadTitle('LeadPilot', 3)).toBe('(3) LeadPilot');
    expect(withUnreadTitle('(3) LeadPilot', 5)).toBe('(5) LeadPilot');
    expect(withUnreadTitle('(5) LeadPilot', 0)).toBe('LeadPilot');
    expect(withUnreadTitle('LeadPilot', 250)).toBe('(99+) LeadPilot');
    expect(withUnreadTitle('(99+) LeadPilot', 2)).toBe('(2) LeadPilot');
  });
});

// ------------------------------------------------------------------ sound, away detection, desktop alerts
const on: AlertSettings = { soundEnabled: true, soundVolume: 80, desktopEnabled: true };
const played: { freq: number; peak: number }[] = [];
class FakeAudio {
  state: 'suspended' | 'running' = 'suspended'; currentTime = 1; destination = {};
  resume() { this.state = 'running'; return Promise.resolve(); }
  createOscillator() { const o = { type: '', freq: 0, frequency: { setValueAtTime: (f: number) => { o.freq = f; } }, connect: () => undefined, start: () => undefined, stop: () => undefined }; return o; }
  createGain() { const g = { peak: 0, gain: { setValueAtTime: () => undefined, linearRampToValueAtTime: (v: number) => { g.peak = v; }, exponentialRampToValueAtTime: () => undefined }, connect: (x: unknown) => x }; return g; }
}
/** An audio context whose beeps are recorded (frequency and loudest level of each tone). */
function recordingAudio() {
  return class extends FakeAudio {
    override createOscillator() { const o = super.createOscillator(); const start = o.start; o.start = () => { played.push({ freq: o.freq, peak: -1 }); start(); }; return o; }
    override createGain() { const g = super.createGain(); const ramp = g.gain.linearRampToValueAtTime; g.gain.linearRampToValueAtTime = (v: number) => { ramp(v); const last = played[played.length - 1]; if (last) last.peak = v; else queueMicrotask(() => undefined); (g as { peak: number }).peak = v; }; return g; }
  };
}

describe('volume', () => {
  it('clamps to a whole number from 0 to 100 and maps to a safe gain', () => {
    expect([clampVolume(-5), clampVolume(0), clampVolume(49.6), clampVolume(100), clampVolume(900), clampVolume('x'), clampVolume(NaN)]).toEqual([0, 0, 50, 100, 100, 50, 50]);
    expect(beepGain(0)).toBe(0); expect(beepGain(100)).toBeCloseTo(0.4); expect(beepGain(50)).toBeCloseTo(0.2); expect(beepGain(500)).toBeCloseTo(0.4);
  });
});

describe('isAway', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('is true when the tab is hidden or does not have focus (another application in front), false only when it is in front and focused', () => {
    vi.stubGlobal('document', { hidden: false, hasFocus: () => true }); expect(isAway()).toBe(false);
    vi.stubGlobal('document', { hidden: true, hasFocus: () => true }); expect(isAway()).toBe(true);
    vi.stubGlobal('document', { hidden: false, hasFocus: () => false }); expect(isAway()).toBe(true);
    vi.stubGlobal('document', { hidden: true, hasFocus: () => false }); expect(isAway()).toBe(true);
  });
});

describe('beep limiter', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
  beforeEach(() => resetBeepLimiterForTests());
  it('allows one beep per 3 seconds, shared by tabs through the same storage', () => {
    const store = mem();
    expect(beepAllowed(10_000, store)).toBe(true);
    expect(beepAllowed(11_000, store)).toBe(false); expect(beepAllowed(12_999, store)).toBe(false);   // a burst
    expect(beepAllowed(13_000, store)).toBe(true);                                                     // 3 s later
    resetBeepLimiterForTests();                                                                         // "another tab": no memory of its own, same storage
    expect(beepAllowed(14_000, store)).toBe(false);
  });
  it('still limits itself when storage is unavailable', () => {
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); } };
    expect(beepAllowed(50_000, broken)).toBe(true); expect(beepAllowed(50_500, broken)).toBe(false);
  });
});

describe('playBeep', () => {
  beforeEach(() => { played.length = 0; resetAudioForTests(); resetBeepLimiterForTests(); });
  afterEach(() => vi.unstubAllGlobals());
  it('is silent until the page has been interacted with, then plays two tones at the requested loudness', () => {
    vi.stubGlobal('window', { AudioContext: recordingAudio() });
    expect(playBeep(80)).toBe(false); expect(audioReady()).toBe(false);          // no click yet: nothing to play through
    unlockAudio();                                                                 // the first click wakes the audio
    return Promise.resolve().then(() => {
      expect(audioReady()).toBe(true);
      expect(playBeep(80)).toBe(true); expect(played.map((p) => p.freq)).toEqual([880, 1175]);
      played.length = 0; expect(playBeep(0)).toBe(false); expect(played).toHaveLength(0); // volume 0 is silent
    });
  });
  it('does not crash when the browser has no audio or refuses it', () => {
    vi.stubGlobal('window', {}); expect(() => unlockAudio()).not.toThrow(); expect(playBeep(50)).toBe(false);
    vi.stubGlobal('window', { AudioContext: class { constructor() { throw new Error('blocked'); } } }); expect(() => unlockAudio()).not.toThrow(); expect(playBeep(50)).toBe(false);
  });
  it('soundForNotification: off means silent, on plays once per burst', () => {
    vi.stubGlobal('window', { AudioContext: recordingAudio() }); unlockAudio();
    return Promise.resolve().then(() => {
      expect(soundForNotification({ ...on, soundEnabled: false })).toBe(false);
      expect(soundForNotification(on)).toBe(true);
      expect(soundForNotification(on)).toBe(false);   // within 3 s
      expect(soundForNotification({ ...on, soundVolume: 0 })).toBe(false);
    });
  });
});

describe('showDesktop', () => {
  const made: { title: string; opts: Record<string, unknown> }[] = [];
  class FakeNotification { static permission = 'granted'; onclick: (() => void) | null = null; constructor(public title: string, public opts: Record<string, unknown>) { made.push({ title, opts }); } close() { /* noop */ } }
  beforeEach(() => { made.length = 0; FakeNotification.permission = 'granted'; vi.stubGlobal('window', { focus: () => undefined, Notification: FakeNotification }); vi.stubGlobal('Notification', FakeNotification); vi.stubGlobal('document', { hidden: false, hasFocus: () => false }); });
  afterEach(() => vi.unstubAllGlobals());
  const n = { id: 'n1', title: 'New chat from Riya', body: 'Hello', link: '/inbox?c=1' };
  it('shows one system notification, tagged so several tabs show a single one, when the person is away', () => {
    showDesktop(n, () => undefined, on);
    expect(made).toEqual([{ title: 'New chat from Riya', opts: { body: 'Hello', tag: 'n1' } }]);
  });
  it('stays quiet when the person is looking at LeadPilot, has turned it off, has not allowed it, or there is nothing to say', () => {
    vi.stubGlobal('document', { hidden: false, hasFocus: () => true }); showDesktop(n, () => undefined, on);
    vi.stubGlobal('document', { hidden: false, hasFocus: () => false });
    showDesktop(n, () => undefined, { ...on, desktopEnabled: false });
    FakeNotification.permission = 'denied'; showDesktop(n, () => undefined, on);
    FakeNotification.permission = 'default'; showDesktop(n, () => undefined, on);
    FakeNotification.permission = 'granted'; showDesktop({ id: 'x' }, () => undefined, on);
    expect(made).toHaveLength(0);
  });
  it('defaults are sound on at 50 and desktop alerts on', () => { expect(DEFAULT_ALERT_SETTINGS).toEqual({ soundEnabled: true, soundVolume: 50, desktopEnabled: true }); });
});
