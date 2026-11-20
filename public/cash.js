import { mountCalendar } from './calendar.js';
export function mountCash({ api, esc, money, initialDate, toast }) {
  const host = document.querySelector('#cash-content');
  let date = initialDate;
  let generation = 0;
  const methods = { pix: 'Pix', cash: 'Dinheiro', card: 'Cartão', transfer: 'Transferência' };
  const label = () => date.split('-').reverse().join('/');
  mountCalendar(document.querySelector('#cash-calendar'), { api, initialDate, showEvents: false, onSelect: async value => { date = value; document.querySelector('#cash-date-picker').open = false; try { await refresh(); } catch (error) { toast(error.message); } } });
  async function refresh() {
    const ownGeneration = ++generation;
    host.innerHTML = '<p class="empty" role="status">Carregando caixa…</p>';
    let result;
    try { result = await api(`/api/cash?date=${date}`); } catch (error) { if (ownGeneration === generation) host.innerHTML = `<p class="draft-error" role="alert">${esc(error.message)}. Selecione a data para tentar novamente.</p>`; throw error; }
    if (ownGeneration !== generation) return;
    document.querySelector('#cash-date-label').textContent = `Caixa de ${label()}`;
    host.innerHTML = `<div class="stats cash-stats"><article><span>RECEBIDO NO DIA</span><strong>${money(result.receivedCents)}</strong><small>${result.payments.length} recebimento(s) confirmado(s)</small></article><article><span>ALUGUÉIS COM RETIRADA NO DIA</span><strong>${money(result.expectedCents)}</strong><small>Valor contratado, pago ou a receber</small></article></div>
      <section class="panel"><div class="panel-head"><h2>Confirmar recebimentos</h2><span class="tag">${result.pending.length} pendente(s)</span></div><p class="hint">Aluguéis com retirada até ${label()} ainda sem pagamento confirmado. Registre somente o valor integral do aluguel que já recebeu. Multas e pagamentos parciais serão controlados em uma próxima etapa.</p>
      ${result.pending.length ? result.pending.map(rental => `<form class="cash-row" data-payment="${rental.id}" data-date="${date}"><div><strong>${esc(rental.customerName)}</strong><small>${esc(rental.costumeName)} · ${esc(rental.size)} · retirada ${rental.pickupDate.split('-').reverse().join('/')}</small><strong>${money(rental.priceCents)}</strong></div><div class="cash-confirm"><label>Forma recebida<select name="method" required><option value="">Selecione</option>${Object.entries(methods).map(([value, text]) => `<option value="${value}">${text}</option>`).join('')}</select></label><button type="submit" class="primary" ${date > initialDate ? 'disabled' : ''}>Confirmar em ${label()}</button></div><p class="draft-error" role="alert"></p></form>`).join('') : '<p class="empty">Nenhum recebimento pendente até esta data.</p>'}</section>
      <section class="panel cash-history"><div class="panel-head"><h2>Entradas confirmadas</h2></div>${result.payments.length ? result.payments.map(payment => `<div class="list-row"><div><strong>${esc(payment.customerName)}</strong><small>${esc(payment.costumeName)} · ${esc(payment.size)} · ${methods[payment.method]}</small></div><strong>${money(payment.amountCents)}</strong></div>`).join('') : '<p class="empty">Ainda não há entradas confirmadas neste dia.</p>'}</section>`;
  }
  host.addEventListener('submit', async event => {
    const form = event.target.closest('[data-payment]');
    if (!form) return;
    event.preventDefault();
    const button = form.querySelector('button');
    if (button.disabled) return;
    button.disabled = true;
    try {
      await api('/api/cash/payments', { method: 'POST', body: JSON.stringify({ rentalId: Number(form.dataset.payment), receivedDate: form.dataset.date, method: form.elements.method.value }) });
      toast('Recebimento confirmado.');
      await refresh();
    } catch (error) { form.querySelector('.draft-error').textContent = error.message; button.disabled = false; }
  });
  return { refresh };
}
