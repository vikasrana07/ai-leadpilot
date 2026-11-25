'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageSquareQuote, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { handleApiError } from '@/lib/forms';

interface CannedResponseItem {
  id: string;
  shortcut: string;
  title: string;
  body: string;
  category?: string;
  isSystem?: boolean;
}

export function CannedResponsesCard() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const canEdit = can('settings:manage') || can('conversation:reply');

  const [shortcut, setShortcut] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');

  const list = useQuery({
    queryKey: ['conversations', 'canned-responses'],
    queryFn: () => api<CannedResponseItem[]>('/conversations/canned-responses'),
  });

  const create = useMutation({
    mutationFn: () =>
      api<CannedResponseItem>('/conversations/canned-responses', {
        method: 'POST',
        body: { shortcut: shortcut.trim(), title: title.trim(), body: body.trim() },
      }),
    onSuccess: async () => {
      toast.success('Quick response saved');
      setShortcut('');
      setTitle('');
      setBody('');
      await qc.invalidateQueries({ queryKey: ['conversations', 'canned-responses'] });
    },
    onError: (e) => handleApiError(e),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api(`/conversations/canned-responses/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Quick response removed');
      await qc.invalidateQueries({ queryKey: ['conversations', 'canned-responses'] });
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MessageSquareQuote className="h-4 w-4 text-muted-foreground" aria-hidden />
          <CardTitle>Inbox quick responses (slash commands)</CardTitle>
        </div>
        {!canEdit ? <Badge>Read only</Badge> : null}
      </CardHeader>
      <CardBody className="space-y-4">
        <p className="text-helper">
          Type <code className="rounded bg-muted px-1 py-0.5 text-[12px]">/</code> in the Inbox reply composer to insert these templates. Supports <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{'{{lead.name}}'}</code> and <code className="rounded bg-muted px-1 py-0.5 text-[12px]">{'{{lead.location}}'}</code>.
        </p>

        {list.isPending ? (
          <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {list.data?.map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3 px-4 py-3 text-[13px]">
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-primary">{item.shortcut}</span>
                    <span className="font-medium">{item.title}</span>
                    {item.isSystem ? <Badge>Default</Badge> : null}
                  </div>
                  <p className="text-helper line-clamp-2">{item.body}</p>
                </div>
                {canEdit && !item.isSystem ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={`Delete ${item.shortcut}`}
                    loading={remove.isPending}
                    onClick={() => remove.mutate(item.id)}
                  >
                    <Trash2 className="h-3.5 w-3.5 text-muted-foreground hover:text-danger" />
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        )}

        {canEdit ? (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!shortcut.trim() || !title.trim() || !body.trim()) return;
              create.mutate();
            }}
            className="space-y-3 rounded-lg border border-border bg-muted/20 p-4"
          >
            <p className="text-[13px] font-medium">Add custom quick response</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label htmlFor="canned-shortcut" className="text-label mb-1 block">Shortcut</label>
                <Input
                  id="canned-shortcut"
                  placeholder="/booking"
                  value={shortcut}
                  onChange={(e) => setShortcut(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="canned-title" className="text-label mb-1 block">Title</label>
                <Input
                  id="canned-title"
                  placeholder="Booking token instructions"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </div>
            </div>
            <div>
              <label htmlFor="canned-body" className="text-label mb-1 block">Message text</label>
              <textarea
                id="canned-body"
                rows={2}
                placeholder="Hi {{lead.name}}, you can reserve your unit in {{lead.location}}..."
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="w-full rounded-md border border-border bg-surface px-3 py-2 text-[13px] outline-none focus:border-primary"
              />
            </div>
            <div className="flex justify-end">
              <Button
                type="submit"
                size="sm"
                variant="primary"
                disabled={!shortcut.trim() || !title.trim() || !body.trim()}
                loading={create.isPending}
              >
                <Plus className="h-3.5 w-3.5" aria-hidden />
                Add snippet
              </Button>
            </div>
          </form>
        ) : null}
      </CardBody>
    </Card>
  );
}
