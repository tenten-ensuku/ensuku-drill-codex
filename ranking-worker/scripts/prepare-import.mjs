import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { importRow, ORIGINAL_COLUMNS } from '../src/ranking.mjs';

const [input, auditFile, output] = process.argv.slice(2);
if (!input || !auditFile || !output) throw new Error('Usage: node scripts/prepare-import.mjs PRIVATE_SNAPSHOT PRIVATE_AUDIT PRIVATE_OUTPUT_SQL');
const repo = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const outputDirectory = await realpath(dirname(resolve(output)));
const rel = relative(repo, outputDirectory);
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Private exports must be outside the public repository');
const snapshot = JSON.parse(await readFile(input, 'utf8'));
const audit = JSON.parse(await readFile(auditFile, 'utf8'))[0].audit;
if (snapshot.source_project !== 'kclkzevcgpfbavegwbnf' || snapshot.source_table !== 'public.ensuku_rankings') throw new Error('Wrong source');
const rows = snapshot.rows;
if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate source IDs');
function quote(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string' || value.includes('\0')) throw new Error('Unexpected export value');
  return `'${value.replaceAll("'", "''")}'`;
}
const statements = rows.map(source => {
  for (const key of ORIGINAL_COLUMNS) if (!Object.hasOwn(source, key)) throw new Error('Missing source field');
  const row = importRow(source);
  if (!Number.isFinite(row.submitted_at_ms)) throw new Error('Invalid date');
  return `INSERT INTO rankings (${Object.keys(row).join(',')}) VALUES (${Object.values(row).map(quote).join(',')});`;
});
const blockedDevices = new Set(audit.policies.flatMap(policy => [...(policy.check || '').matchAll(/device_id\s*<>\s*'([^']+)'/g)].map(match => match[1])));
if (blockedDevices.size !== 1) throw new Error('Review changed blocked-device policy before import');
for (const device of blockedDevices) {
  const hash = createHash('sha256').update(device).digest('hex');
  statements.push(`INSERT INTO blocked_devices (device_hash) VALUES (${quote(hash)});`);
}
await writeFile(output, statements.join('\n') + '\n', { flag: 'wx' });
console.log(JSON.stringify({ rows: rows.length, blockedDevices: blockedDevices.size, sqlBytes: Buffer.byteLength(statements.join('\n') + '\n') }));
