"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CITIES = void 0;
exports.isKnownCity = isKnownCity;
exports.searchCities = searchCities;
const cities_json_1 = __importDefault(require("./cities.json"));
/**
 * Каталог городов РФ для фильтра и публикации объявлений. Список — не
 * официальный ОКАТО/ФИАС-реестр (это отдельная интеграция на будущее), а
 * курируемый набор крупнейших городов каждого региона, достаточный для
 * запуска сервиса по всей стране. Хранится в JSON, а не в БД — это
 * справочник, не пользовательские данные, его проще обновлять релизом.
 */
exports.CITIES = cities_json_1.default;
const CITY_NAME_SET = new Set(exports.CITIES.map((c) => c.name));
function isKnownCity(value) {
    return typeof value === 'string' && CITY_NAME_SET.has(value);
}
/** Быстрый поиск городов по вхождению подстроки (регистронезависимо, без учёта ё/е) — для автокомплита. */
function searchCities(query, limit = 20) {
    const normalized = query.trim().toLowerCase().replace(/ё/g, 'е');
    if (!normalized)
        return exports.CITIES.slice(0, limit);
    return exports.CITIES.filter((c) => c.name.toLowerCase().replace(/ё/g, 'е').includes(normalized)).slice(0, limit);
}
