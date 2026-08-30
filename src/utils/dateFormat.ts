const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Форматирует календарную дату аренды (хранится как 'YYYY-MM-DD', без
 * времени и часового пояса — сервис работает по всей России в разных
 * часовых поясах, а даты начала/конца аренды не привязаны к конкретному
 * часовому поясу). Парсим вручную, а не через `new Date(iso)`, потому что
 * встроенный парсер интерпретирует голую дату как полночь UTC — в часовых
 * поясах восточнее UTC (вся Россия) при выводе через toLocaleString с
 * локальным TZ дата могла бы сместиться на предыдущий день.
 */
export function formatDate(iso: string): string {
  if (!DATE_RE.test(iso)) return iso;
  const [year, month, day] = iso.split('-');
  return `${day}.${month}.${year}`;
}

function toUtcDays(iso: string): number {
  const [year, month, day] = iso.split('-').map(Number);
  return Date.UTC(year, month - 1, day) / 86_400_000;
}

/** Число дней аренды включительно (date_from и date_to — обе входят в срок). */
export function rentalDays(dateFrom: string, dateTo: string): number {
  return toUtcDays(dateTo) - toUtcDays(dateFrom) + 1;
}
