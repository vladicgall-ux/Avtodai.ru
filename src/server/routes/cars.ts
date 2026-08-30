import { Router, type Request } from 'express';
import fs from 'fs';
import path from 'path';
import { requireAuth, requireActiveUser, requireAgreementAccepted, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { isKnownCity } from '../../db/cities';
import {
  createListing,
  searchListings,
  listListingsByOwner,
  getListingWithExtras,
  setListingStatus,
  addListingPhoto,
  countListingPhotos,
  getListingPhoto,
  deleteListingPhotoRecord,
  type CarClass,
  type Transmission,
  type FuelType,
} from '../../services/carService';
import { getOwnerStats } from '../../services/statsService';
import { uploadCarPhoto, isValidImageFile, processUploadedImage, uploadsDir, removeUploadedFile } from '../middleware/upload';
import { parseId } from '../utils/parseId';

export const carsRouter = Router();

carsRouter.use(requireAuth, requireActiveUser);

const CAR_CLASSES: CarClass[] = ['economy', 'comfort', 'business', 'premium', 'suv', 'minivan'];
const TRANSMISSIONS: Transmission[] = ['manual', 'automatic'];
const FUEL_TYPES: FuelType[] = ['petrol', 'diesel', 'hybrid', 'electric', 'gas'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isCarClass(v: unknown): v is CarClass {
  return typeof v === 'string' && (CAR_CLASSES as string[]).includes(v);
}
function isTransmission(v: unknown): v is Transmission {
  return typeof v === 'string' && (TRANSMISSIONS as string[]).includes(v);
}
function isFuelType(v: unknown): v is FuelType {
  return typeof v === 'string' && (FUEL_TYPES as string[]).includes(v);
}

function parseRange(req: Request): { from: string; to: string } | undefined {
  const from = req.query.from;
  const to = req.query.to;
  if (typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)) {
    return { from, to };
  }
  return undefined;
}

/** Поиск активных объявлений по всей России — город, класс, коробка, цена, залог, даты. */
carsRouter.get('/', (req, res) => {
  const dateFrom = typeof req.query.dateFrom === 'string' && DATE_RE.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
  const dateTo = typeof req.query.dateTo === 'string' && DATE_RE.test(req.query.dateTo) ? req.query.dateTo : undefined;
  const minPrice = Number(req.query.minPrice);
  const maxPrice = Number(req.query.maxPrice);
  const hasDeposit =
    req.query.hasDeposit === '1' ? true : req.query.hasDeposit === '0' ? false : undefined;
  const sortRaw = req.query.sort;
  const sort =
    sortRaw === 'price_desc' || sortRaw === 'newest' || sortRaw === 'rating' ? sortRaw : 'price_asc';

  const listings = searchListings({
    city: typeof req.query.city === 'string' && isKnownCity(req.query.city) ? req.query.city : undefined,
    carClass: isCarClass(req.query.carClass) ? req.query.carClass : undefined,
    transmission: isTransmission(req.query.transmission) ? req.query.transmission : undefined,
    brand: typeof req.query.brand === 'string' ? req.query.brand.trim().slice(0, 60) : undefined,
    model: typeof req.query.model === 'string' ? req.query.model.trim().slice(0, 60) : undefined,
    minPrice: Number.isFinite(minPrice) && minPrice > 0 ? minPrice : undefined,
    maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
    hasDeposit,
    dateFrom: dateFrom && dateTo ? dateFrom : undefined,
    dateTo: dateFrom && dateTo ? dateTo : undefined,
    sort,
  });
  res.json({ listings });
});

carsRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ listings: listListingsByOwner(user.telegram_id) });
});

carsRouter.get('/mine/stats', (req, res) => {
  const { user } = req as AuthedRequest;
  const range = parseRange(req);
  if (!range) {
    res.status(400).json({ error: 'Укажите диапазон дат (from, to)' });
    return;
  }
  res.json({ stats: getOwnerStats(user.telegram_id, range.from, range.to) });
});

/** Публикация нового объявления. Требует подтверждённый телефон и принятое Пользовательское соглашение. */
carsRouter.post('/', requireAgreementAccepted, writeLimiter(15, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  const {
    brand,
    model,
    year,
    color,
    plate,
    city,
    carClass,
    transmission,
    fuelType,
    seats,
    pricePerDay,
    deposit,
    minRentalDays,
    mileageLimit,
    restrictions,
    description,
  } = req.body ?? {};

  if (typeof brand !== 'string' || !brand.trim() || typeof model !== 'string' || !model.trim()) {
    res.status(400).json({ error: 'Укажите марку и модель автомобиля' });
    return;
  }
  const yearNum = Number(year);
  if (!Number.isInteger(yearNum) || yearNum < 1970 || yearNum > new Date().getFullYear() + 1) {
    res.status(400).json({ error: 'Некорректный год выпуска' });
    return;
  }
  if (typeof plate !== 'string' || !plate.trim()) {
    res.status(400).json({ error: 'Укажите госномер' });
    return;
  }
  if (!isKnownCity(city)) {
    res.status(400).json({ error: 'Выберите город из списка' });
    return;
  }
  if (!isCarClass(carClass) || !isTransmission(transmission) || !isFuelType(fuelType)) {
    res.status(400).json({ error: 'Некорректные параметры автомобиля' });
    return;
  }
  const seatsNum = Number(seats);
  if (!Number.isInteger(seatsNum) || seatsNum < 1 || seatsNum > 9) {
    res.status(400).json({ error: 'Количество мест должно быть от 1 до 9' });
    return;
  }
  const priceNum = Number(pricePerDay);
  if (!Number.isInteger(priceNum) || priceNum < 0 || priceNum > 1_000_000) {
    res.status(400).json({ error: 'Некорректная цена за сутки' });
    return;
  }
  const depositNum = Number(deposit ?? 0);
  if (!Number.isInteger(depositNum) || depositNum < 0 || depositNum > 5_000_000) {
    res.status(400).json({ error: 'Некорректная сумма залога' });
    return;
  }
  const minDaysNum = Number(minRentalDays ?? 1);
  if (!Number.isInteger(minDaysNum) || minDaysNum < 1 || minDaysNum > 90) {
    res.status(400).json({ error: 'Некорректный минимальный срок аренды' });
    return;
  }
  const mileageLimitNum = mileageLimit === undefined || mileageLimit === null || mileageLimit === '' ? undefined : Number(mileageLimit);
  if (mileageLimitNum !== undefined && (!Number.isInteger(mileageLimitNum) || mileageLimitNum < 0 || mileageLimitNum > 10_000)) {
    res.status(400).json({ error: 'Некорректный лимит пробега' });
    return;
  }

  const listing = createListing({
    ownerId: user.telegram_id,
    brand: brand.trim().slice(0, 60),
    model: model.trim().slice(0, 60),
    year: yearNum,
    color: typeof color === 'string' ? color.trim().slice(0, 40) : undefined,
    plate: plate.trim().slice(0, 20),
    city,
    carClass,
    transmission,
    fuelType,
    seats: seatsNum,
    pricePerDay: priceNum,
    deposit: depositNum,
    minRentalDays: minDaysNum,
    mileageLimit: mileageLimitNum,
    restrictions: typeof restrictions === 'string' ? restrictions.trim().slice(0, 300) : undefined,
    description: typeof description === 'string' ? description.trim().slice(0, 1000) : undefined,
  });
  res.status(201).json({ listing });
});

// Одно фото на объявление — сознательное ограничение, чтобы не раздувать
// хранилище хостинга (даже сжатые в WebP, десятки фото на объявление
// быстро набегают на заметный объём при росте числа объявлений).
const MAX_PHOTOS_PER_LISTING = 1;

/** Загрузка фото автомобиля — одно на объявление, только владельцем. Чтобы заменить, сперва удалите текущее. */
carsRouter.post(
  '/:id/photos',
  requireAgreementAccepted,
  writeLimiter(20, 10 * 60_000),
  (req, res, next) => {
    uploadCarPhoto.array('photos', MAX_PHOTOS_PER_LISTING)(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const { user } = req as AuthedRequest;
    const listingId = parseId(req.params.id);
    const files = (req as unknown as { files?: Express.Multer.File[] }).files ?? [];
    if (!listingId) {
      for (const f of files) fs.unlink(f.path, () => {});
      res.status(400).json({ error: 'Некорректный ID' });
      return;
    }
    if (!files.length) {
      res.status(400).json({ error: 'Файлы не получены' });
      return;
    }

    const listing = getListingWithExtras(listingId);
    if (!listing || listing.owner_id !== user.telegram_id) {
      for (const f of files) fs.unlink(f.path, () => {});
      res.status(403).json({ error: 'Это не ваше объявление' });
      return;
    }

    const existing = countListingPhotos(listingId);
    if (existing + files.length > MAX_PHOTOS_PER_LISTING) {
      for (const f of files) fs.unlink(f.path, () => {});
      res.status(400).json({ error: `Не более ${MAX_PHOTOS_PER_LISTING} фото на объявление` });
      return;
    }

    let position = existing;
    const saved: string[] = [];
    for (const file of files) {
      // Каждый файл валидируется независимо — плохой файл в середине пакета
      // не должен приводить к тому, что уже проверенные соседние файлы
      // тоже отбрасываются.
      if (!isValidImageFile(file.path) || !(await processUploadedImage(file.path))) {
        fs.unlink(file.path, () => {});
        continue;
      }
      addListingPhoto(listingId, file.filename, position);
      saved.push(file.filename);
      position += 1;
    }

    if (!saved.length) {
      res.status(400).json({ error: 'Ни один файл не прошёл проверку — загрузите изображение JPEG, PNG или WebP' });
      return;
    }
    res.json({ photos: saved.map((f) => `/uploads/${f}`) });
  }
);

/** Удаление фото объявления — нужно, чтобы заменить единственное разрешённое фото на другое. */
carsRouter.post('/:id/photos/:photoId/delete', (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const listingId = parseId(req.params.id);
  const photoId = parseId(req.params.photoId);
  if (!listingId || !photoId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const listing = getListingWithExtras(listingId);
  if (!listing || listing.owner_id !== user.telegram_id) {
    res.status(403).json({ error: 'Это не ваше объявление' });
    return;
  }
  const photo = getListingPhoto(photoId);
  if (!photo || photo.listing_id !== listingId) {
    res.status(404).json({ error: 'Фото не найдено' });
    return;
  }
  deleteListingPhotoRecord(photoId);
  removeUploadedFile(path.join(uploadsDir, path.basename(photo.photo_path)));
  res.json({ ok: true });
});

function setStatus(status: 'active' | 'paused' | 'deleted') {
  return (req: Request, res: import('express').Response) => {
    const { user } = req as unknown as AuthedRequest;
    const id = parseId(req.params.id);
    if (!id) {
      res.status(400).json({ error: 'Некорректный ID' });
      return;
    }
    const ok = setListingStatus(id, user.telegram_id, status);
    if (!ok) {
      res.status(404).json({ error: 'Объявление не найдено' });
      return;
    }
    res.json({ ok: true });
  };
}

carsRouter.post('/:id/pause', setStatus('paused'));
carsRouter.post('/:id/activate', setStatus('active'));
carsRouter.post('/:id/delete', setStatus('deleted'));

carsRouter.get('/:id', (req, res) => {
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const listing = getListingWithExtras(id);
  if (!listing) {
    res.status(404).json({ error: 'Объявление не найдено' });
    return;
  }
  res.json({ listing });
});
