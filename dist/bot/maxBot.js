"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createMaxBot = createMaxBot;
const max_bot_api_1 = require("@maxhub/max-bot-api");
const config_1 = require("../config");
const userService_1 = require("../services/userService");
const webSessionService_1 = require("../services/webSessionService");
const maxNotifier_1 = require("./maxNotifier");
const notifier_1 = require("./notifier");
const supportService_1 = require("../services/supportService");
const bookingService_1 = require("../services/bookingService");
const contactRequestService_1 = require("../services/contactRequestService");
const displayName_1 = require("../utils/displayName");
const dateFormat_1 = require("../utils/dateFormat");
const escapeBotHtml_1 = require("../utils/escapeBotHtml");
const bot_1 = require("./bot");
/** Тот же принцип, что и лимит поддержки в bot.ts — не даёт заваливать БД/админов текстом. */
const SUPPORT_LIMIT = 5;
const SUPPORT_WINDOW_MS = 60000;
const supportHits = new Map();
function isSupportRateLimited(userId) {
    const now = Date.now();
    const hits = (supportHits.get(userId) ?? []).filter((t) => now - t < SUPPORT_WINDOW_MS);
    hits.push(now);
    supportHits.set(userId, hits);
    return hits.length > SUPPORT_LIMIT;
}
/**
 * Бот MAX — параллельно с Telegram-ботом, полностью опционален (не создаётся,
 * если MAX_BOT_TOKEN не задан). Умеет регистрацию, подтверждение телефона,
 * пересылку сообщений в поддержку и подтверждение/отклонение брони —
 * полноценное MAX Mini App использует тот же validateMaxInitData на бэкенде
 * (см. utils/maxAuth.ts).
 */
function createMaxBot() {
    const bot = new max_bot_api_1.Bot(config_1.config.maxBotToken);
    (0, maxNotifier_1.setMaxBotInstance)(bot);
    // Без этого необработанная ошибка в любом апдейте MAX уронит весь процесс
    // (включая уже работающий Telegram-бот) — таково поведение SDK по умолчанию.
    bot.catch((err) => {
        console.error('Ошибка в обработчике бота MAX:', err);
    });
    bot.on('bot_started', async (ctx) => {
        (0, userService_1.upsertMaxUser)({ id: ctx.user.user_id, name: ctx.user.name, username: ctx.user.username });
        const greeting = `🚗 ${config_1.config.serviceName} — аренда авто от частных лиц по всей России\n\n` +
            'Здесь владельцы публикуют объявления о сдаче автомобиля в аренду, а арендаторы бронируют даты напрямую.\n\n' +
            'Чтобы бронировать или публиковать объявления — подтвердите номер телефона кнопкой ниже.';
        const contactKeyboard = max_bot_api_1.Keyboard.inlineKeyboard([[max_bot_api_1.Keyboard.button.requestContact('📱 Подтвердить номер телефона')]]);
        try {
            const image = await ctx.api.uploadImage({ source: bot_1.bannerPath });
            await ctx.reply(greeting, {
                attachments: [
                    new max_bot_api_1.ImageAttachment('photos' in image ? { photos: image.photos } : { url: image.url }).toJson(),
                    contactKeyboard,
                ],
            });
            return;
        }
        catch (err) {
            console.error('Не удалось отправить баннер в MAX:', err);
        }
        await ctx.reply(greeting, { attachments: [contactKeyboard] });
    });
    bot.on('message_created', async (ctx) => {
        const sender = ctx.message.sender;
        if (!sender)
            return;
        const contact = ctx.contactInfo;
        if (contact?.tel) {
            const user = (0, userService_1.upsertMaxUser)({ id: sender.user_id, name: sender.name, username: sender.username });
            (0, userService_1.setPhoneVerified)(user.telegram_id, contact.tel);
            if (contact.fullName)
                (0, userService_1.setFullName)(user.telegram_id, contact.fullName);
            await ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация объявлений.');
            return;
        }
        const text = ctx.message.body.text?.trim();
        if (!text)
            return;
        // Код для входа в браузерную (не Mini App) версию сайта — у MAX нет
        // публичного login-виджета для сторонних сайтов, поэтому пользователь
        // получает 6-значный код на сайте и присылает его сюда, боту.
        if (/^\d{6}$/.test(text)) {
            const user = (0, userService_1.upsertMaxUser)({ id: sender.user_id, name: sender.name, username: sender.username });
            const linked = (0, webSessionService_1.consumeLoginCode)(text, user.telegram_id);
            await ctx.reply(linked
                ? '✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.'
                : 'Код не найден или уже устарел. Запросите новый код на сайте и попробуйте снова.');
            return;
        }
        if (isSupportRateLimited(sender.user_id)) {
            await ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
            return;
        }
        const user = (0, userService_1.upsertMaxUser)({ id: sender.user_id, name: sender.name, username: sender.username });
        (0, supportService_1.createSupportMessage)(user.telegram_id, text.slice(0, 1000));
        await (0, notifier_1.notifyAdmins)(`🆘 <b>Сообщение в поддержку (MAX)</b>\nОт: ${(0, escapeBotHtml_1.escapeBotHtml)(sender.name)}${sender.username ? ' · @' + (0, escapeBotHtml_1.escapeBotHtml)(sender.username) : ''} (ID ${(0, userService_1.maxStorageId)(sender.user_id)})\n\n${(0, escapeBotHtml_1.escapeBotHtml)(text)}`);
        await ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
    });
    bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
        const bookingId = Number(ctx.match[1]);
        const ownerId = (0, userService_1.maxStorageId)(ctx.callback.user.user_id);
        try {
            (0, bookingService_1.confirmBooking)(bookingId, ownerId);
            const info = (0, bookingService_1.getBookingWithPeople)(bookingId);
            await ctx.answerOnCallback({ notification: 'Бронирование подтверждено!' });
            await ctx.editMessage({
                text: `✅ Вы подтвердили бронь.\n${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)}, ${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}\n` +
                    `Арендатор (${(0, displayName_1.platformLabel)(info.renter_platform)}): ${(0, escapeBotHtml_1.escapeBotHtml)((0, displayName_1.displayName)(info.renter_full_name, info.renter_first_name))}${info.renter_username ? ' (@' + (0, escapeBotHtml_1.escapeBotHtml)(info.renter_username) + ')' : ''}\n` +
                    `Телефон: ${info.renter_phone ? (0, escapeBotHtml_1.escapeBotHtml)(info.renter_phone) : 'не указан'}\n` +
                    `Сумма: ${info.total_price} ₽${info.deposit ? ` + залог ${info.deposit} ₽` : ''}`,
                format: 'html',
            });
            const renterUser = (0, userService_1.getUser)(info.renter_id);
            await (0, notifier_1.notifyUser)(renterUser, `✅ Владелец подтвердил бронь!\n${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)}, ${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}\n` +
                `Владелец (${(0, displayName_1.platformLabel)(info.owner_platform)}): ${(0, escapeBotHtml_1.escapeBotHtml)((0, displayName_1.displayName)(info.owner_full_name, info.owner_first_name))}\nТелефон: ${info.owner_phone ? (0, escapeBotHtml_1.escapeBotHtml)(info.owner_phone) : 'не указан'}\nСумма: ${info.total_price} ₽`);
            await (0, notifier_1.notifyContractReady)(renterUser, bookingId);
            const ownerUser = (0, userService_1.getUser)(info.owner_id);
            await (0, notifier_1.notifyContractReady)(ownerUser, bookingId);
        }
        catch (err) {
            const message = err instanceof bookingService_1.BookingError ? err.message : 'Не удалось подтвердить бронирование';
            await ctx.answerOnCallback({ notification: message });
        }
    });
    bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
        const bookingId = Number(ctx.match[1]);
        const ownerId = (0, userService_1.maxStorageId)(ctx.callback.user.user_id);
        try {
            const info = (0, bookingService_1.getBookingWithPeople)(bookingId);
            (0, bookingService_1.declineBooking)(bookingId, ownerId);
            await ctx.answerOnCallback({ notification: 'Бронирование отклонено' });
            await ctx.editMessage({
                text: `❌ Вы отклонили бронь.\n${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)}, ${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}\nАвтомобиль снова доступен на эти даты.`,
                format: 'html',
            });
            await (0, notifier_1.notifyUser)((0, userService_1.getUser)(info.renter_id), `❌ Владелец отклонил бронь на ${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)} (${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}).\nПопробуйте найти другой автомобиль в приложении.`);
        }
        catch (err) {
            const message = err instanceof bookingService_1.BookingError ? err.message : 'Не удалось отклонить бронирование';
            await ctx.answerOnCallback({ notification: message });
        }
    });
    bot.action(/^confirm_contact:(\d+)$/, async (ctx) => {
        const requestId = Number(ctx.match[1]);
        const ownerId = (0, userService_1.maxStorageId)(ctx.callback.user.user_id);
        try {
            (0, contactRequestService_1.confirmContactRequest)(requestId, ownerId);
            const info = (0, contactRequestService_1.getContactRequestWithPeople)(requestId);
            await ctx.answerOnCallback({ notification: 'Контакты подтверждены!' });
            await ctx.editMessage({
                text: `✅ Вы подтвердили запрос на контакты.\n${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)} (${(0, escapeBotHtml_1.escapeBotHtml)(info.city)})\n` +
                    `Арендатор (${(0, displayName_1.platformLabel)(info.renter_platform)}): ${(0, escapeBotHtml_1.escapeBotHtml)((0, displayName_1.displayName)(info.renter_full_name, info.renter_first_name))}${info.renter_username ? ' (@' + (0, escapeBotHtml_1.escapeBotHtml)(info.renter_username) + ')' : ''}\n` +
                    `Телефон: ${info.renter_phone ? (0, escapeBotHtml_1.escapeBotHtml)(info.renter_phone) : 'не указан'}`,
                format: 'html',
            });
            await (0, notifier_1.notifyUser)((0, userService_1.getUser)(info.renter_id), `✅ Владелец подтвердил запрос!\n${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)} (${(0, escapeBotHtml_1.escapeBotHtml)(info.city)})\n` +
                `Владелец (${(0, displayName_1.platformLabel)(info.owner_platform)}): ${(0, escapeBotHtml_1.escapeBotHtml)((0, displayName_1.displayName)(info.owner_full_name, info.owner_first_name))}\nТелефон: ${info.owner_phone ? (0, escapeBotHtml_1.escapeBotHtml)(info.owner_phone) : 'не указан'}`);
        }
        catch (err) {
            const message = err instanceof contactRequestService_1.ContactRequestError ? err.message : 'Не удалось подтвердить запрос';
            await ctx.answerOnCallback({ notification: message });
        }
    });
    bot.action(/^decline_contact:(\d+)$/, async (ctx) => {
        const requestId = Number(ctx.match[1]);
        const ownerId = (0, userService_1.maxStorageId)(ctx.callback.user.user_id);
        try {
            const info = (0, contactRequestService_1.getContactRequestWithPeople)(requestId);
            (0, contactRequestService_1.declineContactRequest)(requestId, ownerId);
            await ctx.answerOnCallback({ notification: 'Запрос отклонён' });
            await ctx.editMessage({
                text: `❌ Вы отклонили запрос на контакты по объявлению ${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)}.`,
                format: 'html',
            });
            await (0, notifier_1.notifyUser)((0, userService_1.getUser)(info.renter_id), `❌ Владелец отклонил запрос на контакты по объявлению ${(0, escapeBotHtml_1.escapeBotHtml)(info.brand)} ${(0, escapeBotHtml_1.escapeBotHtml)(info.model)}.`);
        }
        catch (err) {
            const message = err instanceof contactRequestService_1.ContactRequestError ? err.message : 'Не удалось отклонить запрос';
            await ctx.answerOnCallback({ notification: message });
        }
    });
    return bot;
}
