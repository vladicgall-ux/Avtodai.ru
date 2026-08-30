import citiesJson from './cities.json';

export interface CityInfo {
  name: string;
  region: string;
}

/**
 * Каталог городов РФ для фильтра и публикации объявлений. Список — не
 * официальный ОКАТО/ФИАС-реестр (это отдельная интеграция на будущее), а
 * курируемый набор крупнейших городов каждого региона, достаточный для
 * запуска сервиса по всей стране. Хранится в JSON, а не в БД — это
 * справочник, не пользовательские данные, его проще обновлять релизом.
 */
export const CITIES: readonly CityInfo[] = citiesJson as CityInfo[];

const CITY_NAME_SET = new Set(CITIES.map((c) => c.name));

export function isKnownCity(value: unknown): value is string {
  return typeof value === 'string' && CITY_NAME_SET.has(value);
}

/** Быстрый поиск городов по вхождению подстроки (регистронезависимо, без учёта ё/е) — для автокомплита. */
export function searchCities(query: string, limit = 20): CityInfo[] {
  const normalized = query.trim().toLowerCase().replace(/ё/g, 'е');
  if (!normalized) return CITIES.slice(0, limit);
  return CITIES.filter((c) => c.name.toLowerCase().replace(/ё/g, 'е').includes(normalized)).slice(0, limit);
}
