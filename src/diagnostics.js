import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { callGeminiJson, extractAudioBatch, getGeminiModelCandidates } from './gemini.js';
import { resolveHermesUsageDbPath } from './hermes-usage.js';

const fail = (status, message) => Object.assign(new Error(message), { status });
const fingerprint = secret => secret ? createHash('sha256').update(secret).digest('hex').slice(0, 12) : '';
const credential = secret => ({ configured: Boolean(secret), suffix: secret ? `••••${secret.slice(-4)}` : '', fingerprint: fingerprint(secret) });
function errorMessage(status) {
  if (status === 429) return 'Limite do provedor atingido. Confira a cota no console; não foi possível determinar se o limite é por minuto ou diário.';
  if ([401, 403].includes(status)) return 'Credencial recusada ou permissão insuficiente.';
  if (status === 404) return 'Modelo ou recurso não encontrado.';
  if ([503, 504].includes(status)) return 'Serviço indisponível ou tempo de espera esgotado.';
  return 'Não foi possível concluir o teste. Confira a configuração e tente novamente.';
}
export function createDiagnostics({ db, env = process.env, fetchImpl = fetch }) {
  const running = new Set(), recent = new Map();
  function record(provider, kind, result, extra = {}) {
    db.prepare('INSERT INTO integration_events(provider,kind,status,duration_ms,model,fingerprint,tokens,message) VALUES (?,?,?,?,?,?,?,?)').run(
      provider, kind, result.status, result.durationMs || 0, extra.model || '', extra.fingerprint || '', extra.tokens ?? null, result.message || '',
    );
    db.exec("DELETE FROM integration_events WHERE created_at < datetime('now','-90 days')");
  }
  function recordAttempt({ model, task, status, durationMs, apiKey, usage }) {
    try { record('gemini', task, { status, durationMs }, { model, fingerprint: fingerprint(apiKey), tokens: usage?.totalTokenCount }); } catch { /* Telemetria não pode impedir a operação. */ }
  }
  function summary() {
    const latest = id => db.prepare("SELECT * FROM integration_events WHERE provider=? AND kind LIKE 'test:%' ORDER BY id DESC LIMIT 1").get(id) || null;
    return [
      { id: 'gemini', name: 'Gemini', ...credential(env.GEMINI_API_KEY), source: 'Ambiente do servidor', models: getGeminiModelCandidates(env), tests: ['connection', 'response', 'audio'] },
      { id: 'whatsapp', name: 'WhatsApp / Meta', ...credential(env.WHATSAPP_TOKEN), configured: Boolean(env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID), phoneId: env.WHATSAPP_PHONE_ID || '', wabaId: env.WHATSAPP_WABA_ID || '', apiVersion: env.WHATSAPP_API_VERSION || 'v23.0', templates: [env.WHATSAPP_CONFIRMATION_TEMPLATE, env.WHATSAPP_REMINDER_TEMPLATE].filter(Boolean), testRecipient: env.WHATSAPP_TEST_PHONE || '', tests: ['connection', 'templates', 'send'] },
      { id: 'webhook', name: 'Recebimento WhatsApp', configured: Boolean(env.WHATSAPP_APP_SECRET && env.WHATSAPP_VERIFY_TOKEN && env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID), lastEvent: db.prepare("SELECT created_at FROM integration_events WHERE provider='webhook' ORDER BY id DESC LIMIT 1").get()?.created_at || null, challenge: db.prepare('SELECT code, received_at AS receivedAt, expires_at AS expiresAt FROM diagnostic_challenges ORDER BY expires_at DESC LIMIT 1').get() || null, deliveries: db.prepare('SELECT * FROM diagnostic_messages ORDER BY updated_at DESC LIMIT 10').all(), tests: ['connection'] },
      { id: 'sqlite', name: 'Banco de dados', configured: true, tests: ['connection'] },
      { id: 'hermes', name: 'Monitoramento de consumo', configured: Boolean(resolveHermesUsageDbPath(env)), tests: ['connection'] },
      { id: 'backup', name: 'Backup', configured: Boolean(env.BACKUP_DIR), lastBackup: db.prepare('SELECT * FROM backup_runs ORDER BY id DESC LIMIT 1').get() || null, tests: ['connection'] },
    ].map(item => ({ ...item, lastTest: latest(item.id) }));
  }
  async function json(url, options = {}) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw Object.assign(new Error('Falha do provedor'), { httpStatus: response.status });
    return response.json();
  }
  async function run(provider, kind, actorId, input = {}) {
    const config = summary().find(item => item.id === provider);
    if (!config || !config.tests.includes(kind)) throw fail(422, 'Teste inválido');
    if (!config.configured) throw fail(422, 'Serviço não configurado');
    if (provider === 'whatsapp' && kind === 'send' && (!/^55\d{10,11}$/.test(env.WHATSAPP_TEST_PHONE || '') || !env.WHATSAPP_TEST_TEMPLATE || input.recipient !== env.WHATSAPP_TEST_PHONE)) throw fail(422, 'Configure o destinatário e template de teste e confira o número antes de enviar');
    const key = `${actorId}:${provider}`;
    if (running.has(provider) || Date.now() - (recent.get(key) || 0) < 10_000) throw fail(429, 'Aguarde 10 segundos antes de testar novamente');
    running.add(provider); recent.set(key, Date.now());
    const started = Date.now();
    let result;
    try {
      if (provider === 'gemini') {
        if (kind === 'connection') {
          const data = await json('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': env.GEMINI_API_KEY } });
          if (!Array.isArray(data.models)) throw new Error('Resposta inválida');
          result = { message: 'Credencial aceita para consultar modelos. A geração deve ser testada separadamente.' };
        } else {
          const options = { apiKey: env.GEMINI_API_KEY, fetchImpl, env, onAttempt: recordAttempt };
          const data = kind === 'response'
            ? await callGeminiJson({ ...options, task: 'diagnostic-response', maxOutputTokens: 128, contents: [{ parts: [{ text: 'Retorne somente {"ok":true}.' }] }], schema: { type: 'OBJECT', properties: { ok: { type: 'BOOLEAN' } }, required: ['ok'] } })
            : await extractAudioBatch({ ...options, cache: false, kind: 'costumes', mimeType: 'audio/wav', fileName: 'diagnostic.wav', data: (await readFile(new URL('./fixtures/diagnostic.wav', import.meta.url))).toString('base64') });
          if (kind === 'response' ? data.ok !== true : !data.items.some(item => /pirata/i.test(item.name) && item.size.toUpperCase() === 'M')) throw new Error('Resposta inesperada');
          const usage = data._usage || data.usage;
          result = { message: kind === 'response' ? 'Resposta válida recebida.' : 'Áudio reconhecido: pirata, tamanho M.', model: usage?.model || '', requestedModel: config.models[0], fallback: Boolean(usage?.model && usage.model !== config.models[0]), usage: usage || null };
        }
      } else if (provider === 'whatsapp') {
        const base = `https://graph.facebook.com/${encodeURIComponent(env.WHATSAPP_API_VERSION || 'v23.0')}`;
        const headers = { authorization: `Bearer ${env.WHATSAPP_TOKEN}`, 'content-type': 'application/json' };
        if (kind === 'connection') {
          const data = await json(`${base}/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}?fields=id,display_phone_number,verified_name`, { headers });
          if (!data.id) throw new Error('Resposta inválida');
          result = { message: 'Acesso ao número confirmado.', number: data.display_phone_number || '', name: data.verified_name || '' };
        } else if (kind === 'templates') {
          if (!env.WHATSAPP_WABA_ID) throw fail(422, 'Configure WHATSAPP_WABA_ID para consultar templates');
          const names = config.templates;
          if (!names.length) throw fail(422, 'Nenhum template de operação configurado');
          const templates = [];
          for (const name of names) {
            const data = await json(`${base}/${encodeURIComponent(env.WHATSAPP_WABA_ID)}/message_templates?name=${encodeURIComponent(name)}&fields=name,status,language&limit=100`, { headers });
            templates.push({ name, approved: data.data?.some(t => t.name === name && t.status === 'APPROVED' && t.language === 'pt_BR') || false });
          }
          result = { status: templates.every(t => t.approved) ? 'ok' : 'degraded', message: 'Verificação de templates em português concluída.', templates };
        } else {
          const data = await json(`${base}/${encodeURIComponent(env.WHATSAPP_PHONE_ID)}/messages`, { method: 'POST', headers, body: JSON.stringify({ messaging_product: 'whatsapp', to: env.WHATSAPP_TEST_PHONE, type: 'template', template: { name: env.WHATSAPP_TEST_TEMPLATE, language: { code: env.WHATSAPP_TEST_LANGUAGE || 'pt_BR' } } }) });
          const id = data.messages?.[0]?.id;
          if (typeof id !== 'string') throw new Error('Mensagem sem identificador');
          db.prepare('INSERT INTO diagnostic_messages(id) VALUES (?)').run(id);
          result = { message: 'Mensagem aceita pela Meta. Entrega ainda não comprovada.', messageId: id };
        }
      } else if (provider === 'webhook') {
        const code = `LORE-TESTE-${randomBytes(6).toString('hex')}`;
        db.prepare('DELETE FROM diagnostic_challenges WHERE expires_at<?').run(Date.now());
        db.prepare('INSERT INTO diagnostic_challenges(code,expires_at) VALUES (?,?)').run(code, Date.now() + 600_000);
        result = { status: 'pending', message: `Envie ${code} ao WhatsApp da loja em até 10 minutos. Depois atualize este painel para conferir o recebimento.`, code };
      } else if (provider === 'sqlite') {
        if (db.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || db.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Integridade inválida');
        db.exec('SAVEPOINT diagnostic_write');
        try { db.prepare('INSERT INTO diagnostic_probe(value) VALUES (?)').run('test'); } finally { db.exec('ROLLBACK TO diagnostic_write; RELEASE diagnostic_write'); }
        result = { message: 'Integridade, chaves estrangeiras e escrita verificadas. Dados de operação preservados.' };
      } else if (provider === 'hermes') {
        const path = resolveHermesUsageDbPath(env);
        if (!existsSync(path)) throw new Error('Banco ausente');
        const hermes = new DatabaseSync(path, { readOnly: true });
        try { const row = hermes.prepare("SELECT MAX(last_seen) AS lastSeen FROM session_model_usage WHERE session_id=?").get(env.HERMES_USAGE_SESSION_ID || 'fantasia-mvp-local'); result = { message: row.lastSeen ? `Último registro: ${new Date(row.lastSeen * 1000).toISOString()}` : 'Banco acessível; nenhum registro desta aplicação.' }; } finally { hermes.close(); }
      } else {
        const { createVerifiedBackup } = await import('./backup.js');
        result = { message: 'Backup criado e restauração em base temporária verificada.', ...(await createVerifiedBackup(db, env.BACKUP_DIR)) };
      }
      result = { status: 'ok', ...result, durationMs: Date.now() - started };
    } catch (error) {
      result = { status: 'failed', message: error.status === 422 ? error.message : errorMessage(error.httpStatus || (['TimeoutError', 'AbortError'].includes(error.name) ? 504 : 502)), durationMs: Date.now() - started };
    } finally { running.delete(provider); }
    record(provider, `test:${kind}`, result, { model: result.model, fingerprint: config.fingerprint, tokens: result.usage?.totalTokens });
    return result;
  }
  function webhook(value) {
    record('webhook', 'received', { status: 'ok', message: 'Evento com assinatura válida recebido.' });
    for (const status of value.statuses || []) {
      if (!['sent', 'delivered', 'read', 'failed'].includes(status.status)) continue;
      const row = db.prepare('SELECT status FROM diagnostic_messages WHERE id=?').get(status.id);
      const rank = { accepted: 0, sent: 1, failed: 2, delivered: 3, read: 4 };
      if (row && rank[status.status] > rank[row.status]) db.prepare('UPDATE diagnostic_messages SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(status.status, status.id);
    }
  }
  function consumeChallenge(message) {
    const text = message.text?.body?.trim();
    if (!text?.startsWith('LORE-TESTE-')) return false;
    const challenge = db.prepare('SELECT * FROM diagnostic_challenges WHERE code=? AND expires_at>?').get(text, Date.now());
    if (!challenge) return false;
    db.prepare('UPDATE diagnostic_challenges SET received_at=CURRENT_TIMESTAMP WHERE code=?').run(text);
    return true;
  }
  return { summary, run, recordAttempt, webhook, consumeChallenge };
}
