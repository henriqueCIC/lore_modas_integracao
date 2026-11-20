import { createServer as httpServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createDatabase } from './db.js';
import { daysLate, validDate, validRentalDates } from './domain.js';
import { extractRentalDraft, extractAudioBatch } from './gemini.js';
import { extractLead, nextQuestion, sendWhatsAppText, verifyMetaSignature } from './whatsapp.js';
import {
  reminderFor,
  sendReminderTemplate,
  confirmationFor,
  formatRentalConfirmationMessage,
  buildRentalConfirmationUrl,
  sendRentalConfirmationTemplate,
} from './reminders.js';

const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const send = (res, status, data, headers = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
};
const fail = (status, message) => Object.assign(new Error(message), { status });
const today = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
const positiveId = value => Number.isSafeInteger(Number(value)) && Number(value) > 0 ? Number(value) : null;
const clean = (value, max = 120) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const brazilPhone = value => {
  const digits = clean(value, 30).replace(/\D/g, '');
  const phone = digits.length === 10 || digits.length === 11 ? `55${digits}` : digits;
  return /^55\d{10,11}$/.test(phone) ? phone : '';
};

async function body(req, maxLength = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxLength) throw fail(413, 'Conteúdo muito grande');
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw fail(400, 'JSON inválido'); }
}

async function rawBody(req, maxLength = 1_000_000) {
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxLength) throw fail(413, 'Conteúdo muito grande');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function createServer({ db, password, whatsapp, gemini }) {
  if (!password || password.length < 12) throw new Error('Defina uma senha com pelo menos 12 caracteres');
  const draftService = {
    extractRentalDraft: gemini?.extractRentalDraft || extractRentalDraft,
    extractAudioBatch: gemini?.extractAudioBatch || extractAudioBatch,
  };
  const salt = randomBytes(16);
  const expected = scryptSync(password, salt, 32);
  const sessions = new Set();
  const loginAttempts = new Map();
  function receipt(input, kind, result) {
    if (input.requestId === undefined) return null;
    if (typeof input.requestId !== 'string' || !/^[a-f0-9-]{36}$/.test(input.requestId)) throw fail(422, 'Identificador de confirmação inválido');
    const fingerprint = createHash('sha256').update(JSON.stringify(input, Object.keys(input).sort())).digest('hex');
    if (result) {
      db.prepare('INSERT INTO write_receipts (request_id, kind, fingerprint, result) VALUES (?, ?, ?, ?)').run(input.requestId, kind, fingerprint, JSON.stringify(result));
      return result;
    }
    const stored = db.prepare('SELECT * FROM write_receipts WHERE request_id=?').get(input.requestId);
    if (!stored) return null;
    if (stored.kind !== kind || stored.fingerprint !== fingerprint) throw fail(409, 'Este rascunho já foi confirmado com outros dados. Confira a lista antes de cadastrar novamente.');
    return JSON.parse(stored.result);
  }
  const wa = whatsapp || (process.env.WHATSAPP_APP_SECRET && process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID && process.env.GEMINI_API_KEY ? {
    appSecret: process.env.WHATSAPP_APP_SECRET, verifyToken: process.env.WHATSAPP_VERIFY_TOKEN,
    token: process.env.WHATSAPP_TOKEN, phoneId: process.env.WHATSAPP_PHONE_ID, geminiKey: process.env.GEMINI_API_KEY,
    reminderTemplate: process.env.WHATSAPP_REMINDER_TEMPLATE || '',
    confirmationTemplate: process.env.WHATSAPP_CONFIRMATION_TEMPLATE || '',
  } : null);
  const waOutbound = whatsapp || (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_ID ? {
    token: process.env.WHATSAPP_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_ID,
    reminderTemplate: process.env.WHATSAPP_REMINDER_TEMPLATE || '',
    confirmationTemplate: process.env.WHATSAPP_CONFIRMATION_TEMPLATE || '',
  } : null);
  const canSendConfirmationApi = () => Boolean(waOutbound?.sendConfirmation || (waOutbound?.token && waOutbound?.phoneId && waOutbound?.confirmationTemplate));
  let processing = false;
  let reminding = false;
  let confirming = false;
  async function deliverRentalConfirmation(rental) {
    const message = formatRentalConfirmationMessage(rental);
    const url = buildRentalConfirmationUrl(rental);
    if (!rental.whatsappOptIn) return { status: 'no_opt_in', message, url };
    if (rental.confirmationSentAt) return { status: 'sent', sentAt: rental.confirmationSentAt, message, url };
    if (!canSendConfirmationApi()) return { status: 'not_configured', message, url };
    try {
      if (waOutbound.sendConfirmation) await waOutbound.sendConfirmation(rental, message);
      else await sendRentalConfirmationTemplate(rental, waOutbound);
      db.prepare('UPDATE rentals SET confirmation_sent_at=CURRENT_TIMESTAMP WHERE id=? AND confirmation_sent_at IS NULL').run(rental.id);
      return { status: 'sent', message, url };
    } catch (error) {
      db.prepare('UPDATE rentals SET confirmation_attempts=confirmation_attempts+1 WHERE id=?').run(rental.id);
      console.error('[whatsapp] Falha no aviso de confirmação:', error.message);
      return { status: 'failed', error: 'Não foi possível entregar o aviso agora. Tente reenviar em instantes.', message, url };
    }
  }
  async function checkConfirmations() {
    if (!canSendConfirmationApi() || confirming) return;
    confirming = true;
    try {
      const rows = db.prepare(`SELECT r.id, c.name AS costumeName, c.size, u.name AS customerName, u.phone,
        r.pickup_date AS pickupDate, r.due_date AS dueDate, r.price_cents AS priceCents, r.status,
        r.whatsapp_opt_in AS whatsappOptIn, r.confirmation_sent_at AS confirmationSentAt,
        r.confirmation_attempts AS confirmationAttempts
        FROM rentals r JOIN costumes c ON c.id=r.costume_id JOIN customers u ON u.id=r.customer_id
        WHERE r.status='confirmed' AND r.whatsapp_opt_in=1 AND r.confirmation_sent_at IS NULL
        AND r.confirmation_attempts > 0 AND r.confirmation_attempts < 3 LIMIT 20`).all();
      for (const rental of rows) {
        if (!confirmationFor(rental)) continue;
        await deliverRentalConfirmation(rental);
      }
    } finally { confirming = false; }
  }
  async function checkReminders() {
    if (!waOutbound?.reminderTemplate || reminding) return;
    const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bahia', hour: '2-digit', hourCycle: 'h23' }).format(new Date()));
    if (hour < 9 || hour > 18) return;
    reminding = true;
    try {
      const date = today();
      const rows = db.prepare(`SELECT r.id, r.due_date AS dueDate, r.status, r.reminded_at AS remindedAt,
        c.phone, r.whatsapp_opt_in AS whatsappOptIn
        FROM rentals r JOIN customers c ON c.id=r.customer_id
        WHERE r.status='confirmed' AND r.due_date < ? AND r.reminded_at IS NULL
        AND r.whatsapp_opt_in=1 AND r.reminder_attempts<3`).all(date);
      for (const rental of rows) {
        const reminder = reminderFor(rental, date);
        if (!reminder) continue;
        try {
          await sendReminderTemplate(rental.phone, rental.dueDate, reminder.lateFeeCents, waOutbound);
          db.prepare('UPDATE rentals SET reminded_at=CURRENT_TIMESTAMP WHERE id=? AND reminded_at IS NULL').run(rental.id);
        } catch (error) {
          db.prepare('UPDATE rentals SET reminder_attempts=reminder_attempts+1 WHERE id=?').run(rental.id);
          console.error('Falha no lembrete:', error.message);
        }
      }
    } finally { reminding = false; }
  }
  async function drainMessages() {
    if (!wa || processing) return;
    processing = true;
    try {
      const pending = db.prepare('SELECT * FROM inbound_messages WHERE processed_at IS NULL AND attempts < 3 ORDER BY rowid LIMIT 20').all();
      for (const message of pending) {
        try {
          let reply = message.reply_text;
          if (!reply) {
            const stored = db.prepare('SELECT * FROM leads WHERE phone=?').get(message.phone);
            const lead = stored ? { costumeQuery: stored.costume_query, size: stored.size, useDate: stored.use_date, dueDate: stored.due_date, mode: stored.mode } : {};
            let status = stored?.status || 'collecting';
            if (status === 'collecting' && (/\b(atendente|humano|pessoa)\b/i.test(message.text) || !message.text)) {
              status = 'human';
              reply = 'Recebi sua mensagem. Nossa equipe vai continuar o atendimento por aqui.';
            } else if (status === 'collecting') {
              const updated = wa.extract ? await wa.extract(message.text, lead) : await extractLead(message.text, lead, wa.geminiKey);
              Object.assign(lead, updated);
              reply = nextQuestion(lead);
              if (lead.costumeQuery && lead.size && lead.useDate && lead.mode && (lead.mode !== 'aluguel' || lead.dueDate)) status = 'ready';
            }
            db.prepare(`INSERT INTO leads (phone, customer_name, costume_query, size, use_date, due_date, mode, status, last_message, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
              ON CONFLICT(phone) DO UPDATE SET customer_name=CASE WHEN excluded.customer_name='' THEN leads.customer_name ELSE excluded.customer_name END, costume_query=excluded.costume_query,
              size=excluded.size, use_date=excluded.use_date, due_date=excluded.due_date, mode=excluded.mode,
              status=excluded.status, last_message=excluded.last_message, updated_at=CURRENT_TIMESTAMP`).run(
                message.phone, message.customer_name, lead.costumeQuery || '', lead.size || '', lead.useDate || '', lead.dueDate || '', lead.mode || '', status, message.text,
              );
            db.prepare('UPDATE inbound_messages SET reply_text=? WHERE id=?').run(reply || '', message.id);
          }
          if (reply) {
            if (wa.send) await wa.send(message.phone, reply);
            else await sendWhatsAppText(message.phone, reply, wa);
          }
          db.prepare('UPDATE inbound_messages SET processed_at=CURRENT_TIMESTAMP WHERE id=?').run(message.id);
        } catch (error) {
          db.prepare('UPDATE inbound_messages SET attempts=attempts+1, last_error=? WHERE id=?').run(String(error.message).slice(0, 200), message.id);
          if (message.attempts >= 2) db.prepare("UPDATE leads SET status='human' WHERE phone=?").run(message.phone);
          console.error('Falha no envio WhatsApp:', error.message);
        }
      }
    } finally { processing = false; }
  }
  const retryTimer = wa ? setInterval(() => drainMessages().catch(console.error), 5_000).unref() : null;
  const reminderTimer = (waOutbound?.reminderTemplate || canSendConfirmationApi())
    ? setInterval(() => {
      checkReminders().catch(console.error);
      checkConfirmations().catch(console.error);
    }, 60_000).unref()
    : null;

  const server = httpServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
      if (url.pathname === '/webhooks/whatsapp' && req.method === 'GET') {
        if (!wa || url.searchParams.get('hub.mode') !== 'subscribe' || url.searchParams.get('hub.verify_token') !== wa.verifyToken) throw fail(403, 'Verificação recusada');
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
        res.end(url.searchParams.get('hub.challenge') || '');
        return;
      }
      if (url.pathname === '/webhooks/whatsapp' && req.method === 'POST') {
        if (!wa) throw fail(503, 'WhatsApp não configurado');
        const raw = await rawBody(req);
        if (!verifyMetaSignature(raw, req.headers['x-hub-signature-256'], wa.appSecret)) throw fail(403, 'Assinatura inválida');
        let event;
        try { event = JSON.parse(raw); } catch { throw fail(400, 'JSON inválido'); }
        if (event.object !== 'whatsapp_business_account') throw fail(400, 'Evento inválido');
        for (const entry of event.entry || []) for (const change of entry.changes || []) {
          for (const message of change.value?.messages || []) {
            if (!message.id || !/^\d{10,15}$/.test(message.from || '')) continue;
            const customerName = clean(change.value?.contacts?.find(contact => contact.wa_id === message.from)?.profile?.name || '', 120);
            db.prepare('INSERT OR IGNORE INTO inbound_messages (id, phone, customer_name, text) VALUES (?, ?, ?, ?)').run(message.id, message.from, customerName, message.type === 'text' ? clean(message.text?.body, 2000) : '');
          }
        }
        send(res, 200, { ok: true });
        setImmediate(() => drainMessages().catch(console.error));
        return;
      }
      if (req.method === 'GET' && ['/','/app.js','/audio-import.js','/calendar.js','/cash.js','/styles.css','/lore-modas.png'].includes(url.pathname)) {
        const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const types = { 'index.html': 'text/html; charset=utf-8', 'app.js': 'text/javascript; charset=utf-8', 'audio-import.js': 'text/javascript; charset=utf-8', 'calendar.js': 'text/javascript; charset=utf-8', 'cash.js': 'text/javascript; charset=utf-8', 'styles.css': 'text/css; charset=utf-8', 'lore-modas.png': 'image/png' };
        res.writeHead(200, {
          'content-type': types[file],
          'cache-control': file === 'lore-modas.png' ? 'public, max-age=3600' : 'no-cache',
          'x-content-type-options': 'nosniff',
          'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; media-src 'self' blob:; img-src 'self' data: blob:; object-src 'none'; base-uri 'none'",
        });
        res.end(await readFile(join(publicDir, file)));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/login') {
        const forwarded = process.env.TRUST_LOCAL_PROXY === '1' && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
          ? req.headers['x-forwarded-for']?.split(',')[0].trim() : '';
        const ip = forwarded || req.socket.remoteAddress || 'unknown';
        const now = Date.now();
        if (loginAttempts.size > 1000) {
          for (const [key, entry] of loginAttempts) if (entry.until < now) loginAttempts.delete(key);
        }
        const attempts = loginAttempts.get(ip) || { count: 0, until: now + 900_000 };
        if (attempts.until < now) { attempts.count = 0; attempts.until = now + 900_000; }
        if (attempts.count >= 5) throw fail(429, 'Muitas tentativas. Tente novamente em 15 minutos');
        const input = await body(req);
        const actual = scryptSync(String(input.password || '').slice(0, 256), salt, 32);
        if (!timingSafeEqual(actual, expected)) {
          attempts.count++;
          loginAttempts.set(ip, attempts);
          throw fail(401, 'Senha incorreta');
        }
        loginAttempts.delete(ip);
        const sid = randomBytes(32).toString('hex');
        sessions.add(sid);
        const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
        send(res, 200, { ok: true }, { 'set-cookie': `sid=${sid}; HttpOnly; SameSite=Strict; Path=/${secure}` });
        return;
      }
      if (!url.pathname.startsWith('/api/')) throw fail(404, 'Página não encontrada');
      const sid = /(?:^|;\s*)sid=([a-f0-9]{64})(?:;|$)/.exec(req.headers.cookie || '')?.[1];
      if (!sessions.has(sid)) throw fail(401, 'Entre para continuar');
      if (req.method !== 'GET' && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) throw fail(403, 'Origem não permitida');
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        sessions.delete(sid);
        send(res, 200, { ok: true }, { 'set-cookie': 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/drafts/extract') {
        const input = await body(req, 20_500_000);
        if (!process.env.GEMINI_API_KEY) throw fail(503, 'Gemini não configurado');
        try {
          send(res, 200, await draftService.extractRentalDraft({ mimeType: input.mimeType, fileName: input.fileName, data: input.data, apiKey: process.env.GEMINI_API_KEY }));
        } catch (error) {
          const status = error.httpStatus || (error.message.startsWith('Formato') ? 422 : 502);
          console.error('[drafts/extract] falha:', status, error.message);
          throw fail(status, status === 502 ? 'Não foi possível ler a mídia. Tente novamente.' : error.message);
        }
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/drafts/audio') {
        const input = await body(req, 20_500_000);
        if (!['costumes', 'rentals'].includes(input.kind)) throw fail(422, 'Tipo de importação inválido');
        if (!process.env.GEMINI_API_KEY) throw fail(503, 'Gemini não configurado');
        try {
          send(res, 200, await draftService.extractAudioBatch({ kind: input.kind, mimeType: input.mimeType, fileName: input.fileName, data: input.data, apiKey: process.env.GEMINI_API_KEY }));
        } catch (error) {
          const status = error.httpStatus || (error.message.startsWith('Formato') ? 422 : 502);
          console.error('[drafts/audio] falha:', status, error.message);
          throw fail(status, status === 502 ? 'Não foi possível transcrever o áudio. Tente novamente.' : error.message);
        }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/calendar') {
        const month = url.searchParams.get('month') || today().slice(0, 7);
        if (!/^\d{4}-\d{2}$/.test(month) || !validDate(`${month}-01`)) throw fail(422, 'Mês inválido');
        const events = db.prepare(`SELECT pickup_date AS date, 'pickup' AS kind FROM rentals WHERE status='confirmed' AND pickup_date BETWEEN ? AND ?
          UNION ALL SELECT due_date AS date, 'return' AS kind FROM rentals WHERE status='confirmed' AND due_date BETWEEN ? AND ?`).all(`${month}-01`, `${month}-31`, `${month}-01`, `${month}-31`);
        const days = new Map();
        for (const event of events) {
          const day = days.get(event.date) || { date: event.date, pickups: 0, returns: 0 };
          day[event.kind === 'pickup' ? 'pickups' : 'returns']++;
          days.set(event.date, day);
        }
        send(res, 200, { month, days: [...days.values()] });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/cash') {
        const date = url.searchParams.get('date') || today();
        if (!validDate(date)) throw fail(422, 'Data inválida');
        const payments = db.prepare(`SELECT p.id, p.rental_id AS rentalId, p.amount_cents AS amountCents, p.received_date AS receivedDate, p.method,
          c.name AS costumeName, c.size, u.name AS customerName FROM payments p JOIN rentals r ON r.id=p.rental_id
          JOIN costumes c ON c.id=r.costume_id JOIN customers u ON u.id=r.customer_id WHERE p.received_date=? ORDER BY p.id DESC`).all(date);
        const pending = db.prepare(`SELECT r.id, r.price_cents AS priceCents, r.pickup_date AS pickupDate, c.name AS costumeName, c.size, u.name AS customerName
          FROM rentals r JOIN costumes c ON c.id=r.costume_id JOIN customers u ON u.id=r.customer_id
          LEFT JOIN payments p ON p.rental_id=r.id WHERE p.id IS NULL AND r.status!='cancelled' AND r.pickup_date<=? ORDER BY r.pickup_date DESC, r.id DESC`).all(date);
        const expectedCents = db.prepare("SELECT COALESCE(SUM(price_cents),0) AS total FROM rentals WHERE pickup_date=? AND status!='cancelled'").get(date).total;
        send(res, 200, { date, expectedCents, receivedCents: payments.reduce((sum, payment) => sum + payment.amountCents, 0), payments, pending });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/cash/payments') {
        const input = await body(req);
        const rentalId = positiveId(input.rentalId);
        if (!rentalId || !validDate(input.receivedDate) || input.receivedDate > today() || !['pix', 'cash', 'card', 'transfer'].includes(input.method)) throw fail(422, 'Confira o aluguel, a data recebida e a forma de pagamento');
        db.exec('BEGIN IMMEDIATE');
        try {
          const rental = db.prepare("SELECT price_cents, status FROM rentals WHERE id=?").get(rentalId);
          if (!rental || rental.status === 'cancelled') throw fail(404, 'Aluguel não encontrado');
          const existing = db.prepare('SELECT id, received_date, method FROM payments WHERE rental_id=?').get(rentalId);
          if (existing && (existing.received_date !== input.receivedDate || existing.method !== input.method)) throw fail(409, 'Este aluguel já possui recebimento confirmado. Confira o histórico.');
          const id = existing?.id || Number(db.prepare('INSERT INTO payments (rental_id, amount_cents, received_date, method) VALUES (?, ?, ?, ?)').run(rentalId, rental.price_cents, input.receivedDate, input.method).lastInsertRowid);
          db.exec('COMMIT');
          send(res, existing ? 200 : 201, { id, amountCents: rental.price_cents });
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/costumes') {
        send(res, 200, db.prepare('SELECT id, name, size, quantity FROM costumes ORDER BY name, size').all());
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/leads') {
        send(res, 200, db.prepare('SELECT phone, customer_name AS customerName, costume_query AS costumeQuery, size, use_date AS useDate, due_date AS dueDate, mode, status, last_message AS lastMessage, updated_at AS updatedAt FROM leads ORDER BY updated_at DESC LIMIT 500').all());
        return;
      }
      const leadReset = /^\/api\/leads\/(\d{10,15})\/reset$/.exec(url.pathname);
      if (req.method === 'POST' && leadReset) {
        const result = db.prepare("UPDATE leads SET costume_query='', size='', use_date='', due_date='', mode='', status='collecting', last_message='', updated_at=CURRENT_TIMESTAMP WHERE phone=?").run(leadReset[1]);
        if (!result.changes) throw fail(404, 'Pedido não encontrado');
        send(res, 200, { ok: true });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/costumes') {
        const input = await body(req);
        const saved = receipt(input, 'costumes');
        if (saved) { send(res, 200, saved); return; }
        const name = clean(input.name), size = clean(input.size, 30), quantity = Number(input.quantity);
        if (!name || !size || !Number.isSafeInteger(quantity) || quantity < 1) throw fail(422, 'Informe fantasia, tamanho e quantidade positiva');
        db.exec('BEGIN IMMEDIATE');
        try {
          let result;
          if (input.existingId !== undefined) {
            const existing = db.prepare('SELECT * FROM costumes WHERE id=?').get(positiveId(input.existingId) || 0);
            if (!existing) throw fail(404, 'Fantasia não encontrada');
            if (existing.name !== name || existing.size !== size) throw fail(409, 'Confira o nome e tamanho do item que receberá as unidades');
            if (!Number.isSafeInteger(existing.quantity + quantity)) throw fail(422, 'Quantidade excede o limite');
            db.prepare('UPDATE costumes SET quantity=quantity+? WHERE id=?').run(quantity, existing.id);
            result = { id: existing.id, name, size, quantity: existing.quantity + quantity };
          } else {
            const created = db.prepare('INSERT INTO costumes (name, size, quantity) VALUES (?, ?, ?)').run(name, size, quantity);
            result = { id: Number(created.lastInsertRowid), name, size, quantity };
          }
          receipt(input, 'costumes', result);
          db.exec('COMMIT');
          send(res, 201, result);
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/rentals') {
        const apiReady = canSendConfirmationApi();
        const rows = db.prepare(`SELECT r.id, c.name AS costumeName, c.size, u.name AS customerName, u.phone,
          r.pickup_date AS pickupDate, r.due_date AS dueDate, r.returned_date AS returnedDate,
          r.price_cents AS priceCents, r.late_fee_cents AS lateFeeCents, r.status,
          r.whatsapp_opt_in AS whatsappOptIn, r.confirmation_sent_at AS confirmationSentAt,
          r.confirmation_attempts AS confirmationAttempts
          FROM rentals r JOIN costumes c ON c.id=r.costume_id JOIN customers u ON u.id=r.customer_id
          ORDER BY r.status='confirmed' DESC, r.due_date DESC, r.id DESC LIMIT 500`).all();
        send(res, 200, rows.map(r => ({
          ...r,
          whatsappOptIn: Boolean(r.whatsappOptIn),
          whatsappApiReady: apiReady,
          whatsappMessage: formatRentalConfirmationMessage(r),
          whatsappUrl: buildRentalConfirmationUrl(r),
        })));
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/rentals') {
        const input = await body(req);
        const saved = receipt(input, 'rentals');
        if (saved) { send(res, 200, saved); return; }
        const costumeId = positiveId(input.costumeId), customerName = clean(input.customerName), phone = brazilPhone(input.phone);
        const priceCents = input.priceCents === null || input.priceCents === '' || input.priceCents === undefined ? NaN : Number(input.priceCents);
        if (!costumeId || !customerName || !phone || !validRentalDates(input.pickupDate, input.dueDate) || !Number.isSafeInteger(priceCents) || priceCents < 0) throw fail(422, 'Confira cliente, telefone, datas e valor');
        let createdRental;
        db.exec('BEGIN IMMEDIATE');
        try {
          const costume = db.prepare('SELECT name, size, quantity FROM costumes WHERE id=?').get(costumeId);
          if (!costume) throw fail(404, 'Fantasia não encontrada');
          const overlaps = db.prepare(`SELECT pickup_date AS pickupDate,
            CASE WHEN due_date < ? THEN '9999-12-31' ELSE due_date END AS dueDate
            FROM rentals WHERE costume_id=? AND status='confirmed' AND pickup_date <= ?
            AND (due_date >= ? OR due_date < ?)`).all(today(), costumeId, input.dueDate, input.pickupDate, today());
          const starts = [input.pickupDate, ...overlaps.map(r => r.pickupDate).filter(date => date >= input.pickupDate)];
          if (starts.some(date => overlaps.filter(r => r.pickupDate <= date && r.dueDate >= date).length >= costume.quantity)) throw fail(409, 'Fantasia indisponível nessas datas');
          db.prepare('INSERT INTO customers (name, phone) VALUES (?, ?) ON CONFLICT(phone) DO UPDATE SET name=excluded.name').run(customerName, phone);
          const customerId = db.prepare('SELECT id FROM customers WHERE phone=?').get(phone).id;
          const whatsappOptIn = input.whatsappOptIn === true;
          const result = db.prepare(`INSERT INTO rentals (costume_id, customer_id, pickup_date, due_date, price_cents, whatsapp_opt_in, status)
            VALUES (?, ?, ?, ?, ?, ?, 'confirmed')`).run(costumeId, customerId, input.pickupDate, input.dueDate, priceCents, whatsappOptIn ? 1 : 0);
          const id = Number(result.lastInsertRowid);
          receipt(input, 'rentals', { id });
          db.exec('COMMIT');
          createdRental = {
            id,
            costumeName: costume.name,
            size: costume.size,
            customerName,
            phone,
            pickupDate: input.pickupDate,
            dueDate: input.dueDate,
            priceCents,
            status: 'confirmed',
            whatsappOptIn,
            confirmationSentAt: null,
            confirmationAttempts: 0,
          };
        } catch (error) { db.exec('ROLLBACK'); throw error; }
        const whatsappConfirmation = await deliverRentalConfirmation(createdRental);
        send(res, 201, { id: createdRental.id, whatsappConfirmation });
        return;
      }
      const notifyMatch = /^\/api\/rentals\/(\d+)\/notify$/.exec(url.pathname);
      if (req.method === 'POST' && notifyMatch) {
        const rental = db.prepare(`SELECT r.id, c.name AS costumeName, c.size, u.name AS customerName, u.phone,
          r.pickup_date AS pickupDate, r.due_date AS dueDate, r.price_cents AS priceCents, r.status,
          r.whatsapp_opt_in AS whatsappOptIn, r.confirmation_sent_at AS confirmationSentAt,
          r.confirmation_attempts AS confirmationAttempts
          FROM rentals r JOIN costumes c ON c.id=r.costume_id JOIN customers u ON u.id=r.customer_id
          WHERE r.id=?`).get(Number(notifyMatch[1]));
        if (!rental || rental.status === 'cancelled') throw fail(404, 'Aluguel não encontrado');
        if (!rental.whatsappOptIn) throw fail(422, 'Cliente não autorizou avisos por WhatsApp nesta locação');
        if (rental.confirmationSentAt) throw fail(409, 'Aviso de confirmação já foi enviado para esta locação');
        if (!canSendConfirmationApi()) throw fail(503, 'WhatsApp de confirmação não configurado no servidor');
        const outcome = await deliverRentalConfirmation({ ...rental, whatsappOptIn: Boolean(rental.whatsappOptIn) });
        send(res, outcome.status === 'sent' ? 200 : 502, outcome);
        return;
      }
      const returnMatch = /^\/api\/rentals\/(\d+)\/return$/.exec(url.pathname);
      if (req.method === 'POST' && returnMatch) {
        const input = await body(req);
        if (!validDate(input.returnedDate)) throw fail(422, 'Data de devolução inválida');
        const rental = db.prepare('SELECT pickup_date, due_date, price_cents, status FROM rentals WHERE id=?').get(Number(returnMatch[1]));
        if (!rental) throw fail(404, 'Aluguel não encontrado');
        if (rental.status !== 'confirmed') throw fail(409, 'Aluguel já encerrado');
        if (input.returnedDate < rental.pickup_date || input.returnedDate > today()) throw fail(422, 'Data de devolução inválida');
        const lateFeeCents = daysLate(rental.due_date, input.returnedDate) * 1000;
        db.prepare("UPDATE rentals SET returned_date=?, late_fee_cents=?, status='returned' WHERE id=?").run(input.returnedDate, lateFeeCents, Number(returnMatch[1]));
        send(res, 200, { lateFeeCents, totalCents: rental.price_cents + lateFeeCents });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/dashboard') {
        const date = url.searchParams.get('date') || today();
        if (!validDate(date)) throw fail(422, 'Data inválida');
        const rows = db.prepare(`SELECT r.id, c.name AS costumeName, c.size, u.name AS customerName, u.phone,
          r.pickup_date AS pickupDate, r.due_date AS dueDate, r.price_cents AS priceCents
          FROM rentals r JOIN costumes c ON c.id=r.costume_id JOIN customers u ON u.id=r.customer_id
          WHERE r.status='confirmed' ORDER BY r.due_date, r.id`).all();
        send(res, 200, { date, pickup: rows.filter(r => r.pickupDate === date), due: rows.filter(r => r.dueDate === date), overdue: rows.filter(r => r.dueDate < date) });
        return;
      }
      throw fail(404, 'Recurso não encontrado');
    } catch (error) {
      send(res, error.status || 500, { error: error.status ? error.message : 'Erro interno' });
      if (!error.status) console.error(error);
    }
  });
  if (retryTimer) server.on('close', () => clearInterval(retryTimer));
  if (reminderTimer) server.on('close', () => clearInterval(reminderTimer));
  if (wa) setImmediate(() => drainMessages().catch(console.error));
  if (waOutbound?.reminderTemplate) setImmediate(() => checkReminders().catch(console.error));
  if (canSendConfirmationApi()) setImmediate(() => checkConfirmations().catch(console.error));
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const path = process.env.DB_PATH || join(dirname(fileURLToPath(import.meta.url)), '../data/fantasias.sqlite');
  if (!process.env.ADMIN_PASSWORD) throw new Error('Defina ADMIN_PASSWORD com pelo menos 12 caracteres');
  mkdirSync(dirname(path), { recursive: true });
  createServer({ db: createDatabase(path), password: process.env.ADMIN_PASSWORD }).listen(Number(process.env.PORT || 3000), '127.0.0.1', () => console.log('Painel em http://127.0.0.1:' + (process.env.PORT || 3000)));
}
