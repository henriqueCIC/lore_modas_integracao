import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from '../src/db.js';
import { createAuth } from '../src/auth.js';

function cli(args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['src/accounts.js', ...args], { env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', b => { output += b; }); child.stderr.on('data', b => { output += b; });
    child.on('error', reject); child.on('exit', code => resolve({ code, output })); child.stdin.end(input);
  });
}
test('provisionamento e recuperação preservam base anterior e fazem backup antes da migração', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'lore-accounts-'));
  const path = join(dir, 'old.sqlite'), env = { DB_PATH: path, BACKUP_DIR: join(dir, 'backups') };
  const old = new DatabaseSync(path);
  old.exec("CREATE TABLE legacy_evidence(value TEXT); INSERT INTO legacy_evidence VALUES ('preservado')"); old.close();
  try {
    const created = await cli(['create', 'admin', 'henrique'], env, 'senha-de-teste-123\nsenha-de-teste-123\n');
    assert.equal(created.code, 0, created.output); assert.ok(!created.output.includes('senha-de-teste-123'));
    const files = await readdir(env.BACKUP_DIR); assert.equal(files.length, 1);
    const backup = new DatabaseSync(join(env.BACKUP_DIR, files[0]));
    assert.equal(backup.prepare("SELECT name FROM sqlite_master WHERE name='users'").get(), undefined); backup.close();
    let db = createDatabase(path), auth = createAuth(db);
    const session = auth.login('henrique', 'senha-de-teste-123');
    assert.equal(db.prepare('SELECT value FROM legacy_evidence').get().value, 'preservado'); db.close();
    const recovered = await cli(['recover', 'henrique'], env, 'nova-senha-teste-123\nnova-senha-teste-123\n');
    assert.equal(recovered.code, 0, recovered.output);
    db = createDatabase(path); auth = createAuth(db);
    assert.equal(auth.session(session.sid), null); assert.equal(auth.login('henrique', 'nova-senha-teste-123').user.role, 'admin'); db.close();
    assert.equal((await cli(['create', 'operator', 'lore'], env, 'temporaria-lore-123\ntemporaria-lore-123\n')).code, 0);
    db = createDatabase(path); assert.equal(createAuth(db).login('lore', 'temporaria-lore-123').user.mustChange, true); db.close();
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('migração de aluguel legado mantém IDs, valor, cliente e snapshot do nome', async () => {
  const { openDatabase } = await import('../src/open-database.js');
  const dir = await mkdtemp(join(tmpdir(), 'lore-legacy-'));
  const path = join(dir, 'legacy.sqlite');
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    CREATE TABLE costumes(id INTEGER PRIMARY KEY,name TEXT NOT NULL,size TEXT NOT NULL,quantity INTEGER NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    CREATE TABLE customers(id INTEGER PRIMARY KEY,name TEXT NOT NULL,phone TEXT NOT NULL UNIQUE,whatsapp_opt_in INTEGER DEFAULT 0);
    CREATE TABLE rentals(id INTEGER PRIMARY KEY,costume_id INTEGER NOT NULL REFERENCES costumes(id),customer_id INTEGER NOT NULL REFERENCES customers(id),pickup_date TEXT NOT NULL,due_date TEXT NOT NULL,returned_date TEXT,price_cents INTEGER NOT NULL,late_fee_cents INTEGER DEFAULT 0,reminded_at TEXT,status TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
    INSERT INTO costumes(id,name,size,quantity) VALUES (7,'Pirata','M',2);
    INSERT INTO customers(id,name,phone) VALUES (9,'Ana','5571999999999');
    INSERT INTO rentals(id,costume_id,customer_id,pickup_date,due_date,price_cents,status) VALUES (11,7,9,'2090-01-01','2090-01-02',15000,'confirmed');
  `);
  legacy.close();
  try {
    const db = await openDatabase({ DB_PATH: path });
    try {
      assert.deepEqual({ ...db.prepare('SELECT id,customer_id,costume_id,price_cents,customer_name FROM rentals').get() }, { id:11,customer_id:9,costume_id:7,price_cents:15000,customer_name:'Ana' });
      assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
      assert.equal(db.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
    } finally { db.close(); }
  } finally { await rm(dir, { recursive: true, force: true }); }
});
