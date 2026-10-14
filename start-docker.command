#!/bin/bash
# 音楽づくり支援アプリを Docker で起動する（Mac / Linux。Windows は start-docker.bat）
# 引数に https を付けると、iPad で録音できる HTTPS でも起動する:  ./start-docker.command https
cd "$(dirname "$0")" || exit 1

if ! command -v docker >/dev/null 2>&1; then
  echo "[エラー] Docker Desktop が入っていません。DOCKER.md の「1. 準備」を見てください。"
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker Desktop を起動しています（最大 3 分ほど待ちます）..."
  [ "$(uname)" = "Darwin" ] && open -a Docker
  for _ in $(seq 1 60); do docker info >/dev/null 2>&1 && break; sleep 3; done
  docker info >/dev/null 2>&1 || { echo "[エラー] Docker Desktop が起動しませんでした。"; exit 1; }
fi

PROFILE_ARGS=()
if [ "$1" = "https" ]; then
  if [ "$(uname)" = "Darwin" ]; then
    HOST_IP="$(ipconfig getifaddr en0 || ipconfig getifaddr en1)"
  else
    HOST_IP="$(hostname -I | awk '{print $1}')"
  fi
  [ -n "$HOST_IP" ] || { echo "[エラー] この PC の IP アドレスが分かりませんでした。"; exit 1; }
  export HOST_IP
  PROFILE_ARGS=(--profile https)
fi

echo "音楽づくり支援アプリを起動しています...（初めてのときは 5〜10 分ほどかかります）"
if ! docker compose "${PROFILE_ARGS[@]}" up -d --build --wait; then
  echo "[エラー] 起動できませんでした。くわしくは: docker compose logs （DOCKER.md の「8. うまくいかないとき」）"
  exit 1
fi

PORT="$(docker compose port web 80 2>/dev/null | head -1 | sed 's/.*://')"
PORT="${PORT:-8080}"
echo
echo "起動しました！  このパソコン: http://localhost:${PORT}/   先生用ページ: http://localhost:${PORT}/#/admin"
if [ -n "$HOST_IP" ]; then
  echo "iPad（HTTPS）: https://${HOST_IP}:${HTTPS_PORT:-8443}/"
  echo "iPad に入れる証明書: http://${HOST_IP}:${CERT_PORT:-8081}/ipad-cert.crt （DOCKER.md の「5. iPad で使う」）"
fi
echo "止めるときは stop-docker.command を実行します（データは残ります）"
[ "$(uname)" = "Darwin" ] && open "http://localhost:${PORT}/"
