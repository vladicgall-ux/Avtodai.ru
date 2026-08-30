import { db } from '../db/db';
import { getListing } from './carService';
import type { Platform } from './userService';

export type ContactRequestStatus = 'pending' | 'confirmed' | 'declined';

export interface ContactRequestRecord {
  id: number;
  listing_id: number;
  renter_id: number;
  status: ContactRequestStatus;
  created_at: string;
  confirmed_at: string | null;
}

export class ContactRequestError extends Error {}

/**
 * Лёгкий запрос «показать контакты» — в отличие от бронирования не требует
 * выбора дат и не резервирует ничего в объявлении, только фиксирует интерес
 * арендатора и уведомляет владельца. Один активный (pending) запрос на пару
 * (объявление, арендатор) — повторное нажатие не плодит дубликаты.
 */
/**
 * created=false означает, что уже существует необработанный запрос по этому
 * объявлению от этого арендатора, и он же возвращён. Это различие важно
 * вызывающему коду: без него повторное нажатие кнопки «Показать контакты»
 * (или пара быстрых кликов) видело бы status === 'pending' в обоих случаях
 * и слало бы владельцу повторное уведомление на каждый клик.
 */
export function createContactRequest(input: {
  listingId: number;
  renterId: number;
}): { request: ContactRequestRecord; created: boolean } {
  const listing = getListing(input.listingId);
  if (!listing || listing.status !== 'active') {
    throw new ContactRequestError('Объявление недоступно');
  }
  if (listing.owner_id === input.renterId) {
    throw new ContactRequestError('Это ваше собственное объявление');
  }
  const existing = db
    .prepare(
      `SELECT * FROM contact_requests WHERE listing_id = ? AND renter_id = ? AND status = 'pending'`
    )
    .get(input.listingId, input.renterId) as ContactRequestRecord | undefined;
  if (existing) return { request: existing, created: false };

  const info = db
    .prepare(`INSERT INTO contact_requests (listing_id, renter_id) VALUES (?, ?)`)
    .run(input.listingId, input.renterId);
  return { request: getContactRequest(Number(info.lastInsertRowid))!, created: true };
}

export function getContactRequest(id: number): ContactRequestRecord | undefined {
  return db.prepare('SELECT * FROM contact_requests WHERE id = ?').get(id) as ContactRequestRecord | undefined;
}

export function confirmContactRequest(id: number, ownerId: number): ContactRequestRecord {
  const request = getContactRequest(id);
  if (!request || request.status !== 'pending') {
    throw new ContactRequestError('Запрос уже обработан');
  }
  const listing = getListing(request.listing_id);
  if (!listing || listing.owner_id !== ownerId) {
    throw new ContactRequestError('Это не ваше объявление');
  }
  db.prepare(`UPDATE contact_requests SET status = 'confirmed', confirmed_at = datetime('now') WHERE id = ?`).run(id);
  return { ...request, status: 'confirmed', confirmed_at: new Date().toISOString() };
}

export function declineContactRequest(id: number, ownerId: number): ContactRequestRecord {
  const request = getContactRequest(id);
  if (!request || request.status !== 'pending') {
    throw new ContactRequestError('Запрос уже обработан');
  }
  const listing = getListing(request.listing_id);
  if (!listing || listing.owner_id !== ownerId) {
    throw new ContactRequestError('Это не ваше объявление');
  }
  db.prepare(`UPDATE contact_requests SET status = 'declined' WHERE id = ?`).run(id);
  return { ...request, status: 'declined' };
}

export interface ContactRequestWithPeople extends ContactRequestRecord {
  brand: string;
  model: string;
  city: string;
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

/**
 * Телефоны обеих сторон включены в выборку всегда — но контроллер отдаёт их
 * во фронтенд только когда status = 'confirmed' (см. routes/contactRequests.ts),
 * а боту они нужны сразу после подтверждения для уведомления.
 */
export function getContactRequestWithPeople(id: number): ContactRequestWithPeople | undefined {
  return db
    .prepare(
      `SELECT cr.*, c.brand, c.model, c.city, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone, rnt.platform AS renter_platform,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name, own.phone AS owner_phone, own.platform AS owner_platform
       FROM contact_requests cr
       JOIN car_listings c ON c.id = cr.listing_id
       JOIN users rnt ON rnt.telegram_id = cr.renter_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE cr.id = ?`
    )
    .get(id) as ContactRequestWithPeople | undefined;
}

export function listContactRequestsByRenter(renterId: number): ContactRequestWithPeople[] {
  return db
    .prepare(
      `SELECT cr.*, c.brand, c.model, c.city, c.owner_id,
              own.first_name AS owner_first_name, own.username AS owner_username, own.full_name AS owner_full_name, own.phone AS owner_phone
       FROM contact_requests cr
       JOIN car_listings c ON c.id = cr.listing_id
       JOIN users own ON own.telegram_id = c.owner_id
       WHERE cr.renter_id = ?
       ORDER BY cr.created_at DESC`
    )
    .all(renterId) as ContactRequestWithPeople[];
}

export function listContactRequestsByOwner(ownerId: number): ContactRequestWithPeople[] {
  return db
    .prepare(
      `SELECT cr.*, c.brand, c.model, c.city, c.owner_id,
              rnt.first_name AS renter_first_name, rnt.username AS renter_username, rnt.full_name AS renter_full_name, rnt.phone AS renter_phone
       FROM contact_requests cr
       JOIN car_listings c ON c.id = cr.listing_id
       JOIN users rnt ON rnt.telegram_id = cr.renter_id
       WHERE c.owner_id = ?
       ORDER BY cr.created_at DESC`
    )
    .all(ownerId) as ContactRequestWithPeople[];
}
