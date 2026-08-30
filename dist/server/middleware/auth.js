"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SESSION_COOKIE_NAME = void 0;
exports.readCookie = readCookie;
exports.requireAuth = requireAuth;
exports.requireActiveUser = requireActiveUser;
exports.requireAgreementAccepted = requireAgreementAccepted;
const telegramAuth_1 = require("../../utils/telegramAuth");
const maxAuth_1 = require("../../utils/maxAuth");
const userService_1 = require("../../services/userService");
const webSessionService_1 = require("../../services/webSessionService");
const config_1 = require("../../config");
exports.SESSION_COOKIE_NAME = 'web_session';
/** Простой разбор Cookie-заголовка — одна ожидаемая кука, тащить ради
 *  неё зависимость cookie-parser не нужно. */
function readCookie(req, name) {
    const header = req.header('Cookie');
    if (!header)
        return undefined;
    for (const part of header.split(';')) {
        const eq = part.indexOf('=');
        if (eq === -1)
            continue;
        if (part.slice(0, eq).trim() === name) {
            return decodeURIComponent(part.slice(eq + 1).trim());
        }
    }
    return undefined;
}
/**
 * Принимает initData либо из Telegram (заголовок X-Telegram-Init-Data), либо
 * из MAX (заголовок X-Max-Init-Data) — это авторизация внутри Mini App. Вне
 * Mini App (обычный браузер на ПК/телефоне) initData нет вовсе — там
 * используется cookie-сессия, выданная после входа кодом в чате с ботом
 * (см. server/routes/auth.ts). Один из трёх способов должен сработать —
 * иначе запрос отклоняется.
 */
function requireAuth(req, res, next) {
    const telegramInitData = req.header('X-Telegram-Init-Data') ?? '';
    const validatedTelegram = (0, telegramAuth_1.validateInitData)(telegramInitData);
    if (validatedTelegram) {
        const user = (0, userService_1.upsertUser)(validatedTelegram.user);
        req.user = (0, userService_1.getUser)(user.telegram_id);
        next();
        return;
    }
    const maxInitData = req.header('X-Max-Init-Data') ?? '';
    const validatedMax = (0, maxAuth_1.validateMaxInitData)(maxInitData);
    if (validatedMax) {
        const user = (0, userService_1.upsertMaxUser)(validatedMax.user);
        req.user = (0, userService_1.getUser)(user.telegram_id);
        next();
        return;
    }
    const sessionToken = readCookie(req, exports.SESSION_COOKIE_NAME);
    const sessionUser = sessionToken ? (0, webSessionService_1.getSessionUser)(sessionToken) : undefined;
    if (sessionUser) {
        req.user = sessionUser;
        next();
        return;
    }
    res.status(401).json({ error: 'Недействительные данные авторизации' });
}
/**
 * Полностью закрывает доступ к разделу (поиск/бронирование/публикация
 * объявлений) забаненным и неверифицированным пользователям — не только
 * запись, но и чтение. Ставится после requireAuth. GET /api/users/me этой
 * проверкой НЕ прикрыт намеренно — фронтенду нужно узнать статус, чтобы
 * показать экран блокировки.
 */
function requireActiveUser(req, res, next) {
    const { user } = req;
    if (config_1.config.adminIds.includes(user.telegram_id)) {
        // Админы не должны иметь возможность случайно заблокировать себе доступ
        // к собственной панели, отозвав себе телефон или забанив самих себя.
        next();
        return;
    }
    if (user.banned) {
        res.status(403).json({ error: 'Ваш аккаунт заблокирован администратором', banned: true });
        return;
    }
    if (!user.phone_verified) {
        res.status(403).json({ error: 'Подтвердите номер телефона в чате с ботом', phoneRequired: true });
        return;
    }
    if (!user.full_name) {
        res.status(403).json({ error: 'Укажите имя и фамилию', nameRequired: true });
        return;
    }
    next();
}
/**
 * Требуется перед любым действием, которое создаёт публичное обязательство
 * между пользователями площадки (публикация объявления, бронирование) —
 * ст. 1253.1 ГК РФ и Пользовательское соглашение автодай.рф применяются
 * только к тем, кто явно принял оферту чекбоксом в интерфейсе.
 */
function requireAgreementAccepted(req, res, next) {
    const { user } = req;
    if (!user.agreement_accepted_at) {
        res.status(403).json({
            error: 'Необходимо принять Пользовательское соглашение сервиса автодай.рф',
            agreementRequired: true,
        });
        return;
    }
    next();
}
