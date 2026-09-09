import { ApiError, VERSION, validateScore, parsePeriod, readRanking, sha256, nameKey } from './ranking.mjs';

const MAX_BODY_BYTES = 4096;
const CACHE_SECONDS = 15;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: {
    'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff', 'X-API-Version': String(VERSION)
  } });
}

async function limited(binding, key) {
  if (!binding || !(await binding.limit({ key: `ensuku-drill:${key}` })).success) throw new ApiError(429, 'rate_limited');
}

async function readBody(request) {
  if (request.headers.get('content-type')?.split(';')[0].trim() !== 'application/json') throw new ApiError(415, 'json_required');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) throw new ApiError(413, 'body_too_large');
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(400, 'invalid_request');
  const chunks = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new ApiError(413, 'body_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new ApiError(400, 'invalid_json'); }
}

async function testLane(request, env) {
  const supplied = request.headers.get('authorization');
  if (!supplied) return 0;
  // The private probe token only selects isolated test rows; it grants no admin access.
  if (!env.PROBE_TOKEN || supplied.length > 200 || await sha256(supplied) !== await sha256(`Bearer ${env.PROBE_TOKEN}`)) throw new ApiError(401, 'invalid_probe_token');
  return 1;
}

function validateParams(params, allowed) {
  const seen = new Set();
  for (const key of params.keys()) {
    if (!allowed.includes(key) || seen.has(key)) throw new ApiError(400, 'invalid_request');
    seen.add(key);
  }
}

async function postScore(request, env, url, isTest) {
  validateParams(url.searchParams, ['start']);
  const data = validateScore(await readBody(request));
  const params = new URLSearchParams({ mode: data.mode_id, period: 'daily', start: url.searchParams.get('start') || '' });
  const period = parsePeriod(params);
  const key = request.headers.get('idempotency-key') || '';
  if (!/^[a-f0-9]{64}$/.test(key)) throw new ApiError(400, 'invalid_idempotency_key');
  const requestKey = await sha256(`${isTest}:${data.device_id}:${key}`);
  const requestHash = await sha256(JSON.stringify(data));
  const existing = await env.DB.prepare('SELECT id, request_hash FROM rankings WHERE request_key = ?').bind(requestKey).first();
  let saved = existing;
  if (!existing) {
    const deviceHash = await sha256(data.device_id);
    await limited(env.POST_LIMIT, `device:${isTest}:${deviceHash}`);
    if (await env.DB.prepare('SELECT 1 FROM blocked_devices WHERE device_hash = ?').bind(deviceHash).first()) throw new ApiError(403, 'submission_blocked');
    const now = new Date();
    const record = { id: crypto.randomUUID(), ...data, submitted_at: now.toISOString(), name_key: nameKey(data.player_name),
      is_hidden: 0, submitted_at_ms: now.getTime(), is_test: isTest, request_key: requestKey, request_hash: requestHash };
    const columns = Object.keys(record);
    // A unique key plus a transactional insert/read also covers simultaneous retries.
    const batch = await env.DB.batch([
      env.DB.prepare(`INSERT INTO rankings (${columns.join(', ')})
        SELECT ${columns.map(() => '?').join(', ')} WHERE (
          SELECT COUNT(*) FROM rankings INDEXED BY rankings_device_created_idx
          WHERE device_id = ? AND is_test = ? AND submitted_at_ms > ?
        ) < 10 ON CONFLICT(request_key) DO NOTHING`).bind(...Object.values(record), data.device_id, isTest, now.getTime() - 60000),
      env.DB.prepare('SELECT id, request_hash FROM rankings WHERE request_key = ?').bind(requestKey)
    ]);
    saved = batch[1].results[0];
  }
  if (!saved) throw new ApiError(429, 'rate_limited');
  if (saved.request_hash !== requestHash) throw new ApiError(409, 'idempotency_conflict');
  let position = null;
  try { position = (await readRanking(env.DB, period, isTest, data.player_name))[0]?.place ?? null; }
  catch { /* A rank-read failure must not make a committed submission look unsuccessful. */ }
  return json({ accepted: true, id: saved.id, duplicate: Boolean(existing), position }, existing ? 200 : 201);
}

async function route(request, env, ctx, url) {
  if (request.method === 'GET' && url.pathname === '/health') return json({ ok: true, version: VERSION });
  const isPost = request.method === 'POST' && url.pathname === '/v1/scores';
  const isRead = request.method === 'GET' && ['/v1/rankings', '/v1/position'].includes(url.pathname);
  if (!isPost && !isRead) throw new ApiError(404, 'not_found');
  // A generous edge ceiling protects shared mobile/Wi-Fi IPs; the tighter write limit is per device.
  await limited(env.EDGE_LIMIT, request.headers.get('cf-connecting-ip') || 'local');
  const isTest = await testLane(request, env);
  if (isPost) return postScore(request, env, url, isTest);
  validateParams(url.searchParams, ['mode', 'period', 'start', ...(url.pathname === '/v1/position' ? ['name'] : [])]);
  const period = parsePeriod(url.searchParams);
  if (url.pathname === '/v1/position') {
    const name = url.searchParams.get('name');
    if (typeof name !== 'string' || name.length > 24 || !name.isWellFormed()) throw new ApiError(400, 'invalid_name');
    const row = (await readRanking(env.DB, period, isTest, name))[0];
    return json({ position: row?.place ?? null });
  }
  const cache = globalThis.caches?.default;
  const cacheUrl = new URL('/__ranking_cache', url.origin);
  cacheUrl.search = new URLSearchParams({ version: String(VERSION), mode: period.mode, period: period.period,
    start: String(period.start === null ? 'all' : Math.floor(period.start / (CACHE_SECONDS * 1000))),
    bucket: String(Math.floor(Date.now() / (CACHE_SECONDS * 1000))) }).toString();
  const cacheKey = new Request(cacheUrl);
  if (!isTest && cache) {
    const hit = await cache.match(cacheKey);
    if (hit) return new Response(hit.body, { headers: { ...Object.fromEntries(hit.headers), 'Cache-Control': 'no-store', 'X-Ranking-Cache': 'hit' } });
  }
  const rows = await readRanking(env.DB, period, isTest);
  const response = json({ rows, version: VERSION });
  response.headers.set('X-Ranking-Cache', 'miss');
  if (!isTest && cache) {
    const cached = response.clone();
    cached.headers.set('Cache-Control', `public, max-age=${CACHE_SECONDS}`);
    ctx.waitUntil(cache.put(cacheKey, cached));
  }
  return response;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('origin');
    const allowed = (env.ALLOWED_ORIGINS || 'https://tenten-ensuku.github.io').split(',');
    let response;
    try {
      // CORS is a browser boundary, not authentication. Non-browser callers still face validation/rate limits.
      if (origin && !allowed.includes(origin)) throw new ApiError(403, 'origin_not_allowed');
      response = request.method === 'OPTIONS' ? new Response(null, { status: 204 }) : await route(request, env, ctx, new URL(request.url));
    } catch (error) {
      response = error instanceof ApiError ? json({ error: error.code }, error.status) : json({ error: 'service_unavailable' }, 503);
      if (response.status === 429) response.headers.set('Retry-After', '60');
    }
    response.headers.set('Vary', 'Origin');
    if (origin && allowed.includes(origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
      response.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key, Authorization');
      response.headers.set('Access-Control-Max-Age', '600');
    }
    return response;
  }
};
