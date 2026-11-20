const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('pt-BR');
const MAX_AUDIO_BYTES = 14_000_000;
const ACCEPTED_AUDIO = 'audio/*,.ogg,.opus,.mp3,.m4a,.mp4,.wav,.webm,.aac,.flac,.aiff,.aif';
const QUICK_SIZES = ['PP', 'P', 'M', 'G', 'GG', 'Infantil', 'Único'];

function findMatchingCostume(costumes, readName, readSize) {
  const normName = normalize(readName);
  const normSize = normalize(readSize);
  if (!normName) return null;
  if (normSize) {
    const exact = costumes.filter(c => normalize(c.name) === normName && normalize(c.size) === normSize);
    if (exact.length === 1) return exact[0];
  }
  if (!normSize) {
    const byName = costumes.filter(c => normalize(c.name) === normName);
    if (byName.length >= 1) return byName[0];
  }
  return null;
}

function ensureQuickCostumeDialog({ api, esc, toast, refresh, getCostumes }) {
  let dialog = document.querySelector('#quick-costume-dialog');
  if (dialog?._controller) return dialog._controller;
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.id = 'quick-costume-dialog';
    dialog.className = 'quick-costume-dialog';
    document.body.append(dialog);
  }
  dialog.innerHTML = `<form class="dialog-form qc-form" method="dialog">
    <div class="dialog-head">
      <div><span class="eyebrow" data-qc-eyebrow>FANTASIA CITADA NO ÁUDIO · FORA DO ESTOQUE</span><h2 data-qc-title>Cadastrar no estoque</h2></div>
      <button type="button" class="close-button" data-qc-close aria-label="Fechar">×</button>
    </div>
    <p class="hint" data-qc-lead>Esta fantasia foi citada no áudio e ainda não está no estoque. Informe somente quais tamanhos e quantas fantasias tem disponíveis para inserir no inventário:</p>
    <label class="qc-name-field" data-qc-name-wrap hidden><span>Nome da fantasia</span><input type="text" data-qc-name maxlength="120" required placeholder="Ex.: Tinker Bell"></label>
    <div class="qc-chips-block">
      <span class="hint">Tamanhos disponíveis (toque para adicionar):</span>
      <div class="qc-size-chips">${QUICK_SIZES.map(size => `<button type="button" class="small-button qc-chip" data-size-chip="${esc(size)}">${esc(size)}</button>`).join('')}</div>
    </div>
    <div class="qc-rows-head"><span>Quais tamanhos disponíveis</span><span>Quantas disponíveis</span><span></span></div>
    <div class="qc-rows" data-qc-rows></div>
    <button type="button" class="text-button qc-add-row" data-qc-add-row>+ Adicionar outro tamanho disponível</button>
    <p class="draft-error" data-qc-error role="alert"></p>
    <div class="draft-actions">
      <button type="button" class="file-action" data-qc-cancel>Agora não</button>
      <button type="submit" class="primary" data-qc-submit>Inserir no inventário e voltar</button>
    </div>
  </form>`;

  const form = dialog.querySelector('form');
  const eyebrowEl = dialog.querySelector('[data-qc-eyebrow]');
  const titleEl = dialog.querySelector('[data-qc-title]');
  const leadEl = dialog.querySelector('[data-qc-lead]');
  const nameWrap = dialog.querySelector('[data-qc-name-wrap]');
  const nameInput = dialog.querySelector('[data-qc-name]');
  const rowsHost = dialog.querySelector('[data-qc-rows]');
  const addRowBtn = dialog.querySelector('[data-qc-add-row]');
  const errorEl = dialog.querySelector('[data-qc-error]');
  const submitBtn = dialog.querySelector('[data-qc-submit]');
  const cancelBtn = dialog.querySelector('[data-qc-cancel]');
  const closeBtn = dialog.querySelector('[data-qc-close]');
  let currentContext = null;
  const queue = [];

  function syncChipStates() {
    const activeSizes = new Set(
      Array.from(rowsHost.querySelectorAll('[data-qc-size]'))
        .map(input => normalize(input.value))
        .filter(Boolean),
    );
    for (const chip of dialog.querySelectorAll('[data-size-chip]')) {
      chip.classList.toggle('is-selected', activeSizes.has(normalize(chip.dataset.sizeChip)));
    }
  }

  function syncRemoveButtons() {
    const rows = rowsHost.querySelectorAll('.qc-row');
    rows.forEach(row => {
      const btn = row.querySelector('[data-qc-remove-row]');
      if (btn) btn.hidden = rows.length <= 1;
    });
    syncChipStates();
  }

  function addSizeRow(sizeValue = '', qtyValue = 1, focusTarget = 'size') {
    const row = document.createElement('div');
    row.className = 'qc-row';
    row.innerHTML = `<input type="text" data-qc-size value="${esc(sizeValue)}" maxlength="30" placeholder="Ex.: P, M, G" required aria-label="Tamanho disponível">
      <input type="number" data-qc-qty value="${esc(qtyValue)}" min="1" step="1" required aria-label="Quantidade disponível">
      <button type="button" class="close-button qc-remove-row" data-qc-remove-row aria-label="Remover tamanho">×</button>`;
    const sizeInput = row.querySelector('[data-qc-size]');
    const qtyInput = row.querySelector('[data-qc-qty]');
    sizeInput.addEventListener('input', syncChipStates);
    row.querySelector('[data-qc-remove-row]').addEventListener('click', () => {
      if (rowsHost.querySelectorAll('.qc-row').length <= 1) return;
      row.remove();
      syncRemoveButtons();
    });
    rowsHost.append(row);
    syncRemoveButtons();
    if (focusTarget === 'qty') {
      qtyInput.focus();
      qtyInput.select?.();
    } else if (focusTarget === 'size') {
      sizeInput.focus();
    }
    return { row, sizeInput, qtyInput };
  }

  nameInput.addEventListener('input', () => {
    const cleanName = nameInput.value.trim();
    titleEl.textContent = cleanName ? `“${cleanName}”` : 'Nova fantasia no estoque';
  });

  addRowBtn.addEventListener('click', () => addSizeRow('', 1, 'size'));

  for (const chip of dialog.querySelectorAll('[data-size-chip]')) {
    chip.addEventListener('click', () => {
      const chipSize = chip.dataset.sizeChip;
      const existingInput = Array.from(rowsHost.querySelectorAll('[data-qc-size]'))
        .find(input => normalize(input.value) === normalize(chipSize));
      if (existingInput) {
        const qtyInput = existingInput.closest('.qc-row').querySelector('[data-qc-qty]');
        qtyInput.focus();
        qtyInput.select?.();
        return;
      }
      const emptyInput = Array.from(rowsHost.querySelectorAll('[data-qc-size]'))
        .find(input => !input.value.trim());
      if (emptyInput) {
        emptyInput.value = chipSize;
        syncChipStates();
        const qtyInput = emptyInput.closest('.qc-row').querySelector('[data-qc-qty]');
        qtyInput.focus();
        qtyInput.select?.();
        return;
      }
      addSizeRow(chipSize, 1, 'qty');
    });
  }

  function advanceQueue() {
    currentContext = null;
    while (queue.length) {
      const next = queue.shift();
      if (next.shouldSkip?.()) continue;
      openNow(next);
      return;
    }
  }

  function dismiss() {
    const onCancel = currentContext?.onCancel;
    if (dialog.open) dialog.close();
    onCancel?.();
    advanceQueue();
  }

  cancelBtn.addEventListener('click', dismiss);
  closeBtn.addEventListener('click', dismiss);
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    dismiss();
  });

  form.addEventListener('submit', async event => {
    event.preventDefault();
    if (submitBtn.disabled || !currentContext) return;
    errorEl.textContent = '';
    const costumeName = nameInput.value.trim();
    if (!costumeName) {
      nameWrap.hidden = false;
      errorEl.textContent = 'Informe o nome da fantasia.';
      nameInput.focus();
      return;
    }
    const entries = [];
    for (const row of rowsHost.querySelectorAll('.qc-row')) {
      const size = row.querySelector('[data-qc-size]').value.trim();
      const quantity = Number(row.querySelector('[data-qc-qty]').value);
      if (!size) {
        errorEl.textContent = 'Informe o tamanho disponível em cada linha.';
        row.querySelector('[data-qc-size]').focus();
        return;
      }
      if (!Number.isSafeInteger(quantity) || quantity < 1) {
        errorEl.textContent = 'Informe quantas fantasias tem disponíveis (mínimo 1).';
        row.querySelector('[data-qc-qty]').focus();
        return;
      }
      const existingEntry = entries.find(e => normalize(e.size) === normalize(size));
      if (existingEntry) existingEntry.quantity += quantity;
      else entries.push({ size, quantity });
    }
    if (!entries.length) {
      errorEl.textContent = 'Adicione pelo menos um tamanho disponível.';
      return;
    }

    submitBtn.disabled = true;
    cancelBtn.disabled = true;
    try {
      const savedCostumes = [];
      for (const entry of entries) {
        const existing = getCostumes().find(c => normalize(c.name) === normalize(costumeName) && normalize(c.size) === normalize(entry.size));
        const payload = existing
          ? { existingId: existing.id, name: existing.name, size: existing.size, quantity: entry.quantity, requestId: crypto.randomUUID() }
          : { name: costumeName, size: entry.size, quantity: entry.quantity, requestId: crypto.randomUUID() };
        const saved = await api('/api/costumes', { method: 'POST', body: JSON.stringify(payload) });
        savedCostumes.push(saved);
      }
      await refresh();
      const ctx = currentContext;
      if (dialog.open) dialog.close();
      const preferredSize = ctx.preferredSize || '';
      const chosen = savedCostumes.find(c => normalize(c.size) === normalize(preferredSize)) || savedCostumes[0];
      ctx.onSaved?.(chosen, savedCostumes);
      toast(`“${costumeName}” inserida no inventário (${savedCostumes.map(c => `${c.size}: ${c.quantity}`).join(', ')}).`);
      advanceQueue();
    } catch (error) {
      errorEl.textContent = error.message;
    } finally {
      submitBtn.disabled = false;
      cancelBtn.disabled = false;
    }
  });

  function openNow(context) {
    currentContext = context;
    const cleanName = String(context.costumeName || '').trim();
    const cleanSize = String(context.preferredSize || '').trim();
    const restock = Boolean(context.restock);
    eyebrowEl.textContent = restock ? 'ESTOQUE OCUPADO NAS DATAS' : 'FANTASIA CITADA NO ÁUDIO · FORA DO ESTOQUE';
    titleEl.textContent = cleanName ? `“${cleanName}”` : 'Nova fantasia no estoque';
    leadEl.textContent = restock
      ? `Todas as unidades cadastradas de “${cleanName}” já estão reservadas nessas datas. Informe quantas unidades extras você tem disponíveis na loja:`
      : cleanName
        ? `A fantasia “${cleanName}” ainda não está no estoque. Informe somente quais tamanhos e quantas fantasias tem disponíveis para inserir no inventário:`
        : 'A fantasia citada no áudio não está no estoque. Informe o nome, quais tamanhos e quantas fantasias tem disponíveis:';
    nameInput.value = cleanName;
    nameWrap.hidden = Boolean(cleanName);
    errorEl.textContent = '';
    rowsHost.replaceChildren();
    const firstRow = addSizeRow(cleanSize, 1, 'none');
    if (!dialog.open) dialog.showModal();
    setTimeout(() => {
      if (!cleanName) nameInput.focus();
      else if (!cleanSize) firstRow.sizeInput.focus();
      else {
        firstRow.qtyInput.focus();
        firstRow.qtyInput.select?.();
      }
    }, 30);
  }

  function requestOpen(context) {
    if (dialog.open && currentContext) {
      queue.push(context);
      return;
    }
    openNow(context);
  }

  const controller = { requestOpen };
  dialog._controller = controller;
  return controller;
}

async function getMicrophoneStream(timeoutMs = 8000) {
  if (navigator.permissions?.query) {
    try {
      const permission = await navigator.permissions.query({ name: 'microphone' });
      if (permission.state === 'denied') throw Object.assign(new Error('Microfone negado'), { code: 'DENIED' });
    } catch (error) {
      if (error?.code === 'DENIED') throw error;
    }
  }
  let timedOut = false;
  let timer;
  const request = navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
    if (timedOut) { stream.getTracks().forEach(track => track.stop()); return null; }
    return stream;
  });
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { timedOut = true; reject(Object.assign(new Error('Microfone sem resposta'), { code: 'TIMEOUT' })); }, timeoutMs);
  });
  try {
    return await Promise.race([request, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

const SAVED_AUDIO_DB = 'lore-modas-saved-audios';
const SAVED_AUDIO_STORE = 'pending_audios';

function openSavedAudioDb() {
  if (!window.indexedDB) return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(SAVED_AUDIO_DB, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SAVED_AUDIO_STORE)) {
          db.createObjectStore(SAVED_AUDIO_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function persistSavedAudio(record) {
  const db = await openSavedAudioDb();
  if (!db) return;
  await new Promise(resolve => {
    try {
      const tx = db.transaction(SAVED_AUDIO_STORE, 'readwrite');
      tx.objectStore(SAVED_AUDIO_STORE).put({
        id: record.id,
        kind: record.kind,
        fileName: record.fileName,
        mimeType: record.mimeType,
        size: record.size,
        base64: record.base64,
        createdAt: record.createdAt,
        errorMessage: record.errorMessage,
      });
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      try { db.close(); } catch {}
      resolve();
    }
  });
}

async function deleteSavedAudio(id) {
  const db = await openSavedAudioDb();
  if (!db) return;
  await new Promise(resolve => {
    try {
      const tx = db.transaction(SAVED_AUDIO_STORE, 'readwrite');
      tx.objectStore(SAVED_AUDIO_STORE).delete(id);
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); resolve(); };
    } catch {
      try { db.close(); } catch {}
      resolve();
    }
  });
}

async function loadSavedAudios(kind) {
  const db = await openSavedAudioDb();
  if (!db) return [];
  return new Promise(resolve => {
    try {
      const tx = db.transaction(SAVED_AUDIO_STORE, 'readonly');
      const req = tx.objectStore(SAVED_AUDIO_STORE).getAll();
      req.onsuccess = () => {
        db.close();
        const all = Array.isArray(req.result) ? req.result : [];
        resolve(all.filter(item => item && item.kind === kind && item.base64).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0)));
      };
      req.onerror = () => { db.close(); resolve([]); };
    } catch {
      try { db.close(); } catch {}
      resolve([]);
    }
  });
}

function base64ToBlob(base64, mimeType) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mimeType || 'audio/webm' });
}

function formatKb(bytes) {
  const kb = Math.max(1, Math.round((Number(bytes) || 0) / 1024));
  return kb >= 1024 ? `${(kb / 1024).toFixed(1).replace('.', ',')} MB` : `${kb} KB`;
}

export function mountAudioImports({ api, esc, toast, refresh, getCostumes, onRentalCreated }) {
  let activeRecorder = null, requesting = false, disposed = false;
  const syncers = [];
  const objectUrls = new Set();
  const quickCostumeDialog = ensureQuickCostumeDialog({ api, esc, toast, refresh, getCostumes });

  function revokeUrl(url) {
    if (!url) return;
    URL.revokeObjectURL(url);
    objectUrls.delete(url);
  }

  for (const host of document.querySelectorAll('[data-audio-kind]')) {
    const kind = host.dataset.audioKind;
    const inventory = kind === 'costumes';
    host.innerHTML = `<div class="panel-head"><div><span class="eyebrow">CADASTRO POR VOZ</span><h2>${inventory ? 'Conte o que tem no acervo' : 'Dite os aluguéis do dia'}</h2></div></div>
      <p class="hint">${inventory ? 'Exemplo: “Tenho duas fantasias de Homem Aranha PP e três de Gato de Botas GG.” Nada é salvo sem sua aprovação.' : 'Pode falar vários aluguéis no mesmo áudio: fantasia, tamanho, cliente, datas e valor. Nada é gravado automaticamente.'}</p>
      <div class="audio-actions"><button type="button" class="primary" data-record>Gravar áudio</button><button type="button" class="file-action" data-cancel-record hidden>Cancelar gravação</button><button type="button" class="file-action" data-upload>Enviar arquivo de áudio</button><input type="file" accept="${ACCEPTED_AUDIO}" data-file hidden></div>
      <p class="hint" data-audio-status role="status">Até 2 minutos de gravação ou arquivo de até 14 MB (áudios de 30–40 s com folga). Também aceita arrastar o arquivo para esta área.</p>
      <div class="saved-audio-list" data-saved-audios hidden></div>
      <div data-audio-results hidden>
        <div class="audio-results-head"><audio class="audio-preview" controls data-audio-preview hidden></audio><span class="tag" data-audio-usage hidden></span><button type="button" class="file-action" data-cancel-all>Cancelar todos</button></div>
        <details open><summary>Transcrição do áudio (editável)</summary><textarea class="transcript" data-transcript rows="3" aria-label="Transcrição do áudio"></textarea></details>
        <p class="hint" data-results-hint>Confira e edite os campos desejados. Use <strong>Aprovar e inserir</strong> para gravar cada item ou <strong>Cancelar</strong> para descartar. Nada foi salvo ainda.</p>
        <div class="audio-drafts" data-drafts></div>
      </div>`;

    const recordButton = host.querySelector('[data-record]');
    const cancelRecordButton = host.querySelector('[data-cancel-record]');
    const uploadButton = host.querySelector('[data-upload]');
    const fileInput = host.querySelector('[data-file]');
    const status = host.querySelector('[data-audio-status]');
    const savedAudiosBox = host.querySelector('[data-saved-audios]');
    const resultsBox = host.querySelector('[data-audio-results]');
    const resultsHint = host.querySelector('[data-results-hint]');
    const previewAudio = host.querySelector('[data-audio-preview]');
    const usageTag = host.querySelector('[data-audio-usage]');
    const transcriptInput = host.querySelector('[data-transcript]');
    const cancelAllButton = host.querySelector('[data-cancel-all]');
    const draftList = host.querySelector('[data-drafts]');
    let busy = false;
    let currentPreviewUrl = '';
    const savedRecords = new Map();

    const pending = () => draftList.querySelector('form');
    const say = message => { status.textContent = message; };
    const updateResultsChrome = () => {
      const hasPending = Boolean(pending());
      cancelAllButton.textContent = hasPending ? 'Cancelar todos' : 'Fechar revisão';
      resultsHint.innerHTML = hasPending
        ? 'Confira e edite os campos desejados. Use <strong>Aprovar e inserir</strong> para gravar cada item ou <strong>Cancelar</strong> para descartar. Nada foi salvo ainda.'
        : 'Revisão concluída. Você pode fechar esta área ou enviar outro áudio.';
    };
    const input = (label, name, value, type = 'text', extra = '') => `<label>${label}<input name="${name}" type="${type}" value="${esc(value ?? '')}" required ${extra}></label>`;

    function buildOptions(costumes, selectedId) {
      return costumes.map(c => `<option value="${c.id}" ${String(c.id) === String(selectedId || '') ? 'selected' : ''}>${esc(c.name)} · ${esc(c.size)} (${c.quantity} un.)</option>`).join('');
    }

    function clearResults(message) {
      draftList.replaceChildren();
      transcriptInput.value = '';
      transcriptInput.textContent = '';
      if (currentPreviewUrl) {
        previewAudio.pause();
        previewAudio.removeAttribute('src');
        previewAudio.hidden = true;
        revokeUrl(currentPreviewUrl);
        currentPreviewUrl = '';
      }
      if (usageTag) { usageTag.textContent = ''; usageTag.hidden = true; }
      resultsBox.hidden = true;
      if (message) say(message);
    }

    function syncDraftCostumes() {
      const costumes = getCostumes();
      for (const form of draftList.querySelectorAll('form.audio-draft')) {
        const readName = form.dataset.readName || '';
        const readSize = form.dataset.readSize || '';
        const matched = findMatchingCostume(costumes, readName, readSize);
        if (inventory) {
          const select = form.elements.existingId;
          const prev = select.value;
          const stillExists = costumes.some(c => String(c.id) === prev);
          const nextValue = stillExists ? prev : (matched ? String(matched.id) : '');
          select.innerHTML = `<option value="">Cadastrar novo modelo</option>${buildOptions(costumes, nextValue)}`;
          select.value = nextValue;
          select.dispatchEvent(new Event('change'));
        } else {
          const select = form.elements.costumeId;
          const prev = select.value;
          const stillExists = costumes.some(c => String(c.id) === prev);
          const nextValue = stillExists ? prev : (matched ? String(matched.id) : '');
          select.innerHTML = `<option value="">Selecione a fantasia e o tamanho</option>${buildOptions(costumes, nextValue)}`;
          select.value = nextValue;
          form._syncMissingBox?.();
        }
      }
    }
    syncers.push(syncDraftCostumes);

    function addDraft(item, index) {
      const form = document.createElement('form');
      form.className = 'audio-draft';
      const readName = inventory ? item.name : item.costumeName;
      const readSize = item.size;
      form.dataset.readName = readName || '';
      form.dataset.readSize = readSize || '';
      const requestId = crypto.randomUUID();
      const costumes = getCostumes();
      const match = findMatchingCostume(costumes, readName, readSize);
      const options = buildOptions(costumes, match?.id || '');
      const spokenCostumeLabel = item.costumeName ? `“${esc(item.costumeName)}”` : 'A fantasia citada no áudio';
      form.innerHTML = `<div class="panel-head"><h3>${inventory ? 'Fantasia' : 'Aluguel'} ${index + 1}</h3><span class="tag">Rascunho</span></div>
        <p class="hint">${esc(item.notes || 'Revise os campos abaixo antes de aprovar.')}</p>
        ${inventory ? `<label>Destino no acervo<select name="existingId"><option value="">Cadastrar novo modelo</option>${options}</select></label>
          <div class="form-row">${input('Fantasia', 'name', match?.name || item.name, 'text', 'maxlength="120"')}${input('Tamanho', 'size', match?.size || item.size, 'text', 'maxlength="30"')}</div>
          ${input('Unidades a acrescentar', 'quantity', item.quantity, 'number', 'min="1" step="1"')}<p class="hint" data-stock></p>`
        : `<p class="hint">Lido no áudio: <strong>${esc(item.costumeName || 'fantasia não identificada')}</strong> · ${esc(item.size || 'tamanho não informado')}</p>
          <label>Fantasia cadastrada<select name="costumeId" required><option value="">Selecione a fantasia e o tamanho</option>${options}</select></label>
          <div class="missing-costume-bar" data-missing-box ${match ? 'hidden' : ''}>
            <div class="missing-costume-bar-copy">
              <strong data-missing-title>${spokenCostumeLabel} ainda não está no estoque</strong>
              <span class="hint" data-missing-desc>Informe os tamanhos e quantidades disponíveis para inserir no inventário e selecionar neste aluguel.</span>
            </div>
            <button type="button" class="primary small-button" data-open-quick-costume>Inserir no inventário</button>
          </div>
          <p class="hint quick-added-note" data-quick-done hidden></p>
          ${input('Cliente', 'customerName', item.customerName, 'text', 'maxlength="120"')}${input('Telefone com DDD', 'phone', item.phone, 'tel', 'placeholder="71999999999"')}
          <div class="form-row">${input('Retirada', 'pickupDate', item.pickupDate, 'date')}${input('Devolução prevista', 'dueDate', item.dueDate, 'date')}</div>
          ${input('Valor do aluguel (R$)', 'price', item.priceCents === null ? '' : (item.priceCents / 100).toFixed(2), 'number', 'min="0" step="0.01"')}
          <label class="check-row"><input type="checkbox" name="whatsappOptIn"> Cliente aceitou receber confirmação da locação e avisos por WhatsApp</label>`}
        <p class="draft-error" role="alert"></p>
        <div class="draft-actions"><button type="button" class="file-action" data-remove>Cancelar</button><button class="primary" type="submit">Aprovar e inserir</button></div>`;
      if (inventory) {
        const updateStock = () => {
          const selected = getCostumes().find(c => c.id === Number(form.elements.existingId.value));
          form.elements.name.readOnly = Boolean(selected);
          form.elements.size.readOnly = Boolean(selected);
          if (selected) { form.elements.name.value = selected.name; form.elements.size.value = selected.size; }
          const quantity = Number(form.elements.quantity.value);
          form.querySelector('[data-stock]').textContent = selected ? `${selected.quantity} no cadastro + ${quantity || 0} deste áudio = ${selected.quantity + (quantity || 0)} unidades. Aprove apenas se são unidades adicionais.` : 'Será criado um novo item no acervo ao aprovar.';
        };
        form.elements.existingId.addEventListener('change', updateStock);
        form.elements.quantity.addEventListener('input', updateStock);
        updateStock();
      } else {
        const select = form.elements.costumeId;
        const missingBox = form.querySelector('[data-missing-box]');
        const openQuickBtn = form.querySelector('[data-open-quick-costume]');
        const quickDone = form.querySelector('[data-quick-done]');

        const focusNextClientField = () => {
          const next = ['customerName', 'phone', 'pickupDate', 'dueDate', 'price']
            .map(name => form.elements[name])
            .find(field => field && !String(field.value || '').trim());
          (next || form.querySelector('[type=submit]'))?.focus();
        };

        const promptQuickCostume = (restockCostume = null) => {
          const targetName = restockCostume?.name || form.dataset.readName || item.costumeName || '';
          const targetSize = restockCostume?.size || form.dataset.readSize || item.size || '';
          quickCostumeDialog.requestOpen({
            costumeName: targetName,
            preferredSize: targetSize,
            restock: Boolean(restockCostume),
            shouldSkip: () => !form.isConnected || (!restockCostume && Boolean(select.value)),
            onSaved(chosen, savedList) {
              if (!form.isConnected || !chosen) return;
              form.dataset.readName = chosen.name;
              form.dataset.readSize = chosen.size;
              const latestCostumes = getCostumes();
              select.innerHTML = `<option value="">Selecione a fantasia e o tamanho</option>${buildOptions(latestCostumes, chosen.id)}`;
              select.value = String(chosen.id);
              missingBox.hidden = true;
              form.querySelector('.draft-error').textContent = '';
              const summary = savedList.map(c => `${c.size}: ${c.quantity} un.`).join(', ');
              quickDone.textContent = `“${chosen.name}” inserida no inventário (${summary}) e já selecionada neste aluguel. Você pode escolher o tamanho acima ou clicar em Aprovar e inserir.`;
              quickDone.hidden = false;
              select.focus();
            },
          });
        };

        form._syncMissingBox = () => {
          missingBox.hidden = Boolean(select.value);
        };
        form._promptQuickCostume = promptQuickCostume;

        openQuickBtn.addEventListener('click', () => promptQuickCostume());

        select.addEventListener('change', () => {
          quickDone.hidden = true;
          form.querySelector('.draft-error').textContent = '';
          missingBox.hidden = Boolean(select.value);
        });
      }
      form.querySelector('[data-remove]').addEventListener('click', () => {
        form.remove();
        updateResultsChrome();
        if (!pending()) {
          say('Rascunhos concluídos ou cancelados. Você pode enviar outro áudio.');
          if (!draftList.children.length) clearResults('Rascunho cancelado. Nenhum item foi inserido.');
        } else {
          say('Rascunho cancelado. Continue revisando os demais.');
        }
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        const button = form.querySelector('[type=submit]');
        const cancelButton = form.querySelector('[data-remove]');
        const draftError = form.querySelector('.draft-error');
        if (button.disabled) return;
        const values = Object.fromEntries(new FormData(form));
        const payload = inventory
          ? { name: values.name, size: values.size, quantity: Number(values.quantity), ...(values.existingId ? { existingId: Number(values.existingId) } : {}), requestId }
          : { costumeId: Number(values.costumeId), customerName: values.customerName, phone: values.phone, pickupDate: values.pickupDate, dueDate: values.dueDate, priceCents: Math.round(Number(values.price) * 100), whatsappOptIn: values.whatsappOptIn === 'on', requestId };
        button.disabled = true;
        cancelButton.disabled = true;
        draftError.textContent = '';
        try {
          const created = await api(`/api/${kind}`, { method: 'POST', body: JSON.stringify(payload) });
          const saved = document.createElement('p');
          saved.className = 'draft-saved';
          const sentNotice = !inventory && created?.whatsappConfirmation?.status === 'sent' ? ' e aviso enviado no WhatsApp' : '';
          saved.textContent = `${inventory ? values.name : values.customerName} — ${inventory ? 'inserido no acervo' : `aluguel aprovado e inserido${sentNotice}`}.`;
          form.replaceWith(saved);
          updateResultsChrome();
          if (!inventory && created?.whatsappConfirmation) onRentalCreated?.(values.customerName, created);
          say(pending() ? 'Item aprovado e inserido. Revise os próximos rascunhos.' : 'Todos os rascunhos foram revisados. Você pode enviar outro áudio.');
          try { await refresh(); } catch { toast('Registro salvo. Atualize a página para recarregar a lista.'); }
        } catch (error) {
          draftError.textContent = error.message;
          if (!inventory && /indisponível/i.test(error.message)) {
            const selected = getCostumes().find(c => c.id === Number(values.costumeId));
            if (selected) form._promptQuickCostume?.(selected);
          }
          button.disabled = false;
          cancelButton.disabled = false;
        }
      });
      draftList.append(form);
    }

    function syncSavedAudiosVisibility() {
      savedAudiosBox.hidden = savedAudiosBox.children.length === 0;
    }

    function setRetryButtonsDisabled(disabled, activeId = '') {
      for (const btn of savedAudiosBox.querySelectorAll('[data-retry-audio]')) {
        btn.disabled = disabled;
        if (btn.dataset.retryAudio === activeId) {
          btn.textContent = disabled ? 'Reenviando…' : 'Reenviar áudio';
        } else if (!disabled) {
          btn.textContent = 'Reenviar áudio';
        }
      }
    }

    function removeSavedAudioCard(id) {
      const record = savedRecords.get(id);
      if (record?.previewUrl) revokeUrl(record.previewUrl);
      savedRecords.delete(id);
      const card = savedAudiosBox.querySelector(`[data-saved-audio-id="${id}"]`);
      if (card) card.remove();
      syncSavedAudiosVisibility();
      deleteSavedAudio(id);
    }

    function upsertSavedAudioCard(record) {
      let existing = savedRecords.get(record.id);
      if (!existing) {
        for (const candidate of savedRecords.values()) {
          if (candidate.base64 === record.base64) {
            existing = candidate;
            break;
          }
        }
      }
      const target = existing || record;
      target.errorMessage = record.errorMessage || target.errorMessage || 'Falha temporária no envio. Seu áudio está guardado abaixo.';
      if (!target.blob && target.base64) {
        try {
          target.blob = base64ToBlob(target.base64, target.mimeType);
        } catch {}
      }
      if (!target.previewUrl && target.blob) {
        try {
          target.previewUrl = URL.createObjectURL(target.blob);
          objectUrls.add(target.previewUrl);
        } catch {}
      }
      savedRecords.set(target.id, target);

      let card = savedAudiosBox.querySelector(`[data-saved-audio-id="${target.id}"]`);
      if (!card) {
        card = document.createElement('div');
        card.className = 'saved-audio-card';
        card.dataset.savedAudioId = target.id;
        card.innerHTML = `<div class="saved-audio-head">
            <div>
              <strong class="saved-audio-title">Áudio guardado para reenvio</strong>
              <span class="hint" data-saved-meta></span>
            </div>
            <button type="button" class="primary" data-retry-audio="${esc(target.id)}">Reenviar áudio</button>
          </div>
          <p class="draft-error" data-saved-error role="alert"></p>
          <audio class="audio-preview" controls data-saved-preview hidden></audio>`;
        card.querySelector('[data-retry-audio]').addEventListener('click', () => {
          processAudio(target.blob, target);
        });
        savedAudiosBox.append(card);
      }

      const timeStr = target.createdAt
        ? new Date(target.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
        : '';
      card.querySelector('[data-saved-meta]').textContent = `${target.fileName || 'gravacao.webm'} · ${formatKb(target.size)}${timeStr ? ` · guardado às ${timeStr}` : ''} · só sai daqui quando for enviado`;
      card.querySelector('[data-saved-error]').textContent = target.errorMessage;
      const audioEl = card.querySelector('[data-saved-preview]');
      if (target.previewUrl) {
        if (audioEl.getAttribute('src') !== target.previewUrl) audioEl.src = target.previewUrl;
        audioEl.hidden = false;
      }
      syncSavedAudiosVisibility();
      return target;
    }

    loadSavedAudios(kind).then(items => {
      if (disposed) return;
      for (const item of items) upsertSavedAudioCard(item);
    });

    async function processAudio(file, savedRecord = null) {
      if ((!file && !savedRecord) || busy) return;
      if (pending()) { say('Aprove ou cancele os rascunhos atuais antes de enviar outro áudio.'); return; }
      const sizeBytes = savedRecord?.size || file?.size || 0;
      if (sizeBytes === 0) { say('O arquivo de áudio está vazio. Tente novamente ou envie outro arquivo.'); return; }
      if (sizeBytes > MAX_AUDIO_BYTES) { say('Envie um áudio de até 14 MB.'); return; }
      busy = true;
      recordButton.disabled = uploadButton.disabled = true;
      setRetryButtonsDisabled(true, savedRecord?.id || '');
      say(savedRecord ? 'Reenviando o áudio guardado para o Gemini…' : 'Enviando e transcrevendo o áudio com Gemini…');
      let base64 = savedRecord?.base64 || '';
      const mimeType = savedRecord?.mimeType || file?.type || 'audio/webm';
      const fileName = savedRecord?.fileName || file?.name || 'gravacao.webm';
      try {
        if (!base64) {
          const dataUrl = await new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(new Error('Não foi possível ler o arquivo de áudio'));
            reader.readAsDataURL(file);
          });
          base64 = String(dataUrl).split(',')[1] || '';
        }
        const result = await api('/api/drafts/audio', {
          method: 'POST',
          body: JSON.stringify({ kind, mimeType, fileName, data: base64 }),
        });
        if (savedRecord?.id) {
          removeSavedAudioCard(savedRecord.id);
        } else {
          for (const candidate of savedRecords.values()) {
            if (candidate.base64 === base64) removeSavedAudioCard(candidate.id);
          }
        }
        resultsBox.hidden = false;
        if (currentPreviewUrl) revokeUrl(currentPreviewUrl);
        try {
          const previewBlob = file || savedRecord?.blob || base64ToBlob(base64, mimeType);
          currentPreviewUrl = URL.createObjectURL(previewBlob);
          objectUrls.add(currentPreviewUrl);
          previewAudio.src = currentPreviewUrl;
          previewAudio.hidden = false;
        } catch {
          previewAudio.hidden = true;
        }
        transcriptInput.value = result.transcript;
        transcriptInput.textContent = result.transcript;
        if (usageTag) {
          const u = result.usage;
          if (u && (u.cached || u.totalTokens > 0)) {
            usageTag.textContent = u.cached
              ? `Cache · 0 tokens · ${u.model}`
              : `${u.totalTokens} tokens (${u.audioTokens ? `${u.audioTokens} áudio + ` : ''}${u.inputTokens - (u.audioTokens || 0)} texto + ${u.outputTokens} saída) · ${u.model}`;
            usageTag.hidden = false;
          } else {
            usageTag.textContent = '';
            usageTag.hidden = true;
          }
        }
        draftList.replaceChildren();
        result.items.forEach(addDraft);
        updateResultsChrome();
        say(result.items.length ? `${result.items.length} rascunho(s) pronto(s) para revisão. Nada foi salvo ainda.` : 'Nenhum registro identificado. Confira a transcrição e tente um áudio mais claro.');
        if (!inventory) {
          for (const form of draftList.querySelectorAll('form.audio-draft')) {
            if (!form.elements.costumeId.value) {
              form._promptQuickCostume?.();
            }
          }
        }
      } catch (error) {
        if (base64) {
          const record = upsertSavedAudioCard(savedRecord ? { ...savedRecord, errorMessage: error.message } : {
            id: crypto.randomUUID(),
            kind,
            fileName,
            mimeType,
            size: sizeBytes,
            base64,
            blob: file,
            createdAt: Date.now(),
            errorMessage: error.message,
          });
          persistSavedAudio(record);
          say(`${error.message} O áudio foi guardado abaixo — clique em Reenviar áudio para tentar novamente sem precisar gravar de novo.`);
        } else {
          say(error.message);
        }
      } finally {
        busy = false;
        recordButton.disabled = uploadButton.disabled = false;
        setRetryButtonsDisabled(false);
      }
    }

    cancelAllButton.addEventListener('click', () => {
      const hadPending = Boolean(pending());
      clearResults(hadPending ? 'Rascunhos cancelados. Nenhum item restante foi inserido.' : 'Revisão fechada. Você pode enviar outro áudio.');
    });

    uploadButton.addEventListener('click', () => {
      if (activeRecorder || requesting) { say('Finalize ou cancele a gravação antes de enviar outro arquivo.'); return; }
      if (pending()) { say('Aprove ou cancele os rascunhos atuais antes de enviar outro áudio.'); return; }
      fileInput.click();
    });

    fileInput.addEventListener('change', () => {
      const file = fileInput.files[0];
      fileInput.value = '';
      processAudio(file);
    });

    host.addEventListener('dragover', event => {
      event.preventDefault();
      if (!busy && !activeRecorder && !requesting) host.classList.add('is-dragover');
    });
    host.addEventListener('dragleave', event => {
      if (!host.contains(event.relatedTarget)) host.classList.remove('is-dragover');
    });
    host.addEventListener('drop', event => {
      event.preventDefault();
      host.classList.remove('is-dragover');
      if (activeRecorder || requesting || busy) { say('Finalize a operação em andamento antes de soltar outro arquivo.'); return; }
      const file = event.dataTransfer?.files?.[0];
      if (file) processAudio(file);
    });

    cancelRecordButton.addEventListener('click', () => {
      if (activeRecorder?.host !== host) return;
      activeRecorder.cancelled = true;
      if (activeRecorder.recorder.state !== 'inactive') activeRecorder.recorder.stop();
    });

    recordButton.addEventListener('click', async () => {
      if (activeRecorder?.host === host) {
        if (activeRecorder.recorder.state !== 'inactive') activeRecorder.recorder.stop();
        return;
      }
      if (activeRecorder || requesting || busy) { say('Finalize o áudio em andamento primeiro.'); return; }
      if (pending()) { say('Aprove ou cancele os rascunhos atuais antes de gravar outro áudio.'); return; }
      if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) { say('Gravação indisponível neste navegador. Use Enviar arquivo de áudio.'); return; }
      let stream, timer;
      requesting = true;
      recordButton.disabled = true;
      say('Solicitando acesso ao microfone…');
      try {
        stream = await getMicrophoneStream(8000);
        if (!stream || disposed) { stream?.getTracks().forEach(track => track.stop()); return; }
        const mimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
        let recorder;
        try {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType, audioBitsPerSecond: 32_000 } : { audioBitsPerSecond: 32_000 });
        } catch {
          recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
        }
        const chunks = [];
        let size = 0, failed = false, elapsed = 0;
        const session = { host, recorder, stream, cancelled: false };
        activeRecorder = session;
        recorder.ondataavailable = event => {
          if (event.data.size) { chunks.push(event.data); size += event.data.size; }
          if (size > MAX_AUDIO_BYTES && recorder.state === 'recording') recorder.stop();
        };
        timer = setInterval(() => {
          elapsed++;
          say(`Gravando: ${elapsed}s de 120s. Clique em Parar e transcrever ao terminar.`);
          if (elapsed >= 120 && recorder.state === 'recording') recorder.stop();
        }, 1000);
        recorder.onerror = () => { failed = true; if (recorder.state !== 'inactive') recorder.stop(); };
        recorder.onstop = () => {
          clearInterval(timer);
          stream.getTracks().forEach(track => track.stop());
          activeRecorder = null;
          recordButton.textContent = 'Gravar áudio';
          cancelRecordButton.hidden = true;
          uploadButton.disabled = false;
          if (session.cancelled) {
            say('Gravação cancelada. Nada foi enviado.');
            return;
          }
          if (failed) {
            say('Não foi possível concluir a gravação. Tente enviar um arquivo.');
            return;
          }
          if (!disposed) {
            const type = recorder.mimeType || chunks[0]?.type || 'audio/webm';
            const ext = type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm';
            const blob = new Blob(chunks, { type });
            if (blob.size === 0) {
              say('Nenhum som foi capturado na gravação. Verifique o microfone ou envie um arquivo.');
              return;
            }
            const file = new File([blob], `gravacao.${ext}`, { type });
            processAudio(file);
          }
        };
        recorder.start(1000);
        recordButton.textContent = 'Parar e transcrever';
        cancelRecordButton.hidden = false;
        uploadButton.disabled = true;
        say('Gravando… fale as fantasias ou os aluguéis.');
      } catch (error) {
        clearInterval(timer);
        stream?.getTracks().forEach(track => track.stop());
        activeRecorder = null;
        cancelRecordButton.hidden = true;
        uploadButton.disabled = false;
        if (error?.code === 'DENIED') {
          say('Microfone bloqueado neste navegador. Libere a permissão nas configurações ou use Enviar arquivo de áudio.');
        } else if (error?.code === 'TIMEOUT') {
          say('Este navegador não respondeu ao pedido de microfone. Use Enviar arquivo de áudio ou abra o painel no Chrome/Safari para gravar.');
        } else {
          say('Não foi possível acessar o microfone. Libere o acesso no navegador ou envie um arquivo.');
        }
      } finally {
        requesting = false;
        recordButton.disabled = false;
      }
    });
  }
  window.addEventListener('pagehide', () => {
    disposed = true;
    activeRecorder?.stream.getTracks().forEach(track => track.stop());
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  });
  window.addEventListener('pageshow', () => { disposed = false; });
  return {
    syncCostumes: () => syncers.forEach(fn => fn()),
    openQuickCostume: ctx => quickCostumeDialog.requestOpen(ctx),
  };
}
