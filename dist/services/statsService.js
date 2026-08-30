"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAdminStats = getAdminStats;
exports.getOwnerStats = getOwnerStats;
exports.getOwnerAllTimeStats = getOwnerAllTimeStats;
exports.getRenterAllTimeStats = getRenterAllTimeStats;
const db_1 = require("../db/db");
/**
 * "Онлайн" — грубая оценка: пользователи, чей last_seen_at (обновляется на
 * каждом запросе к API) попадает в последние 5 минут. У Mini App нет
 * постоянного соединения, поэтому это приближение по недавней активности.
 */
function getAdminStats() {
    const totalUsers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM users`).get().n;
    const onlineUsers = db_1.db
        .prepare(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= datetime('now', '-5 minutes')`)
        .get().n;
    const verifiedUsers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE phone_verified = 1`).get().n;
    const ownersWithListings = db_1.db
        .prepare(`SELECT COUNT(DISTINCT owner_id) AS n FROM car_listings WHERE status != 'deleted'`)
        .get().n;
    const bannedUsers = db_1.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE banned = 1`).get().n;
    const activeListings = db_1.db.prepare(`SELECT COUNT(*) AS n FROM car_listings WHERE status = 'active'`).get().n;
    const totalBookings = db_1.db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed')`).get().n;
    return { totalUsers, onlineUsers, verifiedUsers, ownersWithListings, bannedUsers, activeListings, totalBookings };
}
/** Статистика владельца (число броней, заработок) за диапазон дат по date_from объявлений. */
function getOwnerStats(ownerId, from, to) {
    const row = db_1.db
        .prepare(`SELECT
         COUNT(*) AS bookingsCount,
         COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total_price ELSE 0 END), 0) AS earnings
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       WHERE c.owner_id = ? AND b.date_from BETWEEN ? AND ?`)
        .get(ownerId, from, to);
    return row;
}
function getOwnerAllTimeStats(ownerId) {
    const row = db_1.db
        .prepare(`SELECT
         COUNT(*) AS bookingsCount,
         COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total_price ELSE 0 END), 0) AS earnings
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       WHERE c.owner_id = ?`)
        .get(ownerId);
    return row;
}
function getRenterAllTimeStats(renterId) {
    const row = db_1.db
        .prepare(`SELECT
         COUNT(*) AS bookingsCount,
         COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total_price ELSE 0 END), 0) AS totalSpent
       FROM bookings b
       WHERE b.renter_id = ? AND b.status IN ('pending','confirmed','completed')`)
        .get(renterId);
    return row;
}
