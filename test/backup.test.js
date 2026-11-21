import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createDatabase } from '../src/db.js';
import { createVerifiedBackup } from '../src/backup.js';

test('backup inclui WAL, abre cópia restaurada e preserva locações', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'lore-backup-'));
  const db = createDatabase(join(dir, 'source.sqlite'));
  try {
    db.exec("INSERT INTO costumes(name,size,quantity) VALUES ('Pirata','M',2)");
    const result = await createVerifiedBackup(db, join(dir, 'copies'));
    const restored = createDatabase(join(dir, 'copies', result.fileName));
    try { assert.equal(restored.prepare('SELECT quantity FROM costumes').get().quantity, 2); } finally { restored.close(); }
    assert.ok(db.prepare('SELECT verified_at FROM backup_runs').get().verified_at);
  } finally { db.close(); rmSync(dir, { recursive: true, force: true }); }
});
