import { Router, type Request, type Response } from 'express';
import fs from 'fs';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { uploadBroadcastPhoto, isValidImageFile, processUploadedImage } from '../middleware/upload';
import { config } from '../../config';
import { listAllUsers, listActiveUserIds, setUserBanned, getUser } from '../../services/userService';
import { listListingsByOwner, searchListings } from '../../services/carService';
import { listAllBookings, listBookingsByRenter } from '../../services/bookingService';
import { listAllSupportMessages, createAdminReply } from '../../services/supportService';
import { getAdminStats, getOwnerAllTimeStats, getRenterAllTimeStats } from '../../services/statsService';
import { getOwnerRatingSummary, getRenterRatingSummary } from '../../services/ratingService';
import { notifyPhoto, notifyUser } from '../../bot/notifier';
import { parseSignedId } from '../utils/parseId';
import { db } from '../../db/db';

export const adminRouter = Router();

adminRouter.use(requireAuth);

adminRouter.use((req, res, next) => {
  const { user } = req as AuthedRequest;
  if (!config.adminIds.includes(user.telegram_id)) {
    res.status(403).json({ error: 'Доступ только для администраторов' });
    return;
  }
  next();
});

adminRouter.get('/stats', (_req, res) => {
  res.json({ stats: getAdminStats() });
});

adminRouter.get('/users', (_req, res) => {
  res.json({ users: listAllUsers() });
});

/** Подробная карточка пользователя для админки: объявления, брони, статистика за всё время. */
adminRouter.get('/users/:id', (req, res) => {
  const telegramId = parseSignedId(req.params.id);
  if (!telegramId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const user = getUser(telegramId);
  if (!user) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }
  const listings = listListingsByOwner(telegramId);
  const ownerStats = listings.length ? getOwnerAllTimeStats(telegramId) : null;
  const ownerRating = listings.length ? getOwnerRatingSummary(telegramId) : null;
  const bookings = listBookingsByRenter(telegramId);
  const renterStats = getRenterAllTimeStats(telegramId);
  const renterRating = getRenterRatingSummary(telegramId);
  // Сигнал для модерации: сколько раз пользователь сам отменял брони.
  const cancelledBookingsCount = (
    db
      .prepare(`SELECT COUNT(*) AS n FROM bookings WHERE renter_id = ? AND cancellation_reason IS NOT NULL`)
      .get(telegramId) as { n: number }
  ).n;
  res.json({
    user,
    listings,
    ownerStats,
    ownerRating,
    bookings,
    renterStats,
    renterRating,
    cancelledBookingsCount,
  });
});

adminRouter.get('/listings', (_req, res) => {
  res.json({ listings: searchListings({ sort: 'newest' }) });
});

adminRouter.get('/bookings', (_req, res) => {
  res.json({ bookings: listAllBookings() });
});

adminRouter.get('/support', (_req, res) => {
  res.json({ messages: listAllSupportMessages() });
});

/** Ответ администратора пользователю — уходит ему сообщением от бота. */
adminRouter.post('/support/:userId/reply', async (req, res) => {
  const userId = parseSignedId(req.params.userId);
  if (!userId) {
    res.status(400).json({ error: 'Некорректный ID' });
    return;
  }
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  if (!message) {
    res.status(400).json({ error: 'Введите текст ответа' });
    return;
  }
  const target = getUser(userId);
  if (!target) {
    res.status(404).json({ error: 'Пользователь не найден' });
    return;
  }
  const record = createAdminReply(userId, message);
  await notifyUser(target, `✉️ <b>Ответ поддержки</b>\n\n${message}`);
  res.status(201).json({ message: record });
});

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Массовая рассылка всем незаблокированным пользователям от имени бота
 * (не от личного аккаунта админа). Текст и/или фото — нужно хотя бы одно.
 * Шлём последовательно с небольшой паузой, чтобы не упереться в лимит
 * Telegram (~30 сообщений/сек на бота).
 */
adminRouter.post(
  '/broadcast',
  writeLimiter(5, 60 * 60_000),
  (req, res, next) => {
    uploadBroadcastPhoto.single('photo')(req, res, (err: unknown) => {
      if (err) {
        res.status(400).json({ error: err instanceof Error ? err.message : 'Не удалось загрузить фото' });
        return;
      }
      next();
    });
  },
  async (req, res) => {
    const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
    const file = (req as unknown as { file?: Express.Multer.File }).file;
    // multipart/form-data — значения всегда строки, не булевы.
    const pin = req.body?.pin === 'true' || req.body?.pin === '1';

    if (!message && !file) {
      res.status(400).json({ error: 'Добавьте текст или фото' });
      return;
    }
    if (file) {
      if (!isValidImageFile(file.path)) {
        fs.unlink(file.path, () => {});
        res.status(400).json({ error: 'Файл повреждён или не является изображением' });
        return;
      }
      if (!(await processUploadedImage(file.path))) {
        fs.unlink(file.path, () => {});
        res.status(400).json({ error: 'Не удалось обработать изображение — попробуйте другой файл' });
        return;
      }
    }

    const recipients = listActiveUserIds();
    // Отвечаем сразу, не дожидаясь конца рассылки: при сотнях получателей
    // с паузой 40мс + временем самого запроса к Telegram/MAX это легко
    // уходит за 30-60 секунд — типичный таймаут реверс-прокси на хостинге,
    // который просто оборвал бы соединение с клиентом на середине рассылки.
    res.json({ accepted: true, total: recipients.length });

    let sent = 0;
    for (const telegramId of recipients) {
      const recipient = getUser(telegramId);
      if (!recipient) continue;
      // Фото умеем слать только через Telegram — у пользователей MAX пока
      // нет notifyPhoto для этой платформы, поэтому им уходит хотя бы текст.
      const ok =
        file && recipient.platform === 'telegram'
          ? await notifyPhoto(telegramId, file.path, message, pin)
          : await notifyUser(recipient, message || `📷 Новое объявление от ${config.serviceName}`, undefined, pin);
      if (ok) sent += 1;
      await sleep(40);
    }

    if (file) {
      fs.unlink(file.path, () => {});
    }

    console.log(`Рассылка завершена: отправлено ${sent} из ${recipients.length}`);
  }
);

function setBan(banned: boolean) {
  return (req: Request, res: Response) => {
    const telegramId = parseSignedId(req.params.id);
    if (!telegramId) {
      res.status(400).json({ error: 'Некорректный ID' });
      return;
    }
    if (config.adminIds.includes(telegramId)) {
      res.status(400).json({ error: 'Нельзя заблокировать администратора' });
      return;
    }
    const target = getUser(telegramId);
    if (!target) {
      res.status(404).json({ error: 'Пользователь не найден' });
      return;
    }
    setUserBanned(telegramId, banned);
    res.json({ user: getUser(telegramId) });
  };
}

adminRouter.post('/users/:id/ban', setBan(true));
adminRouter.post('/users/:id/unban', setBan(false));
