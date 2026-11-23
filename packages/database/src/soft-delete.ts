import { Prisma } from './generated/client.js';

export const SOFT_DELETE_MODELS = new Set(['Lead', 'Property', 'KnowledgeDocument']);

export interface SoftDeleteOptions {
  withDeleted?: boolean;
}

/** Query args are dynamic across models inside a generic `$allModels` hook, so they are modelled as plain objects. */
type QueryArgs = Record<string, unknown>;
type Where = Record<string, unknown>;
interface HookParams { model: string; args: QueryArgs; query: (args: QueryArgs) => Promise<unknown> }

const whereOf = (a: QueryArgs): Where | undefined => a.where as Where | undefined;

/**
 * Strips `withDeleted` flag from args and args.where if present.
 * If withDeleted is false/undefined, ensures `where.deletedAt: null` is injected
 * unless an explicit `deletedAt` condition is already present in `where`.
 */
export function applySoftDeleteArgs(args: QueryArgs | undefined): { args: QueryArgs; withDeleted: boolean } {
  const a: QueryArgs = args ? { ...args } : {};
  const withDeleted = Boolean(a.withDeleted || whereOf(a)?.withDeleted);

  if (a.withDeleted !== undefined) {
    delete a.withDeleted;
  }
  if (a.where) {
    const where: Where = { ...(a.where as Where) };
    if (where.withDeleted !== undefined) {
      delete where.withDeleted;
    }
    a.where = where;
  }

  if (!withDeleted) {
    if (!a.where) {
      a.where = { deletedAt: null };
    } else if ((a.where as Where).deletedAt === undefined) {
      (a.where as Where).deletedAt = null;
    }
  }

  return { args: a, withDeleted };
}

/** List/aggregate operations: inject `deletedAt: null` unless the caller opts out. */
const filtered = async ({ model, args, query }: HookParams): Promise<unknown> => {
  if (SOFT_DELETE_MODELS.has(model)) {
    const { args: cleanArgs } = applySoftDeleteArgs(args);
    return query(cleanArgs);
  }
  return query(args);
};

/** Unique lookups cannot take `deletedAt` in the where clause, so the record is filtered after fetching. */
const unique = (orThrow: boolean) => async ({ model, args, query }: HookParams): Promise<unknown> => {
  if (!SOFT_DELETE_MODELS.has(model)) return query(args);
  const a: QueryArgs = args ? { ...args } : {};
  const withDeleted = Boolean(a.withDeleted || whereOf(a)?.withDeleted);
  if (a.withDeleted !== undefined) delete a.withDeleted;
  if (whereOf(a)?.withDeleted !== undefined) {
    const where: Where = { ...(a.where as Where) };
    delete where.withDeleted;
    a.where = where;
  }

  const record = (await query(a)) as { deletedAt?: Date | null } | null;
  const hidden = !record || (!withDeleted && record.deletedAt != null && whereOf(a)?.deletedAt === undefined);
  if (!hidden) return record;
  if (!orThrow) return null;
  throw new Prisma.PrismaClientKnownRequestError(`No ${model} found`, { code: 'P2025', clientVersion: '7.10.1' });
};

export const softDeleteQueryExtension = {
  $allModels: {
    findMany: filtered,
    findFirst: filtered,
    findFirstOrThrow: filtered,
    count: filtered,
    aggregate: filtered,
    groupBy: filtered,
    findUnique: unique(false),
    findUniqueOrThrow: unique(true),
  },
};

/**
 * Centralized Prisma client extension for soft-delete filtering.
 * Injects `where: { deletedAt: null }` for all findMany, findFirst, findFirstOrThrow,
 * count, aggregate, and groupBy queries on soft-delete models (Lead, Property, KnowledgeDocument)
 * unless an explicit `{ withDeleted: true }` parameter is passed.
 * For findUnique and findUniqueOrThrow, filters out soft-deleted records post-fetch.
 */
export const softDeleteExtension = Prisma.defineExtension({
  name: 'softDelete',
  query: softDeleteQueryExtension,
});
