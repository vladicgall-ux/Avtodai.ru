"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setMaxBotInstance = setMaxBotInstance;
exports.notifyMaxPhoneReminder = notifyMaxPhoneReminder;
exports.notifyMaxWithLink = notifyMaxWithLink;
exports.notifyMax = notifyMax;
const max_bot_api_1 = require("@maxhub/max-bot-api");
const userService_1 = require("../services/userService");
let maxBotInstance = null;
function setMaxBotInstance(bot) {
    maxBotInstance = bot;
}
/** Напоминание подтвердить телефон — с той же кнопкой "Поделиться номером", что и на bot_started. */
async function notifyMaxPhoneReminder(user, text) {
    if (!maxBotInstance)
        return false;
    try {
        await maxBotInstance.api.sendMessageToUser((0, userService_1.realMaxUserId)(user), text, {
            format: 'html',
            attachments: [max_bot_api_1.Keyboard.inlineKeyboard([[max_bot_api_1.Keyboard.button.requestContact('📱 Подтвердить номер телефона')]])],
        });
        return true;
    }
    catch {
        return false;
    }
}
/**
 * Сообщение со ссылкой (Keyboard.button.link) вместо callback-кнопки —
 * используется, только когда нужно открыть конкретный URL (например,
 * Mini App с параметром вроде ?tab=mine), а не вызвать action в самом боте.
 * Если MAX откроет ссылку не как встроенный Mini App, а как внешний
 * браузер — initData не будет, но приложение умеет входить по коду через
 * browserLoginGate, так что это не тупик, а лишний шаг.
 */
async function notifyMaxWithLink(user, text, buttonText, url) {
    if (!maxBotInstance)
        return false;
    try {
        await maxBotInstance.api.sendMessageToUser((0, userService_1.realMaxUserId)(user), text, {
            format: 'html',
            attachments: [max_bot_api_1.Keyboard.inlineKeyboard([[max_bot_api_1.Keyboard.button.link(buttonText, url)]])],
        });
        return true;
    }
    catch {
        return false;
    }
}
/** Отправляет пользователю MAX сообщение (при необходимости — с кнопками действий); молча игнорирует ошибки, аналогично notify() для Telegram. */
async function notifyMax(user, text, buttonRows, pin) {
    if (!maxBotInstance)
        return false;
    try {
        const msg = await maxBotInstance.api.sendMessageToUser((0, userService_1.realMaxUserId)(user), text, {
            format: 'html',
            ...(buttonRows
                ? { attachments: [max_bot_api_1.Keyboard.inlineKeyboard(buttonRows.map((row) => row.map((b) => max_bot_api_1.Keyboard.button.callback(b.text, b.action))))] }
                : {}),
        });
        if (pin && msg.recipient.chat_id != null) {
            try {
                await maxBotInstance.api.pinMessage(msg.recipient.chat_id, msg.body.mid, { notify: false });
            }
            catch {
                // необязательное дополнение к отправке — не роняем рассылку из-за этого
            }
        }
        return true;
    }
    catch {
        return false;
    }
}
