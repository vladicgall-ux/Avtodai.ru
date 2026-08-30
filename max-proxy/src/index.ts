import http from 'http';
import https from 'https';
import { URL } from 'url';

/**
 * Лёгкий обратный прокси без БД и бизнес-логики. Разворачивается отдельным
 * ботом на РФ-регионе bothost — так у него российский IP, и MAX-клиенты
 * достают Mini App без VPN. Просто форвардит все запросы (включая
 * multipart-загрузку фото и все /api/*) на основной сервер АвтоДай.рф;
 * сам сервер и БД остаются одни, ничего не дублируется.
 *
 * Намеренно без внешних зависимостей (только встроенные модули Node) — этот
 * бот на bothost создаётся из того же репозитория/ветки, что основной, но
 * с другим «главным файлом» (max-proxy/dist/index.js), и неизвестно, ставит
 * ли bothost зависимости из package.json подпапки. Без внешних пакетов
 * вопрос отпадает: файлу достаточно самого Node.
 */

const PORT = Number(process.env.PORT ?? 3000);

const upstreamUrlRaw = (process.env.UPSTREAM_URL ?? '').trim();
if (!upstreamUrlRaw.startsWith('https://')) {
  throw new Error(
    'Не задана переменная окружения UPSTREAM_URL — адрес основного сервера ' +
      '(например, https://bot1234.bothost.tech), должна начинаться с https://'
  );
}
const upstream = new URL(upstreamUrlRaw);

const server = http.createServer((req, res) => {
  // Отдельный путь для проверки, что сам прокси жив, не завязан на upstream —
  // удобно для диагностики "прокси не отвечает" против "не отвечает основной сервер".
  if (req.url === '/_proxy/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, upstream: upstream.origin }));
    return;
  }

  const forwardedFor = [req.socket.remoteAddress, req.headers['x-forwarded-for']]
    .filter(Boolean)
    .join(', ');

  const proxyReq = https.request(
    {
      hostname: upstream.hostname,
      port: upstream.port || 443,
      path: req.url,
      method: req.method,
      headers: {
        ...req.headers,
        host: upstream.host,
        'x-forwarded-for': forwardedFor,
        'x-forwarded-proto': 'https',
      },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on('error', (err) => {
    console.error('Ошибка проксирования запроса:', err);
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain; charset=utf-8' });
    }
    res.end('Bad Gateway — не удалось связаться с основным сервером');
  });

  req.pipe(proxyReq);
});

server.listen(PORT, () => {
  console.log(`Прокси запущен на порту ${PORT}, форвардит запросы на ${upstream.origin}`);
});
