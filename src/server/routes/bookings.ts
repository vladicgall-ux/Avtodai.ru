import { Router } from 'express';
import { requireAuth, requireActiveUser, requireAgreementAccepted, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import {
  createBooking,
  cancelBooking,
  cancelBookingByOwner,
  listBookingsByRenter,
  listBookingsByOwner,
  confirmBooking,
  declineBooking,
  getBookingWithPeople,
  BookingError,
} from '../../services/bookingService';
import { notifyUser, notifyContractReady, type ActionButton } from '../../bot/notifier';
import { getUser } from '../../services/userService';
import { displayName, platformLabel } from '../../utils/displayName';
import { formatDate } from '../../utils/dateFormat';
import { parseId } from '../utils/parseId';
import { escapeBotHtml as esc } from '../../utils/escapeBotHtml';

export const bookingsRouter = Router();

bookingsRouter.use(requireAuth, requireActiveUser);

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseRange(from: unknown, to: unknown): { from: string; to: string } | undefined {
  if (typeof from === 'string' && typeof to === 'string' && DATE_RE.test(from) && DATE_RE.test(to)) {
    return { from, to };
  }
  return undefined;
}

/** Брони текущего пользователя как арендатора. */
bookingsRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ bookings: listBookingsByRenter(user.telegram_id, parseRange(req.query.from, req.query.to)) });
});

/** Брони на объявления текущего пользователя как владельца. */
bookingsRouter.get('/owner', (req, res) => {
  const { user } = req as AuthedRequest;
  res.json({ bookings: listBookingsByOwner(user.telegram_id, parseRange(req.query.from, req.query.to)) });
});

/**
 * Бронирование автомобиля на период. Требует подтверждённый телефон и
 * принятое Пользовательское соглашение — арендатор соглашается с тем, что
 * автодай.рф — лишь информационный посредник (ст. 1253.1 ГК РФ), а сама
 * сделка заключается напрямую между ним и владельцем. Бронь резервирует
 * даты сразу, но остаётся 'pending', пока владелец не подтвердит её.
 */
bookingsRouter.post('/', requireAgreementAccepted, writeLimiter(20, 10 * 60_000), async (req, res) => {
  const { user } = req as AuthedRequest;
  const listingId = Number(req.body?.listingId);
  const dateFrom = typeof req.body?.dateFrom === 'string' ? req.body.dateFrom : '';
  const dateTo = typeof req.body?.dateTo === 'string' ? req.body.dateTo : '';
  if (!Number.isInteger(listingId) || !DATE_RE.test(dateFrom) || !DATE_RE.test(dateTo)) {
    res.status(400).json({ error: 'Некорректный запрос на бронирование' });
    return;
  }

  try {
    const booking = createBooking({ listingId, renterId: user.telegram_id, dateFrom, dateTo });
    const full = getBookingWithPeople(booking.id)!;

    const renterName = [displayName(user.full_name, user.first_name), user.username ? `@${user.username}` : null]
      .filter(Boolean)
      .join(' ');

    const ownerButtons: ActionButton[][] = [
      [
        { text: '✅ Подтверждаю бронь', action: `confirm_booking:${booking.id}` },
        { text: '❌ Отклонить', action: `decline_booking:${booking.id}` },
      ],
    ];
    const owner = getUser(full.owner_id);
    if (owner) {
      await notifyUser(
        owner,
        `🚗 Новая заявка на аренду!\n${esc(renterName)} (${platformLabel(user.platform)}) хочет арендовать ${esc(full.brand)} ${esc(full.model)} с ${formatDate(dateFrom)} по ${formatDate(dateTo)}.\nСумма: ${booking.total_price} ₽${booking.deposit ? ` + залог ${booking.deposit} ₽` : ''}.\nНажмите «Подтверждаю», чтобы бронь закрепилась и вы получили контакт арендатора.`,
        ownerButtons
      );
    }
    await notifyUser(
      user,
      `⏳ Заявка отправлена владельцу!\n${esc(full.brand)} ${esc(full.model)}, ${formatDate(dateFrom)} — ${formatDate(dateTo)}\nВладелец: ${esc(full.owner_first_name)}${owner ? ` (${platformLabel(owner.platform)})` : ''}\nЖдём подтверждения — как только владелец подтвердит, вы получите его контакт и сможете сформировать договор аренды.`
    );

    res.status(201).json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

bookingsRouter.post('/:id/cancel', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const bookingId = parseId(req.params.id);
  if (!bookingId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : undefined;
  try {
    const booking = cancelBooking(bookingId, user.telegram_id, reason);
    const full = getBookingWithPeople(booking.id);
    if (full) {
      const owner = getUser(full.owner_id);
      if (owner) {
        await notifyUser(
          owner,
          `❌ Арендатор (${platformLabel(user.platform)}) отменил бронь на ${esc(full.brand)} ${esc(full.model)} (${formatDate(full.date_from)} — ${formatDate(full.date_to)}).${reason ? `\nПричина: ${esc(reason)}` : ''}`
        );
      }
    }
    res.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** Владелец отменяет уже подтверждённую бронь (например, машина сломалась) — арендатор получает уведомление; расчёты между сторонами (возврат средств) сервис не проводит. */
bookingsRouter.post('/:id/cancel-owner', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const bookingId = parseId(req.params.id);
  if (!bookingId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : undefined;
  try {
    const booking = cancelBookingByOwner(bookingId, user.telegram_id, reason);
    const full = getBookingWithPeople(booking.id);
    if (full) {
      const renter = getUser(full.renter_id);
      if (renter) {
        await notifyUser(
          renter,
          `❌ Владелец отменил подтверждённую бронь на ${esc(full.brand)} ${esc(full.model)} (${formatDate(full.date_from)} — ${formatDate(full.date_to)}).${reason ? `\nПричина: ${esc(reason)}` : ''}`
        );
      }
    }
    res.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** Владелец подтверждает бронь на своё объявление. */
bookingsRouter.post('/:id/confirm', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const bookingId = parseId(req.params.id);
  if (!bookingId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  try {
    const booking = confirmBooking(bookingId, user.telegram_id);
    const full = getBookingWithPeople(booking.id)!;
    const renter = getUser(full.renter_id);
    if (renter) {
      await notifyUser(
        renter,
        `✅ Владелец подтвердил бронь!\n${esc(full.brand)} ${esc(full.model)}, ${formatDate(full.date_from)} — ${formatDate(full.date_to)}\nВладелец: ${esc(full.owner_first_name)}${full.owner_phone ? `, тел. ${esc(full.owner_phone)}` : ''}`
      );
      await notifyContractReady(renter, booking.id);
    }
    await notifyContractReady(user, booking.id);
    res.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** Владелец отклоняет бронь. */
bookingsRouter.post('/:id/decline', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const bookingId = parseId(req.params.id);
  if (!bookingId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const reason = typeof req.body?.reason === 'string' ? req.body.reason.trim().slice(0, 300) : undefined;
  try {
    const booking = declineBooking(bookingId, user.telegram_id, reason);
    const full = getBookingWithPeople(booking.id)!;
    const renter = getUser(full.renter_id);
    if (renter) {
      await notifyUser(
        renter,
        `❌ Владелец отклонил бронь на ${esc(full.brand)} ${esc(full.model)} (${formatDate(full.date_from)} — ${formatDate(full.date_to)}).${reason ? `\nПричина: ${esc(reason)}` : ''}`
      );
    }
    res.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
