import { daysLate, validDate } from './domain.js';

const cleanParam = value => String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ').trim();
const formatDateBr = date => typeof date === 'string' && date.includes('-') ? date.split('-').reverse().join('/') : String(date || '');
const formatMoneyBr = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }).replace(/\u00a0/g, ' ');
const formatPhoneBr = phone => {
  const digits = String(phone || '').replace(/\D/g, '');
  const local = digits.startsWith('55') && digits.length >= 12 ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return digits;
};

export function reminderFor(rental, date) {
  if (!validDate(date) || rental.status !== 'confirmed' || !rental.whatsappOptIn || rental.remindedAt || rental.dueDate >= date) return null;
  const late = daysLate(rental.dueDate, date);
  return { daysLate: late, lateFeeCents: late * 1000 };
}

export function confirmationFor(rental) {
  return Boolean(rental && rental.status === 'confirmed' && rental.whatsappOptIn && !rental.confirmationSentAt && Number(rental.confirmationAttempts || 0) < 3);
}

export function formatRentalConfirmationMessage(rental) {
  const customer = cleanParam(rental.customerName);
  const costume = cleanParam(rental.costumeName);
  const size = cleanParam(rental.size);
  const pickup = formatDateBr(rental.pickupDate);
  const due = formatDateBr(rental.dueDate);
  const price = formatMoneyBr(rental.priceCents);
  const phone = formatPhoneBr(rental.phone);
  return [
    `*Lore Modas — Confirmação de Locação #${rental.id}*`,
    '',
    `Olá, ${customer}! Sua locação foi confirmada com os seguintes dados:`,
    '',
    `• *Fantasia:* ${costume}`,
    `• *Tamanho:* ${size}`,
    `• *Retirada:* ${pickup}`,
    `• *Devolução prevista:* ${due}`,
    `• *Valor do aluguel:* ${price}`,
    `• *Telefone cadastrado:* ${phone}`,
    '',
    'Em caso de atraso após a data prevista, a multa é de R$ 10,00 por dia corrido. Qualquer dúvida ou ajuste, responda por aqui.',
  ].join('\n');
}

export function buildRentalConfirmationUrl(rental) {
  const digits = String(rental.phone || '').replace(/\D/g, '');
  return `https://wa.me/${encodeURIComponent(digits)}?text=${encodeURIComponent(formatRentalConfirmationMessage(rental))}`;
}

export async function sendRentalConfirmationTemplate(rental, { token, phoneId, confirmationTemplate, apiVersion = 'v23.0', fetchImpl = fetch }) {
  const parameters = [
    cleanParam(rental.customerName),
    `#${rental.id}`,
    cleanParam(rental.costumeName),
    cleanParam(rental.size),
    formatDateBr(rental.pickupDate),
    formatDateBr(rental.dueDate),
    formatMoneyBr(rental.priceCents),
  ].map(text => ({ type: 'text', text }));
  const response = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: rental.phone,
      type: 'template',
      template: {
        name: confirmationTemplate,
        language: { code: 'pt_BR' },
        components: [{ type: 'body', parameters }],
      },
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Aviso de confirmação não entregue (${response.status})`);
  return response.json();
}

export async function sendReminderTemplate(phone, dueDate, lateFeeCents, { token, phoneId, reminderTemplate, apiVersion = 'v23.0', fetchImpl = fetch }) {
  const response = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'template', template: {
      name: reminderTemplate, language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [
        { type: 'text', text: dueDate.split('-').reverse().join('/') },
        { type: 'text', text: (lateFeeCents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) },
      ] }],
    } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Lembrete não entregue (${response.status})`);
  return response.json();
}
