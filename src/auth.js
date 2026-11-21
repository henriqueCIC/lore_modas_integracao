import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const fail = (status, message) => Object.assign(new Error(message), { status });
const hash = value => createHash('sha256').update(value).digest('hex');
const publicUser = row => ({ id: row.id, username: row.username, role: row.role, blocked: Boolean(row.blocked), mustChange: Boolean(row.must_change), lastLogin: row.last_login });
function passwordHash(password, salt) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 256) throw fail(422, 'A senha deve ter de 12 a 256 caracteres');
  return scryptSync(password, salt, 32).toString('hex');
}
export function createUser(db, { username, password, role, mustChange = false }) {
  if (typeof username !== 'string' || !/^[a-z0-9._-]{3,40}$/.test(username) || !['admin', 'operator'].includes(role)) throw fail(422, 'Usuário ou perfil inválido');
  const salt = randomBytes(16).toString('hex');
  const digest = passwordHash(password, salt);
  if (db.prepare('SELECT id FROM users WHERE username=?').get(username)) throw fail(409, 'Usuário já existe');
  const id = Number(db.prepare('INSERT INTO users (username, role, salt, password_hash, must_change) VALUES (?, ?, ?, ?, ?)').run(username, role, salt, digest, mustChange ? 1 : 0).lastInsertRowid);
  return publicUser(db.prepare('SELECT * FROM users WHERE id=?').get(id));
}
export function auditEvent(db, actorId, action, targetId = null, result = 'ok') {
  db.prepare('INSERT INTO admin_events (actor_id, action, target_id, result) VALUES (?, ?, ?, ?)').run(actorId, action, targetId, result);
  db.exec("DELETE FROM admin_events WHERE created_at < datetime('now','-90 days')");
}
export function createAuth(db) {
  const dummySalt = randomBytes(16).toString('hex');
  function revoke(id) { db.prepare('DELETE FROM sessions WHERE user_id=?').run(id); }
  function setPassword(id, password, mustChange) {
    const salt = randomBytes(16).toString('hex');
    const digest = passwordHash(password, salt);
    db.prepare('UPDATE users SET salt=?, password_hash=?, must_change=? WHERE id=?').run(salt, digest, mustChange ? 1 : 0, id);
    revoke(id);
  }
  function matches(row, password) {
    const value = typeof password === 'string' && password.length <= 256 ? password : '';
    const actual = scryptSync(value, row?.salt || dummySalt, 32);
    return !!row && timingSafeEqual(actual, Buffer.from(row.password_hash, 'hex'));
  }
  return {
    list: () => db.prepare('SELECT * FROM users ORDER BY id').all().map(publicUser),
    login(username, password) {
      const row = db.prepare('SELECT * FROM users WHERE username=?').get(typeof username === 'string' ? username.trim().toLowerCase() : '');
      if (!matches(row, password) || row.blocked) throw fail(401, 'Usuário ou senha incorretos');
      const sid = randomBytes(32).toString('hex'), csrf = randomBytes(32).toString('hex'), now = Date.now();
      db.prepare('DELETE FROM sessions WHERE expires_at<=? OR last_seen<=?').run(now, now - 3_600_000);
      db.prepare('INSERT INTO sessions (token_hash, user_id, csrf, expires_at, last_seen) VALUES (?, ?, ?, ?, ?)').run(hash(sid), row.id, csrf, now + 43_200_000, now);
      db.prepare('UPDATE users SET last_login=CURRENT_TIMESTAMP WHERE id=?').run(row.id);
      return { sid, csrf, user: publicUser(row) };
    },
    session(sid) {
      if (typeof sid !== 'string' || !/^[a-f0-9]{64}$/.test(sid)) return null;
      const row = db.prepare('SELECT u.*, s.csrf, s.expires_at, s.last_seen FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?').get(hash(sid));
      const now = Date.now();
      if (!row || row.blocked || row.expires_at <= now || row.last_seen <= now - 3_600_000) {
        db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(sid));
        return null;
      }
      db.prepare('UPDATE sessions SET last_seen=? WHERE token_hash=?').run(now, hash(sid));
      return { user: publicUser(row), csrf: row.csrf };
    },
    logout(sid) { db.prepare('DELETE FROM sessions WHERE token_hash=?').run(hash(sid)); },
    changePassword(id, current, next) {
      const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!matches(row, current)) throw fail(403, 'Senha atual incorreta');
      if (current === next) throw fail(422, 'Escolha uma senha diferente da atual');
      setPassword(id, next, false);
      auditEvent(db, id, 'password_changed', id);
    },
    manage(actorId, id, action) {
      const actor = db.prepare('SELECT * FROM users WHERE id=?').get(actorId);
      if (!actor || actor.blocked || actor.role !== 'admin') throw fail(403, 'Acesso exclusivo do administrador');
      const target = db.prepare('SELECT * FROM users WHERE id=?').get(id);
      if (!target) throw fail(404, 'Usuário não encontrado');
      if (!['block', 'unblock', 'reset', 'revoke'].includes(action)) throw fail(422, 'Ação inválida');
      if (action === 'block' && target.role === 'admin' && !target.blocked && db.prepare("SELECT COUNT(*) AS n FROM users WHERE role='admin' AND blocked=0").get().n <= 1) throw fail(409, 'Não é possível bloquear o último administrador');
      let temporaryPassword;
      if (action === 'reset') { temporaryPassword = randomBytes(18).toString('base64url'); setPassword(id, temporaryPassword, true); }
      else if (action === 'block' || action === 'unblock') db.prepare('UPDATE users SET blocked=? WHERE id=?').run(action === 'block' ? 1 : 0, id);
      if (action !== 'unblock') revoke(id);
      auditEvent(db, actorId, `user_${action}`, id);
      return { ok: true, ...(temporaryPassword ? { temporaryPassword } : {}) };
    },
    recover(username, password) {
      const row = db.prepare("SELECT * FROM users WHERE username=? AND role='admin'").get(username);
      if (!row) throw fail(404, 'Administrador não encontrado');
      setPassword(row.id, password, false);
      db.prepare('UPDATE users SET blocked=0 WHERE id=?').run(row.id);
      auditEvent(db, null, 'local_admin_recovery', row.id);
    },
  };
}
