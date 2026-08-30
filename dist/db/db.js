"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.db = void 0;
const better_sqlite3_1 = __importDefault(require("better-sqlite3"));
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const config_1 = require("../config");
const dbDir = path_1.default.dirname(config_1.config.dbPath);
if (!fs_1.default.existsSync(dbDir)) {
    fs_1.default.mkdirSync(dbDir, { recursive: true });
}
exports.db = new better_sqlite3_1.default(config_1.config.dbPath);
exports.db.pragma('journal_mode = WAL');
exports.db.pragma('foreign_keys = ON');
// Без этого параллельная запись (например, периодическая задача и HTTP-запрос
// почти одновременно) сразу получила бы SQLITE_BUSY вместо короткого
// ожидания снятия блокировки другим соединением.
exports.db.pragma('busy_timeout = 5000');
const schema = fs_1.default.readFileSync(path_1.default.join(__dirname, 'schema.sql'), 'utf-8');
exports.db.exec(schema);
