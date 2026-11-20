import { mountCalendar } from './calendar.js';
import { mountCash } from './cash.js';
import { mountAudioImports } from './audio-import.js';
const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const money = cents => (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const prettyDate = date => date ? date.split('-').reverse().join('/') : '—';
const localDate = () => {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Bahia', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};
let costumes = [], rentals = [], leads = [];
let calendar, cash, audioImports;

async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Não foi possível concluir a ação');
  return data;
}
function toast(message) {
  $('#toast').textContent = message;
  $('#toast').classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => $('#toast').classList.remove('show'), 4500);
}
function showLogin() { $('#app').hidden = true; $('#login').hidden = false; }
function showApp() { $('#login').hidden = true; $('#app').hidden = false; }
function showWhatsAppNotice(customerName, confirmation, rentalId) {
  const box = $('#whatsapp-notice');
  if (!box || !confirmation?.message) return;
  const labels = {
    sent: { tag: 'Enviado automaticamente', text: `Aviso da locação de ${customerName} enviado no WhatsApp com todos os dados cadastrados.` },
    not_configured: { tag: 'Pronto para enviar', text: `Locação de ${customerName} confirmada. Para envio automático pela API oficial, configure WHATSAPP_TOKEN, WHATSAPP_PHONE_ID e WHATSAPP_CONFIRMATION_TEMPLATE no .env. Você já pode enviar em 1 clique abaixo:` },
    failed: { tag: 'Falha no envio automático', text: `Locação de ${customerName} confirmada, mas o envio automático falhou agora. Reenvie pela API ou abra direto no WhatsApp:` },
    no_opt_in: { tag: 'Aceite não marcado', text: `Locação de ${customerName} confirmada sem disparo automático. Caso o cliente autorize, envie o resumo abaixo pelo WhatsApp:` },
  };
  const info = labels[confirmation.status] || labels.not_configured;
  const safeUrl = typeof confirmation.url === 'string' && confirmation.url.startsWith('https://wa.me/') ? confirmation.url : '';
  box.innerHTML = `<div class="panel-head"><div><span class="eyebrow">AVISO DE LOCAÇÃO · WHATSAPP</span><h2>${esc(info.tag)}</h2></div><button type="button" class="text-button" data-close-wa>Fechar</button></div>
    <p class="hint">${esc(info.text)}</p>
    <pre class="whatsapp-preview"></pre>
    <div class="whatsapp-actions">
      ${safeUrl ? `<a class="primary lead-link" href="${esc(safeUrl)}" target="_blank" rel="noopener noreferrer">Abrir aviso no WhatsApp</a>` : ''}
      <button type="button" class="file-action" data-copy-wa>Copiar mensagem</button>
      ${confirmation.status === 'failed' && rentalId ? `<button type="button" class="file-action" data-notify-rental="${Number(rentalId)}">Reenviar pela API</button>` : ''}
    </div>`;
  box.querySelector('.whatsapp-preview').textContent = confirmation.message;
  box.querySelector('[data-close-wa]').addEventListener('click', () => { box.hidden = true; });
  box.querySelector('[data-copy-wa]').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(confirmation.message);
      toast('Aviso copiado para a área de transferência.');
    } catch {
      toast('Selecione e copie o texto da prévia acima.');
    }
  });
  box.hidden = false;
  box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}
function row(rental, showReturn = false) {
  const overdue = rental.status !== 'returned' && rental.dueDate < localDate() ? Math.round((Date.parse(`${localDate()}T00:00:00Z`) - Date.parse(`${rental.dueDate}T00:00:00Z`)) / 86_400_000) : 0;
  const waStatus = rental.confirmationSentAt
    ? '<small>WhatsApp: confirmação enviada</small>'
    : rental.whatsappOptIn && rental.whatsappApiReady && rental.status === 'confirmed'
      ? '<small>WhatsApp: envio automático pendente</small>'
      : '';
  const safeWaUrl = typeof rental.whatsappUrl === 'string' && rental.whatsappUrl.startsWith('https://wa.me/') ? rental.whatsappUrl : '';
  const actions = [
    showReturn ? `<button class="small-button" data-return="${rental.id}">Registrar devolução</button>` : '',
    safeWaUrl && rental.status === 'confirmed' ? `<a class="small-button lead-link" href="${esc(safeWaUrl)}" target="_blank" rel="noopener noreferrer">Aviso WhatsApp</a>` : '',
    rental.whatsappApiReady && rental.whatsappOptIn && !rental.confirmationSentAt && rental.status === 'confirmed' ? `<button class="small-button" data-notify-rental="${rental.id}">Enviar aviso API</button>` : '',
  ].filter(Boolean).join('');
  return `<div class="list-row"><div><strong>${esc(rental.costumeName)} · ${esc(rental.size)}</strong><small>${esc(rental.customerName)} · ${esc(rental.phone)}</small><small>Retirada ${prettyDate(rental.pickupDate)} · Devolução ${prettyDate(rental.dueDate)}</small>${waStatus}${rental.status === 'returned' ? `<small>Devolvida em ${prettyDate(rental.returnedDate)} · Multa ${money(rental.lateFeeCents)} · Total ${money(rental.priceCents + rental.lateFeeCents)}</small>` : overdue ? `<small>${overdue} dia(s) de atraso · Multa até hoje ${money(overdue * 1000)}</small>` : ''}</div><div class="right"><strong>${money(rental.priceCents)}</strong>${actions ? `<div class="row-actions">${actions}</div>` : ''}</div></div>`;
}
function list(selector, rows, showReturn = false) { $(selector).innerHTML = rows.length ? rows.map(item => row(item, showReturn)).join('') : '<p class="empty">Nada por aqui nesta data.</p>'; }
async function refresh() {
  [costumes, rentals, leads] = await Promise.all([api('/api/costumes'), api('/api/rentals'), api('/api/leads')]);
  $('#costume-count').textContent = costumes.length;
  $('#costume-list').innerHTML = costumes.length ? costumes.map(c => `<div class="list-row"><div><strong>${esc(c.name)}</strong><small>Tamanho ${esc(c.size)}</small></div><span class="tag">${c.quantity} exemplar${c.quantity > 1 ? 'es' : ''}</span></div>`).join('') : '<p class="empty">Cadastre a primeira fantasia para começar.</p>';
  $('#rental-costume').innerHTML = '<option value="">Selecione uma fantasia</option>' + costumes.map(c => `<option value="${c.id}">${esc(c.name)} · ${esc(c.size)} (${c.quantity})</option>`).join('');
  $('#rental-list').innerHTML = rentals.length ? rentals.map(r => row(r, r.status === 'confirmed')).join('') : '<p class="empty">Nenhum aluguel registrado.</p>';
  $('#lead-list').innerHTML = leads.length ? leads.map(lead => `<div class="list-row"><div><strong>${esc(lead.costumeQuery || 'Fantasia ainda não informada')} · ${esc(lead.size || 'tamanho pendente')}</strong><small>${esc(lead.customerName || 'Cliente')} · ${esc(lead.phone)}</small><small>${esc(lead.mode || 'modalidade pendente')} · uso ${prettyDate(lead.useDate)}${lead.dueDate ? ` · devolução ${prettyDate(lead.dueDate)}` : ''}</small><small>Última mensagem: ${esc(lead.lastMessage)}</small></div><div class="right"><span class="tag ${lead.status === 'human' ? 'danger' : ''}">${lead.status === 'ready' ? 'Pronto para confirmar' : lead.status === 'human' ? 'Atendimento humano' : 'Em conversa'}</span><br><a class="small-button lead-link" href="https://wa.me/${encodeURIComponent(lead.phone)}" target="_blank" rel="noopener noreferrer">Abrir conversa</a> <button class="small-button" data-reset-lead="${esc(lead.phone)}">Novo pedido</button></div></div>`).join('') : '<p class="empty">Os pedidos do WhatsApp aparecerão aqui após conectar um número de teste.</p>';
  audioImports?.syncCostumes();
  await Promise.all([refreshDashboard(), calendar?.refresh(), cash?.refresh()]);
}
async function refreshDashboard() {
  const date = $('#dashboard-date').value || localDate();
  const data = await api(`/api/dashboard?date=${encodeURIComponent(date)}`);
  $('#agenda-selected').textContent = `Agenda de ${prettyDate(date)}`;
  for (const rental of [...data.pickup, ...data.due, ...data.overdue]) if (!rentals.some(item => item.id === rental.id)) rentals.push(rental);
  $('#pickup-count').textContent = data.pickup.length;
  $('#due-count').textContent = data.due.length;
  $('#overdue-count').textContent = data.overdue.length;
  $('#pickup-tag').textContent = prettyDate(date);
  $('#due-tag').textContent = prettyDate(date);
  list('#pickup-list', data.pickup);
  list('#due-list', data.due, true);
  list('#overdue-list', data.overdue, true);
}
function navigate(view) {
  const target = document.getElementById(`view-${view}`) ? view : 'hoje';
  document.querySelectorAll('.view').forEach(el => el.hidden = el.id !== `view-${target}`);
  document.querySelectorAll('.nav-link').forEach(el => el.classList.toggle('active', el.dataset.view === target));
}
function openRental({ allowEmptyCostumes = false } = {}) {
  if (!allowEmptyCostumes && !costumes.length) { toast('Cadastre uma fantasia antes de registrar um aluguel.'); location.hash = 'fantasias'; navigate('fantasias'); return; }
  $('#rental-form').reset();
  $('#draft-note').textContent = '';
  $('#pickup-date').value = localDate();
  $('#due-date').value = localDate();
  $('#rental-dialog').showModal();
}
async function importMedia(file) {
  if (!file) return;
  if (file.size > 14_000_000) { toast('O arquivo deve ter até 14 MB.'); return; }
  toast('Lendo mídia com Gemini…');
  const dataUrl = await new Promise((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(reader.result); reader.onerror = () => reject(new Error('Não foi possível abrir o arquivo')); reader.readAsDataURL(file); });
  const draft = await api('/api/drafts/extract', { method: 'POST', body: JSON.stringify({ mimeType: file.type || '', fileName: file.name || '', data: String(dataUrl).split(',')[1] || '' }) });
  openRental({ allowEmptyCostumes: true });
  const form = $('#rental-form');
  form.elements.customerName.value = draft.customerName;
  form.elements.phone.value = draft.phone;
  if (draft.pickupDate) form.elements.pickupDate.value = draft.pickupDate;
  if (draft.dueDate) form.elements.dueDate.value = draft.dueDate;
  form.elements.price.value = draft.priceCents === null ? '' : (draft.priceCents / 100).toFixed(2);
  const norm = v => String(v || '').trim().toLocaleLowerCase('pt-BR');
  const match = costumes.find(c => norm(c.name) === norm(draft.costumeName) && (!norm(draft.size) || norm(c.size) === norm(draft.size)));
  form.elements.costumeId.value = match?.id || '';
  $('#draft-note').textContent = match ? 'Rascunho preenchido. Confira cada campo antes de confirmar.' : `Fantasia lida: ${draft.costumeName || 'não identificada'} · ${draft.size || 'tamanho não identificado'}. Cadastre no estoque na janela aberta ou selecione abaixo.`;
  toast('Rascunho preenchido. Nada foi salvo ainda.');
  if (!match) {
    audioImports?.openQuickCostume?.({
      costumeName: draft.costumeName || '',
      preferredSize: draft.size || '',
      onSaved(chosen, savedList) {
        if (!chosen) return;
        form.elements.costumeId.value = String(chosen.id);
        const summary = savedList.map(c => `${c.size}: ${c.quantity} un.`).join(', ');
        $('#draft-note').textContent = `“${chosen.name}” inserida no inventário (${summary}) e selecionada neste aluguel. Confira os demais campos.`;
      },
    });
  }
}
function openReturn(id) {
  const rental = rentals.find(r => r.id === id);
  if (!rental) return;
  $('#return-form').reset();
  $('#return-form').elements.rentalId.value = id;
  $('#return-date').value = localDate();
  $('#return-summary').textContent = `${rental.costumeName} · ${rental.size} — ${rental.customerName}. Previsto para ${prettyDate(rental.dueDate)}.`;
  updateFee();
  $('#return-dialog').showModal();
}
function updateFee() {
  const rental = rentals.find(r => r.id === Number($('#return-form').elements.rentalId.value));
  if (!rental || !$('#return-date').value) return;
  const due = Date.parse(`${rental.dueDate}T00:00:00Z`), returned = Date.parse(`${$('#return-date').value}T00:00:00Z`);
  const days = Math.max(0, Math.round((returned - due) / 86_400_000));
  $('#fee-preview').textContent = `${days} dia(s) de atraso · Multa ${money(days * 1000)} · Total ${money(rental.priceCents + days * 1000)}`;
}

$('#login-form').addEventListener('submit', async event => {
  event.preventDefault();
  $('#login-error').textContent = '';
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ password: $('#password').value }) });
    $('#password').value = '';
    showApp();
    navigate(location.hash.slice(1) || 'hoje');
    await refresh();
  } catch (error) { $('#login-error').textContent = error.message; }
});
$('#logout').addEventListener('click', async () => { await api('/api/logout', { method: 'POST' }); showLogin(); });
document.querySelectorAll('.nav-link').forEach(link => link.addEventListener('click', () => navigate(link.dataset.view)));
window.addEventListener('hashchange', () => navigate(location.hash.slice(1) || 'hoje'));
$('#dashboard-date').addEventListener('change', () => refreshDashboard().catch(error => toast(error.message)));
$('#new-rental').addEventListener('click', openRental);
$('#new-rental-2').addEventListener('click', openRental);
$('#photo-button').addEventListener('click', () => $('#photo-file').click());
for (const selector of ['#photo-file']) $(selector).addEventListener('change', event => importMedia(event.target.files[0]).catch(error => toast(error.message)).finally(() => { event.target.value = ''; }));
document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => button.closest('dialog').close()));
document.addEventListener('click', event => { const button = event.target.closest('[data-return]'); if (button) openReturn(Number(button.dataset.return)); });
document.addEventListener('click', async event => {
  const button = event.target.closest('[data-notify-rental]');
  if (!button || button.disabled) return;
  button.disabled = true;
  try {
    const outcome = await api(`/api/rentals/${Number(button.dataset.notifyRental)}/notify`, { method: 'POST', body: '{}' });
    toast('Aviso de confirmação enviado no WhatsApp.');
    showWhatsAppNotice('cliente', outcome, Number(button.dataset.notifyRental));
    await refresh();
  } catch (error) {
    toast(error.message);
    button.disabled = false;
  }
});
document.addEventListener('click', async event => { const button = event.target.closest('[data-reset-lead]'); if (button) try { await api(`/api/leads/${button.dataset.resetLead}/reset`, { method: 'POST' }); toast('Novo pedido liberado.'); await refresh(); } catch (error) { toast(error.message); } });
$('#return-date').addEventListener('change', updateFee);
$('#costume-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try { await api('/api/costumes', { method: 'POST', body: JSON.stringify(data) }); form.reset(); toast('Fantasia cadastrada.'); await refresh(); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#rental-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  const priceCents = Math.round(Number(data.price) * 100);
  delete data.price;
  try {
    const created = await api('/api/rentals', { method: 'POST', body: JSON.stringify({ ...data, whatsappOptIn: data.whatsappOptIn === 'on', priceCents }) });
    $('#rental-dialog').close();
    toast(created?.whatsappConfirmation?.status === 'sent' ? 'Aluguel registrado e aviso enviado no WhatsApp.' : 'Aluguel registrado.');
    if (created?.whatsappConfirmation) showWhatsAppNotice(data.customerName, created.whatsappConfirmation, created.id);
    await refresh();
  }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
$('#return-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget, button = form.querySelector('[type=submit]');
  if (button.disabled) return;
  button.disabled = true;
  const data = Object.fromEntries(new FormData(form));
  try { const result = await api(`/api/rentals/${data.rentalId}/return`, { method: 'POST', body: JSON.stringify({ returnedDate: data.returnedDate }) }); $('#return-dialog').close(); toast(`Devolução registrada. Total: ${money(result.totalCents)}.`); await refresh(); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});
audioImports = mountAudioImports({
  api, esc, toast, refresh, getCostumes: () => costumes,
  onRentalCreated: (name, created) => {
    if (created?.whatsappConfirmation) showWhatsAppNotice(name, created.whatsappConfirmation, created.id);
  },
});
calendar = mountCalendar($('#agenda-calendar'), { api, initialDate: localDate(), onSelect: async date => { $('#dashboard-date').value = date; await refreshDashboard().catch(error => toast(error.message)); } });
cash = mountCash({ api, esc, money, initialDate: localDate(), toast });
$('#today-label').textContent = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'full', timeZone: 'America/Bahia' }).format(new Date());
$('#dashboard-date').value = localDate();
try { await refresh(); showApp(); navigate(location.hash.slice(1) || 'hoje'); }
catch (error) { if (error.message === 'Entre para continuar') showLogin(); else { showLogin(); $('#login-error').textContent = error.message; } }
