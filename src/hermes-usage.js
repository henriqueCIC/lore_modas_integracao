import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const DEFAULT_SESSION_ID = 'fantasia-mvp-local';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

const toInt = value => (Number.isFinite(Number(value)) && Number(value) > 0 ? Math.trunc(Number(value)) : 0);

export function resolveHermesUsageDbPath(env = process.env) {
  if (env.HERMES_USAGE_DB) return env.HERMES_USAGE_DB;
  if (env.HERMES_USAGE_TRACKING !== '1') return null;
  const hermesHome = env.HERMES_HOME?.trim() || join(homedir(), '.hermes');
  return join(hermesHome, 'state.db');
}

export function recordGeminiUsage(model, usageMetadata, task = 'fantasia-mvp', env = process.env) {
  const dbPath = resolveHermesUsageDbPath(env);
  if (!dbPath || !existsSync(dbPath)) return false;

  const now = Date.now() / 1000;
  const inputTokens = toInt(usageMetadata?.promptTokenCount);
  const outputTokens = toInt(usageMetadata?.candidatesTokenCount);
  const cacheReadTokens = toInt(usageMetadata?.cachedContentTokenCount);
  const reasoningTokens = toInt(usageMetadata?.thoughtsTokenCount);
  const modelName = String(model || 'gemini-3.8-flash').replace(/^models\//, '');
  const sessionId = env.HERMES_USAGE_SESSION_ID?.trim() || DEFAULT_SESSION_ID;

  let db;
  try {
    db = new DatabaseSync(dbPath);
    db.exec('PRAGMA busy_timeout = 2000;');
    db.prepare(`
      INSERT INTO sessions (id, source, display_name, model, started_at, last_activity_at, billing_provider, billing_base_url, billing_mode, hidden)
      VALUES (?, 'api', 'Fantasia MVP (Lore)', ?, ?, ?, 'gemini', ?, 'api_key', 1)
      ON CONFLICT(id) DO UPDATE SET
        model = excluded.model,
        last_activity_at = excluded.last_activity_at
    `).run(sessionId, modelName, now, now, GEMINI_BASE_URL);

    db.prepare(`
      INSERT INTO session_model_usage (
        session_id, model, billing_provider, billing_base_url, billing_mode, task,
        api_call_count, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, reasoning_tokens,
        first_seen, last_seen
      )
      VALUES (?, ?, 'gemini', ?, 'api_key', ?, 1, ?, ?, ?, 0, ?, ?, ?)
      ON CONFLICT(session_id, model, billing_provider, billing_base_url, billing_mode, task) DO UPDATE SET
        api_call_count = api_call_count + 1,
        input_tokens = input_tokens + excluded.input_tokens,
        output_tokens = output_tokens + excluded.output_tokens,
        cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
        reasoning_tokens = reasoning_tokens + excluded.reasoning_tokens,
        last_seen = excluded.last_seen
    `).run(sessionId, modelName, GEMINI_BASE_URL, String(task || 'fantasia-mvp'), inputTokens, outputTokens, cacheReadTokens, reasoningTokens, now, now);
    return true;
  } catch {
    return false;
  } finally {
    try { db?.close(); } catch {}
  }
}
