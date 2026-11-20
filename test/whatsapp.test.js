import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyMetaSignature, nextQuestion, mergeLead, extractLead } from '../src/whatsapp.js';

test('valida assinatura da Meta e rejeita alteração', () => {
  const payload = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = 'sha256=' + createHmac('sha256', 'secret').update(payload).digest('hex');
  assert.equal(verifyMetaSignature(payload, signature, 'secret'), true);
  assert.equal(verifyMetaSignature(Buffer.from('outro'), signature, 'secret'), false);
});

test('pergunta apenas dados ausentes e nunca promete reserva', () => {
  assert.match(nextQuestion({ costumeQuery: 'Pirata' }), /tamanho/i);
  assert.match(nextQuestion({ costumeQuery: 'Pirata', size: 'M', useDate: '2026-12-10' }), /alugar ou comprar/i);
  assert.match(nextQuestion({ costumeQuery: 'Pirata', size: 'M', useDate: '2026-12-10', mode: 'aluguel' }), /devolução/i);
  assert.match(nextQuestion({ costumeQuery: 'Pirata', size: 'M', useDate: '2026-12-10', mode: 'aluguel', dueDate: '2026-12-12' }), /confirmar disponibilidade/i);
});

test('mescla dados novos sem apagar os já confirmados', () => {
  assert.deepEqual(mergeLead({ costumeQuery: 'Pirata', size: '' }, { costumeQuery: '', size: 'M', mode: 'compra' }), { costumeQuery: 'Pirata', size: 'M', mode: 'compra' });
});

test('normaliza modalidade e pede nova data se devolução for anterior ao uso', async () => {
  const lead = mergeLead({ costumeQuery: 'Pirata', size: 'M', useDate: '2026-12-12' }, { mode: 'Alugar', dueDate: '2026-12-10' });
  assert.equal(lead.mode, 'aluguel');
  assert.equal(lead.dueDate, undefined);
  assert.match(nextQuestion(lead), /devolução/i);
  let request;
  await extractLead('quero alugar', {}, 'chave', async (_url, options) => {
    request = JSON.parse(options.body);
    return { ok: true, json: async () => ({ candidates: [{ content: { parts: [{ text: '{"mode":"aluguel"}' }] } }] }) };
  });
  assert.deepEqual(request.generationConfig.responseSchema.properties.mode.enum, ['aluguel', 'compra']);
});
