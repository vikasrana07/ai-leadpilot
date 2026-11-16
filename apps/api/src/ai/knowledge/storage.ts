import { CreateBucketCommand, DeleteObjectCommand, DeleteObjectsCommand, ListObjectsV2Command, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import { ENV } from '../../common/tokens.js';
import type { Env } from '../../config/env.js';

/** Tenant files live under `tenants/<tenantId>/…`; every key is built server-side from validated ids, never from user input. */
export interface ObjectStorage {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  delete(key: string): Promise<void>;
  /** Deletes every object under a prefix (tenant purge). Returns how many were deleted. */
  deletePrefix(prefix: string): Promise<number>;
}
export const OBJECT_STORAGE = Symbol('OBJECT_STORAGE');

@Injectable()
export class S3Storage implements ObjectStorage, OnModuleInit {
  private readonly log = new Logger('S3');
  private readonly s3: S3Client;
  private readonly bucket: string;
  constructor(@Inject(ENV) env: Env) {
    this.bucket = env.S3_BUCKET;
    this.s3 = new S3Client({
      region: env.S3_REGION, ...(env.S3_ENDPOINT ? { endpoint: env.S3_ENDPOINT } : {}), forcePathStyle: env.S3_FORCE_PATH_STYLE,
      ...(env.S3_ACCESS_KEY && env.S3_SECRET_KEY ? { credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY } } : {}),
    });
  }

  async onModuleInit(): Promise<void> {
    try { await this.s3.send(new HeadBucketCommand({ Bucket: this.bucket })); }
    catch {
      try { await this.s3.send(new CreateBucketCommand({ Bucket: this.bucket })); this.log.log(`Created bucket ${this.bucket}`); }
      catch (e) { this.log.error(`Object storage unavailable: ${e instanceof Error ? e.message : String(e)}`); }
    }
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.s3.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: body, ContentType: contentType, ServerSideEncryption: undefined }));
  }
  async get(key: string): Promise<Buffer> {
    const r = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    return Buffer.from(await (r.Body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray());
  }
  async delete(key: string): Promise<void> { await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key })); }
  async deletePrefix(prefix: string): Promise<number> {
    if (!prefix.startsWith('tenants/') || !prefix.endsWith('/') || prefix.length < 'tenants/x/'.length) throw new Error('refusing to delete an unsafe prefix');
    let total = 0; let token: string | undefined;
    do {
      const page = await this.s3.send(new ListObjectsV2Command({ Bucket: this.bucket, Prefix: prefix, ContinuationToken: token }));
      const keys = (page.Contents ?? []).flatMap((o) => (o.Key ? [{ Key: o.Key }] : []));
      if (keys.length) { await this.s3.send(new DeleteObjectsCommand({ Bucket: this.bucket, Delete: { Objects: keys, Quiet: true } })); total += keys.length; }
      token = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (token);
    return total;
  }
}
