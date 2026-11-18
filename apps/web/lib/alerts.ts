/**
 * Live alerts: what the app does when a notification arrives while the person is working somewhere else. Pure helpers (no React) so the
 * decisions are unit-tested; the hooks that use them are in hooks/use-realtime.ts and components/shell/notification-bell.tsx.
 */
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@leadpilot/validation';
export { DEFAULT_ALERT_SETTINGS, type AlertSettings };

export interface LiveNotification { id?: string; type?: string; title?: string; body?: string | null; link?: string | null }

/** Reads the server-sent event payload. Anything unusable is ignored, never thrown. */
export function parseLive(data: string): LiveNotification | null {
  try {
    const d = JSON.parse(data) as Record<string, unknown>;
    if (!d || typeof d !== 'object' || typeof d.title !== 'string' || d.title.length === 0) return null;
    return { ...(typeof d.id === 'string' ? { id: d.id } : {}), ...(typeof d.type === 'string' ? { type: d.type } : {}), title: d.title, body: typeof d.body === 'string' ? d.body : null, link: typeof d.link === 'string' && /^\/(?![/\\])/.test(d.link) ? d.link : null };
  } catch { return null; }
}

/** Show a pop-up for every notification, except that a new-message pop-up is pointless while the person is already looking at the Inbox. */
export function shouldToast(n: LiveNotification, pathname: string, tabHidden: boolean): boolean {
  if (!n.title) return false;
  if (n.type === 'new_message' && pathname.startsWith('/inbox') && !tabHidden) return false;
  return true;
}

/** "(3) Dashboard" in the browser tab, so a person on another tab sees something arrived. Idempotent: strips an earlier prefix first. */
export function withUnreadTitle(title: string, unread: number): string {
  const clean = title.replace(/^\(\d+\+?\)\s*/, '');
  return unread > 0 ? `(${unread > 99 ? '99+' : unread}) ${clean}` : clean;
}

export type DesktopState = 'unsupported' | 'default' | 'granted' | 'denied';
export function desktopState(): DesktopState {
  if (typeof window === 'undefined' || typeof Notification === 'undefined') return 'unsupported';
  return Notification.permission;
}
/** Must be called from a click. Returns the resulting state. */
export async function enableDesktop(): Promise<DesktopState> {
  if (desktopState() === 'unsupported') return 'unsupported';
  try { await Notification.requestPermission(); } catch { /* older browsers use a callback form; the state below is authoritative */ }
  return desktopState();
}

/**
 * "The person is not looking at LeadPilot": the tab is hidden (another tab, minimised window) OR it does not have focus (another application is
 * in front, even if part of this window is still visible). That is when a system notification is useful; in front, the pop-up is enough.
 */
export function isAway(): boolean {
  if (typeof document === 'undefined') return false;
  return document.hidden || !document.hasFocus();
}

/** A system notification, only when the account setting is on, permission was given, and the person is away. `tag` makes several open tabs show one. */
export function showDesktop(n: LiveNotification, onOpen: (link: string | null) => void, settings: AlertSettings): void {
  if (!settings.desktopEnabled || desktopState() !== 'granted' || !n.title || !isAway()) return;
  try {
    const x = new Notification(n.title, { ...(n.body ? { body: n.body } : {}), ...(n.id ? { tag: n.id } : {}) });
    x.onclick = () => { window.focus(); onOpen(n.link ?? null); x.close(); };
  } catch { /* some browsers refuse outside a service worker; the in-app pop-up still works */ }
}

// ------------------------------------------------------------------ sound
export function clampVolume(v: unknown): number { const n = typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : DEFAULT_ALERT_SETTINGS.soundVolume; return Math.min(100, Math.max(0, n)); }
/** Volume 0..100 to a gain. Capped well below full scale so 100 is loud but never harsh or clipped; 0 is silent. */
export function beepGain(volume: number): number { return (clampVolume(volume) / 100) * 0.4; }

let audio: AudioContext | null = null;
/**
 * Browsers refuse to make sound until the person has clicked or pressed a key on the page. Call this from such an event (the app shell does,
 * once): it creates the shared audio context and wakes it if the browser put it to sleep.
 */
export function unlockAudio(): void {
  if (typeof window === 'undefined') return;
  try {
    const Ctor = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    audio ??= new Ctor();
    if (audio.state === 'suspended') void audio.resume();
  } catch { /* no audio support: the pop-up and tab count still work */ }
}
/** True once the page may make sound (after a click or key press). The settings dialog uses it to say what to do. */
export function audioReady(): boolean { return audio?.state === 'running'; }
/** Test seam: forget the audio context. */
export function resetAudioForTests(): void { audio = null; }

/** A short two-tone beep from an oscillator (no audio file). Returns whether it played. Never throws. */
export function playBeep(volume: number): boolean {
  const gain = beepGain(volume);
  if (gain <= 0 || !audio || audio.state !== 'running') return false;
  try {
    const t0 = audio.currentTime;
    for (const [i, freq] of ([880, 1175] as const).entries()) {
      const start = t0 + i * 0.13; const osc = audio.createOscillator(); const g = audio.createGain();
      osc.type = 'sine'; osc.frequency.setValueAtTime(freq, start);
      g.gain.setValueAtTime(0, start); g.gain.linearRampToValueAtTime(gain, start + 0.015); g.gain.exponentialRampToValueAtTime(0.0001, start + 0.12);
      osc.connect(g); g.connect(audio.destination); osc.start(start); osc.stop(start + 0.14);
    }
    return true;
  } catch { return false; }
}

const BEEP_KEY = 'lp:lastBeep'; const BEEP_GAP_MS = 3000;
let lastBeepInMemory = 0;
/** At most one beep every 3 seconds, also across several open tabs (a shared timestamp), so a burst or a second tab does not double-beep. */
export function beepAllowed(now: number = Date.now(), store: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null): boolean {
  let last = lastBeepInMemory;
  try { const v = Number(store?.getItem(BEEP_KEY)); if (Number.isFinite(v) && v > last) last = v; } catch { /* storage unavailable: this tab still limits itself */ }
  if (now - last < BEEP_GAP_MS) return false;
  lastBeepInMemory = now;
  try { store?.setItem(BEEP_KEY, String(now)); } catch { /* ignore */ }
  return true;
}
/** Beep for a new notification if the person wants sound. Returns whether it played. */
export function soundForNotification(settings: AlertSettings): boolean {
  if (!settings.soundEnabled || !beepAllowed()) return false;
  return playBeep(settings.soundVolume);
}
/** Test seam: forget the beep timestamp. */
export function resetBeepLimiterForTests(): void { lastBeepInMemory = 0; }
