"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactRequestsRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const rateLimit_1 = require("../middleware/rateLimit");
const contactRequestService_1 = require("../../services/contactRequestService");
const notifier_1 = require("../../bot/notifier");
const userService_1 = require("../../services/userService");
const displayName_1 = require("../../utils/displayName");
const parseId_1 = require("../utils/parseId");
exports.contactRequestsRouter = (0, express_1.Router)();
exports.contactRequestsRouter.use(auth_1.requireAuth, auth_1.requireActiveUser);
/** Мои запросы контактов как арендатора — телефон владельца виден только когда status = 'confirmed'. */
exports.contactRequestsRouter.get('/mine', (req, res) => {
    const { user } = req;
    const list = (0, contactRequestService_1.listContactRequestsByRenter)(user.telegram_id).map((r) => ({
        ...r,
        owner_phone: r.status === 'confirmed' ? r.owner_phone : null,
    }));
    res.json({ requests: list });
});
/** Входящие запросы контактов на мои объявления — телефон арендатора виден только после моего подтверждения. */
exports.contactRequestsRouter.get('/owner', (req, res) => {
    const { user } = req;
    const list = (0, contactRequestService_1.listContactRequestsByOwner)(user.telegram_id).map((r) => ({
        ...r,
        renter_phone: r.status === 'confirmed' ? r.renter_phone : null,
    }));
    res.json({ requests: list });
});
/**
 * Лёгкий запрос «показать контакты» — без выбора дат, в отличие от брони.
 * Требует принятое Пользовательское соглашение: это тоже действие, при
 * котором сервис сводит двух пользователей и передаёт персональные данные
 * (телефон) от одного к другому.
 */
exports.contactRequestsRouter.post('/', auth_1.requireAgreementAccepted, (0, rateLimit_1.writeLimiter)(20, 10 * 60000), async (req, res) => {
    const { user } = req;
    const listingId = Number(req.body?.listingId);
    if (!Number.isInteger(listingId)) {
        res.status(400).json({ error: 'Некорректный запрос' });
        return;
    }
    try {
        const request = (0, contactRequestService_1.createContactRequest)({ listingId, renterId: user.telegram_id });
        const full = (0, contactRequestService_1.getContactRequestWithPeople)(request.id);
        // Уже был такой запрос и он ещё не обработан — не шлём повторное уведомление владельцу.
        if (request.status === 'pending') {
            const renterName = [(0, displayName_1.displayName)(user.full_name, user.first_name), user.username ? `@${user.username}` : null]
                .filter(Boolean)
                .join(' ');
            const ownerButtons = [
                [
                    { text: '✅ Показать контакты', action: `confirm_contact:${request.id}` },
                    { text: '❌ Отклонить', action: `decline_contact:${request.id}` },
                ],
            ];
            const owner = (0, userService_1.getUser)(full.owner_id);
            if (owner) {
                await (0, notifier_1.notifyUser)(owner, `📞 ${renterName} (${(0, displayName_1.platformLabel)(user.platform)}) хочет получить ваши контакты по объявлению ${full.brand} ${full.model} (${full.city}).\nПодтвердите, чтобы обменяться контактами.`, ownerButtons);
            }
            await (0, notifier_1.notifyUser)(user, `⏳ Запрос на контакты отправлен владельцу ${full.brand} ${full.model}. Как только он подтвердит — вы получите его телефон.`);
        }
        res.status(201).json({ request });
    }
    catch (err) {
        if (err instanceof contactRequestService_1.ContactRequestError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
exports.contactRequestsRouter.post('/:id/confirm', async (req, res) => {
    const { user } = req;
    const id = (0, parseId_1.parseId)(req.params.id);
    if (!id) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    try {
        (0, contactRequestService_1.confirmContactRequest)(id, user.telegram_id);
        const full = (0, contactRequestService_1.getContactRequestWithPeople)(id);
        const renter = (0, userService_1.getUser)(full.renter_id);
        if (renter) {
            await (0, notifier_1.notifyUser)(renter, `✅ Владелец подтвердил запрос! ${full.brand} ${full.model} (${full.city})\nВладелец: ${(0, displayName_1.displayName)(full.owner_full_name, full.owner_first_name)}${full.owner_phone ? `, тел. ${full.owner_phone}` : ''}`);
        }
        res.json({ request: full });
    }
    catch (err) {
        if (err instanceof contactRequestService_1.ContactRequestError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
exports.contactRequestsRouter.post('/:id/decline', async (req, res) => {
    const { user } = req;
    const id = (0, parseId_1.parseId)(req.params.id);
    if (!id) {
        res.status(400).json({ error: 'Некорректный ID' });
        return;
    }
    try {
        const request = (0, contactRequestService_1.declineContactRequest)(id, user.telegram_id);
        const full = (0, contactRequestService_1.getContactRequestWithPeople)(id);
        if (full) {
            const renter = (0, userService_1.getUser)(full.renter_id);
            if (renter) {
                await (0, notifier_1.notifyUser)(renter, `❌ Владелец отклонил запрос на контакты по объявлению ${full.brand} ${full.model}.`);
            }
        }
        res.json({ request });
    }
    catch (err) {
        if (err instanceof contactRequestService_1.ContactRequestError) {
            res.status(400).json({ error: err.message });
            return;
        }
        throw err;
    }
});
