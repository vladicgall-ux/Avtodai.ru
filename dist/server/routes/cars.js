"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.carsRouter = void 0;
const express_1 = require("express");
const fs_1 = __importDefault(require("fs"));
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const cities_1 = require("../../db/cities");
const carService_1 = require("../../services/carService");
const statsService_1 = require("../../services/statsService");
const upload_1 = require("../middleware/upload");
const parseId_1 = require("../utils/parseId");
exports.carsRouter = (0, express_1.Router)();
exports.carsRouter.use(auth_1.requireAuth, auth_1.requireActiveUser);
const CAR_CLASSES = ['economy', 'comfort', 'business', 'premium', 'suv', 'minivan'];
const TRANSMISSIONS = ['manual', 'automatic'];
const FUEL_TYPES = ['petrol', 'diesel', 'hybrid', 'electric', 'gas'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function isCarClass(v) {
    return typeof v === 'string' && CAR_CLASSES.includes(v);
}
function isTransmission(v) {
    return typeof v === 'string' && TRANSMISSIONS.includes(v);
}
function isFuelType(v) {
    return typeof v === 'string' && FUEL_TYPES.includes(v);
}
function parseRange(req) {
    const from = req.query.from;
    const to = req.query.to;
    if (typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)) {
        return { from, to };
    }
    return undefined;
}
/** Поиск активных объявлений по всей России — город, класс, коробка, цена, залог, даты. */
exports.carsRouter.get('/', (req, res) => {
    const dateFrom = typeof req.query.dateFrom === 'string' && DATE_RE.test(req.query.dateFrom) ? req.query.dateFrom : undefined;
    const dateTo = typeof req.query.dateTo === 'string' && DATE_RE.test(req.query.dateTo) ? req.query.dateTo : undefined;
    const minPrice = Number(req.query.minPrice);
    const maxPrice = Number(req.query.maxPrice);
    const hasDeposit = req.query.hasDeposit === '1' ? true : req.query.hasDeposit === '0' ? false : undefined;
    const sortRaw = req.query.sort;
    const sort = sortRaw === 'price_desc' || sortRaw === 'newest' || sortRaw === 'rating' ? sortRaw : 'price_asc';
    const listings = (0, carService_1.searchListings)({
        city: typeof req.query.city === 'string' && (0, cities_1.isKnownCity)(req.query.city) ? req.query.city : undefined,
        carClass: isCarClass(req.query.carClass) ? req.query.carClass : undefined,
        transmission: isTransmission(req.query.transmission) ? req.query.transmission : undefined,
        brand: typeof req.query.brand === 'string' ? req.query.brand.trim().slice(0, 60) : undefined,
        minPrice: Number.isFinite(minPrice) && minPrice > 0 ? minPrice : undefined,
        maxPrice: Number.isFinite(maxPrice) && maxPrice > 0 ? maxPrice : undefined,
        hasDeposit,
        dateFrom: dateFrom && dateTo ? dateFrom : undefined,
        dateTo: dateFrom && dateTo ? dateTo : undefined,
        sort,
    });
    res.json({ listings });
});
exports.carsRouter.get('/mine', (req, res) => {
    const { user } = req;
    res.json({ listings: (0, carService_1.listListingsByOwner)(user.telegram_id) });
});
exports.carsRouter.get('/mine/stats', (req, res) => {
    const { user } = req;
    const range = parseRange(req);
    if (!range) {
        res.status(400).json({ error: 'Укажите диапазон дат (from, to)' });
        return;
    }
    res.json({ stats: (0, statsService_1.getOwnerStats)(user.telegram_id, range.from, range.to) });
});
/** Публикация нового объявления. Требует подтверждённый телефон и принятое Пользовательское соглашение. */
exports.carsRouter.post('/', auth_1.requireAgreementAccepted, (0, rateLimit_1.writeLimiter)(15, 10 * 60000), (req, res) => {
    const { user } = req;
    const { brand, model, year, color, plate, city, carClass, transmission, fuelType, seats, pricePerDay, deposit, minRentalDays, mileageLimit, restrictions, description, } = req.body ?? {};
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
    if (!(0, cities_1.isKnownCity)(city)) {
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
    if (!Number.isInteger(priceNum) || priceNum < 0 || priceNum > 1000000) {
        res.status(400).json({ error: 'Некорректная цена за сутки' });
        return;
    }
    const depositNum = Number(deposit ?? 0);
    if (!Number.isInteger(depositNum) || depositNum < 0 || depositNum > 5000000) {
        res.status(400).json({ error: 'Некорректная сумма залога' });
        return;
    }
    const minDaysNum = Number(minRentalDays ?? 1);
    if (!Number.isInteger(minDaysNum) || minDaysNum < 1 || minDaysNum > 90) {
        res.status(400).json({ error: 'Некорректный минимальный срок аренды' });
        return;
    }
    const mileageLimitNum = mileageLimit === undefined || mileageLimit === null || mileageLimit === '' ? undefined : Number(mileageLimit);
    if (mileageLimitNum !== undefined && (!Number.isInteger(mileageLimitNum) || mileageLimitNum < 0 || mileageLimitNum > 10000)) {
        res.status(400).json({ error: 'Некорректный лимит пробега' });
        return;
    }
    const listing = (0, carService_1.createListing)({
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
const MAX_PHOTOS_PER_LISTING = 10;
/** Загрузка фото автомобиля — до 10 штук на объявление, только владельцем. */
exports.carsRouter.post('/:id/photos', auth_1.requireAgreementAccepted, (0, rateLimit_1.writeLimiter)(20, 10 * 60000), (req, res, next) => {
    upload_1.uploadCarPhoto.array('photos', MAX_PHOTOS_PER_LISTING)(req, res, (err) => {
        if (err) {
            res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
            return;
        }
        next();
    });
}, async (req, res) => {
    const { user } = req;
    const listingId = (0, parseId_1.parseId)(req.params.id);
    const files = req.files ?? [];
    if (!listingId) {
        for (const f of files)
            fs_1.default.unlink(f.path, () => { });
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    if (!files.length) {
        res.status(400).json({ error: 'Файлы не получены' });
        return;
    }
    const listing = (0, carService_1.getListingWithExtras)(listingId);
    if (!listing || listing.owner_id !== user.telegram_id) {
        for (const f of files)
            fs_1.default.unlink(f.path, () => { });
        res.status(403).json({ error: 'Это не ваше объявление' });
        return;
    }
    const existing = (0, carService_1.countListingPhotos)(listingId);
    if (existing + files.length > MAX_PHOTOS_PER_LISTING) {
        for (const f of files)
            fs_1.default.unlink(f.path, () => { });
        res.status(400).json({ error: `Не более ${MAX_PHOTOS_PER_LISTING} фото на объявление` });
        return;
    }
    let position = existing;
    const saved = [];
    for (const file of files) {
        // Каждый файл валидируется независимо — плохой файл в середине пакета
        // не должен приводить к тому, что уже проверенные соседние файлы
        // тоже отбрасываются.
        if (!(0, upload_1.isValidImageFile)(file.path) || !(await (0, upload_1.processUploadedImage)(file.path))) {
            fs_1.default.unlink(file.path, () => { });
            continue;
        }
        (0, carService_1.addListingPhoto)(listingId, file.filename, position);
        saved.push(file.filename);
        position += 1;
    }
    if (!saved.length) {
        res.status(400).json({ error: 'Ни один файл не прошёл проверку — загрузите изображение JPEG, PNG или WebP' });
        return;
    }
    res.json({ photos: saved.map((f) => `/uploads/${f}`) });
});
function setStatus(status) {
    return (req, res) => {
        const { user } = req;
        const id = (0, parseId_1.parseId)(req.params.id);
        if (!id) {
            res.status(400).json({ error: 'Некорректный ID' });
            return;
        }
        const ok = (0, carService_1.setListingStatus)(id, user.telegram_id, status);
        if (!ok) {
            res.status(404).json({ error: 'Объявление не найдено' });
            return;
        }
        res.json({ ok: true });
    };
}
exports.carsRouter.post('/:id/pause', setStatus('paused'));
exports.carsRouter.post('/:id/activate', setStatus('active'));
exports.carsRouter.post('/:id/delete', setStatus('deleted'));
exports.carsRouter.get('/:id', (req, res) => {
    const id = (0, parseId_1.parseId)(req.params.id);
    if (!id) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    const listing = (0, carService_1.getListingWithExtras)(id);
    if (!listing) {
        res.status(404).json({ error: 'Объявление не найдено' });
        return;
    }
    res.json({ listing });
});
