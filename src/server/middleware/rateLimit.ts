import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import type { Request } from 'express';
import type { AuthedRequest } from './auth';

/** Ключ лимитера: свой telegram_id, если запрос уже прошёл requireAuth
 *  (роут стоит после него), иначе — IP как запасной вариант. Фоллбэк идёт через
 *  штатный ipKeyGenerator — он корректно нормализует IPv6-адреса (иначе клиент
 *  мог бы обходить лимит перебором адресов внутри своей /64 подсети). */
function authedKey(req: Request): string {
  const user = (req as unknown as AuthedRequest).user;
  return user ? `u:${user.telegram_id}` : `ip:${ipKeyGenerator(req.ip ?? '')}`;
}

/** Лимитер для «дорогих»/спам-опасных write-эндпоинтов (бронирование, публикация
 *  объявления, оценка, поддержка, загрузка фото) — считает по пользователю, не по IP,
 *  т.к. несколько пользователей могут сидеть за одним IP (мобильный NAT). */
export function writeLimiter(max: number, windowMs: number) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: authedKey,
    message: { error: 'Слишком много запросов. Попробуйте немного позже.' },
  });
}
