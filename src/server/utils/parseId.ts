/** Разбирает и валидирует числовой ID из параметра маршрута (req.params.id и т.п.). */
export function parseId(raw: string | undefined): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/**
 * Как parseId, но допускает отрицательные значения — telegram_id
 * пользователей MAX хранится в БД со знаком минус (см. userService.maxStorageId),
 * так что admin-роуты, принимающие telegram_id пользователя, должны уметь
 * разобрать и такой ID.
 */
export function parseSignedId(raw: string | undefined): number | null {
  if (!raw || !/^-?\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) && id !== 0 ? id : null;
}
