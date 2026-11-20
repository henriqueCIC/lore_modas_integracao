import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createServer } from '../src/server.js';
import { createHmac } from 'node:crypto';

async function fixture(options = {}) {
  const db = createDatabase(':memory:');
  const server = createServer({ db, password: 'segredo-de-teste', ...options });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function request(path, method = 'GET', body, cookie = '') {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(cookie ? { cookie } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json(), cookie: res.headers.get('set-cookie')?.split(';')[0] };
  }
  return { db, server, request, close: () => new Promise(resolve => server.close(resolve)) };
}

test('página Lore Modas entrega a logo sem expor arquivos privados', async () => {
  const f = await fixture();
  try {
    const base = `http://127.0.0.1:${f.server.address().port}`;
    const page = await fetch(base);
    assert.match(await page.text(), /Lore Modas/);
    const logo = await fetch(`${base}/lore-modas.png`);
    assert.equal(logo.status, 200);
    assert.match(logo.headers.get('content-type'), /^image\/png/);
    assert.equal(Buffer.from(await logo.arrayBuffer()).subarray(1, 4).toString(), 'PNG');
    assert.equal((await fetch(`${base}/.env`)).status, 404);
  } finally { await f.close(); f.db.close(); }
});

test('webhook exige assinatura e não duplica a mesma mensagem', async () => {
  const sent = [];
  const f = await fixture({ whatsapp: { appSecret: 'segredo-meta', verifyToken: 'verificador', token: 'token', phoneId: '123', geminiKey: 'gemini', extract: async (_message, lead) => ({ ...lead, costumeQuery: 'Pirata' }), send: async (_phone, text) => { sent.push(text); } } });
  try {
    const base = `http://127.0.0.1:${f.server.address().port}`;
    const verify = await fetch(`${base}/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=verificador&hub.challenge=12345`);
    assert.equal(await verify.text(), '12345');
    const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { contacts: [{ profile: { name: 'Ana' } }], messages: [{ id: 'wamid.1', from: '5571999999999', type: 'text', text: { body: 'Quero pirata' } }] } }] }] });
    const signature = 'sha256=' + createHmac('sha256', 'segredo-meta').update(payload).digest('hex');
    const bad = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }, body: payload });
    assert.equal(bad.status, 403);
    for (let i = 0; i < 2; i++) {
      const response = await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: payload });
      assert.equal(response.status, 200);
    }
    for (let i = 0; i < 20 && sent.length === 0; i++) await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(sent.length, 1);
    assert.match(sent[0], /tamanho/i);
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    assert.equal((await f.request('/api/leads', 'GET', undefined, cookie)).data.length, 1);
  } finally { await f.close(); f.db.close(); }
});

test('após transferência humana, novas mídias não recebem resposta automática', async () => {
  const sent = [];
  const f = await fixture({ whatsapp: { appSecret: 'segredo-meta', verifyToken: 'v', send: async (_phone, text) => sent.push(text) } });
  try {
    const base = `http://127.0.0.1:${f.server.address().port}`;
    for (const [id, message] of [['1', { type: 'text', text: { body: 'atendente' } }], ['2', { type: 'image' }]]) {
      const payload = JSON.stringify({ object: 'whatsapp_business_account', entry: [{ changes: [{ value: { messages: [{ id, from: '5571999999999', ...message }] } }] }] });
      const signature = 'sha256=' + createHmac('sha256', 'segredo-meta').update(payload).digest('hex');
      assert.equal((await fetch(`${base}/webhooks/whatsapp`, { method: 'POST', headers: { 'x-hub-signature-256': signature }, body: payload })).status, 200);
      for (let i = 0; i < 20 && !f.db.prepare('SELECT processed_at FROM inbound_messages WHERE id=?').get(id)?.processed_at; i++) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(sent.length, 1);
  } finally { await f.close(); f.db.close(); }
});

test('bloqueia dados sem sessão e aceita login', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/costumes')).status, 401);
    assert.equal((await f.request('/api/login', 'POST', { password: 'errada' })).status, 401);
    const login = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    assert.equal(login.status, 200);
    assert.ok(login.cookie?.startsWith('sid='));
    assert.equal((await f.request('/api/costumes', 'GET', undefined, login.cookie)).status, 200);
  } finally { await f.close(); f.db.close(); }
});

test('limita tentativas de senha', async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 5; i++) assert.equal((await f.request('/api/login', 'POST', { password: 'errada' })).status, 401);
    assert.equal((await f.request('/api/login', 'POST', { password: 'segredo-de-teste' })).status, 429);
  } finally { await f.close(); f.db.close(); }
});

test('cadastro, conflito, agenda e devolução com multa', async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const costume = await f.request('/api/costumes', 'POST', { name: 'Pirata', size: 'M', quantity: 1 }, cookie);
    assert.equal(costume.status, 201);
    const input = { costumeId: costume.data.id, customerName: 'Ana', phone: '71999999999', pickupDate: '2026-10-10', dueDate: '2026-10-12', priceCents: 8000 };
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, priceCents: null }, cookie)).status, 422);
    const rental = await f.request('/api/rentals', 'POST', input, cookie);
    assert.equal(rental.status, 201);
    assert.equal((await f.request('/api/rentals', 'GET', undefined, cookie)).data[0].phone, '5571999999999');
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, customerName: 'Bia' }, cookie)).status, 409);
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, pickupDate: '2026-02-30' }, cookie)).status, 422);
    assert.equal((await f.request('/api/dashboard?date=2026-10-12', 'GET', undefined, cookie)).data.due.length, 1);
    const returned = await f.request(`/api/rentals/${rental.data.id}/return`, 'POST', { returnedDate: '2026-10-15' }, cookie);
    assert.equal(returned.status, 200);
    assert.equal(returned.data.lateFeeCents, 3000);
    assert.equal((await f.request('/api/rentals', 'GET', undefined, cookie)).data[0].lateFeeCents, 3000);
    assert.equal((await f.request(`/api/rentals/${rental.data.id}/return`, 'POST', { returnedDate: '2026-10-16' }, cookie)).status, 409);
  } finally { await f.close(); f.db.close(); }
});

test('dona pode liberar novo pedido para um lead antigo', async () => {
  const f = await fixture();
  try {
    f.db.prepare("INSERT INTO leads (phone, status, costume_query) VALUES ('5571999999999', 'ready', 'Pirata')").run();
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    assert.equal((await f.request('/api/leads/5571999999999/reset', 'POST', {}, cookie)).status, 200);
    assert.deepEqual({ ...f.db.prepare("SELECT status, costume_query AS costumeQuery FROM leads WHERE phone='5571999999999'").get() }, { status: 'collecting', costumeQuery: '' });
  } finally { await f.close(); f.db.close(); }
});

test('dois exemplares aceitam aluguéis disjuntos e uma reserva longa', async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const { data: costume } = await f.request('/api/costumes', 'POST', { name: 'Bruxa', size: 'M', quantity: 2 }, cookie);
    const input = { costumeId: costume.id, customerName: 'Ana', phone: '71999999999', pickupDate: '2026-12-10', dueDate: '2026-12-12', priceCents: 5000 };
    assert.equal((await f.request('/api/rentals', 'POST', input, cookie)).status, 201);
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, phone: '71988888888', pickupDate: '2026-12-13', dueDate: '2026-12-15' }, cookie)).status, 201);
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, phone: '71977777777', dueDate: '2026-12-15' }, cookie)).status, 201);
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, phone: '71966666666', dueDate: '2026-12-15' }, cookie)).status, 409);
  } finally { await f.close(); f.db.close(); }
});

test('consentimento para lembrete pertence a cada aluguel', async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const { data: costume } = await f.request('/api/costumes', 'POST', { name: 'Fada', size: 'P', quantity: 1 }, cookie);
    const input = { costumeId: costume.id, customerName: 'Ana', phone: '71999999999', pickupDate: '2026-12-10', dueDate: '2026-12-11', priceCents: 1000 };
    await f.request('/api/rentals', 'POST', { ...input, whatsappOptIn: true }, cookie);
    await f.request('/api/rentals', 'POST', { ...input, pickupDate: '2027-01-10', dueDate: '2027-01-11' }, cookie);
    assert.deepEqual(f.db.prepare('SELECT whatsapp_opt_in AS consent FROM rentals ORDER BY id').all().map(r => r.consent), [1, 0]);
  } finally { await f.close(); f.db.close(); }
});

test('confirmar rascunho de acervo acrescenta unidades uma vez e recusa destino incorreto', async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const { data: costume } = await f.request('/api/costumes', 'POST', { name: 'Pirata', size: 'M', quantity: 2 }, cookie);
    const input = { name: 'Pirata', size: 'M', quantity: 3, existingId: costume.id, requestId: '11111111-1111-4111-8111-111111111111' };
    assert.equal((await f.request('/api/costumes', 'POST', input, cookie)).data.quantity, 5);
    assert.equal((await f.request('/api/costumes', 'POST', input, cookie)).status, 200);
    assert.equal((await f.request('/api/costumes', 'GET', undefined, cookie)).data[0].quantity, 5);
    assert.equal((await f.request('/api/costumes', 'POST', { ...input, quantity: 4 }, cookie)).status, 409);
    assert.equal((await f.request('/api/costumes', 'POST', { ...input, requestId: undefined, size: 'P' }, cookie)).status, 409);
  } finally { await f.close(); f.db.close(); }
});

test('confirmação repetida de aluguel não duplica e conflito mantém rascunho sem recibo', async () => {
  const f = await fixture();
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const { data: costume } = await f.request('/api/costumes', 'POST', { name: 'Homem Aranha', size: 'PP', quantity: 1 }, cookie);
    const input = { costumeId: costume.id, customerName: 'Edvalda', phone: '71999999999', pickupDate: '2027-11-19', dueDate: '2027-11-21', priceCents: 15000, requestId: '22222222-2222-4222-8222-222222222222' };
    assert.equal((await f.request('/api/rentals', 'POST', input, cookie)).status, 201);
    assert.equal((await f.request('/api/rentals', 'POST', input, cookie)).status, 200);
    assert.equal((await f.request('/api/rentals', 'GET', undefined, cookie)).data.length, 1);
    assert.equal((await f.request('/api/rentals', 'POST', { ...input, requestId: '33333333-3333-4333-8333-333333333333' }, cookie)).status, 409);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM write_receipts').get().n, 1);
  } finally { await f.close(); f.db.close(); }
});

test('agenda agrupa eventos por dia e caixa só conta recebimento confirmado uma vez', async () => {
  const f = await fixture();
  try {
    assert.equal((await f.request('/api/cash?date=2026-11-19')).status, 401);
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const { data: costume } = await f.request('/api/costumes', 'POST', { name: 'Homem Aranha', size: 'PP', quantity: 1 }, cookie);
    const { data: rental } = await f.request('/api/rentals', 'POST', { costumeId: costume.id, customerName: 'Edvalda', phone: '71999999999', pickupDate: '2026-11-19', dueDate: '2026-11-21', priceCents: 15000 }, cookie);
    const calendar = await f.request('/api/calendar?month=2026-11', 'GET', undefined, cookie);
    assert.equal(calendar.data.days.find(day => day.date === '2026-11-19').pickups, 1);
    assert.equal(calendar.data.days.find(day => day.date === '2026-11-21').returns, 1);
    assert.equal((await f.request('/api/calendar?month=2026-13', 'GET', undefined, cookie)).status, 422);
    const before = await f.request('/api/cash?date=2026-11-19', 'GET', undefined, cookie);
    assert.equal(before.data.expectedCents, 15000);
    assert.equal(before.data.receivedCents, 0);
    const payment = { rentalId: rental.id, receivedDate: '2026-11-19', method: 'pix' };
    assert.equal((await f.request('/api/cash/payments', 'POST', { ...payment, method: '' }, cookie)).status, 422);
    assert.equal((await f.request('/api/cash/payments', 'POST', { ...payment, receivedDate: '2099-01-01' }, cookie)).status, 422);
    assert.equal((await f.request('/api/cash/payments', 'POST', payment, cookie)).status, 201);
    assert.equal((await f.request('/api/cash/payments', 'POST', payment, cookie)).status, 200);
    const after = await f.request('/api/cash?date=2026-11-19', 'GET', undefined, cookie);
    assert.equal(after.data.receivedCents, 15000);
    assert.equal(after.data.payments.length, 1);
    assert.equal(after.data.pending.length, 0);
    assert.equal((await f.request('/api/cash?date=2026-11-18', 'GET', undefined, cookie)).data.receivedCents, 0);
    assert.equal((await f.request('/api/cash/payments', 'POST', { ...payment, method: 'cash' }, cookie)).status, 409);
  } finally { await f.close(); f.db.close(); }
});

test('rota /api/drafts/audio aceita áudio de 40s (~7,7 MB), repassa erros reais e nunca grava automaticamente', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'chave-sintetica-teste';
  let receivedFileName = '';
  let receivedBytes = 0;
  const f = await fixture({
    gemini: {
      extractAudioBatch: async ({ kind, fileName, data }) => {
        receivedFileName = fileName;
        receivedBytes = Buffer.byteLength(data, 'base64');
        if (fileName === 'quota.m4a') throw Object.assign(new Error('Limite de uso da API Gemini atingido no momento.'), { httpStatus: 429 });
        if (fileName === 'busy.m4a') throw Object.assign(new Error('Serviço Gemini temporariamente sobrecarregado.'), { httpStatus: 503 });
        return {
          transcript: 'Duas fantasias de Pirata M',
          items: kind === 'costumes'
            ? [{ name: 'Pirata', size: 'M', quantity: 2, notes: '' }]
            : [{ costumeName: 'Pirata', size: 'M', customerName: 'Marina Teste', phone: '71988001122', pickupDate: '2026-11-20', dueDate: '2026-11-22', priceCents: 15000, notes: '' }],
        };
      },
    },
  });
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const wavData = Buffer.concat([Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1'), Buffer.alloc(7_700_000)]).toString('base64');
    const ok = await f.request('/api/drafts/audio', 'POST', { kind: 'costumes', mimeType: '', fileName: 'acervo-40s.wav', data: wavData }, cookie);
    assert.equal(ok.status, 200);
    assert.equal(receivedFileName, 'acervo-40s.wav');
    assert.ok(receivedBytes > 7_000_000);
    assert.equal(ok.data.items.length, 1);
    assert.equal((await f.request('/api/costumes', 'GET', undefined, cookie)).data.length, 0);
    assert.equal((await f.request('/api/rentals', 'GET', undefined, cookie)).data.length, 0);

    const quota = await f.request('/api/drafts/audio', 'POST', { kind: 'rentals', mimeType: 'audio/m4a', fileName: 'quota.m4a', data: 'ZmFrZQ==' }, cookie);
    assert.equal(quota.status, 429);
    assert.match(quota.data.error, /Limite/i);

    const busy = await f.request('/api/drafts/audio', 'POST', { kind: 'rentals', mimeType: 'audio/m4a', fileName: 'busy.m4a', data: 'ZmFrZQ==' }, cookie);
    assert.equal(busy.status, 503);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    await f.close();
    f.db.close();
  }
});

test('arquivos estáticos aplicam CSP com media blob e cache-control adequado', async () => {
  const f = await fixture();
  try {
    const base = `http://127.0.0.1:${f.server.address().port}`;
    const page = await fetch(base);
    assert.match(page.headers.get('content-security-policy'), /media-src 'self' blob:/);
    assert.equal(page.headers.get('cache-control'), 'no-cache');
    const logo = await fetch(`${base}/lore-modas.png`);
    assert.equal(logo.headers.get('content-type'), 'image/png');
  } finally { await f.close(); f.db.close(); }
});

test('confirmação de locação dispara aviso imediato no WhatsApp com todos os dados sem duplicar', async () => {
  const sent = [];
  let failOnce = false;
  const f = await fixture({
    whatsapp: {
      appSecret: 'segredo-meta',
      verifyToken: 'v',
      token: 'tok',
      phoneId: '123',
      confirmationTemplate: 'confirmacao_locacao',
      sendConfirmation: async rental => {
        if (failOnce) { failOnce = false; throw new Error('Falha temporária Meta'); }
        sent.push(rental);
      },
    },
  });
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    const { data: costume } = await f.request('/api/costumes', 'POST', { name: 'Homem Aranha', size: 'PP', quantity: 3 }, cookie);

    // 1. Com aceite WhatsApp: dispara imediatamente e não duplica em retry idempotente
    const input = {
      costumeId: costume.id,
      customerName: 'Marina Teste',
      phone: '71988001122',
      pickupDate: '2026-11-20',
      dueDate: '2026-11-22',
      priceCents: 15000,
      whatsappOptIn: true,
      requestId: '44444444-4444-4444-8444-444444444444',
    };
    const created = await f.request('/api/rentals', 'POST', input, cookie);
    assert.equal(created.status, 201);
    assert.equal(created.data.whatsappConfirmation.status, 'sent');
    assert.match(created.data.whatsappConfirmation.message, /Homem Aranha/);
    assert.match(created.data.whatsappConfirmation.message, /PP/);
    assert.match(created.data.whatsappConfirmation.message, /20\/11\/2026/);
    assert.match(created.data.whatsappConfirmation.message, /22\/11\/2026/);
    assert.match(created.data.whatsappConfirmation.message, /150,00/);
    assert.match(created.data.whatsappConfirmation.url, /^https:\/\/wa\.me\/5571988001122\?text=/);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].costumeName, 'Homem Aranha');
    assert.equal(sent[0].size, 'PP');

    // Repetição idempotente não reenvia WhatsApp
    const repeated = await f.request('/api/rentals', 'POST', input, cookie);
    assert.equal(repeated.status, 200);
    assert.equal(sent.length, 1);

    // Reenvio manual de quem já recebeu é recusado com 409
    assert.equal((await f.request(`/api/rentals/${created.data.id}/notify`, 'POST', {}, cookie)).status, 409);

    // 2. Sem aceite WhatsApp: não dispara automaticamente pela API
    const noOptIn = await f.request('/api/rentals', 'POST', {
      ...input,
      phone: '71988003344',
      customerName: 'Carlos Sem Aceite',
      whatsappOptIn: false,
      requestId: '55555555-5555-4555-8555-555555555555',
    }, cookie);
    assert.equal(noOptIn.status, 201);
    assert.equal(noOptIn.data.whatsappConfirmation.status, 'no_opt_in');
    assert.equal(sent.length, 1);
    assert.equal((await f.request(`/api/rentals/${noOptIn.data.id}/notify`, 'POST', {}, cookie)).status, 422);

    // 3. Falha transitória no envio preserva a locação salva e permite reenvio via /notify
    failOnce = true;
    const failedSend = await f.request('/api/rentals', 'POST', {
      ...input,
      phone: '71988005566',
      customerName: 'Joana Retry',
      whatsappOptIn: true,
      requestId: '66666666-6666-4666-8666-666666666666',
    }, cookie);
    assert.equal(failedSend.status, 201);
    assert.equal(failedSend.data.whatsappConfirmation.status, 'failed');
    assert.equal(sent.length, 1);

    const resent = await f.request(`/api/rentals/${failedSend.data.id}/notify`, 'POST', {}, cookie);
    assert.equal(resent.status, 200);
    assert.equal(resent.data.status, 'sent');
    assert.equal(sent.length, 2);

    // Lista de aluguéis expõe estado do aviso
    const list = await f.request('/api/rentals', 'GET', undefined, cookie);
    assert.ok(list.data.find(r => r.id === created.data.id).confirmationSentAt);
    assert.equal(list.data.find(r => r.id === noOptIn.data.id).whatsappOptIn, false);
  } finally { await f.close(); f.db.close(); }
});

test('fluxo de áudio de aluguel com fantasia ausente permite cadastrar no acervo e continuar a locação', async () => {
  const prevKey = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = 'chave-sintetica-teste';
  const f = await fixture({
    gemini: {
      extractAudioBatch: async () => ({
        transcript: 'Aluguei Princesa Elsa tamanho M para Marina Teste por 180 reais.',
        items: [{
          costumeName: 'Princesa Elsa',
          size: 'M',
          customerName: 'Marina Teste',
          phone: '71988001122',
          pickupDate: '2026-11-28',
          dueDate: '2026-11-30',
          priceCents: 18000,
          notes: '',
        }],
      }),
    },
  });
  try {
    const { cookie } = await f.request('/api/login', 'POST', { password: 'segredo-de-teste' });
    // 1. Áudio retorna rascunho de fantasia ainda ausente no acervo (sem gravar nada)
    const draftRes = await f.request('/api/drafts/audio', 'POST', { kind: 'rentals', mimeType: 'audio/m4a', data: 'ZmFrZQ==' }, cookie);
    assert.equal(draftRes.status, 200);
    assert.equal(draftRes.data.items[0].costumeName, 'Princesa Elsa');
    assert.equal((await f.request('/api/costumes', 'GET', undefined, cookie)).data.length, 0);

    // 2. Dona aciona cadastro rápido da fantasia recomendada mantendo o rascunho
    const quickCostume = await f.request('/api/costumes', 'POST', {
      name: 'Princesa Elsa',
      size: 'M',
      quantity: 1,
      requestId: '77777777-7777-4777-8777-777777777777',
    }, cookie);
    assert.equal(quickCostume.status, 201);

    // 3. Dona continua imediatamente o cadastro do cliente usando a fantasia recém-adicionada
    const rental = await f.request('/api/rentals', 'POST', {
      costumeId: quickCostume.data.id,
      customerName: 'Marina Teste',
      phone: '71988001122',
      pickupDate: '2026-11-28',
      dueDate: '2026-11-30',
      priceCents: 18000,
      whatsappOptIn: true,
      requestId: '88888888-8888-4888-8888-888888888888',
    }, cookie);
    assert.equal(rental.status, 201);
    assert.match(rental.data.whatsappConfirmation.message, /Princesa Elsa/);
    assert.match(rental.data.whatsappConfirmation.message, /Marina Teste/);
  } finally {
    if (prevKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = prevKey;
    await f.close();
    f.db.close();
  }
});
