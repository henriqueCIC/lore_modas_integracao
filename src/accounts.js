import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import { createAuth, createUser, auditEvent } from './auth.js';
import { openDatabase } from './open-database.js';

const [command, first, second, ...extra] = process.argv.slice(2);
try {
  if (extra.length || !(command === 'create' && ['admin', 'operator'].includes(first) && second || command === 'recover' && first && !second)) throw new Error('Use: npm run accounts -- create admin|operator nome OU npm run accounts -- recover nome');
  const output = new Writable({ write(_chunk, _encoding, callback) { callback(); } });
  const rl = createInterface({ input: process.stdin, output, terminal: Boolean(process.stdin.isTTY), historySize: 0 });
  const lines = rl[Symbol.asyncIterator]();
  let password, confirmation;
  try {
    process.stderr.write('Nova senha (12 a 256 caracteres, entrada oculta): ');
    password = (await lines.next()).value;
    process.stderr.write('\nRepita a senha: ');
    confirmation = (await lines.next()).value;
    process.stderr.write('\n');
  } finally { rl.close(); }
  if (!password || password !== confirmation) throw new Error('As senhas não conferem. Nenhuma conta foi alterada.');
  const db = await openDatabase();
  try {
    if (command === 'create') {
      const user = createUser(db, { username: second, role: first, password, mustChange: first === 'operator' });
      auditEvent(db, null, 'local_user_created', user.id);
    } else createAuth(db).recover(first, password);
    console.log(command === 'create' ? 'Conta criada.' : 'Acesso administrativo recuperado; sessões anteriores encerradas.');
  } finally { db.close(); }
} catch (error) { console.error(error.message); process.exitCode = 1; }
