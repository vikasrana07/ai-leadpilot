/**
 * WhatsApp Embedded Signup in the browser (ADR 0012). The page opens Meta's pop-up; Meta answers twice: the Facebook SDK's login callback
 * carries a one-time `code`, and the pop-up posts a message to this page with the phone number id and WABA id. We need BOTH, in either order,
 * then send them to our server, which does the real work (code exchange, ownership checks). The browser never sees a token.
 * Everything Meta-facing here follows Meta's documentation at planning time and is UNVERIFIED against a real run.
 */

const FB_ORIGINS = new Set(['https://www.facebook.com', 'https://web.facebook.com']);
const ID = /^\d{6,25}$/;

export type SignupMessage =
  | { kind: 'finish'; phoneNumberId: string; wabaId: string }
  | { kind: 'cancel' }
  | { kind: 'error'; message: string };

/** Interprets a window `message` event. Anything not from Facebook, or not an Embedded Signup message, is ignored (returns null). */
export function parseSignupMessage(origin: string, raw: unknown): SignupMessage | null {
  if (!FB_ORIGINS.has(origin)) return null;
  let d: unknown = raw;
  if (typeof raw === 'string') { try { d = JSON.parse(raw); } catch { return null; } }
  if (!d || typeof d !== 'object') return null;
  const m = d as { type?: unknown; event?: unknown; data?: { phone_number_id?: unknown; waba_id?: unknown; error_message?: unknown } };
  if (m.type !== 'WA_EMBEDDED_SIGNUP') return null;
  if (m.event === 'FINISH' || m.event === 'FINISH_ONLY_WABA') {
    const p = String(m.data?.phone_number_id ?? ''); const w = String(m.data?.waba_id ?? '');
    return ID.test(p) && ID.test(w) ? { kind: 'finish', phoneNumberId: p, wabaId: w } : { kind: 'error', message: 'Meta did not say which WhatsApp number was connected. Please try again.' };
  }
  if (m.event === 'CANCEL') return { kind: 'cancel' };
  if (typeof m.event === 'string' && /error/i.test(m.event)) return { kind: 'error', message: typeof m.data?.error_message === 'string' && m.data.error_message ? m.data.error_message : 'Meta reported a problem while connecting.' };
  return null;
}

export type SignupResult = { code: string; phoneNumberId: string; wabaId: string };
export type SignupOutcome = { status: 'done'; result: SignupResult } | { status: 'cancelled' } | { status: 'error'; message: string } | { status: 'waiting' };

/** Collects the two answers (login code, pop-up message) in either order and settles once. */
export function createSignupCollector() {
  let code: string | null | undefined; let ids: { phoneNumberId: string; wabaId: string } | null = null; let settled: SignupOutcome | null = null;
  const settle = (o: SignupOutcome): SignupOutcome => { settled ??= o; return settled; };
  const check = (): SignupOutcome => {
    if (settled) return settled;
    if (code === null) return settle({ status: 'cancelled' }); // the login dialog was closed without a code
    if (code && ids) return settle({ status: 'done', result: { code, ...ids } });
    return { status: 'waiting' };
  };
  return {
    /** The Facebook SDK login callback: `null` when the user closed the dialog or did not authorise. */
    pushCode(c: string | null): SignupOutcome { if (!settled) code = c && c.length > 0 ? c : null; return check(); },
    pushMessage(m: SignupMessage): SignupOutcome {
      if (settled) return settled;
      if (m.kind === 'cancel') return settle({ status: 'cancelled' });
      if (m.kind === 'error') return settle({ status: 'error', message: m.message });
      ids = { phoneNumberId: m.phoneNumberId, wabaId: m.wabaId }; return check();
    },
  };
}

interface FbSdk {
  init(o: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: Record<string, unknown>): void;
}
declare global { interface Window { FB?: FbSdk; fbAsyncInit?: () => void } }

let sdkPromise: Promise<FbSdk> | null = null;
/** Loads Facebook's SDK on demand (only when the user clicks Connect), once. */
export function loadFacebookSdk(appId: string, graphVersion: string): Promise<FbSdk> {
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<FbSdk>((resolve, reject) => {
    const ready = () => { if (!window.FB) { sdkPromise = null; reject(new Error('Facebook did not load')); return; } window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version: graphVersion }); resolve(window.FB); };
    if (window.FB) { ready(); return; }
    window.fbAsyncInit = ready;
    const s = document.createElement('script');
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous'; s.src = 'https://connect.facebook.net/en_US/sdk.js';
    s.onerror = () => { sdkPromise = null; reject(new Error('Could not load Facebook. Check your connection or an ad blocker, then try again.')); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

const TIMEOUT_MS = 10 * 60_000;
/** Opens the Embedded Signup pop-up and resolves with the code and ids, or says it was cancelled or failed. */
export async function runFacebookSignup(cfg: { appId: string; configId: string; graphVersion: string }): Promise<Exclude<SignupOutcome, { status: 'waiting' }>> {
  const fb = await loadFacebookSdk(cfg.appId, cfg.graphVersion);
  return new Promise((resolve) => {
    const collector = createSignupCollector();
    const finish = (o: SignupOutcome) => { if (o.status === 'waiting') return; cleanup(); resolve(o); };
    const onMessage = (e: MessageEvent) => { const m = parseSignupMessage(e.origin, e.data); if (m) finish(collector.pushMessage(m)); };
    const timer = setTimeout(() => finish({ status: 'error', message: 'The sign-in took too long. Please try again.' }), TIMEOUT_MS);
    const cleanup = () => { clearTimeout(timer); window.removeEventListener('message', onMessage); };
    window.addEventListener('message', onMessage);
    fb.login((r) => finish(collector.pushCode(r.authResponse?.code ?? null)), {
      config_id: cfg.configId, response_type: 'code', override_default_response_type: true,
      extras: { setup: {}, featureType: '', sessionInfoVersion: '3' },
    });
  });
}
