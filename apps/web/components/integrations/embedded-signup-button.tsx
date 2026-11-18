'use client';

import { useQueryClient } from '@tanstack/react-query';
import { MessageCircle } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import { runFacebookSignup } from '@/lib/embedded-signup';
import { handleApiError } from '@/lib/forms';

export interface EmbeddedConfig { mode: 'off' | 'mock' | 'live'; appId: string | null; configId: string | null; graphVersion: string }

const CHANNEL_NAME = 'Main WhatsApp number';

/**
 * "Connect WhatsApp" with Facebook (Embedded Signup, ADR 0012). Live mode opens Meta's pop-up; mock mode (development and tests only, never
 * available in production) opens a small stand-in dialog that feeds the SAME server call, so the whole path is testable without Meta.
 * The browser only ever forwards a one-time code and two ids; the server does the real work.
 */
export function EmbeddedSignupButton({ config, label = 'Connect WhatsApp', variant = 'primary', onConnected }: { config: EmbeddedConfig; label?: string; variant?: 'primary' | 'secondary'; onConnected?: () => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState<'idle' | 'opening' | 'connecting'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [mockOpen, setMockOpen] = useState(false);
  const [mockIds, setMockIds] = useState({ phoneNumberId: '', wabaId: '' });

  async function send(body: { code: string; phoneNumberId: string; wabaId: string }) {
    setBusy('connecting');
    try {
      await api('/channels/whatsapp/embedded', { method: 'POST', body: { name: CHANNEL_NAME, ...body } });
      toast.success('WhatsApp connected');
      await qc.invalidateQueries({ queryKey: ['channels'] });
      setMockOpen(false); onConnected?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not connect WhatsApp');
      handleApiError(e);
    } finally { setBusy('idle'); }
  }

  async function start() {
    setError(null);
    if (config.mode === 'mock') {
      const n = Date.now();
      setMockIds({ phoneNumberId: `${n}`.padEnd(15, '1').slice(0, 15), wabaId: `${n + 1}`.padEnd(15, '2').slice(0, 15) });
      setMockOpen(true); return;
    }
    if (config.mode !== 'live' || !config.appId || !config.configId) { setError('Connecting with Facebook is not set up yet. Use your own Meta app instead.'); return; }
    setBusy('opening');
    try {
      const r = await runFacebookSignup({ appId: config.appId, configId: config.configId, graphVersion: config.graphVersion });
      if (r.status === 'cancelled') { setBusy('idle'); return; } // closing the pop-up is not an error
      if (r.status === 'error') { setError(r.message); setBusy('idle'); return; }
      await send(r.result);
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not open Facebook'); setBusy('idle'); }
  }

  return (
    <div className="space-y-2">
      <Button variant={variant} loading={busy !== 'idle'} onClick={() => void start()}>
        <MessageCircle className="h-4 w-4" aria-hidden />{busy === 'connecting' ? 'Connecting…' : busy === 'opening' ? 'Waiting for Facebook…' : label}
      </Button>
      {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
      {config.mode === 'mock' ? (
        <Dialog open={mockOpen} onOpenChange={setMockOpen}>
          <DialogContent title="Facebook sign-in (test stand-in)" description="Development only: this replaces Meta's pop-up. It sends the same details to the server that the real pop-up would." className="max-w-md">
            <form className="space-y-3" noValidate onSubmit={(e) => { e.preventDefault(); void send({ code: 'mock-ok-ui', ...mockIds }); }}>
              <Field label="Phone number ID" htmlFor="mock-pid"><Input id="mock-pid" inputMode="numeric" autoComplete="off" value={mockIds.phoneNumberId} onChange={(e) => setMockIds((s) => ({ ...s, phoneNumberId: e.target.value }))} /></Field>
              <Field label="WhatsApp Business Account ID" htmlFor="mock-waba"><Input id="mock-waba" inputMode="numeric" autoComplete="off" value={mockIds.wabaId} onChange={(e) => setMockIds((s) => ({ ...s, wabaId: e.target.value }))} /></Field>
              {error ? <p role="alert" className="text-[13px] text-danger">{error}</p> : null}
              <div className="flex justify-end gap-2 pt-1"><Button type="button" onClick={() => setMockOpen(false)}>Cancel</Button><Button type="submit" variant="primary" loading={busy === 'connecting'}>Continue as Facebook user</Button></div>
            </form>
          </DialogContent>
        </Dialog>
      ) : null}
    </div>
  );
}
