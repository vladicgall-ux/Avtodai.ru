import { db } from '../db/db';
import { getBooking } from './bookingService';
import { getListing } from './carService';

export class RatingError extends Error {}

export interface OwnerRatingRecord {
  id: number;
  booking_id: number;
  owner_id: number;
  renter_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
}

/**
 * Арендатор оценивает владельца после того, как аренда фактически
 * завершилась (date_to в прошлом) и бронь была подтверждена владельцем.
 * Одна оценка на бронь — обеспечено UNIQUE-ограничением.
 */
export function createOwnerRating(input: {
  bookingId: number;
  renterId: number;
  rating: number;
  comment?: string;
}): OwnerRatingRecord {
  const booking = getBooking(input.bookingId);
  if (!booking || booking.renter_id !== input.renterId) {
    throw new RatingError('Бронирование не найдено');
  }
  if (booking.status !== 'confirmed' && booking.status !== 'completed') {
    throw new RatingError('У вас нет подтверждённой брони на эту аренду');
  }
  if (booking.date_to >= new Date().toISOString().slice(0, 10)) {
    throw new RatingError('Оценить аренду можно только после её завершения');
  }
  const listing = getListing(booking.listing_id)!;

  try {
    const info = db
      .prepare(
        `INSERT INTO owner_ratings (booking_id, owner_id, renter_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.bookingId, listing.owner_id, input.renterId, input.rating, input.comment ?? null);
    return db.prepare('SELECT * FROM owner_ratings WHERE id = ?').get(info.lastInsertRowid) as OwnerRatingRecord;
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      throw new RatingError('Вы уже оценили эту аренду');
    }
    throw err;
  }
}

export function getOwnerRatingSummary(ownerId: number): { avg: number | null; count: number } {
  const row = db
    .prepare(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM owner_ratings WHERE owner_id = ?`)
    .get(ownerId) as { avg: number | null; count: number };
  return { avg: row.avg !== null ? Math.round(row.avg * 10) / 10 : null, count: row.count };
}

export interface RenterRatingRecord {
  id: number;
  booking_id: number;
  owner_id: number;
  renter_id: number;
  rating: number;
  comment: string | null;
  created_at: string;
}

/** Владелец оценивает арендатора — зеркало createOwnerRating() в обратную сторону. */
export function createRenterRating(input: {
  bookingId: number;
  ownerId: number;
  rating: number;
  comment?: string;
}): RenterRatingRecord {
  const booking = getBooking(input.bookingId);
  if (!booking) {
    throw new RatingError('Бронирование не найдено');
  }
  const listing = getListing(booking.listing_id);
  if (!listing || listing.owner_id !== input.ownerId) {
    throw new RatingError('Это не ваш автомобиль');
  }
  if (booking.status !== 'confirmed' && booking.status !== 'completed') {
    throw new RatingError('У арендатора нет подтверждённой брони на эту аренду');
  }
  if (booking.date_to >= new Date().toISOString().slice(0, 10)) {
    throw new RatingError('Оценить арендатора можно только после завершения аренды');
  }

  try {
    const info = db
      .prepare(
        `INSERT INTO renter_ratings (booking_id, owner_id, renter_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(input.bookingId, input.ownerId, booking.renter_id, input.rating, input.comment ?? null);
    return db.prepare('SELECT * FROM renter_ratings WHERE id = ?').get(info.lastInsertRowid) as RenterRatingRecord;
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      throw new RatingError('Вы уже оценили этого арендатора за эту аренду');
    }
    throw err;
  }
}

export function getRenterRatingSummary(renterId: number): { avg: number | null; count: number } {
  const row = db
    .prepare(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM renter_ratings WHERE renter_id = ?`)
    .get(renterId) as { avg: number | null; count: number };
  return { avg: row.avg !== null ? Math.round(row.avg * 10) / 10 : null, count: row.count };
}
