import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

const dbDir = path.dirname(config.dbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
// Без этого параллельная запись (например, периодическая задача и HTTP-запрос
// почти одновременно) сразу получила бы SQLITE_BUSY вместо короткого
// ожидания снятия блокировки другим соединением.
db.pragma('busy_timeout = 5000');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf-8');
db.exec(schema);

// Лёгкая ручная миграция: CREATE TABLE IF NOT EXISTS выше не добавляет
// колонки в уже существующую (созданную более старой версией схемы) таблицу
// на проде, поэтому недостающие колонки добираем здесь.
const bookingsColumns = db.prepare(`PRAGMA table_info(bookings)`).all() as { name: string }[];
if (!bookingsColumns.some((c) => c.name === 'updated_at')) {
  // ADD COLUMN не допускает недетерминированный DEFAULT вроде datetime('now'),
  // поэтому колонку добавляем без него и сразу же заполняем задним числом —
  // дальше её всегда проставляет явно код сервиса при каждом изменении брони.
  db.exec(`ALTER TABLE bookings ADD COLUMN updated_at TEXT`);
  db.exec(`UPDATE bookings SET updated_at = COALESCE(cancelled_at, created_at)`);
}
