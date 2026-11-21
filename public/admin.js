const labels = { connection: 'Testar conexão', response: 'Testar resposta', audio: 'Testar áudio', templates: 'Conferir templates', send: 'Enviar mensagem de teste' };
export function mountAdmin({ api, esc, toast }) {
  const root = document.querySelector('#view-admin');
  async function refresh() {
    try {
      const [users, integrations, events, usage] = await Promise.all(['users', 'integrations', 'events', 'usage'].map(path => api(`/api/admin/${path}`)));
      root.querySelector('[data-users]').innerHTML = users.map(u => `<div class="list-row"><div><strong>${esc(u.username)}</strong><small>${u.role === 'admin' ? 'Administrador' : 'Operadora'} · ${u.blocked ? 'Bloqueado' : 'Ativo'}${u.mustChange ? ' · Troca de senha pendente' : ''}</small><small>Último acesso: ${esc(u.lastLogin || 'Ainda não entrou')}${u.lastLogin ? ' UTC' : ''}</small></div><div class="row-actions">${[u.blocked ? 'unblock' : 'block', 'revoke', 'reset'].map(action => `<button class="small-button" data-user="${u.id}" data-action="${action}" data-name="${esc(u.username)}">${{ block: 'Bloquear', unblock: 'Desbloquear', revoke: 'Encerrar sessões', reset: 'Redefinir senha' }[action]}</button>`).join('')}</div></div>`).join('');
      root.querySelector('[data-integrations]').innerHTML = integrations.map(i => `<article class="panel"><h2>${esc(i.name)}</h2><p>${i.configured ? 'Configurado' : 'Não configurado'}${i.suffix ? ` · Chave ${esc(i.suffix)} · Identificador ${esc(i.fingerprint)}` : ''}</p>${i.models ? `<p>Modelos: ${esc(i.models.join(' → '))}</p>` : ''}${i.source ? `<p>Origem: ${esc(i.source)}. Testes de resposta e áudio consomem cota.</p>` : ''}${i.wabaId ? `<p>Conta WhatsApp: ${esc(i.wabaId)} · Templates: ${esc(i.templates.join(', ') || 'Nenhum')}</p>` : ''}${i.phoneId ? `<p>Número (ID): ${esc(i.phoneId)} · ${esc(i.apiVersion)}</p>` : ''}<p>${i.lastTest ? `Último teste: ${esc(i.lastTest.created_at)} UTC · ${esc(i.lastTest.status)} · ${i.lastTest.duration_ms} ms · ${esc(i.lastTest.message)}` : 'Ainda não testado'}</p>${i.lastBackup ? `<p>Cópia verificada: ${esc(i.lastBackup.verified_at)} UTC</p>` : ''}${i.id === 'webhook' ? `<p>${i.lastEvent ? `Último callback com assinatura válida: ${esc(i.lastEvent)} UTC` : 'Recebimento não comprovado'}</p>` : ''}${i.challenge ? `<p>Recebimento: ${i.challenge.receivedAt ? 'Confirmado' : Date.now() > i.challenge.expiresAt ? 'Código expirado' : `Aguardando ${esc(i.challenge.code)}`}</p>` : ''}${i.deliveries?.map(d => `<p>Mensagem ${esc(d.id)}: ${esc(d.status)}</p>`).join('') || ''}<div class="row-actions">${i.tests.map(kind => `<button class="small-button" data-provider="${i.id}" data-kind="${kind}" data-recipient="${esc(i.testRecipient || '')}" ${i.configured ? '' : 'disabled'}>${labels[kind]}</button>`).join('')}</div><p data-result="${i.id}" role="status"></p></article>`).join('');
      root.querySelector('[data-events]').textContent = events.map(e => `${e.created_at} UTC · ${e.actor || 'Terminal local'} · ${e.action} · conta ${e.target_id || '—'} · ${e.result}`).join('\n') || 'Nenhuma ação registrada.';
      root.querySelector('[data-usage]').textContent = usage.map(e => `${e.created_at} UTC · ${e.kind} · ${e.model || '—'} · ${e.status} · ${e.duration_ms} ms · ${e.tokens ?? 'não informado'} tokens · chave ${e.fingerprint || '—'}`).join('\n') || 'Nenhuma chamada registrada desde esta atualização.';
    } catch (error) { toast(error.message); }
  }
  root.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.hasAttribute('data-refresh')) return refresh();
    if (button.dataset.user) {
      if (!confirm(`${button.textContent} para ${button.dataset.name}? As sessões existentes podem ser encerradas.`)) return;
      button.disabled = true;
      try {
        const result = await api(`/api/admin/users/${button.dataset.user}/${button.dataset.action}`, { method: 'POST', body: '{}' });
        if (result.temporaryPassword) {
          const dialog = document.querySelector('#temporary-password');
          dialog.querySelector('output').textContent = result.temporaryPassword;
          dialog.showModal();
        }
        await refresh();
      } catch (error) { toast(error.message); }
      finally { button.disabled = false; }
    }
    if (button.dataset.provider) {
      const { provider, kind, recipient } = button.dataset;
      if (kind === 'send' && !confirm(`Enviar uma mensagem real de teste para ${recipient || 'destinatário não configurado'}? A Meta pode cobrar pelo envio.`)) return;
      button.disabled = true;
      const resultBox = root.querySelector(`[data-result="${provider}"]`);
      resultBox.textContent = 'Testando…';
      try {
        const result = await api(`/api/admin/integrations/${provider}/tests`, { method: 'POST', body: JSON.stringify({ kind, recipient }) });
        resultBox.textContent = `${result.status}: ${result.message} Duração: ${result.durationMs} ms.${result.number ? ` Número: ${result.number}.` : ''}${result.templates ? ` ${result.templates.map(t => `${t.name}: ${t.approved ? 'aprovado' : 'indisponível'}`).join('; ')}.` : ''}${result.usage ? ` Tokens: ${result.usage.totalTokens ?? 'não informado'}.` : ''}${result.model ? ` Modelo: ${result.model}${result.fallback ? ' (alternativo)' : ''}.` : ''}`;
      } catch (error) { resultBox.textContent = error.message; }
      finally { button.disabled = false; }
    }
  });
  const dialog = document.querySelector('#temporary-password');
  dialog.addEventListener('close', () => { dialog.querySelector('output').textContent = ''; });
  return { refresh };
}
