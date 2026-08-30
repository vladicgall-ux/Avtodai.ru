import type { Telegraf } from 'telegraf';
import { Markup, Input } from 'telegraf';
import { config } from '../config';
import type { UserRecord } from '../services/userService';
import { notifyMax, notifyMaxWithLink } from './maxNotifier';

let botInstance: Telegraf | null = null;

export function setBotInstance(bot: Telegraf): void {
  botInstance = bot;
}

/** Юзернейм бота (для ссылки-приглашения) — становится известен после getMe() при запуске. */
export function getBotUsername(): string | null {
  return botInstance?.botInfo?.username ?? null;
}

export type NotifyButton =
  | { text: string; callback_data: string }
  | { text: string; url: string }
  // Обычная url-кнопка открывает страницу в обычном браузере Telegram —
  // initData там пустой, и наша авторизация не пройдёт. Кнопка с web_app
  // открывает именно Mini App, с рабочим initData.
  | { text: string; web_app: { url: string } };

/**
 * Кнопка действия, одинаковая для обеих платформ — просто текст и строка
 * action, которая долетает до обработчика (в Telegram это callback_data,
 * в MAX — payload). notifyUser сама превращает её в нужный платформе формат.
 */
export type ActionButton = { text: string; action: string };

/** Закрепляет сообщение в личном чате с пользователем; не роняет вызывающий код при ошибке — это необязательное дополнение к отправке. */
async function tryPin(chatId: number, messageId: number): Promise<void> {
  if (!botInstance) return;
  try {
    await botInstance.telegram.pinChatMessage(chatId, messageId, { disable_notification: true });
  } catch {
    // например, сообщение уже откреплено пользователем вручную — не критично
  }
}

/** Отправляет сообщение пользователю; молча игнорирует ошибки (например, если он ни разу не писал боту). */
export async function notify(
  telegramId: number,
  text: string,
  buttonRows?: NotifyButton[][],
  pin?: boolean
): Promise<boolean> {
  if (!botInstance) return false;
  try {
    const msg = await botInstance.telegram.sendMessage(telegramId, text, {
      parse_mode: 'HTML',
      ...(buttonRows ? Markup.inlineKeyboard(buttonRows) : {}),
    });
    if (pin) await tryPin(telegramId, msg.message_id);
    return true;
  } catch {
    // пользователь мог заблокировать бота — это не критично
    return false;
  }
}

/** Напоминание подтвердить телефон — с той же кнопкой "Поделиться номером", что и на /start. */
export async function notifyPhoneReminder(telegramId: number, text: string): Promise<boolean> {
  if (!botInstance) return false;
  try {
    await botInstance.telegram.sendMessage(telegramId, text, {
      parse_mode: 'HTML',
      ...Markup.keyboard([Markup.button.contactRequest('📱 Подтвердить номер телефона')])
        .resize()
        .oneTime(),
    });
    return true;
  } catch {
    return false;
  }
}

/** Отправляет пользователю фото с подписью; молча игнорирует ошибки (аналогично notify). */
export async function notifyPhoto(telegramId: number, photoPath: string, caption: string, pin?: boolean): Promise<boolean> {
  if (!botInstance) return false;
  try {
    const msg = await botInstance.telegram.sendPhoto(telegramId, Input.fromLocalFile(photoPath), {
      caption,
      parse_mode: 'HTML',
    });
    if (pin) await tryPin(telegramId, msg.message_id);
    return true;
  } catch {
    return false;
  }
}

/** Рассылает сообщение всем администраторам из ADMIN_IDS (например, обращение в поддержку). */
export async function notifyAdmins(text: string, buttonRows?: NotifyButton[][]): Promise<void> {
  await Promise.all(config.adminIds.map((id) => notify(id, text, buttonRows)));
}

/** Отправляет сообщение пользователю через того бота, в котором он зарегистрирован, включая кнопки действий. */
export async function notifyUser(
  user: UserRecord,
  text: string,
  buttonRows?: ActionButton[][],
  pin?: boolean
): Promise<boolean> {
  if (user.platform === 'max') return notifyMax(user, text, buttonRows, pin);
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
export async function notifyContractReady(user: UserRecord, bookingId: number): Promise<boolean> {
  if (!config.webappUrl) return false;
  const deepLink = `${config.webappUrl}?tab=bookings&contract=${bookingId}`;
  const text =
    '📄 Договор аренды и акт приёма-передачи готовы — в разделе «Мои брони» доступны два варианта: заполненный данными сторон и чистый бланк (на случай, если в профиле указано не настоящее имя — впишите верные данные от руки). Распечатайте или сохраните как PDF; часть полей (паспорт, ВУ, VIN, СТС) в любом варианте заполняется от руки при встрече.';
  if (user.platform === 'max') {
    return notifyMaxWithLink(user, text, '📄 Открыть договор', deepLink);
  }
  return notify(user.telegram_id, text, [[{ text: '📄 Открыть договор', web_app: { url: deepLink } }]]);
}
