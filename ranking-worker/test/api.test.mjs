import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.mjs';
import { sha256 } from '../src/ranking.mjs';
import { database, fixture, environment } from './helpers.mjs';

function request(body, headers = {}, query = '') {
  const start = new Date(); start.setUTCHours(0, 0, 0, 0);
  return new Request(`https://rank.test/v1/scores?start=${start.toISOString()}${query}`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://tenten-ensuku.github.io', 'idempotency-key': 'a'.repeat(64), ...headers },
    body: JSON.stringify(body)
  });
}
const ctx = { waitUntil: promise => promise.catch(() => {}) };
function payload() { const { id, submitted_at, ...body } = fixture(); return body; }

test('real handler inserts once, protects retries/concurrent retries, hides device ID', async () => {
  const db = database(); const env = environment(db); const body = payload();
  const first = await worker.fetch(request(body), env, ctx);
  assert.equal(first.status, 201);
  const output = await first.json();
  assert.equal(output.position, 1);
  assert.equal(output.accepted, true);
  assert(!JSON.stringify(output).includes(body.device_id));
  assert.equal(first.headers.get('access-control-allow-origin'), 'https://tenten-ensuku.github.io');
  for (let i = 0; i < 3; i++) assert.equal((await worker.fetch(request(body), env, ctx)).status, 200);
  const concurrent = await Promise.all(Array.from({ length: 8 }, () => worker.fetch(request(body, { 'idempotency-key': 'b'.repeat(64) }), env, ctx)));
  assert(concurrent.every(response => response.ok));
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM rankings').get().n, 2);
  assert.equal((await worker.fetch(request({ ...body, player_name: 'Changed' }), env, ctx)).status, 409);
  db.sql.close();
});

test('invalid inputs, origins, unknown routes, and bounded body fail safely', async () => {
  const db = database(); const env = environment(db);
  for (const [req, status] of [
    [request({ ...payload(), score: -1 }), 400],
    [request(payload(), { origin: 'https://evil.example' }), 403],
    [request(payload(), { 'content-type': 'text/plain' }), 415],
    [request(payload(), { 'idempotency-key': '' }), 400],
    [request({ huge: 'a'.repeat(5000) }), 413],
    [request(payload(), {}, '&test=1'), 400],
    [request(payload(), { authorization: 'Bearer wrong' }), 401]
  ]) assert.equal((await worker.fetch(req, env, ctx)).status, status);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM rankings').get().n, 0);
  assert.equal((await worker.fetch(new Request('https://rank.test/admin'), env, ctx)).status, 404);
  const preflight = await worker.fetch(new Request('https://rank.test/v1/scores', { method: 'OPTIONS', headers: { origin: 'https://tenten-ensuku.github.io' } }), env, ctx);
  assert.equal(preflight.status, 204);
  assert(preflight.headers.get('access-control-allow-headers').includes('Idempotency-Key'));
  db.sql.close();
});

test('edge/device rate limits, blocked device; successful retry does not consume write limit', async () => {
  const db = database(); const env = environment(db); const body = payload();
  assert.equal((await worker.fetch(request(body), env, ctx)).status, 201);
  env.POST_LIMIT.limit = async () => ({ success: false });
  assert.equal((await worker.fetch(request(body), env, ctx)).status, 200);
  const limited = await worker.fetch(request(body, { 'idempotency-key': 'c'.repeat(64) }), env, ctx);
  assert.equal(limited.status, 429); assert.equal(limited.headers.get('retry-after'), '60');
  env.POST_LIMIT.limit = async () => ({ success: true });
  db.sql.prepare('INSERT INTO blocked_devices VALUES (?)').run(await sha256(body.device_id));
  assert.equal((await worker.fetch(request(body, { 'idempotency-key': 'd'.repeat(64) }), env, ctx)).status, 403);
  env.EDGE_LIMIT.limit = async () => ({ success: false });
  assert.equal((await worker.fetch(request(body), env, ctx)).status, 429);
  db.sql.close();
});

test('probe posts use the same production handler but are never publicly ranked', async () => {
  const db = database(); const env = environment(db);
  const output = await worker.fetch(request(payload(), { authorization: 'Bearer unit-test-token' }), env, ctx);
  assert.equal(output.status, 201);
  assert.equal((await output.json()).position, 1);
  const url = 'https://rank.test/v1/rankings?mode=6&period=all';
  assert.equal((await (await worker.fetch(new Request(url), env, ctx)).json()).rows.length, 0);
  assert.equal((await (await worker.fetch(new Request(url, { headers: { authorization: 'Bearer unit-test-token' } }), env, ctx)).json()).rows.length, 1);
  db.sql.close();
});

test('D1 enforces a global rolling write ceiling even if edge counters reset', async () => {
  const db = database(); const env = environment(db); const body = payload();
  for (let i = 0; i < 10; i++) {
    const response = await worker.fetch(request(body, { 'idempotency-key': await sha256(String(i)) }), env, ctx);
    assert.equal(response.status, 201);
  }
  assert.equal((await worker.fetch(request(body, { 'idempotency-key': await sha256('overflow') }), env, ctx)).status, 429);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM rankings').get().n, 10);
  assert.equal((await worker.fetch(request(body, { 'idempotency-key': await sha256('0') }), env, ctx)).status, 200);
  db.sql.close();
});

test('rank read failure after commit still reports accepted and retry stays deduplicated', async () => {
  const db = database(); const env = environment(db);
  const prepare = db.prepare.bind(db);
  db.prepare = query => { if (query.startsWith('SELECT player_name')) throw new Error('simulated'); return prepare(query); };
  const response = await worker.fetch(request(payload()), env, ctx);
  assert.equal(response.status, 201); assert.equal((await response.json()).accepted, true);
  assert.equal((await worker.fetch(request(payload()), env, ctx)).status, 200);
  assert.equal(db.sql.prepare('SELECT COUNT(*) AS n FROM rankings').get().n, 1);
  db.sql.close();
});

test('database failure returns no SQL, internal error or data', async () => {
  const env = environment({ prepare() { throw new Error('private SQL details'); } });
  const response = await worker.fetch(request(payload()), env, ctx);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'service_unavailable' });
});

test('cached responses replace cache headers without duplicate mixed-case values', async () => {
  const oldCaches = globalThis.caches;
  globalThis.caches = { default: { match: async () => new Response('{"rows":[]}', { headers: {
    'content-type': 'application/json', 'cache-control': 'public, max-age=15', 'x-ranking-cache': 'miss'
  } }) } };
  try {
    const env = environment({ prepare() { throw new Error('Unexpected cache miss'); } });
    const response = await worker.fetch(new Request('https://rank.test/v1/rankings?mode=6&period=all'), env, ctx);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-ranking-cache'), 'hit');
  } finally { globalThis.caches = oldCaches; }
});
