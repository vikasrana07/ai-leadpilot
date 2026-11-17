import { createHash } from 'node:crypto';
import type { LoggerService, LogLevel } from '@nestjs/common';
import { getLogContext } from './request-context.js';
import { redact, redactValue } from './redact.js';

export type LogFormat = 'json' | 'pretty';
const ORDER = ['verbose', 'debug', 'log', 'warn', 'error', 'fatal'] as const;
type Level = (typeof ORDER)[number];
export type ConfiguredLevel = 'verbose' | 'debug' | 'log' | 'warn' | 'error';

export interface LoggerOptions { format: LogFormat; level: ConfiguredLevel; write?: (line: string) => void; now?: () => Date }

/** Env -> logger options. Reads process.env directly so logging works even when env validation itself fails. */
export function loggerOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): LoggerOptions {
  const level = ['verbose', 'debug', 'log', 'warn', 'error'].includes(env.LOG_LEVEL ?? '') ? (env.LOG_LEVEL as ConfiguredLevel) : 'log';
  const format: LogFormat = env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'pretty' ? env.LOG_FORMAT : env.NODE_ENV === 'production' ? 'json' : 'pretty';
  return { format, level };
}

/**
 * Stable id for "the same bug": a hash of the error name and its top three stack frames with line/column numbers and absolute path
 * prefixes removed. The same fault from a different request, or after an unrelated edit above it, gets the same fingerprint.
 */
export function fingerprintError(err: unknown): string {
  const e = err instanceof Error ? err : new Error(String(err));
  const frames = (e.stack ?? '').split('\n').slice(1).filter((l) => l.trim().startsWith('at ')).slice(0, 3)
    .map((l) => l.trim().replace(/^at\s+/, '').replace(/\(?(?:file:\/\/)?[^()\s]*[/\\]([^/\\():\s]+)(?::\d+){1,2}\)?/, '($1)'));
  return createHash('sha1').update([e.name, ...frames].join('|')).digest('hex').slice(0, 12);
}

type Fields = Record<string, unknown>;

/** Nest's startup chatter (one line per mapped route): useful when debugging, noise otherwise, so it is only written at debug level or below. */
const BOOT_NOISE = new Set(['RoutesResolver', 'RouterExplorer', 'InstanceLoader', 'NestFactory']);

/**
 * One JSON object per line (production) or a readable line (development). Every line carries the request/job ids from the async context
 * and is passed through redact(). Plugs into Nest as the application logger, so every `new Logger('X')` in the code base uses it.
 */
export class JsonLogger implements LoggerService {
  private readonly write: (line: string) => void;
  private readonly threshold: number;
  constructor(private readonly opts: LoggerOptions) {
    this.write = opts.write ?? ((line) => { process.stdout.write(line); });
    this.threshold = ORDER.indexOf(opts.level);
  }

  log(message: unknown, ...rest: unknown[]): void { this.emit('log', message, rest); }
  warn(message: unknown, ...rest: unknown[]): void { this.emit('warn', message, rest); }
  error(message: unknown, ...rest: unknown[]): void { this.emit('error', message, rest); }
  debug(message: unknown, ...rest: unknown[]): void { this.emit('debug', message, rest); }
  verbose(message: unknown, ...rest: unknown[]): void { this.emit('verbose', message, rest); }
  fatal(message: unknown, ...rest: unknown[]): void { this.emit('fatal', message, rest); }
  setLogLevels(_levels: LogLevel[]): void { /* levels come from LOG_LEVEL */ }

  private emit(level: Level, message: unknown, rest: unknown[]): void {
    if (ORDER.indexOf(level) < this.threshold) return;
    if (level === 'log' && this.threshold > ORDER.indexOf('debug') && BOOT_NOISE.has(String(rest.filter((r) => typeof r === 'string').pop() ?? ''))) return;
    // Nest appends the context name as the last string argument; an error stack, when given, comes before it.
    const strings = rest.filter((r): r is string => typeof r === 'string');
    const context = strings.length ? strings[strings.length - 1] : undefined;
    const stack = strings.length > 1 ? strings[0] : undefined;
    const fields: Fields = {};
    let msg: string;
    if (message instanceof Error) { msg = message.message; fields.stack = message.stack; fields.fingerprint = fingerprintError(message); }
    else if (message !== null && typeof message === 'object') { const { msg: m, ...more } = message as Fields; msg = typeof m === 'string' ? m : JSON.stringify(redactValue(more)); if (typeof m === 'string') Object.assign(fields, more); }
    else msg = String(message);
    if (stack && fields.stack === undefined) fields.stack = stack;
    const ctx = getLogContext();
    const line: Record<string, unknown> = {
      ts: (this.opts.now?.() ?? new Date()).toISOString(), level: level === 'log' ? 'info' : level, ...(context ? { context } : {}), msg: redact(msg),
      ...(ctx?.requestId ? { requestId: ctx.requestId } : {}), ...(ctx?.tenantId ? { tenantId: ctx.tenantId } : {}),
      ...(ctx?.userId ? { userId: ctx.userId } : {}), ...(ctx?.jobId ? { jobId: ctx.jobId } : {}),
      ...(redactValue(fields) as Fields),
    };
    if (this.opts.format === 'json') { this.write(`${JSON.stringify(line)}\n`); return; }
    const extra = Object.entries(line).filter(([k]) => !['ts', 'level', 'context', 'msg', 'stack'].includes(k)).map(([k, v]) => `${k}=${String(v)}`).join(' ');
    this.write(`${String(line.ts)} ${String(line.level).toUpperCase().padEnd(5)} [${context ?? 'App'}] ${String(line.msg)}${extra ? ` (${extra})` : ''}${typeof line.stack === 'string' ? `\n${line.stack}` : ''}\n`);
  }
}

export const createLogger = (env: NodeJS.ProcessEnv = process.env): JsonLogger => new JsonLogger(loggerOptionsFromEnv(env));
