'use client';

import { Check, Info, RefreshCw, Send, X } from 'lucide-react';
import { Card, CardBody } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface DeliveryGaugeProps {
  sentCount: number;
  deliveredCount: number;
  autoRetry?: boolean;
  autoRetryCount?: number;
  nextRetryAt?: string | null;
  status?: string;
  isSample?: boolean;
}

export function DeliveryGauge({
  sentCount,
  deliveredCount,
  autoRetry = true,
  autoRetryCount = 0,
  nextRetryAt,
  status: _status,
  isSample = false,
}: DeliveryGaugeProps) {
  // Compute percentages
  const deliveryPct = isSample
    ? 90
    : sentCount > 0
    ? Math.min(100, Math.round((deliveredCount / sentCount) * 100))
    : 0;

  // Breakdown for initial send + retries
  const firstSendPct = isSample ? 82 : Math.max(0, deliveryPct - (autoRetryCount > 0 ? autoRetryCount * 4 : 0));
  const retry1Gain = isSample ? 6 : autoRetryCount >= 1 ? Math.min(6, deliveryPct - firstSendPct) : 0;
  const retry2Gain = isSample ? 2 : autoRetryCount >= 2 ? Math.max(0, deliveryPct - firstSendPct - retry1Gain) : 0;

  // SVG circular gauge calculations
  const strokeWidth = 14;
  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (deliveryPct / 100) * circumference;

  return (
    <Card className="overflow-hidden border-border/80 bg-gradient-to-br from-card via-card to-card/60 shadow-sm">
      <CardBody className="p-5 sm:p-6 space-y-6">
        {/* Top Header */}
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <Badge tone="success" className="text-[11px] gap-1 font-semibold">
                <RefreshCw className="w-3 h-3 animate-spin-slow" />
                Smart auto-retries
              </Badge>
              {autoRetry ? (
                <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
                  Auto retry: <strong>ON</strong> {autoRetryCount > 0 && `(Attempt ${autoRetryCount}/3)`}
                </span>
              ) : (
                <span className="text-[11px] text-muted-foreground font-medium">
                  Auto retry: <strong>OFF</strong>
                </span>
              )}
            </div>
            <h3 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">
              Up to {isSample ? '90%' : `${deliveryPct}%`} of messages delivered
            </h3>
            <p className="text-xs sm:text-sm text-muted-foreground max-w-xl leading-relaxed">
              Some phones are off or out of network when a campaign goes out. Those messages are sent again on their own, after a gap you choose.
            </p>
          </div>

          {nextRetryAt && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs">
              <span className="text-muted-foreground block text-[10px] uppercase font-semibold">Next Scheduled Retry</span>
              <span className="font-semibold text-primary">{new Date(nextRetryAt).toLocaleString()}</span>
            </div>
          )}
        </div>

        {/* Retryable vs Skipped Reasons Checklist */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Check className="h-2.5 w-2.5 stroke-[3]" />
              </div>
              <span>Phone switched off</span>
            </div>
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Retried</span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                <Check className="h-2.5 w-2.5 stroke-[3]" />
              </div>
              <span>Out of network</span>
            </div>
            <span className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">Retried</span>
          </div>

          <div className="flex items-center justify-between rounded-lg border border-border/60 bg-muted/30 px-3 py-2 text-xs">
            <div className="flex items-center gap-2 text-foreground font-medium">
              <div className="flex h-4 w-4 items-center justify-center rounded-full bg-rose-500/15 text-rose-600 dark:text-rose-400">
                <X className="h-2.5 w-2.5 stroke-[3]" />
              </div>
              <span>Not on WhatsApp</span>
            </div>
            <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">Skipped</span>
          </div>
        </div>

        {/* Circular Gauge Card */}
        <div className="rounded-xl border border-border/70 bg-card p-4 sm:p-5 shadow-sm">
          <div className="flex flex-col md:flex-row items-center justify-around gap-6">
            {/* SVG Ring Gauge */}
            <div className="relative flex items-center justify-center">
              <svg className="h-36 w-36 -rotate-90 transform" viewBox="0 0 140 140">
                {/* Track */}
                <circle
                  cx="70"
                  cy="70"
                  r={radius}
                  className="stroke-muted/40"
                  strokeWidth={strokeWidth}
                  fill="transparent"
                />
                {/* Progress */}
                <circle
                  cx="70"
                  cy="70"
                  r={radius}
                  className="stroke-emerald-500 transition-all duration-1000 ease-out"
                  strokeWidth={strokeWidth}
                  strokeDasharray={circumference}
                  strokeDashoffset={offset}
                  strokeLinecap="round"
                  fill="transparent"
                />
              </svg>
              <div className="absolute flex flex-col items-center justify-center text-center">
                <span className="text-2xl sm:text-3xl font-extrabold tracking-tight text-foreground">
                  {deliveryPct}%
                </span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  delivered
                </span>
              </div>
            </div>

            {/* Breakdown List */}
            <div className="flex-1 max-w-sm space-y-3 w-full">
              <div className="flex items-center justify-between py-1 border-b border-border/40 text-xs">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-foreground">
                    <Send className="h-3 w-3" />
                  </div>
                  <div>
                    <span className="font-semibold text-foreground">First send</span>
                    <p className="text-[10px] text-muted-foreground">Initial broadcast</p>
                  </div>
                </div>
                <span className="text-sm font-bold text-foreground">{firstSendPct}%</span>
              </div>

              {(autoRetryCount >= 1 || isSample) && (
                <div className="flex items-center justify-between py-1 border-b border-border/40 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <RefreshCw className="h-3 w-3" />
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Auto-retry 1</span>
                      <p className="text-[10px] text-muted-foreground">24 hours later</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{retry1Gain}%</span>
                </div>
              )}

              {(autoRetryCount >= 2 || isSample) && (
                <div className="flex items-center justify-between py-1 border-b border-border/40 text-xs">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-6 w-6 items-center justify-center rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                      <RefreshCw className="h-3 w-3" />
                    </div>
                    <div>
                      <span className="font-semibold text-foreground">Auto-retry 2</span>
                      <p className="text-[10px] text-muted-foreground">48 hours later</p>
                    </div>
                  </div>
                  <span className="text-sm font-bold text-emerald-600 dark:text-emerald-400">+{retry2Gain}%</span>
                </div>
              )}
            </div>
          </div>

          {/* Footnote Notice */}
          <div className="mt-4 flex items-center justify-between gap-2 rounded-lg bg-muted/40 p-2.5 text-[11px] text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span>Only undelivered messages are sent again, so nobody gets the same offer twice.</span>
            </div>
            {isSample && (
              <span className="shrink-0 text-[10px] font-medium text-muted-foreground/70">Sample campaign</span>
            )}
          </div>
        </div>
      </CardBody>
    </Card>
  );
}
