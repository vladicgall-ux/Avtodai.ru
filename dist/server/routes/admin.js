"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.adminRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const upload_1 = require("../middleware/upload");
const config_1 = require("../../config");
const userService_1 = require("../../services/userService");
const carService_1 = require("../../services/carService");
const bookingService_1 = require("../../services/bookingService");
const supportService_1 = require("../../services/supportService");
const statsService_1 = require("../../services/statsService");
const ratingService_1 = require("../../services/ratingService");
const notifier_1 = require("../../bot/notifier");
const parseId_1 = require("../utils/parseId");
const db_1 = require("../../db/db");
exports.adminRouter = (0, express_1.Router)();
exports.adminRouter.use(auth_1.requireAuth);
exports.adminRouter.use((req, res, next) => {
    const { user } = req;
    if (!config_1.config.adminIds.includes(user.telegram_id)) {
        res.status(403).json({ error: 'Доступ только для администраторов' });
        return;
    }
    next();
});
exports.adminRouter.get('/stats', (_req, res) => {
    res.json({ stats: (0, statsService_1.getAdminStats)() });
});
exports.adminRouter.get('/users', (_req, res) => {
    res.json({ users: (0, userService_1.listAllUsers)() });
});
/** Подробная карточка пользователя для админки: объявления, брони, статистика за всё время. */
exports.adminRouter.get('/users/:id', (req, res) => {
    const telegramId = (0, parseId_1.parseSignedId)(req.params.id);
    if (!telegramId) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    const user = (0, userService_1.getUser)(telegramId);
    if (!user) {
        res.status(404).json({ error: 'Пользователь не найден' });
        return;
    }
    const listings = (0, carService_1.listListingsByOwner)(telegramId);
    const ownerStats = listings.length ? (0, statsService_1.getOwnerAllTimeStats)(telegramId) : null;
    const ownerRating = listings.length ? (0, ratingService_1.getOwnerRatingSummary)(telegramId) : null;
    const bookings = (0, bookingService_1.listBookingsByRenter)(telegramId);
    const renterStats = (0, statsService_1.getRenterAllTimeStats)(telegramId);
    const renterRating = (0, ratingService_1.getRenterRatingSummary)(telegramId);
    // Сигнал для модерации: сколько раз пользователь сам отменял брони.
    const cancelledBookingsCount = db_1.db
        .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE renter_id = ? AND cancellation_reason IS NOT NULL`)
        .get(telegramId).n;
    res.json({
        user,
        listings,
        ownerStats,
        ownerRating,
        bookings,
        renterStats,
        renterRating,
        cancelledBookingsCount,
    });
});
exports.adminRouter.get('/listings', (_req, res) => {
    res.json({ listings: (0, carService_1.searchListings)({ sort: 'newest' }) });
});
exports.adminRouter.get('/bookings', (_req, res) => {
    res.json({ bookings: (0, bookingService_1.listAllBookings)() });
});
exports.adminRouter.get('/support', (_req, res) => {
    res.json({ messages: (0, supportService_1.listAllSupportMessages)() });
});
/** Ответ администратора пользователю — уходит ему сообщением от бота. */
exports.adminRouter.post('/support/:userId/reply', async (req, res) => {
    const userId = (0, parseId_1.parseSignedId)(req.params.userId);
    if (!userId) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    if (!message) {
        res.status(400).json({ error: 'Введите текст ответа' });
        return;
    }
    const target = (0, userService_1.getUser)(userId);
    if (!target) {
        res.status(404).json({ error: 'Пользователь не найден' });
        return;
    }
    const record = (0, supportService_1.createAdminReply)(userId, message);
    await (0, notifier_1.notifyUser)(target, `✉️ <b>Ответ поддержки</b>\n\n${message}`);
    res.status(201).json({ message: record });
});
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
/**
 * Массовая рассылка всем незаблокированным пользователям от имени бота
 * (не от личного аккаунта админа). Текст и/или фото — нужно хотя бы одно.
 * Шлём последовательно с небольшой паузой, чтобы не упереться в лимит
 * Telegram (~30 сообщений/сек на бота).
 */
exports.adminRouter.post('/broadcast', (0, rateLimit_1.writeLimiter)(5, 60 * 60000), (req, res, next) => {
    upload_1.uploadBroadcastPhoto.single('photo')(req, res, (err) => {
        if (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
            return;
        }
        next();
    });
}, async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    const file = req.file;
    // multipart/form-data — значения всегда строки, не булевы.
    const pin = req.body?.pin === 'true' || req.body?.pin === '1';
    if (!message && !file) {
        res.status(400).json({ error: 'Добавьте текст или фото' });
        return;
    }
    if (file) {
        if (!(0, upload_1.isValidImageFile)(file.path)) {
            fs_1.default.unlink(file.path, () => { });
            res.status(400).json({ error: 'Файл повреждён или не является изображением' });
            return;
        }
        if (!(await (0, upload_1.processUploadedImage)(file.path))) {
            fs_1.default.unlink(file.path, () => { });
            res.status(400).json({ error: 'Не удалось обработать изображение — попробуйте другой файл' });
            return;
        }
    }
    const recipients = (0, userService_1.listActiveUserIds)();
    // Отвечаем сразу, не дожидаясь конца рассылки: при сотнях получателей
    // с паузой 40мс + временем самого запроса к Telegram/MAX это легко
    // уходит за 30-60 секунд — типичный таймаут реверс-прокси на хостинге,
    // который просто оборвал бы соединение с клиентом на середине рассылки.
    res.json({ accepted: true, total: recipients.length });
    let sent = 0;
    for (const telegramId of recipients) {
        const recipient = (0, userService_1.getUser)(telegramId);
        if (!recipient)
            continue;
        // Фото умеем слать только через Telegram — у пользователей MAX пока
        // нет notifyPhoto для этой платформы, поэтому им уходит хотя бы текст.
        const ok = file && recipient.platform === 'telegram'
            ? await (0, notifier_1.notifyPhoto)(telegramId, file.path, message, pin)
            : await (0, notifier_1.notifyUser)(recipient, message || `📷 Новое объявление от ${config_1.config.serviceName}`, undefined, pin);
        if (ok)
            sent += 1;
        await sleep(40);
    }
    if (file) {
        fs_1.default.unlink(file.path, () => { });
    }
    console.log(`Рассылка завершена: отправлено ${sent} из ${recipients.length}`);
});
function setBan(banned) {
    return (req, res) => {
        const telegramId = (0, parseId_1.parseSignedId)(req.params.id);
        if (!telegramId) {
            res.status(400).json({ error: 'Некорректный ID' });
            return;
        }
        if (config_1.config.adminIds.includes(telegramId)) {
            res.status(400).json({ error: 'Нельзя заблокировать администратора' });
            return;
        }
        const target = (0, userService_1.getUser)(telegramId);
        if (!target) {
            res.status(404).json({ error: 'Пользователь не найден' });
            return;
        }
        (0, userService_1.setUserBanned)(telegramId, banned);
        res.json({ user: (0, userService_1.getUser)(telegramId) });
    };
}
exports.adminRouter.post('/users/:id/ban', setBan(true));
exports.adminRouter.post('/users/:id/unban', setBan(false));
