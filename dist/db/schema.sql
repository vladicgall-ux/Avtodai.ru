-- Пользователи (владельцы авто и арендаторы — одна таблица, роль не жёсткая:
-- любой пользователь может и сдавать, и арендовать).
CREATE TABLE IF NOT EXISTS users (
  telegram_id         INTEGER PRIMARY KEY,
  first_name          TEXT NOT NULL,
  last_name           TEXT,
  username            TEXT,
  phone               TEXT,
  phone_verified      INTEGER NOT NULL DEFAULT 0, -- 1, если номер подтверждён через Telegram-контакт
  banned              INTEGER NOT NULL DEFAULT 0, -- 1, если администратор заблокировал доступ
  full_name           TEXT,                       -- имя и фамилия, которые пользователь вводит сам
  agreement_accepted_at TEXT,                      -- когда принято Пользовательское соглашение автодай.рф
  last_seen_at        TEXT,
  platform            TEXT NOT NULL DEFAULT 'telegram' CHECK (platform IN ('telegram','max')),
  phone_reminder_sent_at TEXT,
  created_at          TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Объявления о сдаче автомобиля в аренду. Создаётся только после
-- подтверждения телефона и принятия Пользовательского соглашения —
-- это защита от фейковых объявлений.
CREATE TABLE IF NOT EXISTS car_listings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id        INTEGER NOT NULL REFERENCES users(telegram_id),
  brand           TEXT NOT NULL,
  model           TEXT NOT NULL,
  year            INTEGER NOT NULL CHECK (year BETWEEN 1970 AND 2100),
  color           TEXT,
  plate           TEXT NOT NULL, -- госномер, показывается только владельцу и подтверждённому арендатору
  city            TEXT NOT NULL,
  car_class       TEXT NOT NULL DEFAULT 'economy' CHECK (car_class IN ('economy','comfort','business','premium','suv','minivan')),
  transmission    TEXT NOT NULL DEFAULT 'manual' CHECK (transmission IN ('manual','automatic')),
  fuel_type       TEXT NOT NULL DEFAULT 'petrol' CHECK (fuel_type IN ('petrol','diesel','hybrid','electric','gas')),
  seats           INTEGER NOT NULL DEFAULT 5 CHECK (seats BETWEEN 1 AND 9),
  price_per_day   INTEGER NOT NULL CHECK (price_per_day >= 0),
  deposit         INTEGER NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  min_rental_days INTEGER NOT NULL DEFAULT 1 CHECK (min_rental_days BETWEEN 1 AND 90),
  mileage_limit   INTEGER,     -- лимит пробега в км/сутки, NULL — без ограничения
  restrictions    TEXT,        -- ограничения владельца: «без выезда за город», «не сдаётся в такси» и т.п.
  description     TEXT,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','deleted')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_listings_search ON car_listings (status, city, price_per_day);

-- Фото автомобиля — несколько на объявление, с порядком отображения.
CREATE TABLE IF NOT EXISTS car_photos (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES car_listings(id) ON DELETE CASCADE,
  photo_path  TEXT NOT NULL,
  position    INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_car_photos_listing ON car_photos (listing_id, position);

-- Бронирования аренды. Бронь резервируется сразу (status='pending'), но
-- становится окончательной только после подтверждения владельцем
-- (status='confirmed') — так же, как подтверждение брони места в исходном
-- rideshare-проекте poehali74, на архитектуре которого построен АвтоДай.рф.
CREATE TABLE IF NOT EXISTS bookings (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id      INTEGER NOT NULL REFERENCES car_listings(id),
  renter_id       INTEGER NOT NULL REFERENCES users(telegram_id),
  date_from       TEXT NOT NULL, -- 'YYYY-MM-DD'
  date_to         TEXT NOT NULL, -- 'YYYY-MM-DD', включительно
  total_price     INTEGER NOT NULL CHECK (total_price >= 0),
  deposit         INTEGER NOT NULL DEFAULT 0 CHECK (deposit >= 0),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled','completed')),
  cancellation_reason TEXT,
  cancelled_at    TEXT,
  reminder_sent   INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  -- Момент последнего изменения статуса (подтверждение/отмена/завершение) —
  -- список броней сортируется по нему, чтобы недавнее действие всплывало
  -- наверх независимо от даты самой поездки или момента создания брони.
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_bookings_listing ON bookings (listing_id, status);
CREATE INDEX IF NOT EXISTS idx_bookings_renter ON bookings (renter_id, status);

-- Периоды, которые владелец вручную закрывает от бронирования (например,
-- сам пользуется машиной эти даты) — отдельно от bookings, где даты заняты
-- уже состоявшимся бронированием арендатора.
CREATE TABLE IF NOT EXISTS listing_blocked_dates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id  INTEGER NOT NULL REFERENCES car_listings(id) ON DELETE CASCADE,
  date_from   TEXT NOT NULL, -- 'YYYY-MM-DD'
  date_to     TEXT NOT NULL, -- 'YYYY-MM-DD', включительно
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  CHECK (date_to >= date_from)
);

CREATE INDEX IF NOT EXISTS idx_blocked_dates_listing ON listing_blocked_dates (listing_id);

-- Запрос контактов — лёгкое действие «хочу списаться с владельцем», отдельное
-- от бронирования (не требует выбора дат/суммы). Телефоны обеих сторон
-- раскрываются только после того, как владелец подтвердит запрос — до этого
-- арендатор видит только имя и рейтинг владельца в самом объявлении.
CREATE TABLE IF NOT EXISTS contact_requests (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  listing_id    INTEGER NOT NULL REFERENCES car_listings(id),
  renter_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','declined')),
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  confirmed_at  TEXT
);

CREATE INDEX IF NOT EXISTS idx_contact_requests_listing ON contact_requests (listing_id, status);
CREATE INDEX IF NOT EXISTS idx_contact_requests_renter ON contact_requests (renter_id, status);

-- Обращения в поддержку: и из Mini App, и из обычного текстового сообщения боту.
CREATE TABLE IF NOT EXISTS support_messages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  message     TEXT NOT NULL,
  from_admin  INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_support_user ON support_messages (user_id);

-- Оценки владельцев автомобилей арендаторами.
CREATE TABLE IF NOT EXISTS owner_ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id),
  owner_id    INTEGER NOT NULL REFERENCES users(telegram_id),
  renter_id   INTEGER NOT NULL REFERENCES users(telegram_id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_owner_ratings_owner ON owner_ratings (owner_id);

-- Оценки арендаторов владельцами — помогает решить, подтверждать ли бронь.
CREATE TABLE IF NOT EXISTS renter_ratings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  booking_id  INTEGER NOT NULL REFERENCES bookings(id),
  owner_id    INTEGER NOT NULL REFERENCES users(telegram_id),
  renter_id   INTEGER NOT NULL REFERENCES users(telegram_id),
  rating      INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment     TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (booking_id)
);

CREATE INDEX IF NOT EXISTS idx_renter_ratings_renter ON renter_ratings (renter_id);

-- Веб-сессии для входа с ПК/браузера вне Mini App.
CREATE TABLE IF NOT EXISTS web_sessions (
  token       TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(telegram_id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_web_sessions_user ON web_sessions (user_id);

-- Одноразовые коды для входа в браузерной версии: пользователь получает
-- код на сайте и присылает боту в чат (Telegram или MAX) — бот подтверждает
-- код и привязывает к нему свой user_id.
CREATE TABLE IF NOT EXISTS login_codes (
  code        TEXT PRIMARY KEY,
  poll_token  TEXT,
  user_id     INTEGER REFERENCES users(telegram_id),
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT
);
