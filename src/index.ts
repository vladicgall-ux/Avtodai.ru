import './db/db';
import { config } from './config';
import { createApp } from './server/app';
import { createBot } from './bot/bot';
import { createMaxBot } from './bot/maxBot';
import { sweepExpiredBookings } from './services/bookingService';
import { sendRatingReminders, sendPhoneVerificationReminders } from './jobs/reminders';
import { sweepExpiredWebAuth } from './services/webSessionService';

const SWEEP_INTERVAL_MS = 60_000;

async function main() {
  console.log(`NODE_EXTRA_CA_CERTS=${process.env.NODE_EXTRA_CA_CERTS ?? '(не задан)'}`);
  if (config.maxBotToken && !process.env.NODE_EXTRA_CA_CERTS) {
    // API MAX (business.max.ru) отдаёт сертификат, подписанный Russian
    // Trusted Root CA (Минцифры) — этого корневого сертификата нет в
    // стандартном доверенном хранилище Node.js/Mozilla. Если основной
    // сервер работает не в российском дата-центре, запросы к MAX упадут с
    // ошибкой TLS (UNABLE_TO_VERIFY_LEAF_SIGNATURE), пока сертификат из
    // certs/russian_trusted_ca.pem не подключён через NODE_EXTRA_CA_CERTS
    // (см. .env.example и README.md). Это не критическая ошибка — бот
    // Telegram и веб продолжат работать, — но бот MAX не сможет отвечать.
    console.warn(
      'MAX_BOT_TOKEN задан, но NODE_EXTRA_CA_CERTS — нет. Если основной сервер ' +
        'не в российском регионе, запросы к API MAX могут падать по TLS. ' +
        'Укажите NODE_EXTRA_CA_CERTS=./certs/russian_trusted_ca.pem — см. README.md.'
    );
  }

  if (!config.publicOrigin) {
    // Без PUBLIC_ORIGIN проверка Origin/Referer в csrfProtection() пропускает
    // все запросы (см. server/middleware/csrf.ts) — сознательный компромисс,
    // а не отказ запуска: бот и Mini App должны продолжать работать, даже
    // если хостинг ещё не выдал/не привязал публичный домен. Но раз это
    // ослабляет защиту веб-версии (браузер вне Mini App, вход по cookie) от
    // CSRF, дежурное предупреждение в логе — не пропустить это в production.
    console.warn(
      'PUBLIC_ORIGIN не задан — проверка Origin/Referer (защита от CSRF для веб-версии) ' +
        'отключена. Задайте PUBLIC_ORIGIN=https://<ваш-домен> в production.'
    );
  }

  const app = createApp();
  app.listen(config.port, () => {
    console.log(`${config.serviceName}: HTTP-сервер и Mini App запущены на порту ${config.port}`);
  });

  const bot = createBot();
  // ВАЖНО: bot.launch() в режиме long polling не резолвится, пока бот не
  // остановлен (Telegraf держит промис открытым на весь срок жизни опроса) —
  // await здесь блокировал бы вообще весь код ниже (в т.ч. периодические
  // задачи) до самой остановки процесса. Поэтому запускаем без await и сами
  // логируем результат/ошибку запуска.
  bot
    .launch()
    .then(() => console.log('Telegram-бот запущен (long polling)'))
    .catch((err) => console.error('Не удалось запустить Telegram-бота:', err));

  // Бот MAX полностью опционален — создаётся, только если задан
  // MAX_BOT_TOKEN, и не должен мешать боту Telegram, если что-то пойдёт не
  // так. bot.start() у MAX SDK так же не резолвится, пока бот не
  // остановлен — запускаем без await, по той же причине, что и Telegram.
  let maxBot: ReturnType<typeof createMaxBot> | undefined;
  let maxBotShuttingDown = false;
  const MAX_START_RETRY_MS = 30_000;
  if (config.maxBotToken) {
    maxBot = createMaxBot();
    /**
     * Два известных бага в @maxhub/max-bot-api (long polling), из-за которых
     * бот MAX периодически «навсегда замолкал» и оживал только после
     * ручного передеплоя контейнера:
     *
     * 1) Bot.pollingIsStarted выставляется в true ДО await getMyInfo() и
     *    сбрасывается обратно в false только внутри bot.stop(). Если
     *    первый вызов start() падает, повторный вызов startMaxBot() по
     *    таймеру натыкается на `if (pollingIsStarted) return;` и молча
     *    ничего не делает.
     * 2) В самом long-polling цикле при восстановимой ошибке (сеть
     *    оборвалась, 429, 5xx) вместо `continue` стоит `return` — цикл
     *    опроса тихо завершается, а start() при этом РЕЗОЛВИТСЯ, как будто
     *    всё в порядке.
     *
     * Фикс: и на resolve(), и на reject() считаем, что опрос остановился и
     * его нужно поднять заново, а перед каждым повторным start() явно
     * вызываем stop() — это гарантированно сбрасывает pollingIsStarted
     * независимо от того, в каком состоянии баг оставил бота.
     */
    const startMaxBot = () => {
      maxBot!
        .start()
        .then(() => {
          if (maxBotShuttingDown) {
            console.log('Бот MAX остановлен (штатное завершение).');
            return;
          }
          console.warn(
            'Бот MAX: long polling неожиданно завершился (известный баг SDK при сетевой ошибке) — перезапускаю...'
          );
          maxBot!.stop();
          startMaxBot();
        })
        .catch((err) => {
          console.error('Не удалось запустить бота MAX:', err);
          console.log(`Повторная попытка запуска бота MAX через ${MAX_START_RETRY_MS / 1000} секунд...`);
          maxBot!.stop();
          setTimeout(startMaxBot, MAX_START_RETRY_MS);
        });
    };
    startMaxBot();
  }

  // Переводит брони, срок которых истёк, в «завершена»/«отменена» — без
  // этого статус навсегда оставался бы прежним, даже когда аренда давно
  // закончилась. Через сутки после date_to напоминает арендатору оценить владельца.
  const runPeriodicJobs = () => {
    try {
      sweepExpiredBookings();
    } catch (err) {
      console.error('Ошибка при обработке истёкших бронирований:', err);
    }
    sendRatingReminders().catch((err) => console.error('Ошибка при отправке напоминаний об оценке:', err));
    sendPhoneVerificationReminders().catch((err) =>
      console.error('Ошибка при отправке напоминаний о подтверждении телефона:', err)
    );
    try {
      sweepExpiredWebAuth();
    } catch (err) {
      console.error('Ошибка при очистке истёкших веб-сессий:', err);
    }
  };
  runPeriodicJobs();
  const jobsTimer = setInterval(runPeriodicJobs, SWEEP_INTERVAL_MS);

  // Telegraf/MAX SDK бросают синхронное исключение ('Bot is not running!'),
  // если stop() вызван раньше, чем launch()/start() успел завершить
  // инициализацию (например, сигнал пришёл сразу после старта контейнера) —
  // без try/catch это необработанное исключение в обработчике сигнала
  // валило весь процесс, и хостинг видел бесконечный цикл рестартов вместо
  // штатной остановки.
  const shutdown = (signal: 'SIGINT' | 'SIGTERM') => {
    clearInterval(jobsTimer);
    try {
      bot.stop(signal);
    } catch (err) {
      console.error('Ошибка при остановке Telegram-бота:', err);
    }
    try {
      maxBotShuttingDown = true;
      maxBot?.stop();
    } catch (err) {
      console.error('Ошибка при остановке бота MAX:', err);
    }
    process.exit(0);
  };
  process.once('SIGINT', () => shutdown('SIGINT'));
  process.once('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Не удалось запустить приложение:', err);
  process.exit(1);
});

// Последний рубеж защиты от падения всего процесса на необработанной ошибке
// где-нибудь в фоновой задаче или колбэке, до которого не дотянулся try/catch —
// без этого один такой сбой обрушивал бы весь сервис (бот + API + сайт) сразу.
process.on('unhandledRejection', (reason) => {
  console.error('Необработанный отказ промиса:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('Необработанное исключение:', err);
});
