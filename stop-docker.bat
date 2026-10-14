@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
echo 音楽づくり支援アプリを止めています...（録音・部屋・楽曲のデータは残ります）
docker compose --profile https down
if errorlevel 1 (
  echo [エラー] 止められませんでした。Docker Desktop が起動しているか確かめてください。
  pause
  exit /b 1
)
echo 止めました。もう一度使うときは start-docker.bat を実行してください。
pause
