import { db } from '../db/db';
import { getListing, isListingAvailable } from './carService';
import { rentalDays } from '../utils/dateFormat';
import type { Platform } from './userService';

export type BookingStatus = 'pending' | 'confirmed' | 'cancelled' | 'completed';

export interface BookingRecord {
  id: number;
  listing_id: number;
  renter_id: number;
  date_from: string;
  date_to: string;
  total_price: number;
  deposit: number;
  status: BookingStatus;
  cancellation_reason: string | null;
  cancelled_at: string | null;
  created_at: string;
}

export class BookingError extends Error {}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Создаёт бронь на автомобиль на указанный период. Обёрнуто в
 * db.transaction(): better-sqlite3 синхронный, поэтому проверка доступности
 * и вставка происходят без чужого запроса между ними (event loop
 * однопоточный, между шагами нет await), но транзакция всё равно нужна —
 * без неё ошибка на INSERT после прохождения всех проверок не откатила бы
 * ничего (тут не изменяется отдельный счётчик мест, как в rideService, но
 * паттерн сохранён для единообразия и на случай будущих побочных записей).
 */
export const createBooking = db.transaction(
  (input: { listingId: number; renterId: number; dateFrom: string; dateTo: string }): BookingRecord => {
    if (!DATE_RE.test(input.dateFrom) || !DATE_RE.test(input.dateTo) || input.dateTo < input.dateFrom) {
      throw new BookingError('Некорректный период аренды');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (input.dateFrom < today) {
      throw new BookingError('Дата начала аренды не может быть в прошлом');
    }

    const listing = getListing(input.listingId);
    if (!listing || listing.status !== 'active') {
      throw new BookingError('Объявление недоступно');
    }
    if (listing.owner_id === input.renterId) {
      throw new BookingError('Нельзя забронировать собственный автомобиль');
    }

    const days = rentalDays(input.dateFrom, input.dateTo);
    if (days < listing.min_rental_days) {
      throw new BookingError(`Минимальный срок аренды — ${listing.min_rental_days} дн.`);
    }

    if (!isListingAvailable(input.listingId, input.dateFrom, input.dateTo)) {
      throw new BookingError('Автомобиль занят на выбранные даты');
    }

    const totalPrice = days * listing.price_per_day;
    const info = db
      .prepare(
        `INSERT INTO bookings (listing_id, renter_id, date_from, date_to, total_price, deposit)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(input.listingId, input.renterId, input.dateFrom, input.dateTo, totalPrice, listing.deposit);
    return getBooking(Number(info.lastInsertRowid))!;
  }
);

export function getBooking(id: number): BookingRecord | undefined {
  return db.prepare('SELECT * FROM bookings WHERE id = ?').get(id) as BookingRecord | undefined;
}

/** Занятые (ожидающие подтверждения и подтверждённые) периоды по объявлению — для календаря доступности на карточке. */
export function getBookedRanges(listingId: number): { dateFrom: string; dateTo: string }[] {
  return (
    db
      .prepare(
        `SELECT date_from AS dateFrom, date_to AS dateTo FROM bookings
         WHERE listing_id = ? AND status IN ('pending','confirmed') AND date_to >= date('now')
         ORDER BY date_from`
      )
      .all(listingId) as { dateFrom: string; dateTo: string }[]
  );
}

export const cancelBooking = db.transaction((bookingId: number, renterId: number, reason?: string): BookingRecord => {
  const booking = db
    .prepare('SELECT * FROM bookings WHERE id = ? AND renter_id = ?')
    .get(bookingId, renterId) as BookingRecord | undefined;
  if (!booking || (booking.status !== 'confirmed' && booking.status !== 'pending')) {
    throw new BookingError('Бронирование не найдено');
  }
  db.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'), cancellation_reason = ? WHERE id = ?`
  ).run(reason ?? null, bookingId);
  return { ...booking, status: 'cancelled' };
});

/**
 * Владелец отменяет уже подтверждённую бронь — например, машина сломалась
 * или недоступна по другой причине. Только 'confirmed': отмена 'pending'
 * брони владельцем — это declineBooking (другая семантика для арендатора).
 */
export const cancelBookingByOwner = db.transaction((bookingId: number, ownerId: number, reason?: string): BookingRecord => {
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== 'confirmed') {
    throw new BookingError('Бронирование не найдено или уже обработано');
  }
  const listing = getListing(booking.listing_id);
  if (!listing || listing.owner_id !== ownerId) {
    throw new BookingError('Это не ваш автомобиль');
  }
  db.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'), cancellation_reason = ? WHERE id = ?`
  ).run(reason ?? null, bookingId);
  return { ...booking, status: 'cancelled' };
});

/** Владелец подтверждает бронь — только для своих объявлений и только из статуса 'pending'. */
export function confirmBooking(bookingId: number, ownerId: number): BookingRecord {
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== 'pending') {
    throw new BookingError('Бронирование уже обработано');
  }
  const listing = getListing(booking.listing_id);
  if (!listing || listing.owner_id !== ownerId) {
    throw new BookingError('Это не ваш автомобиль');
  }
  db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).run(bookingId);
  return { ...booking, status: 'confirmed' };
}

/** Владелец отклоняет бронь. */
export function declineBooking(bookingId: number, ownerId: number, reason?: string): BookingRecord {
  const booking = getBooking(bookingId);
  if (!booking || booking.status !== 'pending') {
    throw new BookingError('Бронирование уже обработано');
  }
  const listing = getListing(booking.listing_id);
  if (!listing || listing.owner_id !== ownerId) {
    throw new BookingError('Это не ваш автомобиль');
  }
  db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'), cancellation_reason = ? WHERE id = ?`).run(
    reason ?? null,
    bookingId
  );
  return { ...booking, status: 'cancelled' };
}

export interface BookingWithPeople extends BookingRecord {
  brand: string;
  model: string;
  year: number;
  city: string;
  price_per_day: number;
  owner_id: number;
  renter_first_name: string;
  renter_username: string | null;
  renter_full_name: string | null;
  renter_phone: string | null;
  renter_platform: Platform;
  owner_first_name: string;
  owner_username: string | null;
  owner_full_name: string | null;
  owner_phone: string | null;
  owner_platform: Platform;
}

/** Полный контекст брони (объявление + арендатор + владелец) для сообщений бота и договора. */
export function getBookingWithPeople(bookingId: number): BookingWithPeople | undefined {
  return db
    .prepare(
      `SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone, rnt.platform AS renter_platform,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name, own.phone AS owner_phone, own.platform AS owner_platform
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users rnt ON rnt.telegram_id = b.renter_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE b.id = ?`
    )
    .get(bookingId) as BookingWithPeople | undefined;
}

export function listBookingsByRenter(renterId: number, range?: { from: string; to: string }): BookingWithPeople[] {
  const clauses = ['b.renter_id = @renterId'];
  const params: Record<string, unknown> = { renterId };
  if (range) {
    clauses.push('b.date_from BETWEEN @from AND @to');
    params.from = range.from;
    params.to = range.to;
  }
  return db
    .prepare(
      `SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.date_from DESC`
    )
    .all(params) as BookingWithPeople[];
}

export function listBookingsByOwner(ownerId: number, range?: { from: string; to: string }): BookingWithPeople[] {
  const clauses = ['c.owner_id = @ownerId'];
  const params: Record<string, unknown> = { ownerId };
  if (range) {
    clauses.push('b.date_from BETWEEN @from AND @to');
    params.from = range.from;
    params.to = range.to;
  }
  return db
    .prepare(
      `SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users rnt ON rnt.telegram_id = b.renter_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.date_from DESC`
    )
    .all(params) as BookingWithPeople[];
}

export function listAllBookings(): BookingWithPeople[] {
  return db
    .prepare(
      `SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users rnt ON rnt.telegram_id = b.renter_id
       JOIN users own ON own.telegram_id = c.owner_id
       ORDER BY b.created_at DESC`
    )
    .all() as BookingWithPeople[];
}

/**
 * Автоматически подводит итог по броням, срок которых истёк, а стороны их
 * не отменили вручную: подтверждённые становятся «завершена», зависшие
 * неподтверждённые — «отменена».
 */
export const sweepExpiredBookings = db.transaction((): void => {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare(
    `UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now')
     WHERE status = 'pending' AND date_to < ?`
  ).run(today);
  db.prepare(
    `UPDATE bookings SET status = 'completed'
     WHERE status = 'confirmed' AND date_to < ?`
  ).run(today);
});
