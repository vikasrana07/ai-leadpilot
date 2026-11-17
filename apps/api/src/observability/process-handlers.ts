import type { JsonLogger } from './logger.js';
import { fingerprintError } from './logger.js';

interface ProcessLike { on(event: string, fn: (...a: unknown[]) => void): unknown }

/** Resolves once stdout has drained (or after 1 s), so the fatal line is not lost when the process exits right after. */
export const drainStdout = (): Promise<void> => new Promise((resolve) => { const t = setTimeout(resolve, 1000); process.stdout.write('', () => { clearTimeout(t); resolve(); }); });

/**
 * A crash must be loud and must restart the process: log the cause (redacted, fingerprinted), flush, exit(1). Node's own default for an
 * unhandled rejection is also to exit, but without our structured line; on ECS the non-zero exit makes the scheduler start a new task.
 * Returns nothing; injectable for tests.
 */
export function installProcessHandlers(logger: JsonLogger, opts: { exit?: (code: number) => void; proc?: ProcessLike; flush?: () => Promise<void> } = {}): void {
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const proc = opts.proc ?? process;
  const flush = opts.flush ?? drainStdout;
  let crashing = false;
  const crash = (kind: string) => (reason: unknown) => {
    if (crashing) return; // a second error while shutting down must not loop
    crashing = true;
    const err = reason instanceof Error ? reason : new Error(typeof reason === 'string' ? reason : 'non-error rejection');
    logger.fatal({ msg: `${kind}: ${err.message}`, fingerprint: fingerprintError(err), stack: err.stack }, 'Process');
    void flush().finally(() => exit(1));
  };
  proc.on('uncaughtException', crash('uncaughtException'));
  proc.on('unhandledRejection', crash('unhandledRejection'));
}
