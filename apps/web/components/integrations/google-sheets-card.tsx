'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FileSpreadsheet, RefreshCw, Unplug } from 'lucide-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { handleApiError } from '@/lib/forms';

interface GoogleSheetsStatus {
  connected: boolean;
  configured: boolean;
  spreadsheetId?: string | null;
  sheetName?: string;
  columnMapping?: { name?: string; phone?: string; email?: string; location?: string; requirements?: string };
  lastSyncedRow?: number;
  enabled?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}

export function GoogleSheetsCard() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['integrations', 'google-sheets'],
    queryFn: () => api<GoogleSheetsStatus>('/integrations/google-sheets'),
  });

  const [spreadsheetId, setSpreadsheetId] = useState('');
  const [sheetName, setSheetName] = useState('Sheet1');
  const [nameCol, setNameCol] = useState('Name');
  const [phoneCol, setPhoneCol] = useState('Phone');
  const [emailCol, setEmailCol] = useState('Email');

  useEffect(() => {
    if (!status.data?.connected) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- sync form fields from server config
    setSpreadsheetId(status.data.spreadsheetId ?? '');
    setSheetName(status.data.sheetName ?? 'Sheet1');
    setNameCol(status.data.columnMapping?.name ?? 'Name');
    setPhoneCol(status.data.columnMapping?.phone ?? 'Phone');
    setEmailCol(status.data.columnMapping?.email ?? 'Email');
  }, [status.data]);

  const connect = useMutation({
    mutationFn: () => api<{ url: string }>('/integrations/google-sheets/auth-url'),
    onSuccess: (res) => {
      window.location.href = res.url;
    },
    onError: (e) => handleApiError(e),
  });

  const saveConfig = useMutation({
    mutationFn: () =>
      api('/integrations/google-sheets/config', {
        method: 'PUT',
        body: {
          spreadsheetId: spreadsheetId.trim(),
          sheetName: sheetName.trim() || 'Sheet1',
          columnMapping: { name: nameCol, phone: phoneCol, email: emailCol },
          enabled: true,
        },
      }),
    onSuccess: async () => {
      toast.success('Google Sheet configured');
      await qc.invalidateQueries({ queryKey: ['integrations', 'google-sheets'] });
    },
    onError: (e) => handleApiError(e),
  });

  const syncNow = useMutation({
    mutationFn: () => api<{ imported: number; lastSyncedRow: number }>('/integrations/google-sheets/sync-now', { method: 'POST' }),
    onSuccess: async (res) => {
      toast.success(`Synced ${res.imported} new lead(s)`);
      await qc.invalidateQueries({ queryKey: ['integrations', 'google-sheets'] });
      await qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (e) => handleApiError(e),
  });

  const disconnect = useMutation({
    mutationFn: () => api('/integrations/google-sheets', { method: 'DELETE' }),
    onSuccess: async () => {
      toast.success('Google Sheets disconnected');
      await qc.invalidateQueries({ queryKey: ['integrations', 'google-sheets'] });
    },
    onError: (e) => handleApiError(e),
  });

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-primary" aria-hidden />
            Google Sheets lead sync
          </CardTitle>
          <p className="text-helper mt-0.5">Import new rows from a Google Sheet directly into your CRM.</p>
        </div>
        {status.data ? (
          <Badge tone={status.data.connected ? 'success' : 'neutral'}>
            {status.data.connected ? 'Connected' : 'Not connected'}
          </Badge>
        ) : null}
      </CardHeader>
      <CardBody className="space-y-4">
        {status.isPending ? (
          <Skeleton className="h-16" />
        ) : !status.data?.connected ? (
          <Button variant="primary" size="sm" loading={connect.isPending} onClick={() => connect.mutate()}>
            Connect Google Sheets
          </Button>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Spreadsheet ID" htmlFor="gs-id">
                <Input id="gs-id" placeholder="1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms" value={spreadsheetId} onChange={(e) => setSpreadsheetId(e.target.value)} />
              </Field>
              <Field label="Sheet tab name" htmlFor="gs-tab">
                <Input id="gs-tab" value={sheetName} onChange={(e) => setSheetName(e.target.value)} />
              </Field>
              <Field label="Name column" htmlFor="gs-name">
                <Input id="gs-name" value={nameCol} onChange={(e) => setNameCol(e.target.value)} />
              </Field>
              <Field label="Phone column" htmlFor="gs-phone">
                <Input id="gs-phone" value={phoneCol} onChange={(e) => setPhoneCol(e.target.value)} />
              </Field>
              <Field label="Email column" htmlFor="gs-email">
                <Input id="gs-email" value={emailCol} onChange={(e) => setEmailCol(e.target.value)} />
              </Field>
            </div>
            {status.data.lastSyncedAt ? (
              <p className="text-helper">
                Last synced {timeAgo(status.data.lastSyncedAt)} · Row {status.data.lastSyncedRow}
              </p>
            ) : null}
            {status.data.lastError ? <p className="text-[12px] text-danger">{status.data.lastError}</p> : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" size="sm" loading={saveConfig.isPending} disabled={!spreadsheetId.trim()} onClick={() => saveConfig.mutate()}>
                Save configuration
              </Button>
              {status.data.configured ? (
                <Button variant="secondary" size="sm" loading={syncNow.isPending} onClick={() => syncNow.mutate()}>
                  <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                  Sync now
                </Button>
              ) : null}
              <Button variant="ghost" size="sm" className="text-danger hover:text-danger" loading={disconnect.isPending} onClick={() => disconnect.mutate()}>
                <Unplug className="h-3.5 w-3.5" aria-hidden />
                Disconnect
              </Button>
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  );
}
