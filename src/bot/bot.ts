import { Telegraf, Markup, Input } from 'telegraf';
import path from 'path';
import { config } from '../config';
import { upsertUser, setPhoneVerified, getUser } from '../services/userService';
import { setBotInstance, notifyUser, notifyAdmins, notifyContractReady, type NotifyButton } from './notifier';
import { confirmBooking, declineBooking, getBookingWithPeople, BookingError } from '../services/bookingService';
import {
  confirmContactRequest,
  declineContactRequest,
  getContactRequestWithPeople,
  ContactRequestError,
} from '../services/contactRequestService';
import { createSupportMessage } from '../services/supportService';
import { consumeLoginCode } from '../services/webSessionService';
import { displayName, platformLabel } from '../utils/displayName';
import { formatDate } from '../utils/dateFormat';
import { escapeBotHtml as esc } from '../utils/escapeBotHtml';

/**
 * Простой лимит на сообщения в поддержку через бота: без него любой
 * пользователь может слать текст бесконечно, заваливая БД и администраторов.
 * Храним в памяти процесса — этого достаточно для одного инстанса бота
 * (long polling, без масштабирования по репликам).
 */
// Экспортируется — maxBot.ts переиспользует тот же файл для приветствия в MAX,
// чтобы баннер не приходилось хранить/поддерживать в двух местах.
export const bannerPath = path.join(__dirname, '..', '..', 'public', 'assets', 'banner.jpg');

const SUPPORT_LIMIT = 5;
const SUPPORT_WINDOW_MS = 60_000;
const supportHits = new Map<number, number[]>();

function isSupportRateLimited(userId: number): boolean {
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
function dialogRows(text: string, username: string | null, platform: string): NotifyButton[][] | undefined {
  if (!username || platform !== 'telegram') return undefined;
  return [[{ text, url: `https://t.me/${username}` }]];
}

/** Кнопка открытия Mini App — только если известен публичный HTTPS-адрес. */
function appKeyboard() {
  if (!config.webappUrl) return undefined;
  return Markup.inlineKeyboard([Markup.button.webApp(`🚗 Открыть ${config.serviceName}`, config.webappUrl)]);
}

function replyOpenApp(ctx: { reply: (text: string, extra?: object) => unknown }) {
  const keyboard = appKeyboard();
  if (keyboard) {
    ctx.reply('Открыть приложение:', keyboard);
  } else {
    ctx.reply(
      'Приложение скоро будет доступно — сейчас настраивается публичный адрес. ' +
        `Загляните чуть позже, я пришлю кнопку «Открыть ${config.serviceName}».`
    );
  }
}

/** Кнопки на документы — только если известен публичный HTTPS-адрес (там же лежат сами страницы). */
function legalKeyboard() {
  if (!config.webappUrl) return undefined;
  return Markup.inlineKeyboard([
    [Markup.button.url('📄 Пользовательское соглашение', `${config.webappUrl}/legal/oferta.html`)],
    [Markup.button.url('🔒 Обработка персональных данных', `${config.webappUrl}/legal/privacy.html`)],
  ]);
}

export function createBot(): Telegraf {
  const bot = new Telegraf(config.botToken);
  setBotInstance(bot);

  if (!config.webappUrl) {
    console.warn(
      'WEBAPP_URL не задан (или не начинается с https://) — бот запущен без кнопки Mini App. ' +
        'Узнайте публичный домен у вашего хостинга и пропишите его в WEBAPP_URL.'
    );
  } else {
    // Кнопка меню слева от поля ввода — открывает Mini App без команды /start.
    bot.telegram
      .setChatMenuButton({
        menuButton: { type: 'web_app', text: config.serviceName, web_app: { url: config.webappUrl } },
      })
      .catch((err) => console.error('Не удалось установить кнопку меню:', err));
  }

  bot.start((ctx) => {
    upsertUser({
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
    });

    ctx
      .replyWithPhoto(Input.fromLocalFile(bannerPath), {
        caption:
          `🚗 <b>${config.serviceName}</b> — аренда авто от частных лиц по всей России\n\n` +
          'Здесь владельцы публикуют объявления о сдаче автомобиля в аренду, а арендаторы бронируют даты напрямую, без прокатных компаний и посредников.\n\n' +
          'Чтобы бронировать или публиковать объявления — сначала подтвердите номер телефона кнопкой ниже. ' +
          'Это нужно, чтобы в приложении не было фейковых объявлений.',
        parse_mode: 'HTML',
        ...Markup.keyboard([Markup.button.contactRequest('📱 Подтвердить номер телефона')])
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
    upsertUser({
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
    });
    setPhoneVerified(ctx.from.id, contact.phone_number);
    ctx.reply(
      '✅ Номер подтверждён! Теперь вам доступны бронирование и публикация объявлений.',
      Markup.removeKeyboard()
    );

    const legal = legalKeyboard();
    if (legal) {
      ctx.reply('Продолжая пользоваться сервисом, вы принимаете условия:', legal);
    }

    replyOpenApp(ctx);
  });

  bot.command('whoami', (ctx) => {
    const user = getUser(ctx.from.id);
    if (!user) {
      ctx.reply('Сначала напишите /start');
      return;
    }
    ctx.reply(
      `ID: ${user.telegram_id}\nИмя: ${user.first_name}\nТелефон подтверждён: ${
        user.phone_verified ? 'да' : 'нет'
      }`
    );
  });

  bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match[1]);
    try {
      confirmBooking(bookingId, ctx.from.id);
      const info = getBookingWithPeople(bookingId)!;

      const renterButtons = dialogRows('💬 Написать арендатору', info.renter_username, info.renter_platform);
      await ctx.answerCbQuery('Бронирование подтверждено!');
      await ctx.editMessageText(
        `✅ Вы подтвердили бронь.\n${esc(info.brand)} ${esc(info.model)}, ${formatDate(info.date_from)} — ${formatDate(info.date_to)}\n` +
          `Арендатор (${platformLabel(info.renter_platform)}): ${esc(displayName(info.renter_full_name, info.renter_first_name))}${info.renter_username ? ' (@' + esc(info.renter_username) + ')' : ''}\n` +
          `Телефон: ${info.renter_phone ? esc(info.renter_phone) : 'не указан'}\n` +
          `Сумма: ${info.total_price} ₽${info.deposit ? ` + залог ${info.deposit} ₽` : ''}`,
        {
          parse_mode: 'HTML',
          ...(renterButtons ? Markup.inlineKeyboard(renterButtons) : {}),
        }
      );

      const renterUser = getUser(info.renter_id)!;
      await notifyUser(
        renterUser,
        `✅ Владелец подтвердил бронь!\n${esc(info.brand)} ${esc(info.model)}, ${formatDate(info.date_from)} — ${formatDate(info.date_to)}\n` +
          `Владелец (${platformLabel(info.owner_platform)}): ${esc(displayName(info.owner_full_name, info.owner_first_name))}\nТелефон: ${info.owner_phone ? esc(info.owner_phone) : 'не указан'}\nСумма: ${info.total_price} ₽`
      );
      await notifyContractReady(renterUser, bookingId);
      const ownerUser = getUser(info.owner_id)!;
      await notifyContractReady(ownerUser, bookingId);
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось подтвердить бронирование';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  });

  bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match[1]);
    try {
      const info = getBookingWithPeople(bookingId)!;
      declineBooking(bookingId, ctx.from.id);

      await ctx.answerCbQuery('Бронирование отклонено');
      await ctx.editMessageText(
        `❌ Вы отклонили бронь.\n${esc(info.brand)} ${esc(info.model)}, ${formatDate(info.date_from)} — ${formatDate(info.date_to)}\nАвтомобиль снова доступен на эти даты.`
      );

      await notifyUser(
        getUser(info.renter_id)!,
        `❌ Владелец отклонил бронь на ${esc(info.brand)} ${esc(info.model)} (${formatDate(info.date_from)} — ${formatDate(info.date_to)}).\nПопробуйте найти другой автомобиль в приложении.`
      );
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось отклонить бронирование';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  });

  bot.action(/^confirm_contact:(\d+)$/, async (ctx) => {
    const requestId = Number(ctx.match[1]);
    try {
      confirmContactRequest(requestId, ctx.from.id);
      const info = getContactRequestWithPeople(requestId)!;

      const renterButtons = dialogRows('💬 Написать арендатору', info.renter_username, info.renter_platform);
      await ctx.answerCbQuery('Контакты подтверждены!');
      await ctx.editMessageText(
        `✅ Вы подтвердили запрос на контакты.\n${esc(info.brand)} ${esc(info.model)} (${esc(info.city)})\n` +
          `Арендатор (${platformLabel(info.renter_platform)}): ${esc(displayName(info.renter_full_name, info.renter_first_name))}${info.renter_username ? ' (@' + esc(info.renter_username) + ')' : ''}\n` +
          `Телефон: ${info.renter_phone ? esc(info.renter_phone) : 'не указан'}`,
        {
          parse_mode: 'HTML',
          ...(renterButtons ? Markup.inlineKeyboard(renterButtons) : {}),
        }
      );

      await notifyUser(
        getUser(info.renter_id)!,
        `✅ Владелец подтвердил запрос!\n${esc(info.brand)} ${esc(info.model)} (${esc(info.city)})\n` +
          `Владелец (${platformLabel(info.owner_platform)}): ${esc(displayName(info.owner_full_name, info.owner_first_name))}\nТелефон: ${info.owner_phone ? esc(info.owner_phone) : 'не указан'}`
      );
    } catch (err) {
      const message = err instanceof ContactRequestError ? err.message : 'Не удалось подтвердить запрос';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  });

  bot.action(/^decline_contact:(\d+)$/, async (ctx) => {
    const requestId = Number(ctx.match[1]);
    try {
      const info = getContactRequestWithPeople(requestId)!;
      declineContactRequest(requestId, ctx.from.id);

      await ctx.answerCbQuery('Запрос отклонён');
      await ctx.editMessageText(`❌ Вы отклонили запрос на контакты по объявлению ${esc(info.brand)} ${esc(info.model)}.`);

      await notifyUser(
        getUser(info.renter_id)!,
        `❌ Владелец отклонил запрос на контакты по объявлению ${esc(info.brand)} ${esc(info.model)}.`
      );
    } catch (err) {
      const message = err instanceof ContactRequestError ? err.message : 'Не удалось отклонить запрос';
      await ctx.answerCbQuery(message, { show_alert: true });
    }
  });

  // Ловим любой обычный текст, не обработанный выше (команды и контакт
  // перехватываются раньше и сюда не попадают) — это и есть «Поддержка»:
  // всё, что пишут боту, долетает администратору и сохраняется в БД.
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    if (!text) return;

    // Код для входа в браузерную (не Mini App) версию сайта — у Telegram
    // (как и у MAX) нет рабочего публичного login-виджета для сторонних
    // сайтов, поэтому пользователь получает 6-значный код на сайте и
    // присылает его сюда, боту.
    if (/^\d{6}$/.test(text)) {
      upsertUser({
        id: ctx.from.id,
        first_name: ctx.from.first_name,
        last_name: ctx.from.last_name,
        username: ctx.from.username,
      });
      const linked = consumeLoginCode(text, ctx.from.id);
      ctx.reply(
        linked
          ? '✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.'
          : 'Код не найден или уже устарел. Запросите новый код на сайте и попробуйте снова.'
      );
      return;
    }

    if (config.adminIds.includes(ctx.from.id)) return; // не шлём админу его же сообщения

    if (isSupportRateLimited(ctx.from.id)) {
      ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
      return;
    }

    upsertUser({
      id: ctx.from.id,
      first_name: ctx.from.first_name,
      last_name: ctx.from.last_name,
      username: ctx.from.username,
    });
    createSupportMessage(ctx.from.id, text.slice(0, 1000));

    const user = getUser(ctx.from.id);
    const senderName = [
      displayName(user?.full_name, ctx.from.first_name),
      ctx.from.username ? `@${ctx.from.username}` : null,
    ]
      .filter(Boolean)
      .join(' ');
    await notifyAdmins(
      `🆘 <b>Сообщение в поддержку</b>\nОт: ${esc(senderName)} (ID ${ctx.from.id})${user?.phone ? `, ${esc(user.phone)}` : ''}\n\n${esc(text)}`,
      dialogRows('💬 Написать в ответ', ctx.from.username ?? null, 'telegram')
    );

    ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
  });

  bot.catch((err) => {
    console.error('Ошибка в обработчике бота:', err);
  });

  return bot;
}
