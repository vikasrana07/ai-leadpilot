'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

interface FollowupTemplate {
  key: string;
  name: string;
  category: string;
  description: string;
  subjectTemplate: string;
  bodyTemplate: string;
}

function interpolateTemplate(
  template: string,
  vars: { leadName: string; businessName: string; agentName: string },
): string {
  const firstName = vars.leadName.trim().split(/\s+/)[0] || 'there';
  const map: Record<string, string> = {
    'lead.name': vars.leadName.trim() || 'there',
    'lead.firstName': firstName,
    'business.name': vars.businessName.trim() || 'our team',
    'agent.name': vars.agentName.trim() || 'Your Advisor',
    'appointment.date': '[Date]',
    'appointment.time': '[Time]',
    'appointment.location': 'Online / Office',
  };
  return template.replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (match, key: string) => map[key] ?? match);
}

export function SendEmailDialog({
  open,
  onOpenChange,
  lead,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  lead: { id: string; name: string; email?: string | null };
}) {
  const qc = useQueryClient();
  const { ctx, activeWorkspace } = useAuth();
  const [templateKey, setTemplateKey] = useState('');
  const [subject, setSubject] = useState('');
  const [text, setText] = useState('');

  const templatesQuery = useQuery({
    queryKey: ['emails', 'templates'],
    queryFn: () => api<FollowupTemplate[]>('/emails/templates'),
    enabled: open,
    staleTime: 300_000,
  });

  const handleTemplateChange = (nextKey: string) => {
    setTemplateKey(nextKey);
    if (!nextKey) return;
    const tpl = templatesQuery.data?.find((t) => t.key === nextKey);
    if (!tpl) return;
    const vars = {
      leadName: lead.name,
      businessName: activeWorkspace?.name ?? 'LeadPilot',
      agentName: ctx.user.name,
    };
    setSubject(interpolateTemplate(tpl.subjectTemplate, vars));
    setText(interpolateTemplate(tpl.bodyTemplate, vars));
  };

  const send = useMutation({
    mutationFn: (body: { to: string; leadId: string; templateKey?: string; subject: string; text: string }) =>
      api<{ id: string; status: string; suppressed?: boolean }>('/emails/send', {
        method: 'POST',
        body,
      }),
    onSuccess: async (res) => {
      if (res.suppressed) {
        toast.warning('Recipient is on the suppression list. Email was not sent.');
      } else {
        toast.success('Tracked email dispatched');
      }
      onOpenChange(false);
      setTemplateKey('');
      setSubject('');
      setText('');
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['leads', 'activity', lead.id] }),
        qc.invalidateQueries({ queryKey: ['emails'] }),
      ]);
    },
    onError: (e) => handleApiError(e),
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!lead.email) {
      toast.error('This lead does not have an email address configured.');
      return;
    }
    if (!subject.trim() || !text.trim()) return;

    send.mutate({
      to: lead.email,
      leadId: lead.id,
      ...(templateKey ? { templateKey } : {}),
      subject: subject.trim(),
      text: text.trim(),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        title={`Send Email to ${lead.name}`}
        description="Outbound email is automatically instrumented with open and link click tracking via Amazon SES."
        variant="modal"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="text-label mb-1 block">To</label>
            <Input
              value={lead.email ?? 'No email address on file'}
              disabled
              className="bg-muted font-mono text-[13px]"
            />
            {!lead.email && (
              <p className="text-destructive mt-1 text-[12px]">
                Cannot send: Please update the lead with a valid email address first.
              </p>
            )}
          </div>

          <div>
            <label htmlFor="email-template-select" className="text-label mb-1 block">
              Template (Optional)
            </label>
            <Select
              id="email-template-select"
              value={templateKey}
              onChange={(e) => handleTemplateChange(e.target.value)}
              disabled={!lead.email || send.isPending || templatesQuery.isLoading}
            >
              <option value="">Custom message (no template)</option>
              {(templatesQuery.data ?? []).map((tpl) => (
                <option key={tpl.key} value={tpl.key}>
                  {tpl.category} — {tpl.name}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <label className="text-label mb-1 block">Subject</label>
            <Input
              required
              placeholder="e.g. Property Brochure & Available Units"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={!lead.email || send.isPending}
            />
          </div>

          <div>
            <label className="text-label mb-1 block">Message Body</label>
            <Textarea
              required
              rows={6}
              placeholder="Hi there, here is the information regarding the property you inquired about..."
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={!lead.email || send.isPending}
            />
            <p className="text-helper mt-1 text-[12px]">
              Links (https://...) in the message body will be automatically wrapped for click analytics.
            </p>
          </div>

          <div className="mt-6 flex justify-end gap-2 border-t border-border pt-3">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={send.isPending}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              loading={send.isPending}
              disabled={!lead.email || !subject.trim() || !text.trim()}
            >
              <Send className="mr-1.5 h-4 w-4" />
              Send Tracked Email
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
