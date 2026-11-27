import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { detectPromise } from '../conversations/promise-tracker.js';
import { ENV } from '../common/tokens.js';
import type { Env } from '../config/env.js';
import {
  MockVoiceTranscriptionProvider,
  OpenAiWhisperProvider,
} from '../conversations/voice-transcription.service.js';
import { DbService } from '../db/db.module.js';
import { parseMoney } from './lead-import.service.js';

export interface VoiceExtraction {
  note: string;
  updates: {
    budgetMin?: number;
    budgetMax?: number;
    location?: string;
    propertyType?: string;
    buyingTimeline?: 'IMMEDIATE' | 'ONE_TO_THREE_MONTHS' | 'THREE_TO_SIX_MONTHS' | 'SIX_PLUS_MONTHS' | 'UNKNOWN';
    requirements?: string;
  };
  suggestedTask?: {
    title: string;
    dueAt: string;
  };
}

/**
 * Deterministic field extractor for English & Hinglish field-agent voice notes.
 * Used in offline/mock mode and as a fallback if structured LLM extraction is unavailable.
 */
export function extractVoiceFields(transcript: string, now = new Date()): VoiceExtraction {
  const text = transcript.trim();
  const updates: VoiceExtraction['updates'] = {};

  // Budget: e.g., "80 lakh", "1.2 cr", "₹92L", "budget 85L"
  const budgetMatch = text.match(/(?:₹|rs\.?\s*)?\d+(?:\.\d+)?\s*(?:cr(?:ore)?s?|l(?:akh|ac)?s?|k)\b/i);
  if (budgetMatch) {
    const parsed = parseMoney(budgetMatch[0]);
    if (parsed && parsed > 0) {
      updates.budgetMax = parsed;
    }
  }

  // Property / unit type: e.g., "2 BHK", "3BHK", "villa", "plot", "office"
  const propMatch = text.match(/\b(\d\s*bhk|villa|penthouse|plot|studio|duplex|commercial|office|shop)\b/i);
  if (propMatch) {
    updates.propertyType = propMatch[1]!.replace(/\s+/g, ' ').toUpperCase();
  }

  // Location: "at Wakad", "in Baner", "Baner mein"
  const locEn = text.match(/\b(?:at|in|near)\s+([A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?)/);
  const locHi = text.match(/\b([A-Z][a-zA-Z]+)\s+mein\b/);
  const loc = locEn?.[1] ?? locHi?.[1];
  if (loc && !/^(January|February|March|April|May|June|July|August|September|October|November|December|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/i.test(loc)) {
    updates.location = loc.trim();
  }

  // Timeline
  if (/\b(immediate|urgent|this week|this month|asap)\b/i.test(text)) {
    updates.buyingTimeline = 'IMMEDIATE';
  } else if (/\b(next month|1-3 months|2 months|3 months)\b/i.test(text)) {
    updates.buyingTimeline = 'ONE_TO_THREE_MONTHS';
  }

  // Follow-up task
  let suggestedTask: VoiceExtraction['suggestedTask'] | undefined;
  if (/\b(follow[\s-]?up|call back|call|visit|meet)\b/i.test(text)) {
    const due = new Date(now.getTime() + 24 * 3_600_000);
    due.setHours(11, 0, 0, 0);
    if (/\btoday\b/i.test(text)) {
      due.setTime(now.getTime() + 2 * 3_600_000);
    } else if (/\bnext week\b/i.test(text)) {
      due.setTime(now.getTime() + 7 * 86_400_000);
      due.setHours(11, 0, 0, 0);
    }
    suggestedTask = {
      title: `Follow up: ${text.slice(0, 80)}`,
      dueAt: due.toISOString(),
    };
  }

  return {
    note: text,
    updates,
    ...(suggestedTask ? { suggestedTask } : {}),
  };
}

@Injectable()
export class LeadVoiceService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Optional() @Inject(ENV) private readonly env?: Env,
  ) {}

  private assertCanWrite(a: Actor) {
    if (!a.permissions.has('lead:write:all') && !a.permissions.has('lead:write:own')) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Missing permission to edit leads' });
    }
  }

  private scopeWhere(a: Actor, leadId: string) {
    if (a.permissions.has('lead:write:all')) return { id: leadId, tenantId: a.tenantId, deletedAt: null };
    return { id: leadId, tenantId: a.tenantId, deletedAt: null, assignedMembershipId: a.membershipId ?? '__none__' };
  }

  async transcribeAndExtract(
    a: Actor,
    leadId: string,
    file?: { originalname: string; mimetype: string; buffer: Buffer; size: number },
    transcriptOverride?: string,
  ) {
    this.assertCanWrite(a);
    await this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: this.scopeWhere(a, leadId), select: { id: true } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
    });

    let transcript = transcriptOverride?.trim() ?? '';
    let language = 'en';

    if (!transcript) {
      if (!file || !file.buffer?.length) {
        throw new BadRequestException({ code: 'audio_required', message: 'Please record audio or enter a voice note transcript' });
      }
      const useOpenAi = this.env?.AI_PROVIDER === 'openai' && Boolean(this.env?.OPENAI_API_KEY);
      const provider = useOpenAi
        ? new OpenAiWhisperProvider(this.env!.OPENAI_API_KEY!)
        : new MockVoiceTranscriptionProvider();
      const res = await provider.transcribe(file.buffer, file.mimetype || 'audio/webm');
      transcript = res.text;
      language = res.language ?? 'en';
    }

    const extraction = extractVoiceFields(transcript);
    return { transcript, language, extraction };
  }

  async applyExtraction(
    a: Actor,
    leadId: string,
    input: {
      note: string;
      updates?: VoiceExtraction['updates'];
      task?: { title: string; dueAt?: string };
    },
  ) {
    this.assertCanWrite(a);
    return this.db.tenantTx({ tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) }, async (tx) => {
      const lead = await tx.lead.findFirst({ where: this.scopeWhere(a, leadId) });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });

      // 1. Add note
      let noteId: string | null = null;
      if (a.userId && input.note.trim()) {
        const noteRow = await tx.leadNote.create({
          data: {
            id: uuidv7(),
            tenantId: a.tenantId,
            leadId,
            authorUserId: a.userId,
            body: input.note.trim(),
          },
        });
        noteId = noteRow.id;
      }

      // 2. Patch extracted lead fields
      const u = input.updates ?? {};
      const patch: Record<string, unknown> = {};
      if (typeof u.budgetMin === 'number' && u.budgetMin > 0) patch.budgetMinMinor = BigInt(Math.round(u.budgetMin * 100));
      if (typeof u.budgetMax === 'number' && u.budgetMax > 0) patch.budgetMaxMinor = BigInt(Math.round(u.budgetMax * 100));
      if (u.location) patch.location = u.location;
      if (u.propertyType) patch.propertyType = u.propertyType;
      if (u.buyingTimeline) patch.buyingTimeline = u.buyingTimeline;
      if (u.requirements) patch.requirements = u.requirements;

      if (Object.keys(patch).length > 0) {
        await tx.lead.update({ where: { id: leadId }, data: patch });
      }

      // 3. Create follow-up task if provided (or auto-capture promise from voice note)
      let taskId: string | null = null;
      const detectedPromise = !input.task?.title?.trim() ? detectPromise(input.note) : null;
      const taskTitle = input.task?.title?.trim() || detectedPromise?.title || '';
      if (taskTitle) {
        const t = await tx.task.create({
          data: {
            id: uuidv7(),
            tenantId: a.tenantId,
            leadId,
            assigneeMembershipId: a.membershipId ?? lead.assignedMembershipId,
            title: taskTitle.slice(0, 200),
            dueAt: input.task?.dueAt ? new Date(input.task.dueAt) : (detectedPromise?.dueAt ?? null),
            source: detectedPromise ? 'promise_tracker' : 'voice_note',
            ...(detectedPromise ? { notes: JSON.stringify({ kind: 'promise', snippet: detectedPromise.snippet, suggestedFollowUp: detectedPromise.suggestedFollowUp }) } : {}),
          },
        });
        taskId = t.id;
      }

      await tx.leadActivity.create({
        data: {
          id: uuidv7(),
          tenantId: a.tenantId,
          leadId,
          type: 'voice_note_applied',
          actorUserId: a.userId,
          data: { ...(noteId ? { noteId } : {}), updatedFields: Object.keys(patch), ...(taskId ? { taskId } : {}) },
        },
      });

      await this.audit.record(tx, {
        tenantId: a.tenantId,
        actorUserId: a.userId,
        action: 'lead.voice_note_applied',
        resourceType: 'lead',
        resourceId: leadId,
        ...(a.requestId ? { requestId: a.requestId } : {}),
        metadata: { ...(noteId ? { noteId } : {}), updatedFields: Object.keys(patch), ...(taskId ? { taskId } : {}) },
      });

      return { ok: true, noteId, taskId, updatedFields: Object.keys(patch) };
    });
  }
}
