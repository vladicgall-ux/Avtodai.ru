"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.bookingsRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const bookingService_1 = require("../../services/bookingService");
const notifier_1 = require("../../bot/notifier");
const userService_1 = require("../../services/userService");
const displayName_1 = require("../../utils/displayName");
const dateFormat_1 = require("../../utils/dateFormat");
const parseId_1 = require("../utils/parseId");
exports.bookingsRouter = (0, express_1.Router)();
exports.bookingsRouter.use(auth_1.requireAuth, auth_1.requireActiveUser);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseRange(from, to) {
    if (typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)) {
        return { from, to };
    }
    return undefined;
}
/** Брони текущего пользователя как арендатора. */
exports.bookingsRouter.get('/mine', (req, res) => {
    const { user } = req;
    res.json({ bookings: (0, bookingService_1.listBookingsByRenter)(user.telegram_id, parseRange(req.query.from, req.query.to)) });
});
/** Брони на объявления текущего пользователя как владельца. */
exports.bookingsRouter.get('/owner', (req, res) => {
    const { user } = req;
    res.json({ bookings: (0, bookingService_1.listBookingsByOwner)(user.telegram_id, parseRange(req.query.from, req.query.to)) });
});
/**
 * Бронирование автомобиля на период. Требует подтверждённый телефон и
 * принятое Пользовательское соглашение — арендатор соглашается с тем, что
 * автодай.рф — лишь информационный посредник (ст. 1253.1 ГК РФ), а сама
 * сделка заключается напрямую между ним и владельцем. Бронь резервирует
 * даты сразу, но остаётся 'pending', пока владелец не подтвердит её.
 */
exports.bookingsRouter.post('/', auth_1.requireAgreementAccepted, (0, rateLimit_1.writeLimiter)(20, 10 * 60000), async (req, res) => {
    const { user } = req;
    const listingId = Number(req.body?.listingId);
    const dateFrom = typeof req.body?.dateFrom === 'string' ? req.body.dateFrom : '';
    const dateTo = typeof req.body?.dateTo === 'string' ? req.body.dateTo : '';
    if (!Number.isInteger(listingId) || !DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
        res.status(400).json({ error: 'Некорректный запрос на бронирование' });
        return;
    }
    try {
        const booking = (0, bookingService_1.createBooking)({ listingId, renterId: user.telegram_id, dateFrom, dateTo });
        const full = (0, bookingService_1.getBookingWithPeople)(booking.id);
        const renterName = [(0, displayName_1.displayName)(user.full_name, user.first_name), user.username ? `@${user.username}` : null]
            .filter(Boolean)
            .join(' ');
        const ownerButtons = [
            [
                { text: '✅ Подтверждаю бронь', action: `confirm_booking:${booking.id}` },
                { text: '❌ Отклонить', action: `decline_booking:${booking.id}` },
            ],
        ];
        const owner = (0, userService_1.getUser)(full.owner_id);
        if (owner) {
            await (0, notifier_1.notifyUser)(owner, `🚗 Новая заявка на аренду!\n${renterName} (${(0, displayName_1.platformLabel)(user.platform)}) хочет арендовать ${full.brand} ${full.model} с ${(0, dateFormat_1.formatDate)(dateFrom)} по ${(0, dateFormat_1.formatDate)(dateTo)}.\nСумма: ${booking.total_price} ₽${booking.deposit ? ` + залог ${booking.deposit} ₽` : ''}.\nНажмите «Подтверждаю», чтобы бронь закрепилась и вы получили контакт арендатора.`, ownerButtons);
        }
        await (0, notifier_1.notifyUser)(user, `⏳ Заявка отправлена владельцу!\n${full.brand} ${full.model}, ${(0, dateFormat_1.formatDate)(dateFrom)} — ${(0, dateFormat_1.formatDate)(dateTo)}\nВладелец: ${full.owner_first_name}${owner ? ` (${(0, displayName_1.platformLabel)(owner.platform)})` : ''}\nЖдём подтверждения — как только владелец подтвердит, вы получите его контакт и сможете сформировать договор аренды.`);
        res.status(201).json({ booking });
    }
    catch (err) {
        if (err instanceof bookingService_1.BookingError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
exports.bookingsRouter.post('/:id/cancel', async (req, res) => {
    const { user } = req;
    const bookingId = (0, parseId_1.parseId)(req.params.id);
    if (!bookingId) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : undefined;
    try {
        const booking = (0, bookingService_1.cancelBooking)(bookingId, user.telegram_id, reason);
        const full = (0, bookingService_1.getBookingWithPeople)(booking.id);
        if (full) {
            const owner = (0, userService_1.getUser)(full.owner_id);
            if (owner) {
                await (0, notifier_1.notifyUser)(owner, `❌ Арендатор (${(0, displayName_1.platformLabel)(user.platform)}) отменил бронь на ${full.brand} ${full.model} (${(0, dateFormat_1.formatDate)(full.date_from)} — ${(0, dateFormat_1.formatDate)(full.date_to)}).${reason ? `\nПричина: ${reason}` : ''}`);
            }
        }
        res.json({ booking });
    }
    catch (err) {
        if (err instanceof bookingService_1.BookingError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
/** Владелец подтверждает бронь на своё объявление. */
exports.bookingsRouter.post('/:id/confirm', async (req, res) => {
    const { user } = req;
    const bookingId = (0, parseId_1.parseId)(req.params.id);
    if (!bookingId) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    try {
        const booking = (0, bookingService_1.confirmBooking)(bookingId, user.telegram_id);
        const full = (0, bookingService_1.getBookingWithPeople)(booking.id);
        const renter = (0, userService_1.getUser)(full.renter_id);
        if (renter) {
            await (0, notifier_1.notifyUser)(renter, `✅ Владелец подтвердил бронь!\n${full.brand} ${full.model}, ${(0, dateFormat_1.formatDate)(full.date_from)} — ${(0, dateFormat_1.formatDate)(full.date_to)}\nВладелец: ${full.owner_first_name}${full.owner_phone ? `, тел. ${full.owner_phone}` : ''}\nСформируйте договор аренды и акт приёма-передачи в разделе брони — это защитит обе стороны.`);
        }
        res.json({ booking });
    }
    catch (err) {
        if (err instanceof bookingService_1.BookingError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
/** Владелец отклоняет бронь. */
exports.bookingsRouter.post('/:id/decline', async (req, res) => {
    const { user } = req;
    const bookingId = (0, parseId_1.parseId)(req.params.id);
    if (!bookingId) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : undefined;
    try {
        const booking = (0, bookingService_1.declineBooking)(bookingId, user.telegram_id, reason);
        const full = (0, bookingService_1.getBookingWithPeople)(booking.id);
        const renter = (0, userService_1.getUser)(full.renter_id);
        if (renter) {
            await (0, notifier_1.notifyUser)(renter, `❌ Владелец отклонил бронь на ${full.brand} ${full.model} (${(0, dateFormat_1.formatDate)(full.date_from)} — ${(0, dateFormat_1.formatDate)(full.date_to)}).${reason ? `\nПричина: ${reason}` : ''}`);
        }
        res.json({ booking });
    }
    catch (err) {
        if (err instanceof bookingService_1.BookingError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
