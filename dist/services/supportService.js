"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSupportMessage = createSupportMessage;
exports.createAdminReply = createAdminReply;
exports.listAllSupportMessages = listAllSupportMessages;
const db_1 = require("../db/db");
function createSupportMessage(userId, message) {
    const info = db_1.db.prepare(`INSERT INTO support_messages (user_id, message) VALUES (?, ?)`).run(userId, message);
    return db_1.db.prepare('SELECT * FROM support_messages WHERE id = ?').get(info.lastInsertRowid);
}
/** Ответ администратора конкретному пользователю — попадает в ту же ленту (from_admin=1). */
function createAdminReply(userId, message) {
    const info = db_1.db
        .prepare(`INSERT INTO support_messages (user_id, message, from_admin) VALUES (?, ?, 1)`)
        .run(userId, message);
    return db_1.db.prepare('SELECT * FROM support_messages WHERE id = ?').get(info.lastInsertRowid);
}
function listAllSupportMessages() {
    return db_1.db
        .prepare(`SELECT s.*, u.first_name, u.username, u.full_name, u.phone
       FROM support_messages s JOIN users u ON u.telegram_id = s.user_id
       ORDER BY s.created_at DESC`)
        .all();
}
