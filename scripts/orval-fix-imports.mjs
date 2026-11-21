// Orval's body-carrying calls reference a `getHeaders` helper that it does not define for the custom client.
// Add an import from our mutator module to every generated file that uses it.
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('apps/web/lib/api-generated');
const IMPORT = "import { getHeaders } from '@/lib/custom-instance';\n";
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));

for (const f of walk(root).filter((p) => p.endsWith('.ts'))) {
  const s = fs.readFileSync(f, 'utf8');
  if (s.includes('getHeaders(') && !s.includes(IMPORT)) fs.writeFileSync(f, IMPORT + s);
}
