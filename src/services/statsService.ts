import { db } from '../db/db';

export interface AdminStats {
  totalUsers: number;
  onlineUsers: number;
  verifiedUsers: number;
  ownersWithListings: number;
  bannedUsers: number;
  activeListings: number;
  totalBookings: number;
}

/**
 * "Онлайн" — грубая оценка: пользователи, чей last_seen_at (обновляется на
 * каждом запросе к API) попадает в последние 5 минут. У Mini App нет
 * постоянного соединения, поэтому это приближение по недавней активности.
 */
export function getAdminStats(): AdminStats {
  const totalUsers = (db.prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n;
  const onlineUsers = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM users WHERE last_seen_at >= datetime('now', '-5 minutes')`)
      .get() as { n: number }
  ).n;
  const verifiedUsers = (
    db.prepare(`SELECT COUNT(*) AS n FROM users WHERE phone_verified = 1`).get() as { n: number }
  ).n;
  const ownersWithListings = (
    db
      .prepare(`SELECT COUNT(DISTINCT owner_id) AS n FROM car_listings WHERE status != 'deleted'`)
      .get() as { n: number }
  ).n;
  const bannedUsers = (db.prepare(`SELECT COUNT(*) AS n FROM users WHERE banned = 1`).get() as { n: number }).n;
  const activeListings = (
    db.prepare(`SELECT COUNT(*) AS n FROM car_listings WHERE status = 'active'`).get() as { n: number }
  ).n;
  const totalBookings = (
    db.prepare(`SELECT COUNT(*) AS n FROM bookings WHERE status IN ('pending','confirmed')`).get() as {
      n: number;
    }
  ).n;

  return { totalUsers, onlineUsers, verifiedUsers, ownersWithListings, bannedUsers, activeListings, totalBookings };
}

export interface OwnerStats {
  bookingsCount: number;
  earnings: number;
}

/** Статистика владельца (число броней, заработок) за диапазон дат по date_from объявлений. */
export function getOwnerStats(ownerId: number, from: string, to: string): OwnerStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS bookingsCount,
         COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total_price ELSE 0 END), 0) AS earnings
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       WHERE c.owner_id = ? AND b.date_from BETWEEN ? AND ?`
    )
    .get(ownerId, from, to) as OwnerStats;
  return row;
}

export function getOwnerAllTimeStats(ownerId: number): OwnerStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS bookingsCount,
         COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total_price ELSE 0 END), 0) AS earnings
       FROM bookings b
       JOIN car_listings c ON c.id = b.listing_id
       WHERE c.owner_id = ?`
    )
    .get(ownerId) as OwnerStats;
  return row;
}

export interface RenterStats {
  bookingsCount: number;
  totalSpent: number;
}

export function getRenterAllTimeStats(renterId: number): RenterStats {
  const row = db
    .prepare(
      `SELECT
         COUNT(*) AS bookingsCount,
         COALESCE(SUM(CASE WHEN b.status IN ('confirmed','completed') THEN b.total_price ELSE 0 END), 0) AS totalSpent
       FROM bookings b
       WHERE b.renter_id = ? AND b.status IN ('pending','confirmed','completed')`
    )
    .get(renterId) as RenterStats;
  return row;
}
