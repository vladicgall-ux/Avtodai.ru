"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeLimiter = writeLimiter;
const express_rate_limit_1 = __importStar(require("express-rate-limit"));
/** Ключ лимитера: свой telegram_id, если запрос уже прошёл requireAuth
 *  (роут стоит после него), иначе — IP как запасной вариант. Фоллбэк идёт через
 *  штатный ipKeyGenerator — он корректно нормализует IPv6-адреса (иначе клиент
 *  мог бы обходить лимит перебором адресов внутри своей /64 подсети). */
function authedKey(req) {
    const user = req.user;
    return user ? `u:${user.telegram_id}` : `ip:${(0, express_rate_limit_1.ipKeyGenerator)(req.ip ?? '')}`;
}
/** Лимитер для «дорогих»/спам-опасных write-эндпоинтов (бронирование, публикация
 *  объявления, оценка, поддержка, загрузка фото) — считает по пользователю, не по IP,
 *  т.к. несколько пользователей могут сидеть за одним IP (мобильный NAT). */
function writeLimiter(max, windowMs) {
    return (0, express_rate_limit_1.default)({
        windowMs,
        max,
        standardHeaders: true,
        legacyHeaders: false,
        keyGenerator: authedKey,
        message: { error: 'Слишком много запросов. Попробуйте немного позже.' },
    });
}
