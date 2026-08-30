"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RatingError = void 0;
exports.createOwnerRating = createOwnerRating;
exports.getOwnerRatingSummary = getOwnerRatingSummary;
exports.createRenterRating = createRenterRating;
exports.getRenterRatingSummary = getRenterRatingSummary;
const db_1 = require("../db/db");
const bookingService_1 = require("./bookingService");
const carService_1 = require("./carService");
class RatingError extends Error {
}
exports.RatingError = RatingError;
/**
 * Арендатор оценивает владельца после того, как аренда фактически
 * завершилась (date_to в прошлом) и бронь была подтверждена владельцем.
 * Одна оценка на бронь — обеспечено UNIQUE-ограничением.
 */
function createOwnerRating(input) {
    const booking = (0, bookingService_1.getBooking)(input.bookingId);
    if (!booking || booking.renter_id !== input.renterId) {
        throw new RatingError('Бронирование не найдено');
    }
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
        throw new RatingError('У вас нет подтверждённой брони на эту аренду');
    }
    if (booking.date_to >= new Date().toISOString().slice(0, 10)) {
        throw new RatingError('Оценить аренду можно только после её завершения');
    }
    const listing = (0, carService_1.getListing)(booking.listing_id);
    try {
        const info = db_1.db
            .prepare(`INSERT INTO owner_ratings (booking_id, owner_id, renter_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`)
            .run(input.bookingId, listing.owner_id, input.renterId, input.rating, input.comment ?? null);
        return db_1.db.prepare('SELECT * FROM owner_ratings WHERE id = ?').get(info.lastInsertRowid);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            throw new RatingError('Вы уже оценили эту аренду');
        }
        throw err;
    }
}
function getOwnerRatingSummary(ownerId) {
    const row = db_1.db
        .prepare(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM owner_ratings WHERE owner_id = ?`)
        .get(ownerId);
    return { avg: row.avg !== null ? Math.round(row.avg * 10) / 10 : null, count: row.count };
}
/** Владелец оценивает арендатора — зеркало createOwnerRating() в обратную сторону. */
function createRenterRating(input) {
    const booking = (0, bookingService_1.getBooking)(input.bookingId);
    if (!booking) {
        throw new RatingError('Бронирование не найдено');
    }
    const listing = (0, carService_1.getListing)(booking.listing_id);
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
        const info = db_1.db
            .prepare(`INSERT INTO renter_ratings (booking_id, owner_id, renter_id, rating, comment)
         VALUES (?, ?, ?, ?, ?)`)
            .run(input.bookingId, input.ownerId, booking.renter_id, input.rating, input.comment ?? null);
        return db_1.db.prepare('SELECT * FROM renter_ratings WHERE id = ?').get(info.lastInsertRowid);
    }
    catch (err) {
        if (err instanceof Error && err.message.includes('UNIQUE')) {
            throw new RatingError('Вы уже оценили этого арендатора за эту аренду');
        }
        throw err;
    }
}
function getRenterRatingSummary(renterId) {
    const row = db_1.db
        .prepare(`SELECT AVG(rating) AS avg, COUNT(*) AS count FROM renter_ratings WHERE renter_id = ?`)
        .get(renterId);
    return { avg: row.avg !== null ? Math.round(row.avg * 10) / 10 : null, count: row.count };
}
