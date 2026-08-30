import { db } from '../db/db';
import { config } from '../config';
import { notify, notifyUser, notifyPhoneReminder, type NotifyButton } from '../bot/notifier';
import { notifyMaxWithLink, notifyMaxPhoneReminder } from '../bot/maxNotifier';
import { getUser, listUsersDueForPhoneReminder, markPhoneReminderSent } from '../services/userService';
import { displayName } from '../utils/displayName';

interface RatingReminderRow {
  id: number;
  renter_id: number;
  brand: string;
  model: string;
  owner_first_name: string;
  owner_full_name: string | null;
}

/** Подтверждённые/завершённые брони, срок которых истёк, ещё не оценены арендатором и по которым напоминание ещё не отправлялось. */
function listBookingsDueForRatingReminder(): RatingReminderRow[] {
  return db
    .prepare(
      `SELECT b.id, b.renter_id, c.brand, c.model, own.first_name AS owner_first_name, own.full_name AS owner_full_name
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE b.status IN ('confirmed','completed')
         AND b.reminder_sent = 0
         AND date(b.date_to) < date('now')
         AND NOT EXISTS (SELECT 1 FROM owner_ratings r WHERE r.booking_id = b.id)`
    )
    .all() as RatingReminderRow[];
}

function markRatingReminderSent(bookingId: number): void {
  db.prepare(`UPDATE bookings SET reminder_sent = 1 WHERE id = ?`).run(bookingId);
}

/**
 * После завершения аренды просит арендатора оценить владельца — если бронь
 * была подтверждена и оценки ещё нет. Отмечает бронь как «напоминание
 * отправлено» сразу после отправки, чтобы не слать повторно на каждом тике.
 *
 * Кнопка «Оценить аренду» ведёт на ?tab=mine — app.js при загрузке читает
 * этот параметр и сразу открывает «Мои брони», а не стартовый экран поиска.
 * В Telegram это web_app-кнопка (гарантированно открывает именно Mini App с
 * initData). В MAX — обычная ссылка: если MAX откроет её не как встроенный
 * Mini App, а как внешний браузер, initData не будет, но приложение умеет
 * входить по коду через browserLoginGate — это лишний шаг, а не тупик.
 */
export async function sendRatingReminders(): Promise<void> {
  const due = listBookingsDueForRatingReminder();
  for (const b of due) {
    const renter = getUser(b.renter_id);
    if (renter) {
      const text = `🌟 Как прошла аренда ${b.brand} ${b.model} у владельца ${displayName(b.owner_full_name, b.owner_first_name)}?\nОцените аренду в приложении — это поможет другим арендаторам.`;
      const deepLink = config.webappUrl ? `${config.webappUrl}?tab=mine` : undefined;
      if (renter.platform === 'telegram') {
        const buttons: NotifyButton[][] | undefined = deepLink
          ? [[{ text: '⭐ Оценить аренду', web_app: { url: deepLink } }]]
          : undefined;
        await notify(renter.telegram_id, text, buttons);
      } else if (deepLink) {
        await notifyMaxWithLink(renter, text, '⭐ Оценить аренду', deepLink);
      } else {
        await notifyUser(renter, text);
      }
    }
    markRatingReminderSent(b.id);
  }
}

/**
 * Раз в 6 часов напоминает подтвердить номер телефона тем, кто
 * зарегистрировался (написал боту), но так и не поделился контактом — с той
 * же кнопкой, что была на /start. Продолжается, пока пользователь не
 * подтвердит номер, не будет заблокирован администратором или не перестанет
 * получать сообщения (заблокирует бота — тогда notify просто вернёт false,
 * без ошибки).
 */
export async function sendPhoneVerificationReminders(): Promise<void> {
  const due = listUsersDueForPhoneReminder();
  const text =
    'Напоминаем: чтобы бронировать автомобили или публиковать свои объявления, нужно подтвердить номер телефона кнопкой ниже.';
  for (const user of due) {
    if (user.platform === 'telegram') {
      await notifyPhoneReminder(user.telegram_id, text);
    } else {
      await notifyMaxPhoneReminder(user, text);
    }
    markPhoneReminderSent(user.telegram_id);
  }
}
