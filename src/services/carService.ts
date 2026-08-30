import { db } from '../db/db';

export type CarClass = 'economy' | 'comfort' | 'business' | 'premium' | 'suv' | 'minivan';
export type Transmission = 'manual' | 'automatic';
export type FuelType = 'petrol' | 'diesel' | 'hybrid' | 'electric' | 'gas';
export type ListingStatus = 'active' | 'paused' | 'deleted';

export interface CarListingRecord {
  id: number;
  owner_id: number;
  brand: string;
  model: string;
  year: number;
  color: string | null;
  plate: string;
  city: string;
  car_class: CarClass;
  transmission: Transmission;
  fuel_type: FuelType;
  seats: number;
  price_per_day: number;
  deposit: number;
  min_rental_days: number;
  mileage_limit: number | null;
  restrictions: string | null;
  description: string | null;
  status: ListingStatus;
  created_at: string;
}

export interface CarListingWithExtras extends CarListingRecord {
  owner_first_name: string;
  owner_username: string | null;
  owner_full_name: string | null;
  avg_rating: number | null;
  rating_count: number;
  photos: string[];
  /** ID фото в том же порядке, что и photos — нужен только владельцу для удаления/замены фото. */
  photoIds: number[];
}

export interface CreateListingInput {
  ownerId: number;
  brand: string;
  model: string;
  year: number;
  color?: string;
  plate: string;
  city: string;
  carClass: CarClass;
  transmission: Transmission;
  fuelType: FuelType;
  seats: number;
  pricePerDay: number;
  deposit: number;
  minRentalDays: number;
  mileageLimit?: number;
  restrictions?: string;
  description?: string;
}

export function createListing(input: CreateListingInput): CarListingRecord {
  const info = db
    .prepare(
      `INSERT INTO car_listings
        (owner_id, brand, model, year, color, plate, city, car_class, transmission, fuel_type,
         seats, price_per_day, deposit, min_rental_days, mileage_limit, restrictions, description)
       VALUES
        (@ownerId, @brand, @model, @year, @color, @plate, @city, @carClass, @transmission, @fuelType,
         @seats, @pricePerDay, @deposit, @minRentalDays, @mileageLimit, @restrictions, @description)`
    )
    .run({
      ownerId: input.ownerId,
      brand: input.brand,
      model: input.model,
      year: input.year,
      color: input.color ?? null,
      plate: input.plate,
      city: input.city,
      carClass: input.carClass,
      transmission: input.transmission,
      fuelType: input.fuelType,
      seats: input.seats,
      pricePerDay: input.pricePerDay,
      deposit: input.deposit,
      minRentalDays: input.minRentalDays,
      mileageLimit: input.mileageLimit ?? null,
      restrictions: input.restrictions ?? null,
      description: input.description ?? null,
    });
  return getListing(Number(info.lastInsertRowid))!;
}

export function getListing(id: number): CarListingRecord | undefined {
  return db.prepare('SELECT * FROM car_listings WHERE id = ?').get(id) as CarListingRecord | undefined;
}

const LISTING_WITH_EXTRAS_SELECT = `
  SELECT c.*,
         u.first_name AS owner_first_name,
         u.username   AS owner_username,
         u.full_name  AS owner_full_name,
         ROUND(rt.avg_rating, 1) AS avg_rating, COALESCE(rt.rating_count, 0) AS rating_count
  FROM car_listings c
  JOIN users u ON u.telegram_id = c.owner_id
  LEFT JOIN (
    SELECT owner_id, AVG(rating) AS avg_rating, COUNT(*) AS rating_count
    FROM owner_ratings GROUP BY owner_id
  ) rt ON rt.owner_id = c.owner_id
`;

function attachPhotos(listing: Omit<CarListingWithExtras, 'photos' | 'photoIds'>): CarListingWithExtras {
  const rows = db
    .prepare('SELECT id, photo_path FROM car_photos WHERE listing_id = ? ORDER BY position ASC, id ASC')
    .all(listing.id) as { id: number; photo_path: string }[];
  return { ...listing, photos: rows.map((r) => r.photo_path), photoIds: rows.map((r) => r.id) };
}

export interface SearchFilter {
  city?: string;
  carClass?: CarClass;
  transmission?: Transmission;
  brand?: string;
  model?: string;
  minPrice?: number;
  maxPrice?: number;
  hasDeposit?: boolean; // true = только с залогом, false = только без залога
  dateFrom?: string; // YYYY-MM-DD, исключает занятые на этот период
  dateTo?: string;
  sort?: 'price_asc' | 'price_desc' | 'newest' | 'rating';
}

/** Активные объявления, доступные в указанный период (без пересечения с чужими confirmed/pending бронями). */
export function searchListings(filter: SearchFilter): CarListingWithExtras[] {
  const clauses = [`c.status = 'active'`, `u.banned = 0`];
  const params: Record<string, unknown> = {};

  if (filter.city) {
    clauses.push('c.city = @city');
    params.city = filter.city;
  }
  if (filter.carClass) {
    clauses.push('c.car_class = @carClass');
    params.carClass = filter.carClass;
  }
  if (filter.transmission) {
    clauses.push('c.transmission = @transmission');
    params.transmission = filter.transmission;
  }
  if (filter.brand) {
    clauses.push('c.brand LIKE @brand ESCAPE \'\\\'');
    params.brand = `%${filter.brand.replace(/[\\%_]/g, '\\$&')}%`;
  }
  if (filter.model) {
    clauses.push('c.model LIKE @model ESCAPE \'\\\'');
    params.model = `%${filter.model.replace(/[\\%_]/g, '\\$&')}%`;
  }
  if (filter.minPrice !== undefined) {
    clauses.push('c.price_per_day >= @minPrice');
    params.minPrice = filter.minPrice;
  }
  if (filter.maxPrice !== undefined) {
    clauses.push('c.price_per_day <= @maxPrice');
    params.maxPrice = filter.maxPrice;
  }
  if (filter.hasDeposit === true) {
    clauses.push('c.deposit > 0');
  } else if (filter.hasDeposit === false) {
    clauses.push('c.deposit = 0');
  }
  if (filter.dateFrom && filter.dateTo) {
    clauses.push(`NOT EXISTS (
      SELECT 1 FROM bookings b
      WHERE b.listing_id = c.id AND b.status IN ('pending','confirmed')
        AND b.date_from <= @dateTo AND b.date_to >= @dateFrom
    )`);
    params.dateFrom = filter.dateFrom;
    params.dateTo = filter.dateTo;
  }

  const orderBy =
    filter.sort === 'price_desc'
      ? 'c.price_per_day DESC'
      : filter.sort === 'rating'
        ? 'COALESCE(rt.avg_rating, 0) DESC'
        : filter.sort === 'newest'
          ? 'c.created_at DESC'
          : 'c.price_per_day ASC';

  const sql = `${LISTING_WITH_EXTRAS_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy}`;
  const rows = db.prepare(sql).all(params) as Omit<CarListingWithExtras, 'photos' | 'photoIds'>[];
  return rows.map(attachPhotos);
}

export function getListingWithExtras(id: number): CarListingWithExtras | undefined {
  const row = db.prepare(`${LISTING_WITH_EXTRAS_SELECT} WHERE c.id = @id`).get({ id }) as
    | Omit<CarListingWithExtras, 'photos' | 'photoIds'>
    | undefined;
  return row ? attachPhotos(row) : undefined;
}

export function listListingsByOwner(ownerId: number): CarListingRecord[] {
  return db
    .prepare(`SELECT * FROM car_listings WHERE owner_id = ? AND status != 'deleted' ORDER BY created_at DESC`)
    .all(ownerId) as CarListingRecord[];
}

export function addListingPhoto(listingId: number, photoPath: string, position: number): void {
  db.prepare('INSERT INTO car_photos (listing_id, photo_path, position) VALUES (?, ?, ?)').run(
    listingId,
    photoPath,
    position
  );
}

export function countListingPhotos(listingId: number): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM car_photos WHERE listing_id = ?').get(listingId) as {
    n: number;
  };
  return row.n;
}

export interface CarPhotoRecord {
  id: number;
  listing_id: number;
  photo_path: string;
  position: number;
}

export function getListingPhoto(photoId: number): CarPhotoRecord | undefined {
  return db.prepare('SELECT * FROM car_photos WHERE id = ?').get(photoId) as CarPhotoRecord | undefined;
}

export function deleteListingPhotoRecord(photoId: number): void {
  db.prepare('DELETE FROM car_photos WHERE id = ?').run(photoId);
}

export function setListingStatus(id: number, ownerId: number, status: ListingStatus): boolean {
  const info = db
    .prepare(`UPDATE car_listings SET status = ? WHERE id = ? AND owner_id = ?`)
    .run(status, id, ownerId);
  return info.changes > 0;
}

/** Проверяет, свободен ли автомобиль на указанный период (без учёта переданной брони, если задана). */
export function isListingAvailable(
  listingId: number,
  dateFrom: string,
  dateTo: string,
  excludeBookingId?: number
): boolean {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS n FROM bookings
       WHERE listing_id = ? AND status IN ('pending','confirmed')
         AND date_from <= ? AND date_to >= ?
         AND (? IS NULL OR id != ?)`
    )
    .get(listingId, dateTo, dateFrom, excludeBookingId ?? null, excludeBookingId ?? null) as { n: number };
  return row.n === 0;
}
