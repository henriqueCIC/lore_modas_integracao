import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recordGeminiUsage } from '../src/hermes-usage.js';

function createHermesSchema(dbPath) {
  const db = new DatabaseSync(dbPath);
  db.exec(`
    CREATE TABLE sessions (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      display_name TEXT,
      model TEXT,
      started_at REAL NOT NULL,
      last_activity_at REAL,
      billing_provider TEXT,
      billing_base_url TEXT,
      billing_mode TEXT,
      hidden INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE session_model_usage (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      model TEXT NOT NULL,
      billing_provider TEXT NOT NULL DEFAULT '',
      billing_base_url TEXT NOT NULL DEFAULT '',
      billing_mode TEXT NOT NULL DEFAULT '',
      task TEXT NOT NULL DEFAULT '',
      api_call_count INTEGER NOT NULL DEFAULT 0,
      input_tokens INTEGER NOT NULL DEFAULT 0,
      output_tokens INTEGER NOT NULL DEFAULT 0,
      cache_read_tokens INTEGER NOT NULL DEFAULT 0,
      cache_write_tokens INTEGER NOT NULL DEFAULT 0,
      reasoning_tokens INTEGER NOT NULL DEFAULT 0,
      first_seen REAL,
      last_seen REAL,
      PRIMARY KEY (session_id, model, billing_provider, billing_base_url, billing_mode, task)
    );
  `);
  db.close();
}

test('registra uso de tokens Gemini no state.db do Hermes no formato lido pelo Codenotch', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-usage-'));
  const dbPath = join(dir, 'state.db');
  try {
    createHermesSchema(dbPath);
    const ok1 = recordGeminiUsage('gemini-3.8-flash', {
      promptTokenCount: 120,
      candidatesTokenCount: 45,
      cachedContentTokenCount: 10,
      thoughtsTokenCount: 30,
    }, 'whatsapp-lead', { HERMES_USAGE_DB: dbPath });
    const ok2 = recordGeminiUsage('gemini-3.8-flash', {
      promptTokenCount: 80,
      candidatesTokenCount: 55,
    }, 'whatsapp-lead', { HERMES_USAGE_DB: dbPath });

    assert.equal(ok1, true);
    assert.equal(ok2, true);

    const db = new DatabaseSync(dbPath);
    const row = db.prepare(`
      SELECT last_seen,
             input_tokens + cache_read_tokens + cache_write_tokens + output_tokens AS total_tokens,
             api_call_count
      FROM session_model_usage
      WHERE billing_provider = 'gemini'
    `).get();
    db.close();

    assert.equal(row.api_call_count, 2);
    assert.equal(row.total_tokens, 310);
    assert.ok(row.last_seen > 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('não grava nada quando HERMES_USAGE_TRACKING está desligado', () => {
  assert.equal(recordGeminiUsage('gemini-3.8-flash', { promptTokenCount: 10 }, 'test', {}), false);
});
