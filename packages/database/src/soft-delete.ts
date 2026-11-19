import { Prisma } from './generated/client.js';

export const SOFT_DELETE_MODELS = new Set(['Lead', 'Property', 'KnowledgeDocument']);

export interface SoftDeleteOptions {
  withDeleted?: boolean;
}

/**
 * Strips `withDeleted` flag from args and args.where if present.
 * If withDeleted is false/undefined, ensures `where.deletedAt: null` is injected
 * unless an explicit `deletedAt` condition is already present in `where`.
 */
export function applySoftDeleteArgs(args: any): { args: any; withDeleted: boolean } {
  const a = (args ? { ...args } : {}) as Record<string, any>;
  const withDeleted = Boolean(a.withDeleted || a.where?.withDeleted);

  if (a.withDeleted !== undefined) {
    delete a.withDeleted;
  }
  if (a.where) {
    a.where = { ...a.where };
    if (a.where.withDeleted !== undefined) {
      delete a.where.withDeleted;
    }
  }

  if (!withDeleted) {
    if (!a.where) {
      a.where = { deletedAt: null };
    } else if (a.where.deletedAt === undefined) {
      a.where.deletedAt = null;
    }
  }

  return { args: a, withDeleted };
}

export const softDeleteQueryExtension = {
  $allModels: {
    async findMany({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const { args: cleanArgs } = applySoftDeleteArgs(args);
        return query(cleanArgs);
      }
      return query(args);
    },

    async findFirst({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const { args: cleanArgs } = applySoftDeleteArgs(args);
        return query(cleanArgs);
      }
      return query(args);
    },

    async findFirstOrThrow({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const { args: cleanArgs } = applySoftDeleteArgs(args);
        return query(cleanArgs);
      }
      return query(args);
    },

    async count({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const { args: cleanArgs } = applySoftDeleteArgs(args);
        return query(cleanArgs);
      }
      return query(args);
    },

    async aggregate({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const { args: cleanArgs } = applySoftDeleteArgs(args);
        return query(cleanArgs);
      }
      return query(args);
    },

    async groupBy({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const { args: cleanArgs } = applySoftDeleteArgs(args);
        return query(cleanArgs);
      }
      return query(args);
    },

    async findUnique({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const a = (args ? { ...args } : {}) as Record<string, any>;
        const withDeleted = Boolean(a.withDeleted || a.where?.withDeleted);
        if (a.withDeleted !== undefined) delete a.withDeleted;
        if (a.where?.withDeleted !== undefined) {
          a.where = { ...a.where };
          delete a.where.withDeleted;
        }

        const record = (await query(a)) as any;
        if (!record) return null;
        if (!withDeleted && record.deletedAt != null && a.where?.deletedAt === undefined) {
          return null;
        }
        return record;
      }
      return query(args);
    },

    async findUniqueOrThrow({ model, args, query }: { model: string; args: any; query: (args: any) => Promise<any> }) {
      if (SOFT_DELETE_MODELS.has(model)) {
        const a = (args ? { ...args } : {}) as Record<string, any>;
        const withDeleted = Boolean(a.withDeleted || a.where?.withDeleted);
        if (a.withDeleted !== undefined) delete a.withDeleted;
        if (a.where?.withDeleted !== undefined) {
          a.where = { ...a.where };
          delete a.where.withDeleted;
        }

        const record = (await query(a)) as any;
        if (!record) {
          throw new Prisma.PrismaClientKnownRequestError(`No ${model} found`, {
            code: 'P2025',
            clientVersion: '7.10.1',
          });
        }
        if (!withDeleted && record.deletedAt != null && a.where?.deletedAt === undefined) {
          throw new Prisma.PrismaClientKnownRequestError(`No ${model} found`, {
            code: 'P2025',
            clientVersion: '7.10.1',
          });
        }
        return record;
      }
      return query(args);
    },
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
