FROM node:20-bookworm-slim

# python3/make/g++ — на случай, если для better-sqlite3 не найдётся готовый
# бинарник под конкретную платформу сборки и потребуется компиляция из исходников.
# curl — нужен для HEALTHCHECK ниже (в slim-образе его нет по умолчанию,
# а PaaS-хостинги вроде bothost ждут, что health-check реально сможет
# выполниться внутри контейнера, иначе статус навсегда остаётся "starting").
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci

COPY . .
RUN npm run build

ENV PORT=3000
EXPOSE 3000

HEALTHCHECK --interval=10s --timeout=3s --start-period=15s --retries=3 \
  CMD curl -f http://localhost:3000/ || exit 1

CMD ["node", "dist/index.js"]
