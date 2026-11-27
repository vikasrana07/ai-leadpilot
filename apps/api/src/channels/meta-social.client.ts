import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export interface MetaSocialSentItem {
  channelType: 'MESSENGER' | 'INSTAGRAM';
  externalId: string;
  recipientId: string;
  text: string;
  messageId: string;
}

@Injectable()
export class MetaSocialClient {
  private readonly log = new Logger('MetaSocial');
  readonly sent: MetaSocialSentItem[] = [];

  constructor(@Optional() @Inject(ENV) private readonly env?: Env) {}

  async sendText(
    channelType: 'MESSENGER' | 'INSTAGRAM',
    externalId: string,
    accessToken: string,
    recipientId: string,
    text: string,
  ): Promise<{ messageId: string }> {
    if (this.env?.WHATSAPP_MODE !== 'live') {
      const messageId = `ms_${Date.now()}_${this.sent.length + 1}`;
      this.sent.push({ channelType, externalId, recipientId, text, messageId });
      return { messageId };
    }

    const res = await fetch(
      `https://graph.facebook.com/v21.0/${encodeURIComponent(externalId)}/messages?access_token=${encodeURIComponent(accessToken)}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          recipient: { id: recipientId },
          messaging_type: 'RESPONSE',
          message: { text },
        }),
      },
    );
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      this.log.warn(`${channelType} send failed (${res.status}): ${errText.slice(0, 200)}`);
      throw new Error(`${channelType} API error (${res.status})`);
    }
    const json = (await res.json()) as { message_id?: string };
    return { messageId: json.message_id ?? `ms_${Date.now()}` };
  }
}
