export function mountCalendar(host, { api, initialDate, onSelect, showEvents = true }) {
  let selected = initialDate;
  let month = initialDate.slice(0, 7);
  let days = [];
  let generation = 0;
  const formatter = new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  function render() {
    const [year, number] = month.split('-').map(Number);
    const first = new Date(Date.UTC(year, number - 1, 1));
    const count = new Date(Date.UTC(year, number, 0)).getUTCDate();
    const offset = (first.getUTCDay() + 6) % 7;
    const rawMonth = formatter.format(first);
    const monthTitle = rawMonth ? rawMonth[0].toLocaleUpperCase('pt-BR') + rawMonth.slice(1) : rawMonth;
    host.innerHTML = `<div class="calendar-toolbar"><div><span class="eyebrow">${showEvents ? 'AGENDA DA LOJA' : 'ESCOLHA UMA DATA'}</span><h2>${monthTitle}</h2></div><div class="calendar-controls"><button type="button" class="small-button" data-month="-1" aria-label="Mês anterior">‹</button><button type="button" class="small-button" data-today>Hoje</button><button type="button" class="small-button" data-month="1" aria-label="Próximo mês">›</button></div></div>
      <div class="calendar-week" aria-hidden="true">${['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB', 'DOM'].map(day => `<span>${day}</span>`).join('')}</div>
      <div class="calendar-days" role="group" aria-label="Dias de ${rawMonth}">${'<span class="calendar-blank" aria-hidden="true"></span>'.repeat(offset)}${Array.from({ length: count }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        const event = days.find(item => item.date === date);
        const label = `${index + 1} de ${rawMonth}${event ? `, ${event.pickups} retirada(s), ${event.returns} devolução(ões)` : ''}`;
        return `<button type="button" class="calendar-day ${date === initialDate ? 'is-today' : ''}" data-date="${date}" aria-label="${label}" aria-pressed="${date === selected}"><span class="calendar-number">${index + 1}</span>${showEvents ? `<span class="calendar-events" aria-hidden="true">${event?.pickups ? `<span class="event-pickup">${event.pickups}<span class="event-word"> retirada${event.pickups > 1 ? 's' : ''}</span></span>` : ''}${event?.returns ? `<span class="event-return">${event.returns}<span class="event-word"> ${event.returns > 1 ? 'devoluções' : 'devolução'}</span></span>` : ''}</span>` : ''}</button>`;
      }).join('')}</div>${showEvents ? '<p class="calendar-legend"><span>● Retiradas</span><span>● Devoluções previstas</span><small>Toque no dia para ver a agenda.</small></p>' : ''}`;
  }
  async function refresh() {
    const ownGeneration = ++generation;
    try {
      const result = showEvents ? await api(`/api/calendar?month=${month}`) : { days: [] };
      if (ownGeneration !== generation) return;
      days = result.days; render();
    } catch (error) {
      if (ownGeneration !== generation) return;
      days = []; render();
      const message = document.createElement('p'); message.className = 'draft-error'; message.textContent = error.message; host.append(message);
    }
  }
  host.addEventListener('click', async event => {
    const day = event.target.closest('[data-date]');
    const step = event.target.closest('[data-month]');
    if (day) { selected = day.dataset.date; render(); await onSelect(selected); }
    else if (step) {
      const [year, number] = month.split('-').map(Number);
      const next = new Date(Date.UTC(year, number - 1 + Number(step.dataset.month), 1));
      if (next.getUTCFullYear() < 1900 || next.getUTCFullYear() > 2099) return;
      month = next.toISOString().slice(0, 7); await refresh();
    } else if (event.target.closest('[data-today]')) { selected = initialDate; month = initialDate.slice(0, 7); await refresh(); await onSelect(selected); }
  });
  render();
  return { refresh };
}
