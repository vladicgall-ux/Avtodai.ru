"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.displayName = displayName;
exports.platformLabel = platformLabel;
/** Настоящее имя и фамилия, если пользователь их указал, иначе — имя из профиля платформы. */
function displayName(fullName, firstName) {
    return fullName || firstName;
}
/**
 * Человекочитаемая метка платформы для уведомлений — чтобы было сразу
 * понятно, из Telegram собеседник или из MAX (это разные пространства
 * контактов: username из одной платформы бесполезен в другой).
 */
function platformLabel(platform) {
    return platform === 'max' ? 'MAX' : 'Telegram';
}
