import test from 'node:test';
import assert from 'node:assert/strict';
import { createDatabase } from '../src/db.js';
import { createAuth, createUser } from '../src/auth.js';

test('contas individuais: senha, sessão revogada, bloqueio e troca obrigatória', () => {
  const db = createDatabase(':memory:');
  try {
    const admin = createUser(db, { username: 'henrique', password: 'senha-admin-teste', role: 'admin' });
    const lore = createUser(db, { username: 'lore', password: 'senha-lore-teste', role: 'operator', mustChange: true });
    const auth = createAuth(db);
    assert.throws(() => auth.login('lore', 'senha-errada'), /incorretos/);
    const session = auth.login('lore', 'senha-lore-teste');
    assert.equal(auth.session(session.sid).user.role, 'operator');
    assert.equal(session.user.mustChange, true);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM sessions').all()).includes(session.sid));
    auth.changePassword(lore.id, 'senha-lore-teste', 'nova-senha-lore');
    assert.equal(auth.session(session.sid), null);
    assert.equal(auth.login('lore', 'nova-senha-lore').user.mustChange, false);
    auth.manage(admin.id, lore.id, 'block');
    assert.throws(() => auth.login('lore', 'nova-senha-lore'), /incorretos/);
    auth.manage(admin.id, lore.id, 'unblock');
    const reset = auth.manage(admin.id, lore.id, 'reset');
    assert.equal(auth.login('lore', reset.temporaryPassword).user.mustChange, true);
    assert.throws(() => auth.manage(admin.id, admin.id, 'block'), /administrador/);
    assert.throws(() => auth.manage(lore.id, admin.id, 'reset'), /administrador/);
    assert.ok(!JSON.stringify(db.prepare('SELECT * FROM admin_events').all()).includes(reset.temporaryPassword));
  } finally { db.close(); }
});

test('sessão expira por inatividade e duração absoluta', () => {
  const db = createDatabase(':memory:');
  try {
    createUser(db, { username: 'admin', password: 'senha-admin-teste', role: 'admin' });
    const auth = createAuth(db);
    const first = auth.login('admin', 'senha-admin-teste');
    db.exec('UPDATE sessions SET last_seen=0');
    assert.equal(auth.session(first.sid), null);
    const second = auth.login('admin', 'senha-admin-teste');
    db.exec('UPDATE sessions SET expires_at=0');
    assert.equal(auth.session(second.sid), null);
    assert.throws(() => createUser(db, { username: 'outro', password: 'curta', role: 'admin' }), /12/);
  } finally { db.close(); }
});
