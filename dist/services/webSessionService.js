"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createWebSession = createWebSession;
exports.getSessionUser = getSessionUser;
exports.deleteWebSession = deleteWebSession;
exports.deleteAllWebSessionsForUser = deleteAllWebSessionsForUser;
exports.createLoginCode = createLoginCode;
exports.consumeLoginCode = consumeLoginCode;
exports.checkLoginCode = checkLoginCode;
exports.sweepExpiredWebAuth = sweepExpiredWebAuth;
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("../db/db");
const userService_1 = require("./userService");
const SESSION_TTL_MS = 30 * 24 * 60 * 60000; // 30 дней
const LOGIN_CODE_TTL_MS = 10 * 60000; // 10 минут
function isoIn(ms) {
    return new Date(Date.now() + ms).toISOString();
}
function createWebSession(userId) {
    const token = crypto_1.default.randomBytes(32).toString('hex');
    db_1.db.prepare('INSERT INTO web_sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(token, userId, isoIn(SESSION_TTL_MS));
    return token;
}
function getSessionUser(token) {
    if (!token)
        return undefined;
    const row = db_1.db
        .prepare("SELECT user_id FROM web_sessions WHERE token = ? AND expires_at > datetime('now')")
        .get(token);
    return row ? (0, userService_1.getUser)(row.user_id) : undefined;
}
function deleteWebSession(token) {
    db_1.db.prepare('DELETE FROM web_sessions WHERE token = ?').run(token);
}
/** Обрывает все веб-сессии пользователя разом — кнопка «Выйти со всех устройств». */
function deleteAllWebSessionsForUser(userId) {
    db_1.db.prepare('DELETE FROM web_sessions WHERE user_id = ?').run(userId);
}
/**
 * Короткий числовой код для входа в браузерной версии: пользователь получает
 * его на сайте и присылает боту в чат — в Telegram или в MAX. Вместе с кодом
 * генерируется длинный случайный pollToken, который возвращается только
 * этому браузеру и требуется вместе с кодом при опросе статуса — угадать оба
 * значения одновременно нереально, даже если код всего 6 цифр.
 */
function createLoginCode() {
    const pollToken = crypto_1.default.randomBytes(24).toString('hex');
    for (let attempt = 0; attempt < 10; attempt += 1) {
        const code = String(crypto_1.default.randomInt(0, 1000000)).padStart(6, '0');
        const exists = db_1.db.prepare('SELECT 1 FROM login_codes WHERE code = ?').get(code);
        if (exists)
            continue;
        db_1.db.prepare('INSERT INTO login_codes (code, poll_token, expires_at) VALUES (?, ?, ?)').run(code, pollToken, isoIn(LOGIN_CODE_TTL_MS));
        return { code, pollToken };
    }
    throw new Error('Не удалось сгенерировать код входа, попробуйте ещё раз');
}
/** Привязывает код к пользователю, который прислал его боту (Telegram или MAX). */
function consumeLoginCode(code, userId) {
    const result = db_1.db
        .prepare(`UPDATE login_codes SET user_id = ?
       WHERE code = ? AND expires_at > datetime('now') AND user_id IS NULL`)
        .run(userId, code);
    return result.changes > 0;
}
/**
 * Опрос со страницы браузера: подтверждён ли код и кем. Код одноразовый —
 * как только по нему выдана сессия, отмечаем used_at, чтобы повторный опрос
 * не мог получить вторую валидную сессию по тому же коду.
 */
function checkLoginCode(code, pollToken) {
    if (!code || !pollToken)
        return null;
    const row = db_1.db
        .prepare(`SELECT user_id, poll_token FROM login_codes
       WHERE code = ? AND expires_at > datetime('now') AND used_at IS NULL`)
        .get(code);
    if (!row || !row.poll_token || row.user_id === null)
        return null;
    const expected = Buffer.from(row.poll_token);
    const actual = Buffer.from(pollToken);
    if (expected.length !== actual.length || !crypto_1.default.timingSafeEqual(expected, actual))
        return null;
    const result = db_1.db
        .prepare(`UPDATE login_codes SET used_at = datetime('now') WHERE code = ? AND used_at IS NULL`)
        .run(code);
    if (result.changes === 0)
        return null;
    return row.user_id;
}
/** Чистит истёкшие сессии и коды — вызывается из периодических задач в index.ts. */
function sweepExpiredWebAuth() {
    db_1.db.prepare(`DELETE FROM web_sessions WHERE expires_at <= datetime('now')`).run();
    db_1.db.prepare(`DELETE FROM login_codes WHERE expires_at <= datetime('now')`).run();
}
