"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.legalRouter = void 0;
const express_1 = require("express");
const auth_1 = require("../middleware/auth");
const texts_1 = require("../../legal/texts");
const bookingService_1 = require("../../services/bookingService");
const contractService_1 = require("../../services/contractService");
const parseId_1 = require("../utils/parseId");
exports.legalRouter = (0, express_1.Router)();
// Публичное, без авторизации — соглашение должно быть доступно (в футере
// веба, меню бота) ещё до входа, это требование самого документа.
exports.legalRouter.get('/agreement', (_req, res) => {
    res.json({ version: texts_1.USER_AGREEMENT_VERSION, text: texts_1.USER_AGREEMENT_TEXT, html: (0, texts_1.userAgreementHtml)() });
});
/**
 * Генератор типового договора аренды с актом приёма-передачи — доступен
 * только двум сторонам подтверждённой брони, ни администратору, ни
 * посторонним (сервис не должен раздавать даже частично заполненные
 * персональные данные третьим лицам). Возвращает готовую HTML-страницу
 * с кнопкой печати — из браузера/WebView её можно распечатать или
 * сохранить как PDF («Печать» → «Сохранить как PDF» — так же работает
 * внутри Telegram/MAX WebView, если платформа даёт доступ к системному
 * диалогу печати, либо через открытие ссылки во внешнем браузере).
 */
exports.legalRouter.get('/contract/:bookingId', auth_1.requireAuth, (req, res) => {
    const { user } = req;
    const bookingId = (0, parseId_1.parseId)(req.params.bookingId);
    if (!bookingId) {
        res.status(400).json({ error: 'Некорректный ID брони' });
        return;
    }
    const booking = (0, bookingService_1.getBookingWithPeople)(bookingId);
    if (!booking) {
        res.status(404).json({ error: 'Бронирование не найдено' });
        return;
    }
    if (booking.renter_id !== user.telegram_id && booking.owner_id !== user.telegram_id) {
        res.status(403).json({ error: 'Договор доступен только сторонам этой брони' });
        return;
    }
    if (booking.status !== 'confirmed' && booking.status !== 'completed') {
        res.status(403).json({ error: 'Договор можно сформировать только после подтверждения брони владельцем' });
        return;
    }
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.send((0, contractService_1.renderContractHtml)(booking));
});
