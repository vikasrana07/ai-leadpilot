'use client';

import { Check, Copy, ExternalLink, Mail, ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardBody, CardHeader, CardTitle } from '@/components/ui/card';
import { API_URL } from '@/lib/api';

export function SesCard() {
  const [copied, setCopied] = useState(false);
  const webhookUrl = `${API_URL}/webhooks/ses`;

  const copyUrl = () => {
    void navigator.clipboard.writeText(webhookUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>
              <Mail className="mr-1.5 inline h-4 w-4" aria-hidden />
              Amazon Simple Email Service (SES) Tracking
            </CardTitle>
            <p className="text-helper mt-0.5">
              Track email deliveries, opens, clicks, bounces, and spam complaints in real-time.
            </p>
          </div>
          <Badge tone="success">
            <ShieldCheck className="mr-1 h-3 w-3 inline" /> Active
          </Badge>
        </div>
      </CardHeader>
      <CardBody className="space-y-4">
        <div>
          <label className="text-label mb-1.5 block">Amazon SNS Ingestion Webhook URL</label>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-lg border border-border bg-muted p-2 font-mono text-[12px]">
              {webhookUrl}
            </code>
            <Button size="sm" variant="secondary" onClick={copyUrl}>
              {copied ? <Check className="h-3.5 w-3.5 text-success" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p className="text-helper mt-1 text-[12px]">
            LeadPilot cryptographically verifies AWS SNS message signatures and automatically confirms incoming subscription requests.
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface p-4 text-[13px] space-y-2">
          <p className="font-medium text-foreground">AWS Configuration Steps:</p>
          <ol className="list-decimal list-inside space-y-1 text-muted-foreground text-[12px]">
            <li>Open the Amazon SES Console and navigate to <strong>Configuration Sets</strong>.</li>
            <li>Add an <strong>Event Destination</strong> targeting an Amazon SNS Topic.</li>
            <li>In Amazon SNS, create an <strong>HTTPS Subscription</strong> with the Webhook URL above.</li>
            <li>LeadPilot will auto-confirm the subscription challenge immediately upon creation.</li>
          </ol>
        </div>

        <div className="pt-2 flex justify-end">
          <Button asChild variant="secondary" size="sm">
            <Link href="/emails">
              View Email Engagement Dashboard <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardBody>
    </Card>
  );
}
