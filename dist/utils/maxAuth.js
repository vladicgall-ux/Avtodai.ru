"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateMaxInitData = validateMaxInitData;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
/**
 * Проверяет подпись initData из MAX Mini App.
 *
 * Алгоритм подтверждён официальной документацией MAX (dev.max.ru/docs/
 * webapps/validation): та же схема, что и у Telegram Mini Apps —
 * HMAC-SHA256 от отсортированной data-check-string, ключ —
 * HMAC-SHA256('WebAppData', токен бота).
 */
function validateMaxInitData(initData) {
    // Логируем только короткую причину отказа, без самих данных — initData
    // содержит персональные данные пользователя MAX (id, имя, username), а
    // при неверной подписи ещё и посчитанный HMAC незачем писать в лог.
    //
    // Пустой заголовок НЕ логируем: requireAuth (см. server/middleware/auth.ts)
    // пробует Telegram, затем MAX, затем веб-сессию по кукам — значит этот
    // путь проходит буквально каждый запрос из Telegram Mini App и из
    // браузерной версии (там X-Max-Init-Data вообще не отправляется). Это
    // штатный, самый частый случай, а не ошибка — логировать его означало бы
    // заливать логи шумом на каждый запрос вместо реальных проблем.
    const log = (reason) => console.log(`[maxAuth] отклонено: ${reason}`);
    if (!initData) {
        return null;
    }
    if (!config_1.config.maxBotToken) {
        log('MAX_BOT_TOKEN не задан на сервере');
        return null;
    }
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) {
        log('нет поля hash');
        return null;
    }
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update(config_1.config.maxBotToken).digest();
    const computedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (!timingSafeEqualHex(computedHash, hash)) {
        log('подпись не совпала');
        return null;
    }
    const authDate = Number(params.get('auth_date') ?? 0);
    const now = Date.now() / 1000;
    if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + 300 || now - authDate > 60 * 60 * 24) {
        log('просрочено, из будущего или нет auth_date');
        return null;
    }
    const userRaw = params.get('user');
    if (!userRaw) {
        log('нет поля user');
        return null;
    }
    let parsed;
    try {
        parsed = JSON.parse(userRaw);
    }
    catch {
        log('поле user — невалидный JSON');
        return null;
    }
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'number') {
        log('поле user имеет неверную структуру');
        return null;
    }
    const raw = parsed;
    const user = {
        id: raw.id,
        name: raw.name ?? raw.first_name ?? 'Пользователь MAX',
        username: raw.username ?? null,
    };
    return { user, authDate };
}
function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length)
        return false;
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
