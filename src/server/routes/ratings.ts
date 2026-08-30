import { Router } from 'express';
import { requireAuth, requireActiveUser, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { createOwnerRating, createRenterRating, RatingError } from '../../services/ratingService';

export const ratingsRouter = Router();

ratingsRouter.use(requireAuth, requireActiveUser);

/** Арендатор оценивает владельца после завершения аренды. */
ratingsRouter.post('/', writeLimiter(20, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  const bookingId = Number(req.body?.bookingId);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 300) : undefined;

  if (!Number.isInteger(bookingId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'Некорректная оценка' });
    return;
  }

  try {
    const record = createOwnerRating({ bookingId, renterId: user.telegram_id, rating, comment });
    res.status(201).json({ rating: record });
  } catch (err) {
    if (err instanceof RatingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});

/** Владелец оценивает арендатора конкретной брони. */
ratingsRouter.post('/renter', writeLimiter(20, 10 * 60_000), (req, res) => {
  const { user } = req as AuthedRequest;
  const bookingId = Number(req.body?.bookingId);
  const rating = Number(req.body?.rating);
  const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim().slice(0, 300) : undefined;

  if (!Number.isInteger(bookingId) || !Number.isInteger(rating) || rating < 1 || rating > 5) {
    res.status(400).json({ error: 'Некорректная оценка' });
    return;
  }

  try {
    const record = createRenterRating({ bookingId, ownerId: user.telegram_id, rating, comment });
    res.status(201).json({ rating: record });
  } catch (err) {
    if (err instanceof RatingError) {
      res.status(400).json({ error: err.message });
      return;
    }
    throw err;
  }
});
