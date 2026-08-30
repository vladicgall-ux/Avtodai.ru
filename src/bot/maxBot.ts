import { Bot, Keyboard, ImageAttachment } from '@maxhub/max-bot-api';
import { config } from '../config';
import { upsertMaxUser, setPhoneVerified, setFullName, maxStorageId, getUser } from '../services/userService';
import { consumeLoginCode } from '../services/webSessionService';
import { setMaxBotInstance } from './maxNotifier';
import { notifyAdmins, notifyUser, notifyContractReady } from './notifier';
import { createSupportMessage } from '../services/supportService';
import { confirmBooking, declineBooking, getBookingWithPeople, BookingError } from '../services/bookingService';
import {
  confirmContactRequest,
  declineContactRequest,
  getContactRequestWithPeople,
  ContactRequestError,
} from '../services/contactRequestService';
import { displayName, platformLabel } from '../utils/displayName';
import { formatDate } from '../utils/dateFormat';
import { escapeBotHtml as esc } from '../utils/escapeBotHtml';
import { bannerPath } from './bot';

/** Тот же принцип, что и лимит поддержки в bot.ts — не даёт заваливать БД/админов текстом. */
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
 * Бот MAX — параллельно с Telegram-ботом, полностью опционален (не создаётся,
 * если MAX_BOT_TOKEN не задан). Умеет регистрацию, подтверждение телефона,
 * пересылку сообщений в поддержку и подтверждение/отклонение брони —
 * полноценное MAX Mini App использует тот же validateMaxInitData на бэкенде
 * (см. utils/maxAuth.ts).
 */
export function createMaxBot(): Bot {
  const bot = new Bot(config.maxBotToken!);
  setMaxBotInstance(bot);

  // Без этого необработанная ошибка в любом апдейте MAX уронит весь процесс
  // (включая уже работающий Telegram-бот) — таково поведение SDK по умолчанию.
  bot.catch((err) => {
    console.error('Ошибка в обработчике бота MAX:', err);
  });

  bot.on('bot_started', async (ctx) => {
    upsertMaxUser({ id: ctx.user.user_id, name: ctx.user.name, username: ctx.user.username });
    const greeting =
      `🚗 ${config.serviceName} — аренда авто от частных лиц по всей России\n\n` +
      'Здесь владельцы публикуют объявления о сдаче автомобиля в аренду, а арендаторы бронируют даты напрямую.\n\n' +
      'Чтобы бронировать или публиковать объявления — подтвердите номер телефона кнопкой ниже.';
    const contactKeyboard = Keyboard.inlineKeyboard([[Keyboard.button.requestContact('📱 Подтвердить номер телефона')]]);
    try {
      const image = await ctx.api.uploadImage({ source: bannerPath });
      await ctx.reply(greeting, {
        attachments: [
          new ImageAttachment('photos' in image ? { photos: image.photos } : { url: image.url }).toJson(),
          contactKeyboard,
        ],
      });
      return;
    } catch (err) {
      console.error('Не удалось отправить баннер в MAX:', err);
    }
    await ctx.reply(greeting, { attachments: [contactKeyboard] });
  });

  bot.on('message_created', async (ctx) => {
    const sender = ctx.message.sender;
    if (!sender) return;

    const contact = ctx.contactInfo;
    if (contact?.tel) {
      const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
      setPhoneVerified(user.telegram_id, contact.tel);
      if (contact.fullName) setFullName(user.telegram_id, contact.fullName);
      await ctx.reply('✅ Номер подтверждён! Теперь вам доступны бронирование и публикация объявлений.');
      return;
    }

    const text = ctx.message.body.text?.trim();
    if (!text) return;

    // Код для входа в браузерную (не Mini App) версию сайта — у MAX нет
    // публичного login-виджета для сторонних сайтов, поэтому пользователь
    // получает 6-значный код на сайте и присылает его сюда, боту.
    if (/^\d{6}$/.test(text)) {
      const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
      const linked = consumeLoginCode(text, user.telegram_id);
      await ctx.reply(
        linked
          ? '✅ Вход подтверждён! Вернитесь на сайт — он войдёт автоматически.'
          : 'Код не найден или уже устарел. Запросите новый код на сайте и попробуйте снова.'
      );
      return;
    }

    if (isSupportRateLimited(sender.user_id)) {
      await ctx.reply('⏳ Слишком много сообщений подряд. Подождите немного и напишите ещё раз.');
      return;
    }

    const user = upsertMaxUser({ id: sender.user_id, name: sender.name, username: sender.username });
    createSupportMessage(user.telegram_id, text.slice(0, 1000));
    await notifyAdmins(
      `🆘 <b>Сообщение в поддержку (MAX)</b>\nОт: ${esc(sender.name)}${sender.username ? ' · @' + esc(sender.username) : ''} (ID ${maxStorageId(sender.user_id)})\n\n${esc(text)}`
    );
    await ctx.reply('✅ Сообщение отправлено в поддержку. Мы ответим вам здесь, в этом чате.');
  });

  bot.action(/^confirm_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match![1]);
    const ownerId = maxStorageId(ctx.callback.user.user_id);
    try {
      confirmBooking(bookingId, ownerId);
      const info = getBookingWithPeople(bookingId)!;

      await ctx.answerOnCallback({ notification: 'Бронирование подтверждено!' });
      await ctx.editMessage({
        text:
          `✅ Вы подтвердили бронь.\n${esc(info.brand)} ${esc(info.model)}, ${formatDate(info.date_from)} — ${formatDate(info.date_to)}\n` +
          `Арендатор (${platformLabel(info.renter_platform)}): ${esc(displayName(info.renter_full_name, info.renter_first_name))}${info.renter_username ? ' (@' + esc(info.renter_username) + ')' : ''}\n` +
          `Телефон: ${info.renter_phone ? esc(info.renter_phone) : 'не указан'}\n` +
          `Сумма: ${info.total_price} ₽${info.deposit ? ` + залог ${info.deposit} ₽` : ''}`,
        format: 'html',
      });

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
      await ctx.answerOnCallback({ notification: message });
    }
  });

  bot.action(/^decline_booking:(\d+)$/, async (ctx) => {
    const bookingId = Number(ctx.match![1]);
    const ownerId = maxStorageId(ctx.callback.user.user_id);
    try {
      const info = getBookingWithPeople(bookingId)!;
      declineBooking(bookingId, ownerId);

      await ctx.answerOnCallback({ notification: 'Бронирование отклонено' });
      await ctx.editMessage({
        text: `❌ Вы отклонили бронь.\n${esc(info.brand)} ${esc(info.model)}, ${formatDate(info.date_from)} — ${formatDate(info.date_to)}\nАвтомобиль снова доступен на эти даты.`,
        format: 'html',
      });

      await notifyUser(
        getUser(info.renter_id)!,
        `❌ Владелец отклонил бронь на ${esc(info.brand)} ${esc(info.model)} (${formatDate(info.date_from)} — ${formatDate(info.date_to)}).\nПопробуйте найти другой автомобиль в приложении.`
      );
    } catch (err) {
      const message = err instanceof BookingError ? err.message : 'Не удалось отклонить бронирование';
      await ctx.answerOnCallback({ notification: message });
    }
  });

  bot.action(/^confirm_contact:(\d+)$/, async (ctx) => {
    const requestId = Number(ctx.match![1]);
    const ownerId = maxStorageId(ctx.callback.user.user_id);
    try {
      confirmContactRequest(requestId, ownerId);
      const info = getContactRequestWithPeople(requestId)!;

      await ctx.answerOnCallback({ notification: 'Контакты подтверждены!' });
      await ctx.editMessage({
        text:
          `✅ Вы подтвердили запрос на контакты.\n${esc(info.brand)} ${esc(info.model)} (${esc(info.city)})\n` +
          `Арендатор (${platformLabel(info.renter_platform)}): ${esc(displayName(info.renter_full_name, info.renter_first_name))}${info.renter_username ? ' (@' + esc(info.renter_username) + ')' : ''}\n` +
          `Телефон: ${info.renter_phone ? esc(info.renter_phone) : 'не указан'}`,
        format: 'html',
      });

      await notifyUser(
        getUser(info.renter_id)!,
        `✅ Владелец подтвердил запрос!\n${esc(info.brand)} ${esc(info.model)} (${esc(info.city)})\n` +
          `Владелец (${platformLabel(info.owner_platform)}): ${esc(displayName(info.owner_full_name, info.owner_first_name))}\nТелефон: ${info.owner_phone ? esc(info.owner_phone) : 'не указан'}`
      );
    } catch (err) {
      const message = err instanceof ContactRequestError ? err.message : 'Не удалось подтвердить запрос';
      await ctx.answerOnCallback({ notification: message });
    }
  });

  bot.action(/^decline_contact:(\d+)$/, async (ctx) => {
    const requestId = Number(ctx.match![1]);
    const ownerId = maxStorageId(ctx.callback.user.user_id);
    try {
      const info = getContactRequestWithPeople(requestId)!;
      declineContactRequest(requestId, ownerId);

      await ctx.answerOnCallback({ notification: 'Запрос отклонён' });
      await ctx.editMessage({
        text: `❌ Вы отклонили запрос на контакты по объявлению ${esc(info.brand)} ${esc(info.model)}.`,
        format: 'html',
      });

      await notifyUser(
        getUser(info.renter_id)!,
        `❌ Владелец отклонил запрос на контакты по объявлению ${esc(info.brand)} ${esc(info.model)}.`
      );
    } catch (err) {
      const message = err instanceof ContactRequestError ? err.message : 'Не удалось отклонить запрос';
      await ctx.answerOnCallback({ notification: message });
    }
  });

  return bot;
}
