"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.formatDate = formatDate;
exports.rentalDays = rentalDays;
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
function formatDate(iso) {
    if (!DATE_RE.test(iso))
        return iso;
    const [year, month, day] = iso.split('-');
    return `${day}.${month}.${year}`;
}
function toUtcDays(iso) {
    const [year, month, day] = iso.split('-').map(Number);
    return Date.UTC(year, month - 1, day) / 86400000;
}
/**
 * Число дней аренды: date_from — день получения автомобиля, date_to — день
 * возврата (сам день возврата в срок не входит, как в отеле — заезд/выезд).
 * Бронь «с 4 по 8 сентября» — это 4 дня аренды (4→5, 5→6, 6→7, 7→8), а не 5:
 * начислять деньги за 8-е число некорректно, если в этот день автомобиль
 * уже возвращается владельцу. Раньше формула добавляла +1 и включала оба
 * конца периода, из-за чего 4-дневная аренда считалась и оплачивалась как
 * 5-дневная.
 */
function rentalDays(dateFrom, dateTo) {
    return toUtcDays(dateTo) - toUtcDays(dateFrom);
}
