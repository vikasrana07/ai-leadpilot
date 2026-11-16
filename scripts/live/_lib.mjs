// Shared helpers for the real-provider smoke scripts. They import the COMPILED API classes (apps/api/dist), so the code that runs in
// production is the code being verified. Run `pnpm build` first. Secrets are read from the environment and never printed.
export const results = [];
export function need(...names) {
  const missing = names.filter((n) => !process.env[n]);
  if (missing.length) { console.error(`Missing environment variables: ${missing.join(', ')}`); process.exit(2); }
}
export async function check(name, fn) {
  const t = performance.now();
  try { const detail = await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name} (${Math.round(performance.now() - t)} ms)${detail ? ` - ${detail}` : ''}`); }
  catch (e) { results.push({ name, ok: false }); console.log(`  FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`); }
}
export function finish() {
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed.${failed ? ' NOT verified: fix the failures above.' : ' Record this run (date, mode, account) in PROGRESS.md.'}`);
  process.exit(failed ? 1 : 0);
}
