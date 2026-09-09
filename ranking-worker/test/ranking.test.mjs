import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { validateScore, nameKey, parsePeriod, readRanking, MODES, rankFor, scoreFor } from '../src/ranking.mjs';
import { database, fixture, seed } from './helpers.mjs';

test('server thresholds and score calculation remain identical to the app', () => {
  const html = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
  const ranks = vm.runInNewContext(`(${html.match(/const RANKS = (\{[\s\S]*?\n    \});/)[1]})`);
  for (const mode of Object.keys(MODES)) for (let score = 0; score <= MODES[mode].count * 30; score++) {
    assert.equal(rankFor(mode, score), ranks[mode].find(([, threshold]) => score >= threshold)[0]);
  }
  assert.equal(scoreFor(13, 13, 0, 13.5), 377);
});

test('names retain existing whitespace, emoji, truncation and case grouping', () => {
  assert.equal(nameKey('  AbC  '), 'abc');
  assert.equal(nameKey(''), '名無し');
  assert.equal(nameKey('123456789XYZ'), '123456789');
  const { id, submitted_at, ...body } = fixture({ player_name: '😀牌' });
  assert.equal(validateScore(body).player_name, '😀牌');
  for (const bad of ['<script>', "O'Reilly", 'にんじん', 'てんPC', 'a\u0000', '\ud83d', '1234567890']) {
    assert.throws(() => validateScore({ ...body, player_name: bad }));
  }
});

test('strict submission shape, complete run, times and score validation', () => {
  const { id, submitted_at, ...body } = fixture();
  assert.equal(validateScore(body).score, 370);
  for (const changes of [
    { mode_id: 'constructor' }, { score: '370' }, { score: 9999 }, { score: -1 },
    { elapsed_seconds: -1 }, { elapsed_seconds: 0.01 }, { elapsed_seconds: Infinity }, { elapsed_seconds: 86401 },
    { correct_count: 14 }, { mistake_count: 1 }, { question_count: 80 }, { device_id: '' },
    { submitted_at }, { is_test: 1 }, { admin: true }, { average_seconds: 8 }, { mode_label: 'other' },
    { client_version: '<script>' }, { variant: 'practice' }
  ]) assert.throws(() => validateScore({ ...body, ...changes }));
  assert.throws(() => validateScore({ ...body, variant: 'ura', correct_count: 12, mistake_count: 1, score: 340 }));
});

test('period boundaries retain caller local midnight and rolling local dates', () => {
  const now = Date.parse('2026-09-10T01:00:00.000Z');
  for (const start of ['2026-09-09T15:00:00.000Z', '2026-09-10T00:00:00.000Z']) {
    assert.equal(parsePeriod(new URLSearchParams({ mode: '6', period: 'daily', start }), now).start, Date.parse(start));
  }
  assert.equal(parsePeriod(new URLSearchParams({ mode: '7', period: 'all' }), now).start, null);
  assert.equal(parsePeriod(new URLSearchParams({ mode: '6', period: 'last7', start: '2026-09-03T01:00:00.000Z' }), now).start, now - 7 * 86400000);
  assert.throws(() => parsePeriod(new URLSearchParams({ mode: '6', period: 'daily', start: '2020-01-01T00:00:00.000Z' }), now));
});

test('score, elapsed time, submission time; competition ranks and name dedupe', async () => {
  const db = database();
  for (const row of [
    fixture({ player_name: 'First', score: 380, elapsed_seconds: 10, submitted_at: '2026-09-01T00:00:00Z' }),
    fixture({ player_name: 'SECOND', score: 380, elapsed_seconds: 10, submitted_at: '2026-09-02T00:00:00Z' }),
    fixture({ player_name: 'second', score: 379, elapsed_seconds: 11 }),
    fixture({ player_name: 'Third', score: 380, elapsed_seconds: 10.1 }),
    fixture({ player_name: 'Fourth', score: 379, elapsed_seconds: 1 }),
    fixture({ player_name: 'にんじん', score: 9999 })
  ]) seed(db, row);
  const rows = await readRanking(db, { mode: '6', start: null });
  assert.deepEqual(rows.map(row => [row.player_name, row.place]), [['First', 1], ['SECOND', 1], ['Third', 3], ['Fourth', 4]]);
  assert.equal((await readRanking(db, { mode: '6', start: null }, 0, ' SECOND '))[0].place, 1);
  assert(rows.every(row => !('device_id' in row) && !('request_hash' in row)));
  db.sql.close();
});

test('500 candidates before dedupe, 20 displayed, same-name best and hidden test rows', async () => {
  const db = database();
  for (let i = 0; i < 500; i++) seed(db, fixture({ player_name: 'Repeat', score: 380 }));
  seed(db, fixture({ player_name: 'Outside', score: 300 }));
  assert.equal((await readRanking(db, { mode: '6', start: null })).length, 1);
  assert.equal((await readRanking(db, { mode: '6', start: null }, 0, 'Outside')).length, 0);
  db.sql.exec('DELETE FROM rankings');
  for (let i = 0; i < 25; i++) seed(db, fixture({ player_name: `Name${i}`, score: 370 - i }));
  assert.equal((await readRanking(db, { mode: '6', start: null })).length, 20);
  assert.equal((await readRanking(db, { mode: '6', start: null }, 0, 'Name24'))[0].place, 25);
  db.sql.exec('UPDATE rankings SET is_test = 1');
  assert.equal((await readRanking(db, { mode: '6', start: null })).length, 0);
  assert.equal((await readRanking(db, { mode: '6', start: null }, 1)).length, 20);
  db.sql.close();
});

test('date filter includes exact boundary and excludes other modes', async () => {
  const db = database();
  const start = Date.parse('2026-09-09T15:00:00.000Z');
  seed(db, fixture({ player_name: 'Boundary', submitted_at: new Date(start).toISOString() }));
  seed(db, fixture({ player_name: 'Before', submitted_at: new Date(start - 1).toISOString() }));
  seed(db, fixture({ player_name: 'Other', mode_id: '7' }));
  assert.deepEqual((await readRanking(db, { mode: '6', start })).map(row => row.player_name), ['Boundary']);
  db.sql.close();
});
