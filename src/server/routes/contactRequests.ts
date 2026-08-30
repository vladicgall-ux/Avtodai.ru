import { Router } from 'express';
import { requireAuth, requireActiveUser, requireAgreementAccepted, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import {
  createContactRequest,
  confirmContactRequest,
  declineContactRequest,
  getContactRequestWithPeople,
  listContactRequestsByRenter,
  listContactRequestsByOwner,
  ContactRequestError,
} from '../../services/contactRequestService';
import { notifyUser, type ActionButton } from '../../bot/notifier';
import { getUser } from '../../services/userService';
import { displayName, platformLabel } from '../../utils/displayName';
import { parseId } from '../utils/parseId';

export const contactRequestsRouter = Router();

contactRequestsRouter.use(requireAuth, requireActiveUser);

/** Мои запросы контактов как арендатора — телефон владельца виден только когда status = 'confirmed'. */
contactRequestsRouter.get('/mine', (req, res) => {
  const { user } = req as AuthedRequest;
  const list = listContactRequestsByRenter(user.telegram_id).map((r) => ({
    ...r,
    owner_phone: r.status === 'confirmed' ? r.owner_phone : null,
  }));
  res.json({ requests: list });
});

/** Входящие запросы контактов на мои объявления — телефон арендатора виден только после моего подтверждения. */
contactRequestsRouter.get('/owner', (req, res) => {
  const { user } = req as AuthedRequest;
  const list = listContactRequestsByOwner(user.telegram_id).map((r) => ({
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
contactRequestsRouter.post('/', requireAgreementAccepted, writeLimiter(20, 10 * 60_000), async (req, res) => {
  const { user } = req as AuthedRequest;
  const listingId = Number(req.body?.listingId);
  if (!Number.isInteger(listingId)) {
    res.status(400).json({ error: 'Некорректный запрос' });
    return;
  }

  try {
    const request = createContactRequest({ listingId, renterId: user.telegram_id });
    const full = getContactRequestWithPeople(request.id)!;

    // Уже был такой запрос и он ещё не обработан — не шлём повторное уведомление владельцу.
    if (request.status === 'pending') {
      const renterName = [displayName(user.full_name, user.first_name), user.username ? `@${user.username}` : null]
        .filter(Boolean)
        .join(' ');
      const ownerButtons: ActionButton[][] = [
        [
          { text: '✅ Показать контакты', action: `confirm_contact:${request.id}` },
          { text: '❌ Отклонить', action: `decline_contact:${request.id}` },
        ],
      ];
      const owner = getUser(full.owner_id);
      if (owner) {
        await notifyUser(
          owner,
          `📞 ${renterName} (${platformLabel(user.platform)}) хочет получить ваши контакты по объявлению ${full.brand} ${full.model} (${full.city}).\nПодтвердите, чтобы обменяться контактами.`,
          ownerButtons
        );
      }
      await notifyUser(
        user,
        `⏳ Запрос на контакты отправлен владельцу ${full.brand} ${full.model}. Как только он подтвердит — вы получите его телефон.`
      );
    }

    res.status(201).json({ request });
  } catch (err) {
    if (err instanceof ContactRequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

contactRequestsRouter.post('/:id/confirm', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  try {
    confirmContactRequest(id, user.telegram_id);
    const full = getContactRequestWithPeople(id)!;
    const renter = getUser(full.renter_id);
    if (renter) {
      await notifyUser(
        renter,
        `✅ Владелец подтвердил запрос! ${full.brand} ${full.model} (${full.city})\nВладелец: ${displayName(full.owner_full_name, full.owner_first_name)}${full.owner_phone ? `, тел. ${full.owner_phone}` : ''}`
      );
    }
    res.json({ request: full });
  } catch (err) {
    if (err instanceof ContactRequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

contactRequestsRouter.post('/:id/decline', async (req, res) => {
  const { user } = req as unknown as AuthedRequest;
  const id = parseId(req.params.id);
  if (!id) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  try {
    const request = declineContactRequest(id, user.telegram_id);
    const full = getContactRequestWithPeople(id);
    if (full) {
      const renter = getUser(full.renter_id);
      if (renter) {
        await notifyUser(renter, `❌ Владелец отклонил запрос на контакты по объявлению ${full.brand} ${full.model}.`);
      }
    }
    res.json({ request });
  } catch (err) {
    if (err instanceof ContactRequestError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
