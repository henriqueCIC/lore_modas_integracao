import { createHmac, timingSafeEqual } from 'node:crypto';
import { validDate } from './domain.js';
import { callGeminiJson } from './gemini.js';

export function verifyMetaSignature(payload, signature, secret) {
  if (!secret || !/^sha256=[a-f0-9]{64}$/.test(signature || '')) return false;
  const expected = createHmac('sha256', secret).update(payload).digest();
  return timingSafeEqual(expected, Buffer.from(signature.slice(7), 'hex'));
}

export function mergeLead(current, extracted) {
  const next = { ...current };
  for (const key of ['costumeQuery', 'size']) if (typeof extracted[key] === 'string' && extracted[key].trim()) next[key] = extracted[key].trim().slice(0, 120);
  const mode = typeof extracted.mode === 'string' ? extracted.mode.trim().toLowerCase() : '';
  if (['aluguel', 'alugar'].includes(mode)) next.mode = 'aluguel';
  if (['compra', 'comprar'].includes(mode)) next.mode = 'compra';
  for (const key of ['useDate', 'dueDate']) if (validDate(extracted[key])) next[key] = extracted[key];
  if (next.useDate && next.dueDate && next.dueDate < next.useDate) delete next.dueDate;
  return next;
}

export function nextQuestion(lead) {
  if (!lead.costumeQuery) return 'Olá! Que fantasia ou personagem você procura? Se quiser, envie uma referência.';
  if (!lead.size) return 'Qual tamanho você precisa?';
  if (!lead.useDate) return 'Para qual data você precisa da fantasia?';
  if (!lead.mode) return 'Você deseja alugar ou comprar?';
  if (lead.mode === 'aluguel' && !lead.dueDate) return 'Qual será a data prevista de devolução?';
  return `Obrigada! Anotei ${lead.costumeQuery}, tamanho ${lead.size}, para ${lead.useDate}${lead.mode === 'aluguel' ? `, com devolução prevista em ${lead.dueDate}` : ''}. Nossa equipe vai confirmar disponibilidade e valores por aqui. Se precisar, escreva “atendente”.`;
}

export async function extractLead(message, current, apiKey, fetchImpl = fetch) {
  const parsed = await callGeminiJson({
    apiKey,
    contents: [{ parts: [{ text: `Extraia somente os dados que o cliente informou nesta última mensagem sobre uma fantasia. Não invente. Use null para ausentes. mode deve ser aluguel ou compra. Datas AAAA-MM-DD; datas relativas apenas se inequívocas em Salvador, hoje ${new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bahia' }).format(new Date())}. Estado anterior (para contexto, não copie dados dele): ${JSON.stringify(current)}. Mensagem: ${message}` }] }],
    schema: { type: 'OBJECT', properties: {
      costumeQuery: { type: 'STRING', nullable: true }, size: { type: 'STRING', nullable: true }, useDate: { type: 'STRING', nullable: true }, dueDate: { type: 'STRING', nullable: true }, mode: { type: 'STRING', enum: ['aluguel', 'compra'], nullable: true },
    }, required: ['costumeQuery', 'size', 'useDate', 'dueDate', 'mode'] },
    task: 'whatsapp-lead',
    fetchImpl,
    timeoutMs: 20_000,
  });
  return mergeLead(current, parsed);
}

export async function sendWhatsAppText(phone, text, { token, phoneId, apiVersion = 'v23.0', fetchImpl = fetch }) {
  const response = await fetchImpl(`https://graph.facebook.com/${apiVersion}/${phoneId}/messages`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ messaging_product: 'whatsapp', to: phone, type: 'text', text: { body: text } }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`WhatsApp indisponível (${response.status})`);
  return response.json();
}
