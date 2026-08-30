"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateInitData = validateInitData;
const crypto_1 = __importDefault(require("crypto"));
const config_1 = require("../config");
/**
 * Проверяет подпись initData, которую Telegram Mini App передаёт на бэкенд.
 * Алгоритм из официальной документации Telegram (валидация Web App данных):
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
function validateInitData(initData) {
    if (!initData)
        return null;
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash)
        return null;
    params.delete('hash');
    const dataCheckString = [...params.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, value]) => `${key}=${value}`)
        .join('\n');
    const secretKey = crypto_1.default.createHmac('sha256', 'WebAppData').update(config_1.config.botToken).digest();
    const computedHash = crypto_1.default.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
    if (!timingSafeEqualHex(computedHash, hash)) {
        return null;
    }
    const authDate = Number(params.get('auth_date') ?? 0);
    const now = Date.now() / 1000;
    // initData считается просроченной через 24 часа. Верхнюю границу (now + 5
    // минут) проверяем на случай будущей даты — она бы никогда не устарела.
    if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + 300 || now - authDate > 60 * 60 * 24) {
        return null;
    }
    const userRaw = params.get('user');
    if (!userRaw)
        return null;
    let parsed;
    try {
        parsed = JSON.parse(userRaw);
    }
    catch {
        return null;
    }
    if (!parsed ||
        typeof parsed !== 'object' ||
        typeof parsed.id !== 'number' ||
        typeof parsed.first_name !== 'string') {
        return null;
    }
    return { user: parsed, authDate };
}
function timingSafeEqualHex(a, b) {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length)
        return false;
    return crypto_1.default.timingSafeEqual(bufA, bufB);
}
