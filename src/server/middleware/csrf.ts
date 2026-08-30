import type { Request, Response, NextFunction } from 'express';
import { config } from '../../config';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Защита от CSRF для веб-версии вне Mini App: там авторизация — обычная
 * ambient-кука (web_session), значит браузер жертвы сам приложит её к
 * кросс-сайтовому запросу. SameSite=Lax на куке (см. routes/auth.ts) уже
 * блокирует межсайтовые POST/PUT/DELETE в актуальных браузерах, но это
 * второй, независимый эшелон защиты — сверка Origin/Referer с каноничным
 * доменом сервиса, как рекомендует OWASP (Origin & Referer verification).
 *
 * Внутри Mini App (Telegram/MAX) авторизация идёт по заголовку initData,
 * который сторонний сайт подделать не может (подписан секретом бота) —
 * там ambient-куки не используется вообще, поэтому такие запросы CSRF в
 * принципе не угрожают, и проверка Origin их не трогает.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (req.header('X-Telegram-Init-Data') || req.header('X-Max-Init-Data')) {
    next();
    return;
  }
  if (!config.publicOrigin) {
    // Домен ещё не настроен (например, только разворачиваетесь на хостинге
    // без привязанного домена) — пропускаем проверку, чтобы не заблокировать
    // единственный на тот момент способ входа. Как только PUBLIC_ORIGIN
    // задан в .env, проверка включается автоматически.
    next();
    return;
  }

  const origin = req.header('Origin');
  const referer = req.header('Referer');
  const candidate = origin ?? referer;
  if (!candidate) {
    // Запрос с cookie, но вовсе без Origin/Referer — так ведут себя не
    // только некоторые кросс-сайтовые атаки, но и часть легитимных
    // старых/приватных браузерных режимов. Раз других сигналов нет,
    // безопаснее отклонить: cookie-аутентифицированный запрос без Origin
    // не должен быть штатным сценарием обычного SPA.
    res.status(403).json({ error: 'Запрос отклонён: отсутствует заголовок Origin' });
    return;
  }
  // Сравниваем именно origin (схема+хост+порт), а не префикс строки: startsWith
  // одновременно и слишком строг (ловит, например, лишний слэш на конце
  // PUBLIC_ORIGIN, из-за чего с точно тем же доменом запрос отклонялся бы),
  // и недостаточно строг как защита — "https://autodai.ru.evil.com" тоже
  // начинается с "https://autodai.ru".
  let candidateOrigin: string;
  try {
    candidateOrigin = new URL(candidate).origin;
  } catch {
    res.status(403).json({ error: 'Запрос отклонён: недопустимый источник' });
    return;
  }
  const expectedOrigin = config.publicOrigin.replace(/\/+$/, '');
  if (candidateOrigin !== expectedOrigin) {
    res.status(403).json({ error: 'Запрос отклонён: недопустимый источник' });
    return;
  }
  next();
}
