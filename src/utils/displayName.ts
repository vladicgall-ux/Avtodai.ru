import type { Platform } from '../services/userService';

/** Настоящее имя и фамилия, если пользователь их указал, иначе — имя из профиля платформы. */
export function displayName(fullName: string | null | undefined, firstName: string): string {
  return fullName || firstName;
}

/**
 * Человекочитаемая метка платформы для уведомлений — чтобы было сразу
 * понятно, из Telegram собеседник или из MAX (это разные пространства
 * контактов: username из одной платформы бесполезен в другой).
 */
export function platformLabel(platform: Platform): string {
  return platform === 'max' ? 'MAX' : 'Telegram';
}
