"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.config = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
function required(name, fallback) {
    const value = process.env[name] ?? fallback;
    if (!value) {
        throw new Error(`Не задана переменная окружения ${name}. Смотрите .env.example`);
    }
    return value;
}
const webappUrlRaw = (process.env.WEBAPP_URL ?? '').trim();
const maxBotTokenRaw = (process.env.MAX_BOT_TOKEN ?? '').trim();
const maxBotLinkRaw = (process.env.MAX_BOT_LINK ?? '').trim();
const publicOriginRaw = (process.env.PUBLIC_ORIGIN ?? '').trim();
exports.config = {
    botToken: required('BOT_TOKEN'),
    // Не обязателен на старте: пока не известен публичный HTTPS-домен
    // (например, только разворачиваетесь на хостинге и ждёте домен),
    // бот должен запускаться и работать, просто без кнопки Mini App.
    webappUrl: webappUrlRaw.startsWith('https://') ? webappUrlRaw : undefined,
    // Каноничный публичный Origin сервиса — используется CSRF-защитой
    // (сверка заголовков Origin/Referer у запросов с cookie-сессией) и CORS.
    // Пока домен не известен, проверка Origin просто разрешает запросы без
    // заголовка (см. server/middleware/csrf.ts) — это безопасно, потому что
    // единственный способ атаки (CSRF) требует чужого сайта именно с этим
    // заголовком выставленным браузером.
    publicOrigin: publicOriginRaw.startsWith('https://') ? publicOriginRaw : undefined,
    // Бот MAX опционален и полностью отключён, пока переменная не задана —
    // не должен мешать уже работающему боту Telegram, если что-то пойдёт не так.
    maxBotToken: maxBotTokenRaw || undefined,
    // Прямая ссылка на чат с ботом в MAX (например, https://max.ru/<username>) —
    // отдаётся фронтенду через /api/config для кнопки «Открыть чат в MAX» на
    // экране входа и в поддержке. Опционально, т.к. в отличие от Telegram
    // (где ссылка t.me/<username> строится по известному username бота) точный
    // публичный формат ссылки на бота MAX задаётся вручную после регистрации
    // бота в business.max.ru.
    maxBotLink: maxBotLinkRaw.startsWith('https://') ? maxBotLinkRaw : undefined,
    port: Number(process.env.PORT ?? 3000),
    adminIds: (process.env.ADMIN_IDS ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map(Number),
    dbPath: process.env.DB_PATH ?? './data/avtodai.db',
    // Бампается вручную вместе с ?v=NN у app.js/styles.css в public/index.html.
    // Клиент сверяет это значение при загрузке и сам перезагружает страницу,
    // если у пользователя в кэше/WebView застряла старая версия.
    appVersion: '36',
    serviceName: 'АвтоДай.рф',
    serviceDomain: 'автодай.рф',
};
