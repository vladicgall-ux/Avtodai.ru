import crypto from 'crypto';
import { config } from '../config';
import type { TelegramProfile } from '../services/userService';

export interface ValidatedInitData {
  user: TelegramProfile;
  authDate: number;
}

/**
 * Проверяет подпись initData, которую Telegram Mini App передаёт на бэкенд.
 * Алгоритм из официальной документации Telegram (валидация Web App данных):
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function validateInitData(initData: string): ValidatedInitData | null {
  if (!initData) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computedHash = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  if (!timingSafeEqualHex(computedHash, hash)) {
    return null;
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  const now = Date.now() / 1000;
  // initData считается просроченной через 24 часа. Верхнюю границу (now + 5
  // минут) проверяем на случай будущей даты — она бы никогда не устарела.
  if (!Number.isFinite(authDate) || authDate <= 0 || authDate > now + 300 || now - authDate > 60 * 60 * 24) {
    return null;
  }

  const userRaw = params.get('user');
  if (!userRaw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(userRaw);
  } catch {
    return null;
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    typeof (parsed as { id?: unknown }).id !== 'number' ||
    typeof (parsed as { first_name?: unknown }).first_name !== 'string'
  ) {
    return null;
  }

  return { user: parsed as TelegramProfile, authDate };
}

function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}
