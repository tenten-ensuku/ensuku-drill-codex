export const VERSION = 169;
export const CANDIDATE_LIMIT = 500;
export const DISPLAY_LIMIT = 20;
export const MODES = {
  '6': { count: 13, label: '六枚形', thresholds: [379, 365, 355, 345, 335, 325, 315, 305, 295, 285, 275] },
  '7': { count: 19, label: '七枚形', thresholds: [553, 535, 520, 510, 500, 490, 480, 470, 460, 450, 440] },
  '10_20': { count: 20, label: '十枚形 20問', thresholds: [578, 530, 500, 460, 420, 385, 350, 315, 280, 230, 170] },
  '10_all': { count: 80, label: '十枚形 80問', thresholds: [2291, 2120, 2000, 1800, 1600, 1400, 1200, 1000, 800, 600, 400] }
};
const RANK_LABELS = ['神', 'SS', 'S', 'A+', 'A', 'A-', 'B+', 'B', 'B-', 'C', 'D'];
const BLOCKED_CHARS = /[<>"'`/\\\u0000-\u001f\u007f]/g;
export const BLOCKED_NAMES = new Set(['にんじん', 'だいこん', 'にら', 'てんpc']);
export const ORIGINAL_COLUMNS = ['id', 'player_name', 'mode_id', 'mode_label', 'variant', 'score', 'rank', 'correct_count', 'mistake_count', 'elapsed_seconds', 'average_seconds', 'question_count', 'client_version', 'submitted_at', 'device_id'];
export const PUBLIC_COLUMNS = ['player_name', 'mode_id', 'mode_label', 'score', 'rank', 'elapsed_seconds', 'average_seconds', 'submitted_at'];

export class ApiError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export function normalizeName(name) {
  return name.replace(BLOCKED_CHARS, '').replace(/\s+/g, ' ').trimStart().slice(0, 9).trim() || '名無し';
}

export function nameKey(name) {
  return normalizeName(name).toLocaleLowerCase('ja-JP');
}

export function rankFor(mode, score) {
  const index = MODES[mode].thresholds.findIndex(threshold => score >= threshold);
  return index < 0 ? 'E' : RANK_LABELS[index];
}

export function scoreFor(count, correct, mistakes, elapsed) {
  return Math.max(0, correct * 10 - mistakes * 20 + Math.max(0, count * 20 - Math.floor(elapsed)));
}

function requireValue(condition, code = 'invalid_request') {
  if (!condition) throw new ApiError(400, code);
}

export function validateScore(body) {
  requireValue(body && typeof body === 'object' && !Array.isArray(body));
  const allowed = new Set(['player_name', 'device_id', 'mode_id', 'mode_label', 'variant', 'score', 'rank', 'correct_count', 'mistake_count', 'elapsed_seconds', 'average_seconds', 'question_count', 'client_version']);
  requireValue(Object.keys(body).every(key => allowed.has(key)));
  requireValue(typeof body.mode_id === 'string' && Object.hasOwn(MODES, body.mode_id));
  const mode = MODES[body.mode_id];
  requireValue(typeof body.player_name === 'string' && body.player_name.length <= 9 && body.player_name.isWellFormed(), 'invalid_name');
  const playerName = normalizeName(body.player_name);
  requireValue(playerName === body.player_name && !BLOCKED_NAMES.has(nameKey(playerName)), 'invalid_name');
  requireValue(typeof body.device_id === 'string' && /^[A-Za-z0-9_-]{4,64}$/.test(body.device_id), 'invalid_device');
  requireValue(['normal', 'ura'].includes(body.variant));
  requireValue(body.question_count === mode.count);
  requireValue(Number.isInteger(body.correct_count) && body.correct_count >= 0 && body.correct_count <= mode.count);
  requireValue(Number.isInteger(body.mistake_count) && body.mistake_count >= 0 && body.correct_count + body.mistake_count === mode.count);
  requireValue(body.variant !== 'ura' || body.mistake_count === 0, 'incomplete_run');
  requireValue(Number.isFinite(body.elapsed_seconds) && body.elapsed_seconds >= 0 && body.elapsed_seconds <= 86400);
  requireValue(Math.abs(body.elapsed_seconds * 10 - Math.round(body.elapsed_seconds * 10)) < 0.000001);
  requireValue(Number.isInteger(body.score) && body.score === scoreFor(mode.count, body.correct_count, body.mistake_count, body.elapsed_seconds), 'invalid_score');
  requireValue(typeof body.client_version === 'string' && /^ver[0-9]{1,6}$/.test(body.client_version));
  const average = Number((body.elapsed_seconds / mode.count).toFixed(1));
  requireValue(body.average_seconds === undefined || body.average_seconds === average);
  requireValue(body.mode_label === undefined || body.mode_label === mode.label);
  requireValue(body.rank === undefined || [...RANK_LABELS, 'E'].includes(body.rank));
  return {
    player_name: playerName, device_id: body.device_id, mode_id: body.mode_id,
    mode_label: mode.label, variant: body.variant, score: body.score, rank: rankFor(body.mode_id, body.score),
    correct_count: body.correct_count, mistake_count: body.mistake_count,
    elapsed_seconds: body.elapsed_seconds, average_seconds: average,
    question_count: mode.count, client_version: body.client_version
  };
}

export function parsePeriod(params, now = Date.now()) {
  const mode = params.get('mode');
  const period = params.get('period');
  requireValue(Object.hasOwn(MODES, mode ?? ''));
  requireValue(['daily', 'last7', 'last30', 'all'].includes(period));
  if (period === 'all') {
    requireValue(!params.has('start'));
    return { mode, period, start: null };
  }
  const value = params.get('start');
  requireValue(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value), 'invalid_period');
  const start = Date.parse(value);
  requireValue(Number.isFinite(start) && new Date(start).toISOString() === value, 'invalid_period');
  if (period === 'daily') {
    requireValue(start % 60000 === 0 && start >= now - 27 * 3600000 && start <= now + 300000, 'invalid_period');
  } else {
    const days = period === 'last7' ? 7 : 30;
    requireValue(Math.abs(now - days * 86400000 - start) <= 2 * 3600000, 'invalid_period');
  }
  return { mode, period, start };
}

// Preserve the old API's candidate cap BEFORE same-name aggregation.
export function rankingQuery({ mode, start }, isTest = 0) {
  const sourceIndex = start === null ? 'rankings_mode_order_idx' : 'rankings_mode_date_idx';
  const whereDate = start === null ? '' : 'AND submitted_at_ms >= ?';
  const args = [isTest, mode, ...(start === null ? [] : [start])];
  const order = 'score DESC, elapsed_seconds ASC, submitted_at_ms ASC, id ASC';
  const sql = `SELECT ${PUBLIC_COLUMNS.join(', ')}, name_key FROM rankings INDEXED BY ${sourceIndex}
    WHERE is_test = ? AND is_hidden = 0 AND mode_id = ? ${whereDate}
    ORDER BY ${order} LIMIT ${CANDIDATE_LIMIT}`;
  return { sql, args };
}

// Aggregate at most 500 rows in the Worker instead of repeatedly scanning D1 window-query intermediates.
export function groupCandidates(candidates, ownName = null) {
  const names = new Set();
  const places = new Map();
  const rows = [];
  const target = ownName === null ? null : nameKey(ownName);
  for (const candidate of candidates) {
    if (names.has(candidate.name_key)) continue;
    names.add(candidate.name_key);
    const tie = `${candidate.score}:${Math.round(candidate.elapsed_seconds * 10)}`;
    if (!places.has(tie)) places.set(tie, names.size);
    const row = { ...Object.fromEntries(PUBLIC_COLUMNS.map(key => [key, candidate[key]])), place: places.get(tie) };
    if (target !== null && candidate.name_key === target) return [row];
    if (target === null) rows.push(row);
    if (target === null && rows.length >= DISPLAY_LIMIT) break;
  }
  return target === null ? rows : [];
}

export async function readRanking(db, period, isTest = 0, ownName = null) {
  const { sql, args } = rankingQuery(period, isTest);
  const result = await db.prepare(sql).bind(...args).all();
  return groupCandidates(result.results, ownName);
}

export async function sha256(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export function importRow(row) {
  return {
    ...Object.fromEntries(ORIGINAL_COLUMNS.map(key => [key, row[key]])),
    name_key: nameKey(row.player_name), is_hidden: Number(BLOCKED_NAMES.has(nameKey(row.player_name))),
    submitted_at_ms: Date.parse(row.submitted_at), is_test: 0, request_key: null, request_hash: null
  };
}
