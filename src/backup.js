import { backup, DatabaseSync } from 'node:sqlite';
import { mkdir, chmod, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

export async function createVerifiedBackup(db, directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const fileName = `lore-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}.sqlite`;
  const path = join(directory, fileName);
  await backup(db, path);
  await chmod(path, 0o600);
  const temp = await mkdtemp(join(tmpdir(), 'lore-restore-'));
  try {
    const restoredPath = join(temp, 'restored.sqlite');
    await copyFile(path, restoredPath);
    const restored = new DatabaseSync(restoredPath);
    try {
      if (restored.prepare('PRAGMA integrity_check').get().integrity_check !== 'ok' || restored.prepare('PRAGMA foreign_key_check').all().length) throw new Error('Falha na verificação do backup');
      restored.exec('CREATE TABLE __restore_probe(value TEXT); INSERT INTO __restore_probe VALUES (\'ok\'); DROP TABLE __restore_probe;');
    } finally { restored.close(); }
  } finally { await rm(temp, { recursive: true, force: true }); }
  if (db.prepare("SELECT name FROM sqlite_master WHERE name='backup_runs'").get()) db.prepare('INSERT INTO backup_runs(file_name,verified_at) VALUES (?,CURRENT_TIMESTAMP)').run(fileName);
  return { fileName };
}
