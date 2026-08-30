"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createListing = createListing;
exports.getListing = getListing;
exports.searchListings = searchListings;
exports.getListingWithExtras = getListingWithExtras;
exports.listListingsByOwner = listListingsByOwner;
exports.addListingPhoto = addListingPhoto;
exports.countListingPhotos = countListingPhotos;
exports.setListingStatus = setListingStatus;
exports.isListingAvailable = isListingAvailable;
const db_1 = require("../db/db");
function createListing(input) {
    const info = db_1.db
        .prepare(`INSERT INTO car_listings
        (owner_id, brand, model, year, color, plate, city, car_class, transmission, fuel_type,
         seats, price_per_day, deposit, min_rental_days, mileage_limit, restrictions, description)
       VALUES
        (@ownerId, @brand, @model, @year, @color, @plate, @city, @carClass, @transmission, @fuelType,
         @seats, @pricePerDay, @deposit, @minRentalDays, @mileageLimit, @restrictions, @description)`)
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
    return getListing(Number(info.lastInsertRowid));
}
function getListing(id) {
    return db_1.db.prepare('SELECT * FROM car_listings WHERE id = ?').get(id);
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
function attachPhotos(listing) {
    const photos = db_1.db
        .prepare('SELECT photo_path FROM car_photos WHERE listing_id = ? ORDER BY position ASC, id ASC')
        .all(listing.id).map((r) => r.photo_path);
    return { ...listing, photos };
}
/** Активные объявления, доступные в указанный период (без пересечения с чужими confirmed/pending бронями). */
function searchListings(filter) {
    const clauses = [`c.status = 'active'`, `u.banned = 0`];
    const params = {};
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
    }
    else if (filter.hasDeposit === false) {
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
    const orderBy = filter.sort === 'price_desc'
        ? 'c.price_per_day DESC'
        : filter.sort === 'rating'
            ? 'COALESCE(rt.avg_rating, 0) DESC'
            : filter.sort === 'newest'
                ? 'c.created_at DESC'
                : 'c.price_per_day ASC';
    const sql = `${LISTING_WITH_EXTRAS_SELECT} WHERE ${clauses.join(' AND ')} ORDER BY ${orderBy}`;
    const rows = db_1.db.prepare(sql).all(params);
    return rows.map(attachPhotos);
}
function getListingWithExtras(id) {
    const row = db_1.db.prepare(`${LISTING_WITH_EXTRAS_SELECT} WHERE c.id = @id`).get({ id });
    return row ? attachPhotos(row) : undefined;
}
function listListingsByOwner(ownerId) {
    return db_1.db
        .prepare(`SELECT * FROM car_listings WHERE owner_id = ? AND status != 'deleted' ORDER BY created_at DESC`)
        .all(ownerId);
}
function addListingPhoto(listingId, photoPath, position) {
    db_1.db.prepare('INSERT INTO car_photos (listing_id, photo_path, position) VALUES (?, ?, ?)').run(listingId, photoPath, position);
}
function countListingPhotos(listingId) {
    const row = db_1.db.prepare('SELECT COUNT(*) AS n FROM car_photos WHERE listing_id = ?').get(listingId);
    return row.n;
}
function setListingStatus(id, ownerId, status) {
    const info = db_1.db
        .prepare(`UPDATE car_listings SET status = ? WHERE id = ? AND owner_id = ?`)
        .run(status, id, ownerId);
    return info.changes > 0;
}
/** Проверяет, свободен ли автомобиль на указанный период (без учёта переданной брони, если задана). */
function isListingAvailable(listingId, dateFrom, dateTo, excludeBookingId) {
    const row = db_1.db
        .prepare(`SELECT COUNT(*) AS n FROM bookings
       WHERE listing_id = ? AND status IN ('pending','confirmed')
         AND date_from <= ? AND date_to >= ?
         AND (? IS NULL OR id != ?)`)
        .get(listingId, dateTo, dateFrom, excludeBookingId ?? null, excludeBookingId ?? null);
    return row.n === 0;
}
