import { EntitlementsService } from '../../billing/entitlements.service.js';
import { BadRequestException, Inject, Injectable, Logger, NotFoundException, PayloadTooLargeException, ServiceUnavailableException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@leadpilot/database';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { AuditService } from '../../audit/audit.service.js';
import type { TenantRequestContext } from '../../common/request-context.js';
import { DbService } from '../../db/db.module.js';
import { EMBEDDING_PROVIDER, type EmbeddingProvider } from '../llm.js';
import { chunkText, detectKind, extractText, stripInjection, type DocKind } from './extract.js';
import { OBJECT_STORAGE, type ObjectStorage } from './storage.js';
import { ScannerUnavailableError, VIRUS_SCANNER, type VirusScanner } from './virus-scan.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export interface KnowledgeHit { chunkId: string; documentId: string; title: string; content: string; score: number }

const vec = (v: number[]) => `[${v.map((x) => Number(x.toFixed(6))).join(',')}]`;

@Injectable()
export class KnowledgeService {
  private readonly log = new Logger('Knowledge');
  private readonly pending = new Set<Promise<void>>();

  constructor(
    @Inject(DbService) private readonly db: DbService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(VIRUS_SCANNER) private readonly scanner: VirusScanner,
    @Inject(EMBEDDING_PROVIDER) private readonly embeddings: EmbeddingProvider,
    @Inject(EntitlementsService) private readonly ent: EntitlementsService,
  ) {}

  /** Resolves when all background processing has finished (used by tests and graceful shutdown). */
  async idle(): Promise<void> { while (this.pending.size) await Promise.all([...this.pending]); }

  private rec(ctx: TenantRequestContext, tx: Parameters<AuditService['record']>[0], action: string, id: string, metadata: Record<string, string | number> = {}) {
    return this.audit.record(tx, { tenantId: ctx.tenantId, actorUserId: ctx.userId, action, resourceType: 'knowledge_document', resourceId: id, metadata, requestId: ctx.requestId, ip: ctx.ip });
  }

  /** Pipeline steps 1–3: validate type/size/content, scan, store. Steps 4–10 (extract, chunk, embed, index) run in the background. */
  async upload(ctx: TenantRequestContext, file: { originalname: string; mimetype: string; buffer: Buffer; size: number } | undefined, meta: { title?: string; category?: string }) {
    if (!file) throw new BadRequestException({ code: 'file_required', message: 'Choose a file to upload' });
    if (file.size > MAX_UPLOAD_BYTES) throw new PayloadTooLargeException({ code: 'file_too_large', message: 'Files can be up to 10 MB' });
    await this.ent.assertCanAdd(ctx.tenantId, 'knowledge_mb', 'MB of knowledge storage', Math.max(1, Math.ceil(file.size / 1048576)));
    const filename = file.originalname.replace(/[^\w.\- ]/g, '_').slice(0, 120) || 'document';
    const kind = detectKind(filename, file.mimetype, file.buffer);
    if (!kind) throw new UnprocessableEntityException({ code: 'unsupported_file', message: 'Upload a PDF, DOCX, TXT or CSV file. The file contents must match its type.' });
    try {
      const r = await this.scanner.scan(file.buffer);
      if (!r.clean) { await this.db.tenantTx(ctx, (tx) => this.rec(ctx, tx, 'knowledge.upload_blocked', '00000000-0000-0000-0000-000000000000', { threat: r.threat, filename })); throw new UnprocessableEntityException({ code: 'malware_detected', message: 'This file was blocked by the virus scanner.' }); }
    } catch (e) {
      if (e instanceof ScannerUnavailableError) throw new ServiceUnavailableException({ code: 'scanner_unavailable', message: 'File scanning is unavailable right now, so the upload was not accepted. Please try again shortly.' });
      throw e;
    }
    const id = uuidv7();
    const storageKey = `tenants/${ctx.tenantId}/knowledge/${id}/${filename}`;
    await this.storage.put(storageKey, file.buffer, file.mimetype);
    const doc = await this.db.tenantTx(ctx, async (tx) => {
      const d = await tx.knowledgeDocument.create({ data: { id, tenantId: ctx.tenantId, title: meta.title?.trim() || filename.replace(/\.[^.]+$/, ''), filename, mime: file.mimetype, sizeBytes: file.size, sha256: createHash('sha256').update(file.buffer).digest('hex'), storageKey, category: meta.category?.trim() || null, uploadedByUserId: ctx.userId } });
      await this.rec(ctx, tx, 'knowledge.uploaded', id, { filename, bytes: file.size });
      return d;
    });
    this.kick(ctx.tenantId, id, kind, file.buffer);
    return this.view(doc);
  }

  private kick(tenantId: string, id: string, kind: DocKind, data?: Buffer): void {
    const p = this.process(tenantId, id, kind, data).catch((e) => this.log.error(`process ${id}: ${e instanceof Error ? e.message : String(e)}`)).finally(() => { this.pending.delete(p); });
    this.pending.add(p);
  }

  /** Extract text, chunk, embed, index. Failures are recorded on the document with a customer-safe message. */
  private async process(tenantId: string, id: string, kind: DocKind, data?: Buffer): Promise<void> {
    await this.db.tenantTx({ tenantId }, (tx) => tx.knowledgeDocument.update({ where: { id }, data: { status: 'PROCESSING', error: null } }));
    try {
      const doc = await this.db.tenantTx({ tenantId }, (tx) => tx.knowledgeDocument.findUniqueOrThrow({ where: { id } }));
      const bytes = data ?? (await this.storage.get(doc.storageKey));
      const raw = await extractText(kind, bytes);
      const { text, removed } = stripInjection(raw);
      if (text.length < 20) throw new Error('No readable text was found in this file');
      const chunks = chunkText(text);
      const vectors: number[][] = [];
      for (let i = 0; i < chunks.length; i += 64) vectors.push(...(await this.embeddings.embed(chunks.slice(i, i + 64))));
      await this.db.tenantTx({ tenantId }, async (tx) => {
        await tx.knowledgeChunk.deleteMany({ where: { documentId: id } });
        for (const [i, c] of chunks.entries()) {
          await tx.$executeRaw`INSERT INTO knowledge_chunks (id, tenant_id, document_id, ordinal, content, embedding, embedding_model) VALUES (${uuidv7()}::uuid, ${tenantId}::uuid, ${id}::uuid, ${i}, ${c}, ${vec(vectors[i] as number[])}::vector, ${this.embeddings.model})`;
        }
        await tx.knowledgeDocument.update({ where: { id }, data: { status: 'READY', chunkCount: chunks.length, error: removed ? `${removed} sentence${removed === 1 ? '' : 's'} that looked like instructions to the AI ${removed === 1 ? 'was' : 'were'} left out of the knowledge base.` : null } });
      });
    } catch (e) {
      const message = e instanceof Error && /readable text/.test(e.message) ? e.message : 'We could not process this file. Try re-uploading it, or upload it as text.';
      this.log.warn(`Document ${id} failed: ${e instanceof Error ? e.message : String(e)}`);
      await this.db.tenantTx({ tenantId }, (tx) => tx.knowledgeDocument.update({ where: { id }, data: { status: 'FAILED', error: message } }));
    }
  }

  private view(d: Prisma.KnowledgeDocumentGetPayload<object>) {
    return { id: d.id, title: d.title, filename: d.filename, mime: d.mime, sizeBytes: d.sizeBytes, status: d.status, error: d.error, chunkCount: d.chunkCount, category: d.category, createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString() };
  }

  list(ctx: TenantRequestContext) {
    return this.db.tenantTx(ctx, async (tx) => (await tx.knowledgeDocument.findMany({ where: { tenantId: ctx.tenantId, deletedAt: null }, orderBy: { createdAt: 'desc' } })).map((d) => this.view(d)));
  }

  async get(ctx: TenantRequestContext, id: string) {
    return this.db.tenantTx(ctx, async (tx) => {
      const d = await tx.knowledgeDocument.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } });
      if (!d) throw new NotFoundException({ code: 'not_found', message: 'Document not found' });
      const chunks = await tx.knowledgeChunk.findMany({ where: { documentId: id }, orderBy: { ordinal: 'asc' }, take: 6, select: { ordinal: true, content: true } });
      return { ...this.view(d), preview: chunks.map((c) => c.content) };
    });
  }

  async download(ctx: TenantRequestContext, id: string) {
    const d = await this.db.tenantTx(ctx, (tx) => tx.knowledgeDocument.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }));
    if (!d || !d.storageKey.startsWith(`tenants/${ctx.tenantId}/`)) throw new NotFoundException({ code: 'not_found', message: 'Document not found' });
    return { data: await this.storage.get(d.storageKey), filename: d.filename, mime: d.mime };
  }

  async update(ctx: TenantRequestContext, id: string, input: { title?: string | undefined; category?: string | null | undefined }) {
    return this.db.tenantTx(ctx, async (tx) => {
      const r = await tx.knowledgeDocument.updateMany({ where: { id, tenantId: ctx.tenantId, deletedAt: null }, data: { ...(input.title !== undefined ? { title: input.title } : {}), ...(input.category !== undefined ? { category: input.category } : {}) } });
      if (r.count !== 1) throw new NotFoundException({ code: 'not_found', message: 'Document not found' });
      return this.view(await tx.knowledgeDocument.findUniqueOrThrow({ where: { id } }));
    });
  }

  async reprocess(ctx: TenantRequestContext, id: string) {
    const d = await this.db.tenantTx(ctx, (tx) => tx.knowledgeDocument.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } }));
    if (!d) throw new NotFoundException({ code: 'not_found', message: 'Document not found' });
    const kind = detectKind(d.filename, d.mime, await this.storage.get(d.storageKey));
    if (!kind) throw new UnprocessableEntityException({ code: 'unsupported_file', message: 'This file can no longer be read' });
    await this.db.tenantTx(ctx, async (tx) => { await tx.knowledgeDocument.update({ where: { id }, data: { status: 'PENDING', error: null } }); await this.rec(ctx, tx, 'knowledge.reprocessed', id); });
    this.kick(ctx.tenantId, id, kind);
    return { id, status: 'PENDING' as const };
  }

  async remove(ctx: TenantRequestContext, id: string): Promise<void> {
    const key = await this.db.tenantTx(ctx, async (tx) => {
      const d = await tx.knowledgeDocument.findFirst({ where: { id, tenantId: ctx.tenantId, deletedAt: null } });
      if (!d) throw new NotFoundException({ code: 'not_found', message: 'Document not found' });
      await tx.knowledgeChunk.deleteMany({ where: { documentId: id } });
      await tx.knowledgeDocument.update({ where: { id }, data: { deletedAt: new Date() } });
      await this.rec(ctx, tx, 'knowledge.deleted', id, { filename: d.filename });
      return d.storageKey;
    });
    await this.storage.delete(key).catch((e) => this.log.warn(`Could not delete object ${key}: ${e instanceof Error ? e.message : String(e)}`));
  }

  /**
   * Semantic search. The tenant id comes from the caller's validated context and is applied BOTH as an explicit filter and by
   * RLS; deleted or unfinished documents are excluded.
   */
  async search(tenantId: string, query: string, limit = 5, minScore = 0.2): Promise<KnowledgeHit[]> {
    const [qv] = await this.embeddings.embed([query]);
    const v = vec(qv as number[]);
    const rows = await this.db.tenantTx({ tenantId }, (tx) => tx.$queryRaw<{ id: string; document_id: string; title: string; content: string; score: number }[]>`
      SELECT c.id, c.document_id, d.title, c.content, (1 - (c.embedding <=> ${v}::vector))::float AS score
      FROM knowledge_chunks c JOIN knowledge_documents d ON d.id = c.document_id
      WHERE c.tenant_id = ${tenantId}::uuid AND d.tenant_id = ${tenantId}::uuid AND d.deleted_at IS NULL AND d.status = 'READY'
      ORDER BY c.embedding <=> ${v}::vector LIMIT ${Math.min(limit, 10)}`);
    return rows.filter((r) => r.score >= minScore).map((r) => ({ chunkId: r.id, documentId: r.document_id, title: r.title, content: r.content, score: Math.round(r.score * 1000) / 1000 }));
  }
}
