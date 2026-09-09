import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { importRow } from '../src/ranking.mjs';

export function database() {
  const sql = new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../migrations/0001_rankings.sql', import.meta.url), 'utf8'));
  const db = {
    sql,
    prepare(query) {
      return {
        args: [],
        bind(...args) { this.args = args; return this; },
        async first() { return sql.prepare(query).get(...this.args) ?? null; },
        async all() { return { results: sql.prepare(query).all(...this.args) }; },
        async run() { return sql.prepare(query).run(...this.args); },
        execute() {
          const statement = sql.prepare(query);
          return statement.columns().length ? { results: statement.all(...this.args) } : { results: [], meta: statement.run(...this.args) };
        }
      };
    },
    async batch(statements) {
      sql.exec('BEGIN');
      try {
        const output = statements.map(statement => statement.execute());
        sql.exec('COMMIT');
        return output;
      } catch (error) { sql.exec('ROLLBACK'); throw error; }
    }
  };
  return db;
}

export function fixture(overrides = {}) {
  return {
    id: crypto.randomUUID(), player_name: 'Sample', device_id: 'test_device', mode_id: '6', mode_label: '六枚形',
    variant: 'normal', score: 370, rank: 'SS', correct_count: 13, mistake_count: 0, elapsed_seconds: 20,
    average_seconds: 1.5, question_count: 13, client_version: 'ver169', submitted_at: new Date().toISOString(), ...overrides
  };
}

export function seed(db, source) {
  const row = importRow(source);
  db.sql.prepare(`INSERT INTO rankings (${Object.keys(row).join(',')}) VALUES (${Object.keys(row).map(() => '?').join(',')})`).run(...Object.values(row));
}

export function environment(db) {
  return { DB: db, EDGE_LIMIT: { limit: async () => ({ success: true }) }, POST_LIMIT: { limit: async () => ({ success: true }) }, PROBE_TOKEN: 'unit-test-token' };
}
