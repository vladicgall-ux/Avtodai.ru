"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseId = parseId;
exports.parseSignedId = parseSignedId;
/** Разбирает и валидирует числовой ID из параметра маршрута (req.params.id и т.п.). */
function parseId(raw) {
    if (!raw || !/^\d+$/.test(raw))
        return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id > 0 ? id : null;
}
/**
 * Как parseId, но допускает отрицательные значения — telegram_id
 * пользователей MAX хранится в БД со знаком минус (см. userService.maxStorageId),
 * так что admin-роуты, принимающие telegram_id пользователя, должны уметь
 * разобрать и такой ID.
 */
function parseSignedId(raw) {
    if (!raw || !/^-?\d+$/.test(raw))
        return null;
    const id = Number(raw);
    return Number.isSafeInteger(id) && id !== 0 ? id : null;
}
