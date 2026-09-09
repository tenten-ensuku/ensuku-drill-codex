import { readFile, writeFile, realpath } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { ORIGINAL_COLUMNS, PUBLIC_COLUMNS, MODES, nameKey, BLOCKED_NAMES, rankingQuery, groupCandidates } from '../src/ranking.mjs';

const [sourceFile, exportFile, reportFile] = process.argv.slice(2);
if (!sourceFile || !exportFile || !reportFile) throw new Error('Usage: node scripts/verify-migration.mjs PRIVATE_SOURCE_JSON PRIVATE_D1_SQL PRIVATE_REPORT_JSON');
const repo = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const rel = relative(repo, await realpath(dirname(resolve(reportFile))));
if (!rel || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Keep verification reports outside the public repository');
const source = JSON.parse(await readFile(sourceFile, 'utf8')).rows;
const db = new DatabaseSync(':memory:');
db.exec(await readFile(exportFile, 'utf8'));
const dest = db.prepare('SELECT * FROM rankings WHERE is_test = 0 ORDER BY id').all();
const canonical = rows => JSON.stringify([...rows].sort((a, b) => a.id.localeCompare(b.id)).map(row => ORIGINAL_COLUMNS.map(key => row[key])));
const hash = rows => createHash('sha256').update(canonical(rows)).digest('hex');
if (canonical(source) !== canonical(dest)) throw new Error('Full content verification failed');
function legacyRows(mode, start) {
  // Match source RLS first, then the old 500-row query and browser-side name grouping.
  const candidates = source.filter(row => row.mode_id === mode && (start === null || Date.parse(row.submitted_at) >= start)
    && !BLOCKED_NAMES.has(row.player_name.trim().toLowerCase()))
    .sort((a, b) => b.score - a.score || a.elapsed_seconds - b.elapsed_seconds || Date.parse(a.submitted_at) - Date.parse(b.submitted_at))
    .slice(0, 500);
  const seen = new Set();
  const grouped = candidates.filter(row => {
    const key = nameKey(row.player_name);
    if (seen.has(key) || BLOCKED_NAMES.has(key)) return false;
    seen.add(key); return true;
  });
  return grouped.map(row => ({ ...Object.fromEntries(PUBLIC_COLUMNS.map(key => [key, row[key]])),
    place: grouped.findIndex(other => other.score === row.score && Math.round(other.elapsed_seconds * 10) === Math.round(row.elapsed_seconds * 10)) + 1 }));
}
const days = new Set(source.map(row => `${row.submitted_at.slice(0, 10)}T12:00:00.000Z`));
days.add(new Date().toISOString());
let comparisons = 0;
for (const at of days) {
  const now = Date.parse(at);
  for (const mode of Object.keys(MODES)) {
    for (const start of [null, Math.floor((now + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000, now - 7 * 86400000, now - 30 * 86400000]) {
      const expected = legacyRows(mode, start);
      const query = rankingQuery({ mode, start });
      const candidates = db.prepare(query.sql).all(...query.args);
      const actual = groupCandidates(candidates);
      if (JSON.stringify(actual) !== JSON.stringify(expected.slice(0, 20))) throw new Error(`Ranking mismatch: mode ${mode}, start ${start}`);
      for (const row of expected.slice(0, 1).concat(expected.slice(-1))) {
        const position = groupCandidates(candidates, row.player_name)[0];
        if (position?.place !== row.place) throw new Error('Own position mismatch');
      }
      comparisons++;
    }
  }
}
const report = {
  checkedAt: new Date().toISOString(), sourceRows: source.length, d1Rows: dest.length,
  comparedColumns: ORIGINAL_COLUMNS.length, sourceCanonicalSha256: hash(source), d1CanonicalSha256: hash(dest),
  historicalRankingComparisons: comparisons, modes: Object.fromEntries(Object.keys(MODES).map(mode => [mode, source.filter(row => row.mode_id === mode).length])),
  hiddenRowsPreserved: dest.filter(row => row.is_hidden).length, isolatedTestRows: db.prepare('SELECT COUNT(*) AS n FROM rankings WHERE is_test = 1').get().n
};
db.close();
await writeFile(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
