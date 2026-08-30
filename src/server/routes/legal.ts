import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { USER_AGREEMENT_TEXT, USER_AGREEMENT_VERSION, userAgreementHtml } from '../../legal/texts';
import { getBookingWithPeople } from '../../services/bookingService';
import { renderContractHtml } from '../../services/contractService';
import { parseId } from '../utils/parseId';

export const legalRouter = Router();

// Публичное, без авторизации — соглашение должно быть доступно (в футере
// веба, меню бота) ещё до входа, это требование самого документа.
legalRouter.get('/agreement', (_req, res) => {
  res.json({ version: USER_AGREEMENT_VERSION, text: USER_AGREEMENT_TEXT, html: userAgreementHtml() });
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
legalRouter.get('/contract/:bookingId', requireAuth, (req, res) => {
  const { user } = req as AuthedRequest;
  const bookingId = parseId(req.params.bookingId);
  if (!bookingId) {
    res.status(400).json({ error: 'Некорректный ID брони' });
    return;
  }
  const booking = getBookingWithPeople(bookingId);
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
  res.send(renderContractHtml(booking));
});
