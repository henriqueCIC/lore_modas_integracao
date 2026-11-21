import test from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { createDatabase } from '../../src/db.js';
import { createServer } from '../../src/server.js';
import { createUser } from '../../src/auth.js';

async function fixture() {
  const browser = await chromium.launch({ headless: true });
  const db = createDatabase(':memory:');
  createUser(db, { username: 'admin', password: 'senha-admin-teste', role: 'admin' });
  const server = createServer({ db, whatsapp: {} });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const page = await browser.newPage();
  page.setDefaultTimeout(6000);
  const base = `http://127.0.0.1:${server.address().port}`;
  await page.goto(base);
  await page.locator('#username').fill('admin');
  await page.locator('#password').fill('senha-admin-teste');
  await page.locator('#login-form button').click();
  await page.locator('#app:not([hidden])').waitFor();
  return { page, db, base, close: async () => { await browser.close(); await new Promise(r => server.close(r)); db.close(); } };
}
const audio = { name: 'voz.wav', mimeType: '', buffer: Buffer.from('RIFF\x24\x00\x00\x00WAVEfmt ', 'latin1') };
const draft = { transcript: 'Pirata M', items: [{ costumeName: 'Pirata', size: 'M', customerName: 'Ana', phone: '71999999999', pickupDate: '2090-01-01', dueDate: '2090-01-02', priceCents: 1000 }] };

test('áudio persiste antes da rede e recupera após recarga', async () => {
  const f = await fixture();
  try {
    let sentMime;
    await f.page.route('**/api/drafts/audio', async route => { sentMime = route.request().postDataJSON().mimeType; await new Promise(r => setTimeout(r, 1500)); await route.abort().catch(() => {}); });
    await f.page.locator('[data-view=alugueis]').click();
    await f.page.locator('[data-audio-kind=rentals] [data-file]').setInputFiles(audio);
    const request = await f.page.waitForRequest('**/api/drafts/audio');
    assert.equal(request.postDataJSON().mimeType, 'audio/wav');
    await f.page.reload();
    await f.page.locator('[data-audio-kind=rentals] [data-retry-audio]').waitFor();
    assert.match(await f.page.locator('[data-audio-kind=rentals] [data-saved-meta]').textContent(), /voz.wav/);
  } finally { await f.close(); }
});

test('janela rápida preserva etapas salvas após falha parcial', async () => {
  const f = await fixture();
  try {
    await f.page.route('**/api/drafts/audio', route => route.fulfill({ json: draft }));
    let failed = false;
    await f.page.route('**/api/costumes', async route => {
      if (route.request().method() === 'POST' && route.request().postDataJSON().size === 'G' && !failed) { failed = true; await route.fulfill({ status: 503, json: { error: 'Falha temporária' } }); }
      else await route.continue();
    });
    await f.page.locator('[data-view=alugueis]').click();
    await f.page.locator('[data-audio-kind=rentals] [data-file]').setInputFiles(audio);
    await f.page.locator('#quick-costume-dialog').waitFor();
    await f.page.locator('[data-size-chip=G]').click();
    await f.page.locator('[data-qc-submit]').click();
    await f.page.getByText('Falha temporária', { exact: true }).waitFor();
    await f.page.locator('[data-qc-submit]').click();
    await f.page.locator('#quick-costume-dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(f.db.prepare('SELECT size,quantity FROM costumes ORDER BY size').all().map(r => ({ ...r })), [{ size: 'G', quantity: 1 }, { size: 'M', quantity: 1 }]);
  } finally { await f.close(); }
});

test('áudio sem tamanho exige escolha quando há tamanhos distintos', async () => {
  const f = await fixture();
  try {
    f.db.exec("INSERT INTO costumes(name,size,quantity) VALUES ('Pirata','P',1),('Pirata','G',1)");
    await f.page.reload();
    await f.page.route('**/api/drafts/audio', route => route.fulfill({ json: { ...draft, items: [{ ...draft.items[0], size: '' }] } }));
    await f.page.locator('[data-view=alugueis]').click();
    await f.page.locator('[data-audio-kind=rentals] [data-file]').setInputFiles(audio);
    await f.page.locator('form.audio-draft').waitFor();
    assert.equal(await f.page.locator('form.audio-draft select[name=costumeId]').inputValue(), '');
    assert.equal(await f.page.locator('#quick-costume-dialog').isVisible(), false);
  } finally { await f.close(); }
});

test('admin gerencia Lore, operadora troca senha e não acessa administração', async () => {
  const f = await fixture();
  try {
    const lore = createUser(f.db, { username: 'lore', password: 'senha-lore-teste', role: 'operator', mustChange: true });
    await f.page.locator('#admin-link').click();
    await f.page.locator(`[data-user="${lore.id}"][data-action=block]`).waitFor();
    f.page.on('dialog', dialog => dialog.accept());
    await f.page.locator(`[data-user="${lore.id}"][data-action=block]`).click();
    await f.page.locator(`[data-user="${lore.id}"][data-action=unblock]`).waitFor();
    await f.page.locator(`[data-user="${lore.id}"][data-action=unblock]`).click();
    await f.page.locator(`[data-user="${lore.id}"][data-action=block]`).waitFor();
    await f.page.locator('#logout').click();
    await f.page.locator('#username').fill('lore'); await f.page.locator('#password').fill('senha-lore-teste');
    await f.page.locator('#login-form button').click();
    await f.page.locator('#password-dialog').waitFor();
    await f.page.locator('[name=currentPassword]').fill('senha-lore-teste');
    await f.page.locator('[name=newPassword]').fill('nova-senha-lore-123');
    await f.page.locator('#password-form button').click();
    await f.page.locator('#username').fill('lore'); await f.page.locator('#password').fill('nova-senha-lore-123');
    await f.page.locator('#login-form button').click(); await f.page.locator('#app:not([hidden])').waitFor();
    assert.equal(await f.page.locator('#admin-link').isVisible(), false);
    assert.equal(await f.page.evaluate(async () => (await fetch('/api/admin/integrations')).status), 403);
    await f.page.locator('[data-view=device]').click();
    await f.page.locator('[data-storage]').click();
    await f.page.getByText(/Gravação local confirmada/).waitFor();
    await f.page.reload(); await f.page.locator('[data-storage]').click();
    await f.page.getByText(/Leitura do teste anterior confirmada/).waitFor();
  } finally { await f.close(); }
});

test('reenvio manual após resposta perdida não duplica estoque', async () => {
  const f = await fixture();
  try {
    let first = true;
    await f.page.route('**/api/costumes', async route => {
      if (route.request().method() === 'POST' && first) { first = false; await route.fetch(); await route.abort(); }
      else await route.continue();
    });
    await f.page.locator('[data-view=fantasias]').click();
    await f.page.locator('#costume-name').fill('Pirata'); await f.page.locator('#costume-size').fill('M');
    await f.page.locator('#costume-form button').click();
    await f.page.locator('#toast.show').waitFor();
    await f.page.locator('#costume-form button').click();
    await f.page.locator('#costume-list').getByText('Pirata', { exact: true }).waitFor();
    assert.equal(f.db.prepare('SELECT SUM(quantity) n FROM costumes').get().n, 1);
  } finally { await f.close(); }
});

test('falha no IndexedDB mantém áudio na aba e impede envio sem persistência', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => { indexedDB.open = () => { throw new Error('armazenamento bloqueado'); }; });
    let requests = 0;
    f.page.on('request', request => { if (request.url().endsWith('/api/drafts/audio')) requests++; });
    await f.page.locator('[data-view=alugueis]').click();
    await f.page.locator('[data-audio-kind=rentals] [data-file]').setInputFiles(audio);
    await f.page.getByText('Áudio apenas nesta aba — não feche').waitFor();
    assert.equal(requests, 0);
    await f.page.locator('[data-audio-kind=rentals] [data-retry-audio]').waitFor();
  } finally { await f.close(); }
});

test('diagnóstico avisa microfone bloqueado e reabilita teste', async () => {
  const f = await fixture();
  try {
    await f.page.evaluate(() => { navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('denied', 'NotAllowedError'); }; });
    await f.page.locator('[data-view=device]').click();
    await f.page.locator('[data-microphone]').click();
    await f.page.getByText(/Microfone bloqueado/).waitFor();
    assert.equal(await f.page.locator('[data-microphone]').isEnabled(), true);
  } finally { await f.close(); }
});

test('celular permite sair e alterar a própria senha', async () => {
  const f = await fixture();
  try {
    await f.page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await f.page.locator('#logout').isVisible(), true);
    assert.equal(await f.page.locator('#change-password').isVisible(), true);
  } finally { await f.close(); }
});
