"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setBotInstance = setBotInstance;
exports.getBotUsername = getBotUsername;
exports.notify = notify;
exports.notifyPhoneReminder = notifyPhoneReminder;
exports.notifyPhoto = notifyPhoto;
exports.notifyAdmins = notifyAdmins;
exports.notifyUser = notifyUser;
exports.notifyContractReady = notifyContractReady;
const telegraf_1 = require("telegraf");
const config_1 = require("../config");
const maxNotifier_1 = require("./maxNotifier");
let botInstance = null;
function setBotInstance(bot) {
    botInstance = bot;
}
/** Юзернейм бота (для ссылки-приглашения) — становится известен после getMe() при запуске. */
function getBotUsername() {
    return botInstance?.botInfo?.username ?? null;
}
/** Закрепляет сообщение в личном чате с пользователем; не роняет вызывающий код при ошибке — это необязательное дополнение к отправке. */
async function tryPin(chatId, messageId) {
    if (!botInstance)
        return;
    try {
        await botInstance.telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
    }
    catch {
        // например, сообщение уже откреплено пользователем вручную — не критично
    }
}
/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
async function notify(telegramId, text, buttonRows, pin) {
    if (!botInstance)
        return false;
    try {
        const msg = await botInstance.telegram.sendMessage(telegramId, text, {
            parse_mode: 'HTML',
            ...(buttonRows ? telegraf_1.Markup.inlineKeyboard(buttonRows) : {}),
        });
        if (pin)
            await tryPin(telegramId, msg.message_id);
        return true;
    }
    catch {
        // пользователь мог заблокировать бота — это не критично
        return false;
    }
}
/** Напоминание подтвердить телефон — с той же кнопкой "Поделиться номером", что и на /start. */
async function notifyPhoneReminder(telegramId, text) {
    if (!botInstance)
        return false;
    try {
        await botInstance.telegram.sendMessage(telegramId, text, {
            parse_mode: 'HTML',
            ...telegraf_1.Markup.keyboard([telegraf_1.Markup.button.contactRequest('📱 Подтвердить номер телефона')])
                .resize()
                .oneTime(),
        });
        return true;
    }
    catch {
        return false;
    }
}
/** Отправляет пользователю фото с подписью; молча игнорирует ошибки (аналогично notify). */
async function notifyPhoto(telegramId, photoPath, caption, pin) {
    if (!botInstance)
        return false;
    try {
        const msg = await botInstance.telegram.sendPhoto(telegramId, telegraf_1.Input.fromLocalFile(photoPath), {
            caption,
            parse_mode: 'HTML',
        });
        if (pin)
            await tryPin(telegramId, msg.message_id);
        return true;
    }
    catch {
        return false;
    }
}
/** Рассылает сообщение всем администраторам из ADMIN_IDS (например, обращение в поддержку). */
async function notifyAdmins(text, buttonRows) {
    await Promise.all(config_1.config.adminIds.map((id) => notify(id, text, buttonRows)));
}
/** Отправляет сообщение пользователю через того бота, в котором он зарегистрирован, включая кнопки действий. */
async function notifyUser(user, text, buttonRows, pin) {
    if (user.platform === 'max')
        return (0, maxNotifier_1.notifyMax)(user, text, buttonRows, pin);
    const telegramButtons = buttonRows?.map((row) => row.map((b) => ({ text: b.text, callback_data: b.action })));
    return notify(user.telegram_id, text, telegramButtons, pin);
}
/**
 * Сообщение с готовым договором аренды сразу после подтверждения брони —
 * пока договор не собирается автоматически в PDF и не рассылается файлом,
 * это кнопка-диплинк, которая открывает уже заполненный сервисом договор
 * прямо в приложении (`?tab=bookings&contract=<id>`, см. app.js::init()),
 * откуда стороны печатают его или сохраняют как PDF и дозаполняют вручную
 * поля, которые сервис не запрашивает (паспорт, ВУ, VIN, СТС).
 *
 * Без WEBAPP_URL диплинк не построить (нет ещё известного публичного
 * домена) — тогда просто ничего не отправляем, а не шлём нерабочую ссылку.
 */
async function notifyContractReady(user, bookingId) {
    if (!config_1.config.webappUrl)
        return false;
    const deepLink = `${config_1.config.webappUrl}?tab=bookings&contract=${bookingId}`;
    const text = '📄 Договор аренды и акт приёма-передачи готовы. Откройте, распечатайте или сохраните как PDF — часть полей (паспорт, ВУ, VIN, СТС) заполните от руки при встрече.';
    if (user.platform === 'max') {
        return (0, maxNotifier_1.notifyMaxWithLink)(user, text, '📄 Открыть договор', deepLink);
    }
    return notify(user.telegram_id, text, [[{ text: '📄 Открыть договор', web_app: { url: deepLink } }]]);
}
