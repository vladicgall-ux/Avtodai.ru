"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.sweepExpiredBookings = exports.cancelBooking = exports.createBooking = exports.BookingError = void 0;
exports.getBooking = getBooking;
exports.confirmBooking = confirmBooking;
exports.declineBooking = declineBooking;
exports.getBookingWithPeople = getBookingWithPeople;
exports.listBookingsByRenter = listBookingsByRenter;
exports.listBookingsByOwner = listBookingsByOwner;
exports.listAllBookings = listAllBookings;
const db_1 = require("../db/db");
const carService_1 = require("./carService");
const dateFormat_1 = require("../utils/dateFormat");
class BookingError extends Error {
}
exports.BookingError = BookingError;
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
exports.createBooking = db_1.db.transaction((input) => {
    if (!DATE_RE.test(input.dateFrom) || !DATE_RE.test(input.dateTo) || input.dateTo < input.dateFrom) {
        throw new BookingError('Некорректный период аренды');
    }
    const today = new Date().toISOString().slice(0, 10);
    if (input.dateFrom < today) {
        throw new BookingError('Дата начала аренды не может быть в прошлом');
    }
    const listing = (0, carService_1.getListing)(input.listingId);
    if (!listing || listing.status !== 'active') {
        throw new BookingError('Объявление недоступно');
    }
    if (listing.owner_id === input.renterId) {
        throw new BookingError('Нельзя забронировать собственный автомобиль');
    }
    const days = (0, dateFormat_1.rentalDays)(input.dateFrom, input.dateTo);
    if (days < listing.min_rental_days) {
        throw new BookingError(`Минимальный срок аренды — ${listing.min_rental_days} дн.`);
    }
    if (!(0, carService_1.isListingAvailable)(input.listingId, input.dateFrom, input.dateTo)) {
        throw new BookingError('Автомобиль занят на выбранные даты');
    }
    const totalPrice = days * listing.price_per_day;
    const info = db_1.db
        .prepare(`INSERT INTO bookings (listing_id, renter_id, date_from, date_to, total_price, deposit)
         VALUES (?, ?, ?, ?, ?, ?)`)
        .run(input.listingId, input.renterId, input.dateFrom, input.dateTo, totalPrice, listing.deposit);
    return getBooking(Number(info.lastInsertRowid));
});
function getBooking(id) {
    return db_1.db.prepare('SELECT * FROM bookings WHERE id = ?').get(id);
}
exports.cancelBooking = db_1.db.transaction((bookingId, renterId, reason) => {
    const booking = db_1.db
        .prepare('SELECT * FROM bookings WHERE id = ? AND renter_id = ?')
        .get(bookingId, renterId);
    if (!booking || (booking.status !== 'confirmed' && booking.status !== 'pending')) {
        throw new BookingError('Бронирование не найдено');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'), cancellation_reason = ? WHERE id = ?`).run(reason ?? null, bookingId);
    return { ...booking, status: 'cancelled' };
});
/** Владелец подтверждает бронь — только для своих объявлений и только из статуса 'pending'. */
function confirmBooking(bookingId, ownerId) {
    const booking = getBooking(bookingId);
    if (!booking || booking.status !== 'pending') {
        throw new BookingError('Бронирование уже обработано');
    }
    const listing = (0, carService_1.getListing)(booking.listing_id);
    if (!listing || listing.owner_id !== ownerId) {
        throw new BookingError('Это не ваш автомобиль');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'confirmed' WHERE id = ?`).run(bookingId);
    return { ...booking, status: 'confirmed' };
}
/** Владелец отклоняет бронь. */
function declineBooking(bookingId, ownerId, reason) {
    const booking = getBooking(bookingId);
    if (!booking || booking.status !== 'pending') {
        throw new BookingError('Бронирование уже обработано');
    }
    const listing = (0, carService_1.getListing)(booking.listing_id);
    if (!listing || listing.owner_id !== ownerId) {
        throw new BookingError('Это не ваш автомобиль');
    }
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now'), cancellation_reason = ? WHERE id = ?`).run(reason ?? null, bookingId);
    return { ...booking, status: 'cancelled' };
}
/** Полный контекст брони (объявление + арендатор + владелец) для сообщений бота и договора. */
function getBookingWithPeople(bookingId) {
    return db_1.db
        .prepare(`SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone, rnt.platform AS renter_platform,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name, own.phone AS owner_phone, own.platform AS owner_platform
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users rnt ON rnt.telegram_id = b.renter_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE b.id = ?`)
        .get(bookingId);
}
function listBookingsByRenter(renterId, range) {
    const clauses = ['b.renter_id = @renterId'];
    const params = { renterId };
    if (range) {
        clauses.push('b.date_from BETWEEN @from AND @to');
        params.from = range.from;
        params.to = range.to;
    }
    return db_1.db
        .prepare(`SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.date_from DESC`)
        .all(params);
}
function listBookingsByOwner(ownerId, range) {
    const clauses = ['c.owner_id = @ownerId'];
    const params = { ownerId };
    if (range) {
        clauses.push('b.date_from BETWEEN @from AND @to');
        params.from = range.from;
        params.to = range.to;
    }
    return db_1.db
        .prepare(`SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users rnt ON rnt.telegram_id = b.renter_id
       WHERE ${clauses.join(' AND ')}
       ORDER BY b.date_from DESC`)
        .all(params);
}
function listAllBookings() {
    return db_1.db
        .prepare(`SELECT b.*, c.brand, c.model, c.year, c.city, c.price_per_day, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       JOIN users rnt ON rnt.telegram_id = b.renter_id
       JOIN users own ON own.telegram_id = c.owner_id
       ORDER BY b.created_at DESC`)
        .all();
}
/**
 * Автоматически подводит итог по броням, срок которых истёк, а стороны их
 * не отменили вручную: подтверждённые становятся «завершена», зависшие
 * неподтверждённые — «отменена».
 */
exports.sweepExpiredBookings = db_1.db.transaction(() => {
    const today = new Date().toISOString().slice(0, 10);
    db_1.db.prepare(`UPDATE bookings SET status = 'cancelled', cancelled_at = datetime('now')
     WHERE status = 'pending' AND date_to < ?`).run(today);
    db_1.db.prepare(`UPDATE bookings SET status = 'completed'
     WHERE status = 'confirmed' AND date_to < ?`).run(today);
});
