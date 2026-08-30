"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bannerPath = void 0;
exports.createBot = createBot;
const telegraf_1 = require("telegraf");
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const userService_1 = require("../services/userService");
const notifier_1 = require("./notifier");
const bookingService_1 = require("../services/bookingService");
const contactRequestService_1 = require("../services/contactRequestService");
const supportService_1 = require("../services/supportService");
const webSessionService_1 = require("../services/webSessionService");
const displayName_1 = require("../utils/displayName");
const dateFormat_1 = require("../utils/dateFormat");
/**
 * Простой лимит на сообщения в поддержку через бота: без него любой
 * пользователь может слать текст бесконечно, заваливая БД и администраторов.
 * Храним в памяти процесса — этого достаточно для одного инстанса бота
 * (long polling, без масштабирования по репликам).
 */
// Экспортируется — maxBot.ts переиспользует тот же файл для приветствия в MAX,
// чтобы баннер не приходилось хранить/поддерживать в двух местах.
exports.bannerPath = path_1.default.join(__dirname, '..', '..', 'public', 'assets', 'banner.jpg');
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
 * Ряд с кнопкой, открывающей личный чат с собеседником — только если у
 * него есть username И он тоже в Telegram: ссылка t.me/username не имеет
 * смысла для пользователя MAX (это два разных пространства ников). Если
 * собеседник из другой платформы, показываем только имя и телефон (уже
 * есть в тексте сообщения), без кнопки диалога.
 */
function dialogRows(text, username, platform) {
    if (!username || platform !== 'telegram')
        return undefined;
    return [[{ text, url: `https://t.me/${username}` }]];
}
/** Кнопка открытия Mini App — только если известен публичный HTTPS-адрес. */
function appKeyboard() {
    if (!config_1.config.webappUrl)
        return undefined;
    return telegraf_1.Markup.inlineKeyboard([telegraf_1.Markup.button.webApp(`🚗 Открыть ${config_1.config.serviceName}`, config_1.config.webappUrl)]);
}
function replyOpenApp(ctx) {
    const keyboard = appKeyboard();
    if (keyboard) {
        ctx.reply('Открыть приложение:', keyboard);
    }
    else {
        ctx.reply('Приложение скоро будет доступно — сейчас настраивается публичный адрес. ' +
            `Загляните чуть позже, я пришлю кнопку «Открыть ${config_1.config.serviceName}».`);
    }
}
/** Кнопки на документы — только если известен публичный HTTPS-адрес (там же лежат сами страницы). */
function legalKeyboard() {
    if (!config_1.config.webappUrl)
        return undefined;
    return telegraf_1.Markup.inlineKeyboard([
        [telegraf_1.Markup.button.url('📄 Пользовательское соглашение', `${config_1.config.webappUrl}/legal/oferta.html`)],
        [telegraf_1.Markup.button.url('🔒 Обработка персональных данных', `${config_1.config.webappUrl}/legal/privacy.html`)],
    ]);
}
function createBot() {
    const bot = new telegraf_1.Telegraf(config_1.config.botToken);
    (0, notifier_1.setBotInstance)(bot);
    if (!config_1.config.webappUrl) {
        console.warn('WEBAPP_URL не задан (или не начинается с https://) — бот запущен без кнопки Mini App. ' +
            'Узнайте публичный домен у вашего хостинга и пропишите его в WEBAPP_URL.');
    }
    else {
        // Кнопка меню слева от поля ввода — открывает Mini App без команды /start.
        bot.telegram
            .setChatMenuButton({
            menuButton: { type: 'web_app', text: config_1.config.serviceName, web_app: { url: config_1.config.webappUrl } },
        })
            .catch((err) => console.error('Не удалось установить кнопку меню:', err));
    }
    bot.start((ctx) => {
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        ctx
            .replyWithPhoto(telegraf_1.Input.fromLocalFile(exports.bannerPath), {
            caption: `🚗 <b>${config_1.config.serviceName}</b> — аренда авто от частных лиц по всей России\n\n` +
                'Здесь владельцы публикуют объявления о сдаче автомобиля в аренду, а арендаторы бронируют даты напрямую, без прокатных компаний и посредников.\n\n' +
                'Чтобы бронировать или публиковать объявления — сначала подтвердите номер телефона кнопкой ниже. ' +
                'Это нужно, чтобы в приложении не было фейковых объявлений.',
            parse_mode: 'HTML',
            ...telegraf_1.Markup.keyboard([telegraf_1.Markup.button.contactRequest('📱 Подтвердить номер телефона')])
                .resize()
                .oneTime(),
        })
            .catch((err) => console.error('Не удалось отправить баннер в Telegram:', err));
        replyOpenApp(ctx);
    });
    bot.command('app', (ctx) => {
        replyOpenApp(ctx);
    });
    // Подтверждение номера телефона: Telegram гарантирует, что контакт,
    // отправленный через кнопку request_contact, принадлежит самому пользователю —
    // это и есть защита от фейковых объявлений.
    bot.on('contact', (ctx) => {
        const contact = ctx.message.contact;
        if (contact.user_id !== ctx.from.id) {
            ctx.reply('Пожалуйста, отправьте свой собственный номер телефона.');
            return;
        }
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        (0, userService_1.setPhoneVerified)(ctx.from.id, contact.phone_number);
        ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация объявлений.', telegraf_1.Markup.removeKeyboard());
        const legal = legalKeyboard();
        if (legal) {
            ctx.reply('Продолжая пользоваться сервисом, вы принимаете условия:', legal);
        }
        replyOpenApp(ctx);
    });
    bot.command('whoami', (ctx) => {
        const user = (0, userService_1.getUser)(ctx.from.id);
        if (!user) {
            ctx.reply('Сначала напишите /start');
            return;
        }
        ctx.reply(`ID: ${user.telegram_id}\nИмя: ${user.first_name}\nТелефон подтверждён: ${user.phone_verified ? 'да' : 'нет'}`);
    });
    bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
        const bookingId = Number(ctx.match[1]);
        try {
            (0, bookingService_1.confirmBooking)(bookingId, ctx.from.id);
            const info = (0, bookingService_1.getBookingWithPeople)(bookingId);
            const renterButtons = dialogRows('💬 Написать арендатору', info.renter_username, info.renter_platform);
            await ctx.answerCbQuery('Бронирование подтверждено!');
            await ctx.editMessageText(`✅ Вы подтвердили бронь.\n${info.brand} ${info.model}, ${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}\n` +
                `Арендатор (${(0, displayName_1.platformLabel)(info.renter_platform)}): ${(0, displayName_1.displayName)(info.renter_full_name, info.renter_first_name)}${info.renter_username ? ' (@' + info.renter_username + ')' : ''}\n` +
                `Телефон: ${info.renter_phone ?? 'не указан'}\n` +
                `Сумма: ${info.total_price} ₽${info.deposit ? ` + залог ${info.deposit} ₽` : ''}`, {
                parse_mode: 'HTML',
                ...(renterButtons ? telegraf_1.Markup.inlineKeyboard(renterButtons) : {}),
            });
            const renterUser = (0, userService_1.getUser)(info.renter_id);
            await (0, notifier_1.notifyUser)(renterUser, `✅ Владелец подтвердил бронь!\n${info.brand} ${info.model}, ${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}\n` +
                `Владелец (${(0, displayName_1.platformLabel)(info.owner_platform)}): ${(0, displayName_1.displayName)(info.owner_full_name, info.owner_first_name)}\nТелефон: ${info.owner_phone ?? 'не указан'}\nСумма: ${info.total_price} ₽`);
            await (0, notifier_1.notifyContractReady)(renterUser, bookingId);
            const ownerUser = (0, userService_1.getUser)(info.owner_id);
            await (0, notifier_1.notifyContractReady)(ownerUser, bookingId);
        }
        catch (err) {
            const message = err instanceof bookingService_1.BookingError ? err.message : 'Не удалось подтвердить бронирование';
            await ctx.answerCbQuery(message, { show_alert: true });
        }
    });
    bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
        const bookingId = Number(ctx.match[1]);
        try {
            const info = (0, bookingService_1.getBookingWithPeople)(bookingId);
            (0, bookingService_1.declineBooking)(bookingId, ctx.from.id);
            await ctx.answerCbQuery('Бронирование отклонено');
            await ctx.editMessageText(`❌ Вы отклонили бронь.\n${info.brand} ${info.model}, ${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}\nАвтомобиль снова доступен на эти даты.`);
            await (0, notifier_1.notifyUser)((0, userService_1.getUser)(info.renter_id), `❌ Владелец отклонил бронь на ${info.brand} ${info.model} (${(0, dateFormat_1.formatDate)(info.date_from)} — ${(0, dateFormat_1.formatDate)(info.date_to)}).\nПопробуйте найти другой автомобиль в приложении.`);
        }
        catch (err) {
            const message = err instanceof bookingService_1.BookingError ? err.message : 'Не удалось отклонить бронирование';
            await ctx.answerCbQuery(message, { show_alert: true });
        }
    });
    bot.action(/^confirm_contact:(\d+)$/, async (ctx) => {
        const requestId = Number(ctx.match[1]);
        try {
            (0, contactRequestService_1.confirmContactRequest)(requestId, ctx.from.id);
            const info = (0, contactRequestService_1.getContactRequestWithPeople)(requestId);
            const renterButtons = dialogRows('💬 Написать арендатору', info.renter_username, info.renter_platform);
            await ctx.answerCbQuery('Контакты подтверждены!');
            await ctx.editMessageText(`✅ Вы подтвердили запрос на контакты.\n${info.brand} ${info.model} (${info.city})\n` +
                `Арендатор (${(0, displayName_1.platformLabel)(info.renter_platform)}): ${(0, displayName_1.displayName)(info.renter_full_name, info.renter_first_name)}${info.renter_username ? ' (@' + info.renter_username + ')' : ''}\n` +
                `Телефон: ${info.renter_phone ?? 'не указан'}`, {
                parse_mode: 'HTML',
                ...(renterButtons ? telegraf_1.Markup.inlineKeyboard(renterButtons) : {}),
            });
            await (0, notifier_1.notifyUser)((0, userService_1.getUser)(info.renter_id), `✅ Владелец подтвердил запрос!\n${info.brand} ${info.model} (${info.city})\n` +
                `Владелец (${(0, displayName_1.platformLabel)(info.owner_platform)}): ${(0, displayName_1.displayName)(info.owner_full_name, info.owner_first_name)}\nТелефон: ${info.owner_phone ?? 'не указан'}`);
        }
        catch (err) {
            const message = err instanceof contactRequestService_1.ContactRequestError ? err.message : 'Не удалось подтвердить запрос';
            await ctx.answerCbQuery(message, { show_alert: true });
        }
    });
    bot.action(/^decline_contact:(\d+)$/, async (ctx) => {
        const requestId = Number(ctx.match[1]);
        try {
            const info = (0, contactRequestService_1.getContactRequestWithPeople)(requestId);
            (0, contactRequestService_1.declineContactRequest)(requestId, ctx.from.id);
            await ctx.answerCbQuery('Запрос отклонён');
            await ctx.editMessageText(`❌ Вы отклонили запрос на контакты по объявлению ${info.brand} ${info.model}.`);
            await (0, notifier_1.notifyUser)((0, userService_1.getUser)(info.renter_id), `❌ Владелец отклонил запрос на контакты по объявлению ${info.brand} ${info.model}.`);
        }
        catch (err) {
            const message = err instanceof contactRequestService_1.ContactRequestError ? err.message : 'Не удалось отклонить запрос';
            await ctx.answerCbQuery(message, { show_alert: true });
        }
    });
    // Ловим любой обычный текст, не обработанный выше (команды и контакт
    // перехватываются раньше и сюда не попадают) — это и есть «Поддержка»:
    // всё, что пишут боту, долетает администратору и сохраняется в БД.
    bot.on('text', async (ctx) => {
        const text = ctx.message.text.trim();
        if (!text)
            return;
        // Код для входа в браузерную (не Mini App) версию сайта — у Telegram
        // (как и у MAX) нет рабочего публичного login-виджета для сторонних
        // сайтов, поэтому пользователь получает 6-значный код на сайте и
        // присылает его сюда, боту.
        if (/^\d{6}$/.test(text)) {
            (0, userService_1.upsertUser)({
                id: ctx.from.id,
                first_name: ctx.from.first_name,
                last_name: ctx.from.last_name,
                username: ctx.from.username,
            });
            const linked = (0, webSessionService_1.consumeLoginCode)(text, ctx.from.id);
            ctx.reply(linked
                ? '✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.'
                : 'Код не найден или уже устарел. Запросите новый код на сайте и попробуйте снова.');
            return;
        }
        if (config_1.config.adminIds.includes(ctx.from.id))
            return; // не шлём админу его же сообщения
        if (isSupportRateLimited(ctx.from.id)) {
            ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
            return;
        }
        (0, userService_1.upsertUser)({
            id: ctx.from.id,
            first_name: ctx.from.first_name,
            last_name: ctx.from.last_name,
            username: ctx.from.username,
        });
        (0, supportService_1.createSupportMessage)(ctx.from.id, text.slice(0, 1000));
        const user = (0, userService_1.getUser)(ctx.from.id);
        const senderName = [
            (0, displayName_1.displayName)(user?.full_name, ctx.from.first_name),
            ctx.from.username ? `@${ctx.from.username}` : null,
        ]
            .filter(Boolean)
            .join(' ');
        await (0, notifier_1.notifyAdmins)(`🆘 <b>Сообщение в поддержку</b>\nОт: ${senderName} (ID ${ctx.from.id})${user?.phone ? `, ${user.phone}` : ''}\n\n${text}`, dialogRows('💬 Написать в ответ', ctx.from.username ?? null, 'telegram'));
        ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
    });
    bot.catch((err) => {
        console.error('Ошибка в обработчике бота:', err);
    });
    return bot;
}
