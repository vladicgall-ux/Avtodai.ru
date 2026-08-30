"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.usersRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const userService_1 = require("../../services/userService");
const ratingService_1 = require("../../services/ratingService");
const carService_1 = require("../../services/carService");
const config_1 = require("../../config");
exports.usersRouter = (0, express_1.Router)();
exports.usersRouter.use(auth_1.requireAuth);
/** Профиль текущего пользователя: данные аккаунта + сводка объявлений/рейтингов. */
exports.usersRouter.get('/me', (req, res) => {
    const { user } = req;
    const isAdmin = config_1.config.adminIds.includes(user.telegram_id);
    const listings = (0, carService_1.listListingsByOwner)(user.telegram_id);
    const ownerRating = listings.length ? (0, ratingService_1.getOwnerRatingSummary)(user.telegram_id) : null;
    const renterRating = (0, ratingService_1.getRenterRatingSummary)(user.telegram_id);
    res.json({ user, listings, isAdmin, ownerRating, renterRating });
});
/**
 * Сохраняет настоящее имя и фамилию — не через requireActiveUser, потому что
 * именно отсутствие full_name и есть та проверка, которую этот запрос должен
 * снять (иначе получился бы замкнутый круг). Телефон всё равно обязателен —
 * имя вводят уже после подтверждения номера.
 */
exports.usersRouter.post('/me/name', (0, rateLimit_1.writeLimiter)(10, 10 * 60000), (req, res) => {
    const { user } = req;
    if (user.banned) {
        res.status(403).json({ error: 'Аккаунт заблокирован' });
        return;
    }
    if (!user.phone_verified) {
        res.status(403).json({ error: 'Сначала подтвердите номер телефона в чате с ботом' });
        return;
    }
    const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
    if (fullName.length < 3 || fullName.length > 100 || !fullName.includes(' ')) {
        res.status(400).json({ error: 'Укажите имя и фамилию через пробел' });
        return;
    }
    (0, userService_1.setFullName)(user.telegram_id, fullName);
    res.json({ user: (0, userService_1.getUser)(user.telegram_id) });
});
/**
 * Принятие Пользовательского соглашения сервиса автодай.рф — обязательный
 * чекбокс перед публикацией объявления или бронированием (см. requireAgreementAccepted).
 * Отдельный, не через requireActiveUser: принять оферту можно и без
 * подтверждённого телефона, это независимое условие.
 */
exports.usersRouter.post('/me/agreement/accept', (0, rateLimit_1.writeLimiter)(10, 10 * 60000), (req, res) => {
    const { user } = req;
    (0, userService_1.setAgreementAccepted)(user.telegram_id);
    res.json({ user: (0, userService_1.getUser)(user.telegram_id) });
});
