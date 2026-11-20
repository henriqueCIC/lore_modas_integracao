import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRentalDraft } from '../src/gemini.js';

test('extrai um rascunho sem gravar e preserva campos ausentes', async () => {
  let called = false;
  const fakeFetch = async (url, options) => {
    called = true;
    assert.ok(url.endsWith(`/${encodeURIComponent(process.env.GEMINI_MODEL || 'gemini-3.5-flash-lite')}:generateContent`));
    assert.equal(options.headers['x-goog-api-key'], 'chave-teste');
    assert.match(options.body, /inlineData/);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ costumeName: 'Pirata', size: 'M', customerName: 'Ana', phone: null, pickupDate: '2026-12-10', dueDate: '2026-12-12', priceCents: 8000 }) }] } }] }) };
  };
  const draft = await extractRentalDraft({ mimeType: 'image/jpeg', data: 'ZmFrZQ==', apiKey: 'chave-teste', fetchImpl: fakeFetch });
  assert.equal(called, true);
  assert.equal(draft.costumeName, 'Pirata');
  assert.equal(draft.phone, '');
});

test('recusa mídia inválida e erro de modelo', async () => {
  await assert.rejects(extractRentalDraft({ mimeType: 'text/plain', data: 'abc', apiKey: 'x' }), /Formato/);
  await assert.rejects(extractRentalDraft({ mimeType: 'audio/ogg', data: 'ZmFrZQ==', apiKey: 'x', fetchImpl: async () => ({ ok: false, status: 429 }) }), /Gemini/);
});

test('aceita áudio de celular e não preenche datas incoerentes', async () => {
  let sent;
  const draft = await extractRentalDraft({ mimeType: 'audio/webm;codecs=opus', data: 'ZmFrZQ==', apiKey: 'x', fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body).contents[0].parts[1].inlineData.mimeType;
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: JSON.stringify({ pickupDate: '2026-12-12', dueDate: '2026-12-10' }) }] } }] }) };
  } });
  assert.equal(sent, 'audio/webm');
  assert.equal(draft.pickupDate, '2026-12-12');
  assert.equal(draft.dueDate, '');
});
