import crypto from 'crypto';
import { config } from '../config';
import type { MaxProfile } from '../services/userService';

export interface ValidatedMaxInitData {
  user: MaxProfile;
  authDate: number;
}

/**
 * Проверяет подпись initData из MAX Mini App.
 *
 * Алгоритм подтверждён официальной документацией MAX (dev.max.ru/docs/
 * webapps/validation): та же схема, что и у Telegram Mini Apps —
 * HMAC-SHA256 от отсортированной data-check-string, ключ —
 * HMAC-SHA256('WebAppData', токен бота).
 */
export function validateMaxInitData(initData: string): ValidatedMaxInitData | null {
  // Логируем только короткую причину отказа, без самих данных — initData
  // содержит персональные данные пользователя MAX (id, имя, username), а
  // при неверной подписи ещё и посчитанный HMAC незачем писать в лог.
  const log = (reason: string) => console.log(`[maxAuth] отклонено: ${reason}`);

  if (!initData) {
    log('X-Max-Init-Data пустой или отсутствует');
    return null;
  }
  if (!config.maxBotToken) {
    log('MAX_BOT_TOKEN не задан на сервере');
    return null;
  }

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) {
    log('нет поля hash');
    return null;
  }
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.maxBotToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) {
    log('подпись не совпала');
    return null;
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  const now = Date.now() / 1000;
  if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + 300 || now - authDate > 60 * 60 * 24) {
    log('просрочено, из будущего или нет auth_date');
    return null;
  }

  const userRaw = params.get('user');
  if (!userRaw) {
    log('нет поля user');
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    log('поле user — невалидный JSON');
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || typeof (parsed as { id?: unknown }).id !== 'number') {
    log('поле user имеет неверную структуру');
    return null;
  }
  const raw = parsed as { id: number; first_name?: string; name?: string; username?: string };
  const user: MaxProfile = {
    id: raw.id,
    name: raw.name ?? raw.first_name ?? 'Пользователь MAX',
    username: raw.username ?? null,
  };
  return { user, authDate };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
