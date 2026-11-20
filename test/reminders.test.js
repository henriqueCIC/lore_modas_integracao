import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reminderFor,
  sendReminderTemplate,
  confirmationFor,
  formatRentalConfirmationMessage,
  sendRentalConfirmationTemplate,
} from '../src/reminders.js';

const rental = { status: 'confirmed', dueDate: '2026-12-10', whatsappOptIn: 1, remindedAt: null };

test('lembrete só sai após vencimento, com consentimento e uma vez', () => {
  assert.equal(reminderFor(rental, '2026-12-10'), null);
  assert.equal(reminderFor({ ...rental, whatsappOptIn: 0 }, '2026-12-11'), null);
  assert.equal(reminderFor({ ...rental, remindedAt: '2026-12-11' }, '2026-12-12'), null);
  assert.equal(reminderFor({ ...rental, status: 'returned' }, '2026-12-12'), null);
  assert.deepEqual(reminderFor(rental, '2026-12-13'), { daysLate: 3, lateFeeCents: 3000 });
});

test('envia template aprovado com data e multa em reais', async () => {
  let payload;
  await sendReminderTemplate('5571999999999', '2026-12-10', 3000, {
    token: 'token', phoneId: '123', reminderTemplate: 'atraso_fantasia',
    fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ messages: [{ id: '1' }] }) }; },
  });
  assert.equal(payload.to, '5571999999999');
  assert.equal(payload.template.name, 'atraso_fantasia');
  assert.deepEqual(payload.template.components[0].parameters.map(p => p.text), ['10/12/2026', 'R$ 30,00']);
});

test('formata aviso completo de confirmação de locação e envia template com todos os dados', async () => {
  const fullRental = {
    id: 42,
    costumeName: 'Homem Aranha',
    size: 'PP',
    customerName: 'Marina  \n Teste',
    phone: '5571988001122',
    pickupDate: '2026-11-20',
    dueDate: '2026-11-22',
    priceCents: 15000,
    status: 'confirmed',
    whatsappOptIn: 1,
    confirmationSentAt: null,
    confirmationAttempts: 0,
  };
  assert.equal(confirmationFor(fullRental), true);
  assert.equal(confirmationFor({ ...fullRental, whatsappOptIn: 0 }), false);
  assert.equal(confirmationFor({ ...fullRental, confirmationSentAt: '2026-11-19 14:00:00' }), false);
  assert.equal(confirmationFor({ ...fullRental, confirmationAttempts: 3 }), false);

  const text = formatRentalConfirmationMessage(fullRental);
  assert.match(text, /Lore Modas/);
  assert.match(text, /#42/);
  assert.match(text, /Marina Teste/);
  assert.match(text, /Homem Aranha/);
  assert.match(text, /PP/);
  assert.match(text, /20\/11\/2026/);
  assert.match(text, /22\/11\/2026/);
  assert.match(text, /R\$\s*150,00/);
  assert.match(text, /\(71\) 98800-1122/);

  let payload;
  await sendRentalConfirmationTemplate(fullRental, {
    token: 'token', phoneId: '123', confirmationTemplate: 'confirmacao_locacao',
    fetchImpl: async (_url, options) => { payload = JSON.parse(options.body); return { ok: true, json: async () => ({ messages: [{ id: 'wamid.conf1' }] }) }; },
  });
  assert.equal(payload.to, '5571988001122');
  assert.equal(payload.type, 'template');
  assert.equal(payload.template.name, 'confirmacao_locacao');
  assert.equal(payload.template.language.code, 'pt_BR');
  assert.deepEqual(
    payload.template.components[0].parameters.map(p => p.text),
    ['Marina Teste', '#42', 'Homem Aranha', 'PP', '20/11/2026', '22/11/2026', 'R$ 150,00'],
  );
});
