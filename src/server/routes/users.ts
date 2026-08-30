import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { setFullName, setAgreementAccepted, getUser } from '../../services/userService';
import { getOwnerRatingSummary, getRenterRatingSummary } from '../../services/ratingService';
import { listListingsByOwner } from '../../services/carService';
import { config } from '../../config';

export const usersRouter = Router();

usersRouter.use(requireAuth);

/** Профиль текущего пользователя: данные аккаунта + сводка объявлений/рейтингов. */
usersRouter.get('/me', (req, res) => {
  const { user } = req as AuthedRequest;
  const isAdmin = config.adminIds.includes(user.telegram_id);
  const listings = listListingsByOwner(user.telegram_id);
  const ownerRating = listings.length ? getOwnerRatingSummary(user.telegram_id) : null;
  const renterRating = getRenterRatingSummary(user.telegram_id);
  res.json({ user, listings, isAdmin, ownerRating, renterRating });
});

/**
 * Сохраняет ФИО (фамилия, имя, отчество) — не через requireActiveUser,
 * потому что именно отсутствие full_name и есть та проверка, которую этот
 * запрос должен снять (иначе получился бы замкнутый круг). Телефон всё
 * равно обязателен — ФИО вводят уже после подтверждения номера. Обязательны
 * все три слова: сервис требует полное ФИО до того, как пользователь сможет
 * что-либо делать (см. app.js::boot(), гейт 'name' показывается сразу при
 * запуске, если full_name пуст).
 */
usersRouter.post('/me/name', writeLimiter(10, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  if (user.banned) {
    res.status(403).json({ error: 'Аккаунт заблокирован' });
    return;
  }
  if (!user.phone_verified) {
    res.status(403).json({ error: 'Сначала подтвердите номер телефона в чате с ботом' });
    return;
  }
  const fullName = typeof req.body?.fullName === 'string' ? req.body.fullName.trim().replace(/\s+/g, ' ') : '';
  if (fullName.length > 100 || fullName.split(' ').length < 3) {
    res.status(400).json({ error: 'Укажите фамилию, имя и отчество через пробел' });
    return;
  }
  setFullName(user.telegram_id, fullName);
  res.json({ user: getUser(user.telegram_id) });
});

/**
 * Принятие Пользовательского соглашения сервиса автодай.рф — обязательный
 * чекбокс перед публикацией объявления или бронированием (см. requireAgreementAccepted).
 * Отдельный, не через requireActiveUser: принять оферту можно и без
 * подтверждённого телефона, это независимое условие.
 */
usersRouter.post('/me/agreement/accept', writeLimiter(10, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  setAgreementAccepted(user.telegram_id);
  res.json({ user: getUser(user.telegram_id) });
});
