"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactRequestError = void 0;
exports.createContactRequest = createContactRequest;
exports.getContactRequest = getContactRequest;
exports.confirmContactRequest = confirmContactRequest;
exports.declineContactRequest = declineContactRequest;
exports.getContactRequestWithPeople = getContactRequestWithPeople;
exports.listContactRequestsByRenter = listContactRequestsByRenter;
exports.listContactRequestsByOwner = listContactRequestsByOwner;
const db_1 = require("../db/db");
const carService_1 = require("./carService");
class ContactRequestError extends Error {
}
exports.ContactRequestError = ContactRequestError;
/**
 * Лёгкий запрос «показать контакты» — в отличие от бронирования не требует
 * выбора дат и не резервирует ничего в объявлении, только фиксирует интерес
 * арендатора и уведомляет владельца. Один активный (pending) запрос на пару
 * (объявление, арендатор) — повторное нажатие не плодит дубликаты.
 */
function createContactRequest(input) {
    const listing = (0, carService_1.getListing)(input.listingId);
    if (!listing || listing.status !== 'active') {
        throw new ContactRequestError('Объявление недоступно');
    }
    if (listing.owner_id === input.renterId) {
        throw new ContactRequestError('Это ваше собственное объявление');
    }
    const existing = db_1.db
        .prepare(`SELECT * FROM contact_requests WHERE listing_id = ? AND renter_id = ? AND status = 'pending'`)
        .get(input.listingId, input.renterId);
    if (existing)
        return existing;
    const info = db_1.db
        .prepare(`INSERT INTO contact_requests (listing_id, renter_id) VALUES (?, ?)`)
        .run(input.listingId, input.renterId);
    return getContactRequest(Number(info.lastInsertRowid));
}
function getContactRequest(id) {
    return db_1.db.prepare('SELECT * FROM contact_requests WHERE id = ?').get(id);
}
function confirmContactRequest(id, ownerId) {
    const request = getContactRequest(id);
    if (!request || request.status !== 'pending') {
        throw new ContactRequestError('Запрос уже обработан');
    }
    const listing = (0, carService_1.getListing)(request.listing_id);
    if (!listing || listing.owner_id !== ownerId) {
        throw new ContactRequestError('Это не ваше объявление');
    }
    db_1.db.prepare(`UPDATE contact_requests SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?`).run(id);
    return { ...request, status: 'confirmed', confirmed_at: new Date().toISOString() };
}
function declineContactRequest(id, ownerId) {
    const request = getContactRequest(id);
    if (!request || request.status !== 'pending') {
        throw new ContactRequestError('Запрос уже обработан');
    }
    const listing = (0, carService_1.getListing)(request.listing_id);
    if (!listing || listing.owner_id !== ownerId) {
        throw new ContactRequestError('Это не ваше объявление');
    }
    db_1.db.prepare(`UPDATE contact_requests SET status = 'declined' WHERE id = ?`).run(id);
    return { ...request, status: 'declined' };
}
/**
 * Телефоны обеих сторон включены в выборку всегда — но контроллер отдаёт их
 * во фронтенд только когда status = 'confirmed' (см. routes/contactRequests.ts),
 * а боту они нужны сразу после подтверждения для уведомления.
 */
function getContactRequestWithPeople(id) {
    return db_1.db
        .prepare(`SELECT cr.*, c.brand, c.model, c.city, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone, rnt.platform AS renter_platform,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name, own.phone AS owner_phone, own.platform AS owner_platform
       FROM contact_requests cr
       JOIN car_listings c ON c.id = cr.listing_id
       JOIN users rnt ON rnt.telegram_id = cr.renter_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE cr.id = ?`)
        .get(id);
}
function listContactRequestsByRenter(renterId) {
    return db_1.db
        .prepare(`SELECT cr.*, c.brand, c.model, c.city, c.owner_id,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name, own.phone AS owner_phone
       FROM contact_requests cr
       JOIN car_listings c ON c.id = cr.listing_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE cr.renter_id = ?
       ORDER BY cr.created_at DESC`)
        .all(renterId);
}
function listContactRequestsByOwner(ownerId) {
    return db_1.db
        .prepare(`SELECT cr.*, c.brand, c.model, c.city, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone
       FROM contact_requests cr
       JOIN car_listings c ON c.id = cr.listing_id
       JOIN users rnt ON rnt.telegram_id = cr.renter_id
       WHERE c.owner_id = ?
       ORDER BY cr.created_at DESC`)
        .all(ownerId);
}
