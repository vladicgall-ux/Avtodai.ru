import multer from 'multer';
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';
import { config } from '../../config';
import type { AuthedRequest } from './auth';

export const uploadsDir = path.join(path.dirname(config.dbPath), 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const ALLOWED_TYPES: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
};

const carPhotoStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    // Middleware order guarantees requireAuth ran first, so req.user is set.
    const ownerId = (req as unknown as AuthedRequest).user.telegram_id;
    const ext = ALLOWED_TYPES[file.mimetype] ?? '.jpg';
    // crypto-random суффикс — без него параллельная загрузка двух фото одним
    // владельцем в один и тот же миллисекунд перезаписала бы файл друг друга.
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `car-${ownerId}-${unique}${ext}`);
  },
});

export const uploadCarPhoto = multer({
  storage: carPhotoStorage,
  limits: { fileSize: 5 * 1024 * 1024, files: 10 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      cb(new Error('Разрешены только изображения JPEG, PNG или WebP'));
      return;
    }
    cb(null, true);
  },
});

const broadcastStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext = ALLOWED_TYPES[file.mimetype] ?? '.jpg';
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    cb(null, `broadcast-${unique}${ext}`);
  },
});

/** Фото для массовой рассылки из админки — не привязано к объявлению,
 *  удаляется сразу после отправки (не должно оставаться в /uploads навсегда). */
export const uploadBroadcastPhoto = multer({
  storage: broadcastStorage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_TYPES[file.mimetype]) {
      cb(new Error('Разрешены только изображения JPEG, PNG или WebP'));
      return;
    }
    cb(null, true);
  },
});

/**
 * `fileFilter` в multer видит только заголовок Content-Type, который
 * присылает клиент — его легко подделать (например, назвать .php файл
 * image/jpeg). Здесь уже после записи на диск проверяем настоящую сигнатуру
 * (magic bytes) файла — это и есть реальная защита от загрузки не-картинки
 * под видом картинки. Вызывать после multer, до того как файл где-либо
 * используется (например, отдаётся через /uploads или отправляется в Telegram/MAX).
 */
export function isValidImageFile(filePath: string): boolean {
  let fd: number;
  try {
    fd = fs.openSync(filePath, 'r');
  } catch {
    return false;
  }
  try {
    const buf = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, buf, 0, 12, 0);
    if (bytesRead < 4) return false;
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return true; // JPEG
    if (
      buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a
    ) return true; // PNG
    if (bytesRead === 12 && buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return true; // WebP
    return false;
  } finally {
    fs.closeSync(fd);
  }
}

const MAX_IMAGE_DIMENSION = 5000;
const MAX_IMAGE_PIXELS = 20_000_000;

/**
 * Небольшой файл может быть JPEG/PNG-«бомбой» — валидные магические байты,
 * но при декодировании разворачивается в изображение в десятки тысяч
 * пикселей по стороне, съедая всю память процесса (image bomb). sharp с
 * limitInputPixels откажется декодировать такое ещё на этапе чтения
 * заголовка, не выделяя память под сам пиксельный буфер. Заодно
 * перекодируем файл — это убирает любые встроенные данные оригинала (EXIF
 * с геолокацией съёмки и т.п.), которые не проходят через декодер как
 * обычные пиксели, и заодно любой полиглот-контент, спрятанный после
 * валидных данных изображения. Возвращает false, если файл не удалось
 * безопасно обработать — тогда вызывающий код должен удалить файл и
 * отклонить запрос.
 */
export async function processUploadedImage(filePath: string, mimetype: string): Promise<boolean> {
  try {
    const probe = sharp(filePath, { limitInputPixels: MAX_IMAGE_PIXELS, failOn: 'error' });
    const metadata = await probe.metadata();
    if (!metadata.width || !metadata.height) return false;
    if (metadata.width > MAX_IMAGE_DIMENSION || metadata.height > MAX_IMAGE_DIMENSION) return false;

    let pipeline = sharp(filePath, { limitInputPixels: MAX_IMAGE_PIXELS }).rotate();
    if (mimetype === 'image/png') pipeline = pipeline.png();
    else if (mimetype === 'image/webp') pipeline = pipeline.webp();
    else pipeline = pipeline.jpeg();

    const buffer = await pipeline.toBuffer();
    fs.writeFileSync(filePath, buffer);
    return true;
  } catch {
    return false;
  }
}

/** Удаляет файл с диска, игнорируя отсутствие файла — используется при откате неудачной загрузки. */
export function removeUploadedFile(filePath: string): void {
  try {
    fs.unlinkSync(filePath);
  } catch {
    // файла уже нет — ничего страшного
  }
}
