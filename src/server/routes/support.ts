import { Router } from 'express';
import { requireAuth, type AuthedRequest } from '../middleware/auth';
import { writeLimiter } from '../middleware/rateLimit';
import { createSupportMessage } from '../../services/supportService';
import { notifyAdmins } from '../../bot/notifier';
import { displayName } from '../../utils/displayName';

export const supportRouter = Router();

// Специально без requireActiveUser: даже забаненный или неверифицированный
// пользователь должен иметь возможность написать в поддержку и разобраться в ситуации.
supportRouter.use(requireAuth);

// Отдельный, более жёсткий лимит — иначе пользователь может засыпать
// администратора сообщениями и раздуть таблицу support_messages.
supportRouter.post('/', writeLimiter(8, 5 * 60_000), async (req, res) => {
  const { user } = req as AuthedRequest;
  const message = typeof req.body?.message === 'string' ? req.body.message.trim().slice(0, 1000) : '';
  if (!message) {
    res.status(400).json({ error: 'Введите текст сообщения' });
    return;
  }

  const record = createSupportMessage(user.telegram_id, message);

  const senderName = [displayName(user.full_name, user.first_name), user.username ? `@${user.username}` : null]
    .filter(Boolean)
    .join(' ');
  await notifyAdmins(
    `🆘 <b>Сообщение в поддержку</b>\nОт: ${senderName} (ID ${user.telegram_id})${user.phone ? `, ${user.phone}` : ''}\n\n${message}`
  );

  res.status(201).json({ message: record });
});
