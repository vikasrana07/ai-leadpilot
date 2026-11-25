import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import path from 'node:path';
import { v7 as uuidv7 } from 'uuid';
import { OBJECT_STORAGE, type ObjectStorage } from '../ai/knowledge/storage.js';
import { ScannerUnavailableError, VIRUS_SCANNER, type VirusScanner } from '../ai/knowledge/virus-scan.js';
import { AuditService } from '../audit/audit.service.js';
import type { Actor } from '../common/actor.js';
import { DbService } from '../db/db.module.js';

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export interface AttachmentDto {
  id: string;
  leadId: string;
  filename: string;
  mime: string;
  sizeBytes: number;
  createdAt: string;
}

const ALLOWED_EXTS = new Map<string, string>([
  ['.pdf', 'application/pdf'],
  ['.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  ['.txt', 'text/plain'],
  ['.csv', 'text/csv'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

function matchesMagic(buf: Buffer, ext: string): boolean {
  if (ext === '.pdf') return buf.subarray(0, 5).toString('ascii') === '%PDF-';
  if (ext === '.docx') return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (ext === '.png') return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
  if (ext === '.jpg' || ext === '.jpeg') return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  if (ext === '.webp') {
    return buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP';
  }
  if (ext === '.txt' || ext === '.csv') {
    // Reject binary files masquerading as text/csv
    const sample = buf.subarray(0, Math.min(buf.length, 4096));
    return !sample.includes(0);
  }
  return false;
}

@Injectable()
export class LeadAttachmentsService {
  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
  ) {}

  private txCtx(a: Actor) {
    return { tenantId: a.tenantId, ...(a.userId ? { userId: a.userId } : {}) };
  }

  private assertCanRead(a: Actor) {
    if (!a.permissions.has('lead:read:all') && !a.permissions.has('lead:read:own')) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Missing permission to view leads' });
    }
  }

  private assertCanWrite(a: Actor) {
    if (!a.permissions.has('lead:write:all') && !a.permissions.has('lead:write:own')) {
      throw new ForbiddenException({ code: 'forbidden', message: 'Missing permission to edit leads' });
    }
  }

  private scopeWhere(a: Actor, mode: 'read' | 'write', leadId: string) {
    const hasAll = mode === 'read' ? a.permissions.has('lead:read:all') : a.permissions.has('lead:write:all');
    if (hasAll) return { id: leadId, tenantId: a.tenantId, deletedAt: null };
    return { id: leadId, tenantId: a.tenantId, deletedAt: null, assignedMembershipId: a.membershipId ?? '__none__' };
  }

  async list(a: Actor, leadId: string): Promise<AttachmentDto[]> {
    this.assertCanRead(a);
    return this.db.tenantTx(this.txCtx(a), async (tx) => {
      const lead = await tx.lead.findFirst({ where: this.scopeWhere(a, 'read', leadId), select: { id: true } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const rows = await tx.leadAttachment.findMany({
        where: { tenantId: a.tenantId, leadId },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((r) => ({
        id: r.id,
        leadId: r.leadId,
        filename: r.filename,
        mime: r.mime,
        sizeBytes: r.sizeBytes,
        createdAt: r.createdAt.toISOString(),
      }));
    });
  }

  async upload(
    a: Actor,
    leadId: string,
    file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined,
  ): Promise<AttachmentDto> {
    this.assertCanWrite(a);
    if (!file || !file.buffer?.length) {
      throw new BadRequestException({ code: 'file_required', message: 'Please attach a non-empty file' });
    }
    if (file.size > MAX_ATTACHMENT_BYTES) {
      throw new BadRequestException({ code: 'file_too_large', message: 'Files must be 10 MB or smaller' });
    }
    const ext = path.extname(file.originalname).toLowerCase();
    const mime = ALLOWED_EXTS.get(ext);
    if (!mime) {
      throw new BadRequestException({
        code: 'unsupported_file_type',
        message: 'Allowed types: PDF, DOCX, TXT, CSV, PNG, JPG, WEBP',
      });
    }
    if (!matchesMagic(file.buffer, ext)) {
      throw new BadRequestException({
        code: 'invalid_file_content',
        message: 'File content does not match its extension',
      });
    }

    // Verify lead exists and actor has access BEFORE scanning/storing
    await this.db.tenantTx(this.txCtx(a), async (tx) => {
      const lead = await tx.lead.findFirst({ where: this.scopeWhere(a, 'write', leadId), select: { id: true } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
    });

    try {
      const scan = await this.scanner.scan(file.buffer);
      if (!scan.clean) {
        throw new BadRequestException({ code: 'infected_file', message: `File rejected by security scan (${scan.threat})` });
      }
    } catch (e) {
      if (e instanceof ScannerUnavailableError) {
        throw new ServiceUnavailableException({ code: 'scanner_unavailable', message: 'Virus scanner unavailable; please try again shortly' });
      }
      throw e;
    }

    const id = uuidv7();
    const safeName = path.basename(file.originalname).slice(0, 180) || `attachment${ext}`;
    const storageKey = `tenants/${a.tenantId}/leads/${leadId}/${id}`;

    await this.storage.put(storageKey, file.buffer, mime);

    try {
      const row = await this.db.tenantTx(this.txCtx(a), async (tx) => {
        const created = await tx.leadAttachment.create({
          data: {
            id,
            tenantId: a.tenantId,
            leadId,
            uploadedByUserId: a.userId,
            filename: safeName,
            mime,
            sizeBytes: file.size,
            storageKey,
          },
        });
        await tx.leadActivity.create({
          data: {
            id: uuidv7(),
            tenantId: a.tenantId,
            leadId,
            type: 'attachment_added',
            actorUserId: a.userId,
            data: { attachmentId: id, filename: safeName, sizeBytes: file.size },
          },
        });
        await this.audit.record(tx, {
          tenantId: a.tenantId,
          actorUserId: a.userId,
          action: 'lead.attachment_added',
          resourceType: 'lead',
          resourceId: leadId,
          ...(a.requestId ? { requestId: a.requestId } : {}),
          metadata: { attachmentId: id, filename: safeName, sizeBytes: file.size },
        });
        return created;
      });
      return {
        id: row.id,
        leadId: row.leadId,
        filename: row.filename,
        mime: row.mime,
        sizeBytes: row.sizeBytes,
        createdAt: row.createdAt.toISOString(),
      };
    } catch (e) {
      await this.storage.delete(storageKey).catch(() => undefined);
      throw e;
    }
  }

  async download(a: Actor, leadId: string, attachmentId: string): Promise<{ filename: string; data: Buffer }> {
    this.assertCanRead(a);
    const row = await this.db.tenantTx(this.txCtx(a), async (tx) => {
      const lead = await tx.lead.findFirst({ where: this.scopeWhere(a, 'read', leadId), select: { id: true } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      return tx.leadAttachment.findFirst({ where: { id: attachmentId, tenantId: a.tenantId, leadId } });
    });
    if (!row) throw new NotFoundException({ code: 'not_found', message: 'Attachment not found' });
    const data = await this.storage.get(row.storageKey);
    return { filename: row.filename, data };
  }

  async remove(a: Actor, leadId: string, attachmentId: string): Promise<void> {
    this.assertCanWrite(a);
    const row = await this.db.tenantTx(this.txCtx(a), async (tx) => {
      const lead = await tx.lead.findFirst({ where: this.scopeWhere(a, 'write', leadId), select: { id: true } });
      if (!lead) throw new NotFoundException({ code: 'not_found', message: 'Lead not found' });
      const att = await tx.leadAttachment.findFirst({ where: { id: attachmentId, tenantId: a.tenantId, leadId } });
      if (!att) throw new NotFoundException({ code: 'not_found', message: 'Attachment not found' });
      await tx.leadAttachment.delete({ where: { id: att.id } });
      await tx.leadActivity.create({
        data: {
          id: uuidv7(),
          tenantId: a.tenantId,
          leadId,
          type: 'attachment_deleted',
          actorUserId: a.userId,
          data: { attachmentId: att.id, filename: att.filename },
        },
      });
      await this.audit.record(tx, {
        tenantId: a.tenantId,
        actorUserId: a.userId,
        action: 'lead.attachment_deleted',
        resourceType: 'lead',
        resourceId: leadId,
        ...(a.requestId ? { requestId: a.requestId } : {}),
        metadata: { attachmentId: att.id, filename: att.filename },
      });
      return att;
    });
    await this.storage.delete(row.storageKey).catch(() => undefined);
  }
}
