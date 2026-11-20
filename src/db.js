import { DatabaseSync } from 'node:sqlite';

export function createDatabase(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS costumes (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, size TEXT NOT NULL,
      quantity INTEGER NOT NULL CHECK (quantity > 0), created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS costumes_name ON costumes(name, size);
    CREATE TABLE IF NOT EXISTS customers (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, phone TEXT NOT NULL,
      whatsapp_opt_in INTEGER NOT NULL DEFAULT 0, UNIQUE(phone)
    );
    CREATE TABLE IF NOT EXISTS rentals (
      id INTEGER PRIMARY KEY, costume_id INTEGER NOT NULL REFERENCES costumes(id),
      customer_id INTEGER NOT NULL REFERENCES customers(id),
      pickup_date TEXT NOT NULL, due_date TEXT NOT NULL, returned_date TEXT,
      price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
      late_fee_cents INTEGER NOT NULL DEFAULT 0,
      reminded_at TEXT,
      reminder_attempts INTEGER NOT NULL DEFAULT 0,
      confirmation_sent_at TEXT,
      confirmation_attempts INTEGER NOT NULL DEFAULT 0,
      whatsapp_opt_in INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL CHECK (status IN ('confirmed', 'returned', 'cancelled')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS rentals_availability ON rentals(costume_id, status, pickup_date, due_date);
    CREATE INDEX IF NOT EXISTS rentals_due ON rentals(due_date, status);
    CREATE TABLE IF NOT EXISTS leads (
      phone TEXT PRIMARY KEY, customer_name TEXT NOT NULL DEFAULT '',
      costume_query TEXT NOT NULL DEFAULT '', size TEXT NOT NULL DEFAULT '',
      use_date TEXT NOT NULL DEFAULT '', due_date TEXT NOT NULL DEFAULT '',
      mode TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'collecting',
      last_message TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS inbound_messages (
      id TEXT PRIMARY KEY, phone TEXT NOT NULL, customer_name TEXT NOT NULL DEFAULT '',
      text TEXT NOT NULL, reply_text TEXT NOT NULL DEFAULT '', processed_at TEXT, attempts INTEGER NOT NULL DEFAULT 0,
      last_error TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS write_receipts (
      request_id TEXT PRIMARY KEY, kind TEXT NOT NULL, fingerprint TEXT NOT NULL,
      result TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY, rental_id INTEGER NOT NULL UNIQUE REFERENCES rentals(id),
      amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0), received_date TEXT NOT NULL,
      method TEXT NOT NULL CHECK (method IN ('pix', 'cash', 'card', 'transfer')),
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS payments_date ON payments(received_date);
  `);
  const columns = db.prepare('PRAGMA table_info(rentals)').all().map(row => row.name);
  if (!columns.includes('reminder_attempts')) db.exec('ALTER TABLE rentals ADD COLUMN reminder_attempts INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('whatsapp_opt_in')) db.exec('ALTER TABLE rentals ADD COLUMN whatsapp_opt_in INTEGER NOT NULL DEFAULT 0');
  if (!columns.includes('confirmation_sent_at')) db.exec('ALTER TABLE rentals ADD COLUMN confirmation_sent_at TEXT');
  if (!columns.includes('confirmation_attempts')) db.exec('ALTER TABLE rentals ADD COLUMN confirmation_attempts INTEGER NOT NULL DEFAULT 0');
  return db;
}
