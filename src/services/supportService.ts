import { db } from '../db/db';

export interface SupportMessageRecord {
  id: number;
  user_id: number;
  message: string;
  from_admin: number;
  created_at: string;
}

export function createSupportMessage(userId: number, message: string): SupportMessageRecord {
  const info = db.prepare(`INSERT INTO support_messages (user_id, message) VALUES (?, ?)`).run(userId, message);
  return db.prepare('SELECT * FROM support_messages WHERE id = ?').get(info.lastInsertRowid) as SupportMessageRecord;
}

/** Ответ администратора конкретному пользователю — попадает в ту же ленту (from_admin=1). */
export function createAdminReply(userId: number, message: string): SupportMessageRecord {
  const info = db
    .prepare(`INSERT INTO support_messages (user_id, message, from_admin) VALUES (?, ?, 1)`)
    .run(userId, message);
  return db.prepare('SELECT * FROM support_messages WHERE id = ?').get(info.lastInsertRowid) as SupportMessageRecord;
}

export interface SupportMessageWithUser extends SupportMessageRecord {
  first_name: string;
  username: string | null;
  full_name: string | null;
  phone: string | null;
}

export function listAllSupportMessages(): SupportMessageWithUser[] {
  return db
    .prepare(
      `SELECT s.*, u.first_name, u.username, u.full_name, u.phone
       FROM support_messages s JOIN users u ON u.telegram_id = s.user_id
       ORDER BY s.created_at DESC`
    )
    .all() as SupportMessageWithUser[];
}
