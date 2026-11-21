const root = document.querySelector('#view-device');
const status = root.querySelector('[role=status]');
let preview;
function storageProbe() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('lore-device-check', 1);
    const timer = setTimeout(() => reject(new Error('O armazenamento não respondeu. Feche outras abas e tente novamente.')), 5000);
    request.onupgradeneeded = () => request.result.createObjectStore('probe');
    request.onerror = request.onblocked = () => { clearTimeout(timer); reject(new Error('Armazenamento indisponível neste navegador.')); };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('probe', 'readwrite'), store = tx.objectStore('probe');
      let previous;
      const read = store.get('pending');
      read.onsuccess = () => { previous = read.result; if (previous) store.delete('pending'); else store.put(Date.now(), 'pending'); };
      tx.oncomplete = () => { clearTimeout(timer); db.close(); resolve(Boolean(previous)); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); db.close(); reject(new Error('Não foi possível gravar no armazenamento local.')); };
    };
  });
}
root.querySelector('[data-storage]').addEventListener('click', async event => {
  event.target.disabled = true;
  try { status.textContent = await storageProbe() ? 'Leitura do teste anterior confirmada. O registro de teste foi removido.' : 'Gravação local confirmada. Recarregue esta página e teste novamente para conferir a persistência.'; }
  catch (error) { status.textContent = error.message; }
  finally { event.target.disabled = false; }
});
root.querySelector('[data-microphone]').addEventListener('click', async event => {
  const button = event.target;
  button.disabled = true;
  let stream, timer, expired = false;
  try {
    status.textContent = 'Permita o microfone e fale durante três segundos.';
    const request = navigator.mediaDevices.getUserMedia({ audio: true });
    request.then(s => { if (expired) s.getTracks().forEach(t => t.stop()); }, () => {});
    stream = await Promise.race([request, new Promise((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error('A permissão do microfone não foi respondida.')); }, 10000); })]);
    clearTimeout(timer);
    const blob = await new Promise((resolve, reject) => {
      const chunks = [], recorder = new MediaRecorder(stream);
      recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
      recorder.onerror = () => reject(new Error('Não foi possível gravar o áudio.'));
      recorder.onstop = () => resolve(new Blob(chunks, { type: recorder.mimeType }));
      recorder.start();
      setTimeout(() => { if (recorder.state !== 'inactive') recorder.stop(); }, 3000);
    });
    if (!blob.size) throw new Error('A gravação ficou vazia.');
    if (preview) URL.revokeObjectURL(preview);
    preview = URL.createObjectURL(blob);
    root.querySelector('audio').src = preview;
    root.querySelector('audio').hidden = false;
    status.textContent = 'Gravação concluída. Ouça abaixo para conferir o microfone. O áudio não foi enviado.';
  } catch (error) { status.textContent = error.name === 'NotAllowedError' ? 'Microfone bloqueado. Libere a permissão nas configurações do navegador.' : error.message; }
  finally { clearTimeout(timer); stream?.getTracks().forEach(t => t.stop()); button.disabled = false; }
});
