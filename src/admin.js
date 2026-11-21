import { auditEvent } from './auth.js';

export async function handleAdmin({ req, res, url, db, auth, diagnostics, user, body, send }) {
  if (req.method === 'GET' && url.pathname === '/api/admin/users') { send(res, 200, auth.list()); return; }
  if (req.method === 'GET' && url.pathname === '/api/admin/events') {
    send(res, 200, db.prepare('SELECT e.*, u.username AS actor FROM admin_events e LEFT JOIN users u ON u.id=e.actor_id ORDER BY e.id DESC LIMIT 100').all());
    return;
  }
  if (req.method === 'GET' && url.pathname === '/api/admin/integrations') { send(res, 200, diagnostics.summary()); return; }
  if (req.method === 'GET' && url.pathname === '/api/admin/usage') {
    send(res, 200, db.prepare("SELECT * FROM integration_events WHERE provider='gemini' ORDER BY id DESC LIMIT 100").all()); return;
  }
  const test = /^\/api\/admin\/integrations\/(gemini|whatsapp|webhook|sqlite|hermes|backup)\/tests$/.exec(url.pathname);
  if (req.method === 'POST' && test) {
    const input = await body(req, 4096);
    const result = await diagnostics.run(test[1], input.kind, user.id, input);
    auditEvent(db, user.id, `test_${test[1]}_${input.kind}`, null, result.status);
    send(res, 200, result); return;
  }
  const match = /^\/api\/admin\/users\/(\d+)\/(block|unblock|reset|revoke)$/.exec(url.pathname);
  if (req.method === 'POST' && match) {
    await body(req, 4096);
    send(res, 200, auth.manage(user.id, Number(match[1]), match[2]));
    return;
  }
  throw Object.assign(new Error('Recurso não encontrado'), { status: 404 });
}
