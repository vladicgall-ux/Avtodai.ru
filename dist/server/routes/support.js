"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.supportRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const supportService_1 = require("../../services/supportService");
const notifier_1 = require("../../bot/notifier");
const displayName_1 = require("../../utils/displayName");
exports.supportRouter = (0, express_1.Router)();
// Специально без requireActiveUser: даже забаненный или неверифицированный
// пользователь должен иметь возможность написать в поддержку и разобраться в ситуации.
exports.supportRouter.use(auth_1.requireAuth);
// Отдельный, более жёсткий лимит — иначе пользователь может засыпать
// администратора сообщениями и раздуть таблицу support_messages.
exports.supportRouter.post('/', (0, rateLimit_1.writeLimiter)(8, 5 * 60000), async (req, res) => {
    const { user } = req;
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    if (!message) {
        res.status(400).json({ error: 'Введите текст сообщения' });
        return;
    }
    const record = (0, supportService_1.createSupportMessage)(user.telegram_id, message);
    const senderName = [(0, displayName_1.displayName)(user.full_name, user.first_name), user.username ? `@${user.username}` : null]
        .filter(Boolean)
        .join(' ');
    await (0, notifier_1.notifyAdmins)(`🆘 <b>Сообщение в поддержку</b>\nОт: ${senderName} (ID ${user.telegram_id})${user.phone ? `, ${user.phone}` : ''}\n\n${message}`);
    res.status(201).json({ message: record });
});
