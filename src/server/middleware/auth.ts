import type { Request, Response, NextFunction } from 'express';
import { validateInitData } from '../../utils/telegramAuth';
import { validateMaxInitData } from '../../utils/maxAuth';
import { upsertUser, upsertMaxUser, getUser, type UserRecord } from '../../services/userService';
import { getSessionUser } from '../../services/webSessionService';
import { config } from '../../config';

export interface AuthedRequest extends Request {
  user: UserRecord;
}

export const SESSION_COOKIE_NAME = 'web_session';

/** Простой разбор Cookie-заголовка — одна ожидаемая кука, тащить ради
 *  неё зависимость cookie-parser не нужно. */
export function readCookie(req: Request, name: string): string | undefined {
  const header = req.header('Cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/**
 * Принимает initData либо из Telegram (заголовок X-Telegram-Init-Data), либо
 * из MAX (заголовок X-Max-Init-Data) — это авторизация внутри Mini App. Вне
 * Mini App (обычный браузер на ПК/телефоне) initData нет вовсе — там
 * используется cookie-сессия, выданная после входа кодом в чате с ботом
 * (см. server/routes/auth.ts). Один из трёх способов должен сработать —
 * иначе запрос отклоняется.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const telegramInitData = req.header('X-Telegram-Init-Data') ?? '';
  const validatedTelegram = validateInitData(telegramInitData);
  if (validatedTelegram) {
    const user = upsertUser(validatedTelegram.user);
    (req as AuthedRequest).user = getUser(user.telegram_id)!;
    next();
    return;
  }

  const maxInitData = req.header('X-Max-Init-Data') ?? '';
  const validatedMax = validateMaxInitData(maxInitData);
  if (validatedMax) {
    const user = upsertMaxUser(validatedMax.user);
    (req as AuthedRequest).user = getUser(user.telegram_id)!;
    next();
    return;
  }

  const sessionToken = readCookie(req, SESSION_COOKIE_NAME);
  const sessionUser = sessionToken ? getSessionUser(sessionToken) : undefined;
  if (sessionUser) {
    (req as AuthedRequest).user = sessionUser;
    next();
    return;
  }

  res.status(401).json({ error: 'Недействительные данные авторизации' });
}

/**
 * Полностью закрывает доступ к разделу (поиск/бронирование/публикация
 * объявлений) забаненным и неверифицированным пользователям — не только
 * запись, но и чтение. Ставится после requireAuth. GET /api/users/me этой
 * проверкой НЕ прикрыт намеренно — фронтенду нужно узнать статус, чтобы
 * показать экран блокировки.
 */
export function requireActiveUser(req: Request, res: Response, next: NextFunction): void {
  const { user } = req as AuthedRequest;
  if (config.adminIds.includes(user.telegram_id)) {
    // Админы не должны иметь возможность случайно заблокировать себе доступ
    // к собственной панели, отозвав себе телефон или забанив самих себя.
    next();
    return;
  }
  if (user.banned) {
    res.status(403).json({ error: 'Ваш аккаунт заблокирован администратором', banned: true });
    return;
  }
  if (!user.phone_verified) {
    res.status(403).json({ error: 'Подтвердите номер телефона в чате с ботом', phoneRequired: true });
    return;
  }
  if (!user.full_name) {
    res.status(403).json({ error: 'Укажите имя и фамилию', nameRequired: true });
    return;
  }
  next();
}

/**
 * Требуется перед любым действием, которое создаёт публичное обязательство
 * между пользователями площадки (публикация объявления, бронирование) —
 * ст. 1253.1 ГК РФ и Пользовательское соглашение автодай.рф применяются
 * только к тем, кто явно принял оферту чекбоксом в интерфейсе.
 */
export function requireAgreementAccepted(req: Request, res: Response, next: NextFunction): void {
  const { user } = req as AuthedRequest;
  if (!user.agreement_accepted_at) {
    res.status(403).json({
      error: 'Необходимо принять Пользовательское соглашение сервиса автодай.рф',
      agreementRequired: true,
    });
    return;
  }
  next();
}
