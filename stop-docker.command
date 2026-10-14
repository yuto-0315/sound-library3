#!/bin/bash
# 音楽づくり支援アプリを止める（データは残る）。Windows は stop-docker.bat
cd "$(dirname "$0")" || exit 1
docker compose --profile https down && echo "止めました。もう一度使うときは start-docker.command を実行してください。"
