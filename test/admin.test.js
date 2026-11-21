import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createUser } from '../src/auth.js';
import { createServer } from '../src/server.js';

test('rotas administrativas negam operador e CSRF, bloqueio revoga sessão aberta', async () => {
  const db = createDatabase(':memory:');
  createUser(db, { username: 'admin', password: 'senha-admin-teste', role: 'admin' });
  const lore = createUser(db, { username: 'lore', password: 'senha-lore-teste', role: 'operator' });
  const server = createServer({ db, password: 'legacy-password', whatsapp: {} });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const login = async (username, password) => {
    const res = await fetch(base + '/api/login', { method: 'POST', body: JSON.stringify({ username, password }) });
    return { cookie: res.headers.get('set-cookie')?.split(';')[0], ...(await res.json()) };
  };
  try {
    const admin = await login('admin', 'senha-admin-teste');
    const operator = await login('lore', 'senha-lore-teste');
    assert.equal((await fetch(base + '/api/admin/users', { headers: { cookie: operator.cookie } })).status, 403);
    assert.equal((await fetch(base + '/api/me', { headers: { cookie: operator.cookie } })).status, 200);
    assert.equal((await fetch(base + '/api/admin/users', { headers: { cookie: admin.cookie } })).status, 200);
    const path = base + `/api/admin/users/${lore.id}/block`;
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: admin.cookie }, body: '{}' })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf, origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(path, { method: 'POST', headers: { cookie: admin.cookie, 'x-csrf-token': admin.csrf }, body: '{}' })).status, 200);
    assert.equal((await fetch(base + '/api/costumes', { headers: { cookie: operator.cookie } })).status, 401);
    const old = await login('', 'legacy-password');
    assert.equal(old.cookie, undefined);
  } finally { await new Promise(r => server.close(r)); db.close(); }
});
