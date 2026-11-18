'use client';

import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { DEFAULT_ALERT_SETTINGS, type AlertSettings } from '@/lib/alerts';

export const ALERT_SETTINGS_KEY = ['alert-settings'] as const;
export const fetchAlertSettings = () => api<AlertSettings>('/me/alert-settings');

/** The signed-in person's sound and desktop-alert settings (saved on their account, so they follow them across devices). */
export function useAlertSettings() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ALERT_SETTINGS_KEY, queryFn: fetchAlertSettings, staleTime: 5 * 60_000 });
  const save = useMutation({
    mutationFn: (s: AlertSettings) => api<AlertSettings>('/me/alert-settings', { method: 'PUT', body: s }),
    // Optimistic: the switch and the slider move at once; they snap back if the server refuses.
    onMutate: async (s) => { await qc.cancelQueries({ queryKey: ALERT_SETTINGS_KEY }); const prev = qc.getQueryData<AlertSettings>(ALERT_SETTINGS_KEY); qc.setQueryData(ALERT_SETTINGS_KEY, s); return { prev }; },
    onError: (_e, _s, ctx) => { if (ctx?.prev) qc.setQueryData(ALERT_SETTINGS_KEY, ctx.prev); },
    // No refetch on success: the cache already holds what was saved, and a refetch racing a later change (a dragged slider) would bring back an older value.
  });
  const settings = q.data ?? DEFAULT_ALERT_SETTINGS;
  return { settings, loaded: q.isSuccess, saving: save.isPending, update: (patch: Partial<AlertSettings>) => save.mutate({ ...(qc.getQueryData<AlertSettings>(ALERT_SETTINGS_KEY) ?? settings), ...patch }) };
}

/** The loaded settings, or null while they are still loading (callers then stay quiet rather than guess). */
export function readAlertSettings(qc: QueryClient): AlertSettings | null { return qc.getQueryData<AlertSettings>(ALERT_SETTINGS_KEY) ?? null; }
