import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createDatabase } from './db.js';
import { createVerifiedBackup } from './backup.js';

export async function openDatabase(env = process.env) {
  const path = env.DB_PATH || fileURLToPath(new URL('../data/fantasias.sqlite', import.meta.url));
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    const previous = new DatabaseSync(path);
    try {
      if (!previous.prepare("SELECT name FROM sqlite_master WHERE name='users'").get()) await createVerifiedBackup(previous, env.BACKUP_DIR || join(dirname(path), 'backups'));
    } finally { previous.close(); }
  }
  return createDatabase(path);
}
