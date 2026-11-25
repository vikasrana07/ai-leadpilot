import { Inject, Injectable, Logger } from '@nestjs/common';
import { DbService } from '../db/db.module.js';
import { RealtimeService } from '../realtime/realtime.module.js';
import { AiTrigger } from '../ai/ai-trigger.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';

export interface TranscriptionResult {
  text: string;
  language?: string;
  confidence?: number;
}

export interface VoiceTranscriptionProvider {
  transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult>;
}

/** Mock provider for deterministic offline execution in dev & CI */
export class MockVoiceTranscriptionProvider implements VoiceTranscriptionProvider {
  async transcribe(_audioBuffer: Buffer, _mimeType: string): Promise<TranscriptionResult> {
    return {
      text: 'Namaste, mujhe Baner mein 2 BHK flat dekhna hai. Budget lagbhag 80 lakh hai.',
      language: 'hi-IN',
      confidence: 0.95,
    };
  }
}

/** Live Whisper provider for real OpenAI API */
export class OpenAiWhisperProvider implements VoiceTranscriptionProvider {
  constructor(private readonly apiKey: string) {}

  async transcribe(audioBuffer: Buffer, mimeType: string): Promise<TranscriptionResult> {
    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
    formData.append('file', blob, 'audio.ogg');
    formData.append('model', 'whisper-1');

    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.apiKey}` },
      body: formData,
    });

    if (!res.ok) {
      throw new Error(`Whisper transcription failed with HTTP ${res.status}: ${await res.text()}`);
    }

    const data = (await res.json()) as { text?: string; language?: string };
    return {
      text: data.text ?? '',
      language: data.language,
      confidence: 0.9,
    };
  }
}

@Injectable()
export class VoiceTranscriptionService {
  private readonly log = new Logger(VoiceTranscriptionService.name);
  private readonly provider: VoiceTranscriptionProvider;

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(RealtimeService) private readonly rt: RealtimeService,
    @Inject(AiTrigger) private readonly aiTrigger: AiTrigger,
    @Inject(ENV) private readonly env: Env,
  ) {
    if (this.env.AI_PROVIDER === 'openai' && this.env.OPENAI_API_KEY) {
      this.provider = new OpenAiWhisperProvider(this.env.OPENAI_API_KEY);
    } else {
      this.provider = new MockVoiceTranscriptionProvider();
    }
  }

  /**
   * Transcribes an inbound voice note, enriches the message body, updates conversation preview,
   * notifies connected agents in realtime, and hands the text over to Asha AI for autonomous lead qualification.
   */
  async transcribeAndEnrich(
    tenantId: string,
    messageId: string,
    audioBuffer: Buffer,
    mimeType = 'audio/ogg',
  ): Promise<TranscriptionResult> {
    this.log.log(`Transcribing voice note for message ${messageId} in tenant ${tenantId}...`);

    const result = await this.provider.transcribe(audioBuffer, mimeType);

    let conversationId: string | undefined;

    await this.db.tenantTx({ tenantId }, async (tx) => {
      const msg = await tx.message.findUnique({
        where: { id: messageId },
        select: { id: true, conversationId: true, media: true },
      });
      if (!msg) return;
      conversationId = msg.conversationId;

      const existingMedia = (msg.media ?? {}) as Record<string, unknown>;
      const updatedMedia = {
        ...existingMedia,
        transcribed: true,
        transcript: result.text,
        detectedLanguage: result.language,
        confidence: result.confidence,
      };

      // Update message body with transcript so UI and search index can read it
      await tx.message.update({
        where: { id: messageId },
        data: {
          body: result.text,
          media: updatedMedia,
        },
      });

      // Update conversation preview snippet
      await tx.conversation.update({
        where: { id: msg.conversationId },
        data: {
          lastMessagePreview: `[Voice Note]: ${result.text.slice(0, 100)}`,
        },
      });
    });

    if (conversationId) {
      // Notify connected browser clients via Server-Sent Events
      this.rt.publish(tenantId, {
        type: 'conversation.updated',
        conversationId,
        assignedMembershipId: null,
        data: {
          messageId,
          transcribed: true,
        },
      });

      // Trigger AI Orchestrator now that the voice note has readable customer text
      this.aiTrigger.fire({
        tenantId,
        conversationId,
        messageId,
      });
    }

    this.log.log(`Voice note ${messageId} transcribed successfully: "${result.text.slice(0, 50)}..."`);
    return result;
  }
}
