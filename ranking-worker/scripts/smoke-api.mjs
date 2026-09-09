import { readFile, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { MODES, scoreFor } from '../src/ranking.mjs';

const [base, secretFile, reportFile] = process.argv.slice(2);
if (!base || !secretFile || !reportFile) throw new Error('Usage: node scripts/smoke-api.mjs API_URL PRIVATE_PROBE_SECRET PRIVATE_REPORT');
const secret = JSON.parse(await readFile(secretFile, 'utf8')).PROBE_TOKEN;
const origin = 'https://tenten-ensuku.github.io';
const testId = randomUUID().replaceAll('-', '').slice(0, 6);
const name = `検証${testId}`;
const now = Date.now();
const start = new Date(Math.floor((now + 9 * 3600000) / 86400000) * 86400000 - 9 * 3600000).toISOString();
const hash = text => createHash('sha256').update(text).digest('hex');
const checks = [];
const testRows = [];
const publicBefore = {};
async function get(path, probe = false) {
  const response = await fetch(base + path, { headers: { Origin: origin, ...(probe ? { Authorization: `Bearer ${secret}` } : {}) } });
  assert.equal(response.status, 200, `GET failed: ${path}`);
  const body = await response.json();
  assert(!JSON.stringify(body).includes('device_id'));
  assert.equal(response.headers.get('access-control-allow-origin'), origin);
  return body;
}
async function post(body, key) {
  return fetch(`${base}/v1/scores?start=${start}`, { method: 'POST', headers: {
    Origin: origin, 'Content-Type': 'application/json', Authorization: `Bearer ${secret}`, 'Idempotency-Key': key
  }, body: JSON.stringify(body) });
}
for (const mode of Object.keys(MODES)) {
  publicBefore[mode] = (await get(`/v1/rankings?mode=${mode}&period=all`)).rows;
  for (const variant of ['normal', 'ura']) {
    const count = MODES[mode].count;
    const body = { player_name: name, device_id: `probe_${testId}_${mode}_${variant}`, mode_id: mode, variant,
      correct_count: count, mistake_count: 0, question_count: count, elapsed_seconds: 60.5,
      score: scoreFor(count, count, 0, 60.5), client_version: 'ver169' };
    const key = hash(`${testId}:${mode}:${variant}`);
    const response = await post(body, key);
    assert.equal(response.status, 201, `POST failed: ${mode}/${variant}`);
    const created = await response.json();
    assert(created.accepted && Number.isInteger(created.position));
    testRows.push(created.id);
    const retry = await post(body, key);
    assert.equal(retry.status, 200);
    assert.equal((await retry.json()).id, created.id);
    assert.equal((await post({ ...body, player_name: '別名' }, key)).status, 409);
    assert.equal((await post({ ...body, score: -1 }, hash(key))).status, 400);
    checks.push(`${mode}/${variant}: insert, retry, conflict, invalid input`);
  }
  for (const period of ['daily', 'last7', 'last30', 'all']) {
    const since = period === 'all' ? '' : `&start=${period === 'daily' ? start : new Date(Date.now() - (period === 'last7' ? 7 : 30) * 86400000).toISOString()}`;
    const body = await get(`/v1/rankings?mode=${mode}&period=${period}${since}`);
    assert(body.rows.length <= 20);
    assert(!body.rows.some(row => row.player_name === name));
    const own = await get(`/v1/position?mode=${mode}&period=${period}${since}&name=${encodeURIComponent(name)}`, true);
    assert(Number.isInteger(own.position));
  }
  assert.deepEqual((await get(`/v1/rankings?mode=${mode}&period=all`)).rows, publicBefore[mode]);
}
const rateBody = { player_name: name, device_id: `probe_rate_${testId}`, mode_id: '6', variant: 'normal', correct_count: 0,
  mistake_count: 13, question_count: 13, elapsed_seconds: 60.5, score: 0, client_version: 'ver169' };
let limited = false;
for (let i = 0; i < 13; i++) {
  const response = await post(rateBody, hash(`rate:${testId}:${i}`));
  if (response.status === 429) { limited = true; assert.equal(response.headers.get('retry-after'), '60'); break; }
  assert.equal(response.status, 201);
  testRows.push((await response.json()).id);
}
assert(limited, 'Expected live rate limit');
checks.push('live per-device write rate limit');
const report = { checkedAt: new Date().toISOString(), api: base, checks, isolatedTestIds: testRows, publicRankingsUnchanged: true };
await writeFile(reportFile, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ checks: checks.length, testRows: testRows.length, publicRankingsUnchanged: true }));
