# 音楽づくり支援アプリ（画面 + PHP の API）を 1 つのコンテナで動かす。
# データベースは別のコンテナ（docker-compose.yml の db）を使う。

# ---- 1. 画面（React）をビルドする ----
FROM node:20-bookworm-slim AS build
WORKDIR /app
# 依存パッケージだけ先に入れる（ソースを変えただけなら、ここはキャッシュが使われて速い）
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY public ./public
COPY src ./src
# API は同じアドレスの /api に置く。ソースマップは配信しない
ENV REACT_APP_API_BASE_URL=/api \
    GENERATE_SOURCEMAP=false
RUN npm run build

# ---- 2. Apache + PHP で配信する ----
FROM php:8.2-apache
RUN docker-php-ext-install pdo_mysql
COPY docker/web/php.ini /usr/local/etc/php/conf.d/sound-library.ini
COPY docker/web/apache.conf /etc/apache2/conf-available/sound-library.conf
RUN a2enconf sound-library && a2enmod headers

WORKDIR /var/www/html
COPY --from=build /app/build/ ./
# API。本物の api/config.php（DB の接続情報入り）は .dockerignore で外し、
# 環境変数から接続先を読む Docker 用の config.php を使う
COPY api/ ./api/
COPY docker/web/config.php ./api/config.php
# 共有された音の置き場所（docker-compose.yml でボリュームにする）
RUN mkdir -p api/uploads/audio \
 && chown -R www-data:www-data api/uploads

# データベースまでつながっているかを確かめる（部屋番号で探す API を呼ぶ）
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=12 \
  CMD php -r "exit(@file_get_contents('http://127.0.0.1/api/rooms.php?room_number=1') === false ? 1 : 0);"
