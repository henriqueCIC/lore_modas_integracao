import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createDiagnostics } from '../src/diagnostics.js';

test('diagnóstico usa credencial efetiva, sanitiza segredo e não grava operação', async () => {
  const db = createDatabase(':memory:');
  const env = { GEMINI_API_KEY: 'secret-gemini-1234', GEMINI_MODEL: 'gemini-test', GEMINI_FALLBACK_MODELS: 'gemini-test' };
  let calls = 0;
  const d = createDiagnostics({ db, env, fetchImpl: async (_url, options) => { calls++; assert.equal(options.headers['x-goog-api-key'], env.GEMINI_API_KEY); return { ok: true, status: 200, json: async () => ({ models: [{ name: 'models/gemini-test' }] }) }; } });
  try {
    assert.ok(!JSON.stringify(d.summary()).includes(env.GEMINI_API_KEY));
    const result = await d.run('gemini', 'connection', 1);
    assert.equal(result.status, 'ok'); assert.equal(calls, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM rentals').get().n, 0);
    assert.ok(!JSON.stringify(d.summary()).includes(env.GEMINI_API_KEY));
    await assert.rejects(d.run('gemini', 'connection', 1), /Aguarde/);
  } finally { db.close(); }
});

test('429 informa limite sem vazar erro do provedor; SQLite faz rollback do teste', async () => {
  const db = createDatabase(':memory:');
  const d = createDiagnostics({ db, env: { GEMINI_API_KEY: 'secret' }, fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'secret' } }) }) });
  try {
    const result = await d.run('gemini', 'connection', 1);
    assert.equal(result.status, 'failed'); assert.match(result.message, /limite/i);
    assert.ok(!JSON.stringify(result).includes('secret'));
    assert.equal((await d.run('sqlite', 'connection', 1)).status, 'ok');
    assert.equal(db.prepare('SELECT COUNT(*) n FROM diagnostic_probe').get().n, 0);
    assert.equal(d.summary().find(i => i.id === 'whatsapp').configured, false);
    await assert.rejects(d.run('whatsapp', 'send', 1), /configurado/);
  } finally { db.close(); }
});

test('resposta Gemini registra modelo alternativo, tokens e mudança de chave sem segredos', async () => {
  const db = createDatabase(':memory:');
  const env = { GEMINI_API_KEY: 'primeira-chave-secreta', GEMINI_MODEL: 'gemini-primary', GEMINI_FALLBACK_MODELS: 'gemini-alternative' };
  const fetchImpl = async url => url.includes('primary') ? { ok: false, status: 503, text: async () => 'erro privado' } : { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }], usageMetadata: { totalTokenCount: 12 } }) };
  try {
    const d = createDiagnostics({ db, env, fetchImpl });
    const first = d.summary()[0].fingerprint;
    const result = await d.run('gemini', 'response', 1);
    assert.equal(result.status, 'ok'); assert.equal(result.fallback, true); assert.equal(result.model, 'gemini-alternative');
    assert.ok(db.prepare("SELECT * FROM integration_events WHERE status='ok' AND tokens=12 AND fingerprint=?").get(first));
    env.GEMINI_API_KEY = 'segunda-chave-secreta';
    assert.notEqual(d.summary()[0].fingerprint, first);
    await d.run('gemini', 'response', 2);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM integration_events').all()).includes('chave-secreta'));
  } finally { db.close(); }
});

test('WhatsApp valida destino, separa aceite de entrega e correlaciona desafio sem operação', async () => {
  const db = createDatabase(':memory:');
  const env = { WHATSAPP_TOKEN: 'token-secreto', WHATSAPP_PHONE_ID: 'number', WHATSAPP_APP_SECRET: 'app-secret', WHATSAPP_VERIFY_TOKEN: 'verify', WHATSAPP_TEST_PHONE: '5571999999999', WHATSAPP_TEST_TEMPLATE: 'teste' };
  let calls = 0;
  const d = createDiagnostics({ db, env, fetchImpl: async (_url, options) => { calls++; assert.equal(JSON.parse(options.body).to, env.WHATSAPP_TEST_PHONE); return { ok: true, json: async () => ({ messages: [{ id: 'test-message' }] }) }; } });
  try {
    await assert.rejects(d.run('whatsapp', 'send', 1, { recipient: '5571888888888' }), /destinatário/); assert.equal(calls, 0);
    const sent = await d.run('whatsapp', 'send', 1, { recipient: env.WHATSAPP_TEST_PHONE });
    assert.equal(sent.status, 'ok'); assert.equal(db.prepare('SELECT status FROM diagnostic_messages').get().status, 'accepted');
    d.webhook({ statuses: [{ id: 'test-message', status: 'read' }, { id: 'test-message', status: 'sent' }, { id: 'test-message', status: 'read' }] });
    assert.equal(db.prepare('SELECT status FROM diagnostic_messages').get().status, 'read');
    const challenge = await d.run('webhook', 'connection', 1);
    assert.equal(d.consumeChallenge({ text: { body: challenge.code } }), true);
    assert.ok(d.summary().find(i => i.id === 'webhook').challenge.receivedAt);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM leads').get().n, 0);
  } finally { db.close(); }
});

test('credencial negada e timeout produzem erros sanitizados', async () => {
  for (const failure of [401, 403, 'timeout']) {
    const db = createDatabase(':memory:');
    try {
      const d = createDiagnostics({ db, env: { GEMINI_API_KEY: 'never-return-me' }, fetchImpl: async () => { if (failure === 'timeout') throw Object.assign(new Error('never-return-me'), { name: 'TimeoutError' }); return { ok: false, status: failure }; } });
      const result = await d.run('gemini', 'connection', 1);
      assert.equal(result.status, 'failed'); assert.ok(!JSON.stringify(result).includes('never-return-me'));
    } finally { db.close(); }
  }
});

test('código de diagnóstico expirado ou removido nunca vira pedido operacional', async () => {
  const db = createDatabase(':memory:');
  try {
    const d = createDiagnostics({ db, env: { WHATSAPP_APP_SECRET:'secret',WHATSAPP_VERIFY_TOKEN:'verify',WHATSAPP_TOKEN:'token',WHATSAPP_PHONE_ID:'phone' } });
    const challenge = await d.run('webhook', 'connection', 1);
    db.prepare('UPDATE diagnostic_challenges SET expires_at=?').run(Date.now()-1);
    assert.equal(d.consumeChallenge({ text: { body: challenge.code } }), true);
    assert.equal(db.prepare('SELECT received_at FROM diagnostic_challenges').get().received_at, null);
    db.exec('DELETE FROM diagnostic_challenges');
    assert.equal(d.consumeChallenge({ text: { body: challenge.code } }), true);
    assert.equal(d.consumeChallenge({ text: { body: 'Quero uma fantasia' } }), false);
  } finally { db.close(); }
});

test('teste local de webhook não comprova callback e consumo ausente permanece desconhecido', async () => {
  const db = createDatabase(':memory:');
  try {
    const env = { WHATSAPP_APP_SECRET:'secret',WHATSAPP_VERIFY_TOKEN:'verify',WHATSAPP_TOKEN:'token',WHATSAPP_PHONE_ID:'phone', GEMINI_API_KEY:'key',GEMINI_MODEL:'test',GEMINI_FALLBACK_MODELS:'test' };
    const d = createDiagnostics({ db, env, fetchImpl: async () => ({ ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]}) }) });
    await d.run('webhook', 'connection', 1);
    assert.equal(d.summary().find(i=>i.id==='webhook').lastEvent,null);
    d.webhook({statuses:[]});
    assert.ok(d.summary().find(i=>i.id==='webhook').lastEvent);
    const result = await d.run('gemini','response',1);
    assert.equal(result.usage.totalTokens,null);
    assert.equal(db.prepare("SELECT tokens FROM integration_events WHERE kind='test:response'").get().tokens,null);
  } finally { db.close(); }
});

test('resposta sem usageMetadata não afirma custo zero', async () => {
  const db=createDatabase(':memory:');
  try {
    const d=createDiagnostics({db,env:{GEMINI_API_KEY:'key',GEMINI_MODEL:'test',GEMINI_FALLBACK_MODELS:'test'},fetchImpl:async()=>({ok:true,json:async()=>({candidates:[{content:{parts:[{text:'{"ok":true}'}]}}]})})});
    assert.equal((await d.run('gemini','response',1)).usage.totalTokens,null);
  } finally { db.close(); }
});
