@echo off
chcp 65001 >nul
setlocal EnableExtensions
cd /d "%~dp0"

rem ---- Docker が使えるか確かめる ----
where docker >nul 2>nul
if errorlevel 1 (
  echo.
  echo [エラー] Docker Desktop が入っていません。
  echo   https://www.docker.com/products/docker-desktop/ からインストールしてから、もう一度実行してください。
  echo   くわしくは DOCKER.md の「1. 準備」を見てください。
  echo.
  pause
  exit /b 1
)

docker info >nul 2>nul
if not errorlevel 1 goto docker_ready
echo Docker Desktop を起動しています（最大 3 分ほど待ちます）...
if exist "%ProgramFiles%\Docker\Docker\Docker Desktop.exe" start "" "%ProgramFiles%\Docker\Docker\Docker Desktop.exe"
for /l %%i in (1,1,60) do (
  docker info >nul 2>nul && goto docker_ready
  timeout /t 3 /nobreak >nul
)
echo.
echo [エラー] Docker Desktop が起動しませんでした。
echo   スタートメニューから Docker Desktop を開き、「Engine running」になってから、もう一度実行してください。
echo.
pause
exit /b 1

:docker_ready
docker compose version >nul 2>nul
if errorlevel 1 (
  echo [エラー] docker compose が使えません。Docker Desktop を新しい版に更新してください。
  pause
  exit /b 1
)

rem ---- このパソコンの IP アドレス（Wi-Fi / 有線のうち、外につながっているもの）----
set "HOST_IP="
for /f "delims=" %%i in ('powershell -NoProfile -Command "(Get-NetIPConfiguration | Where-Object { $_.IPv4DefaultGateway -ne $null -and $_.NetAdapter.Status -eq 'Up' } | Select-Object -First 1).IPv4Address.IPAddress"') do set "HOST_IP=%%i"
if not defined HOST_IP (
  echo [エラー] このパソコンの IP アドレスが分かりませんでした。Wi-Fi か有線 LAN につないでから実行してください。
  pause
  exit /b 1
)
if not defined HTTPS_PORT set "HTTPS_PORT=8443"
if not defined CERT_PORT set "CERT_PORT=8081"

echo.
echo 音楽づくり支援アプリを HTTPS で起動しています（IP アドレス: %HOST_IP%）...
echo （初めてのときは 5〜10 分ほどかかります）
echo.
docker compose --profile https up -d --build --wait
if errorlevel 1 (
  echo.
  echo [エラー] 起動できませんでした。くわしくは: docker compose --profile https logs
  echo DOCKER.md の「8. うまくいかないとき」も見てください。
  pause
  exit /b 1
)

echo.
echo ============================================================
echo  起動しました！（HTTPS）
echo.
echo  [iPad で最初に 1 回だけ] 証明書を入れて信頼する
echo   1. iPad の Safari で  http://%HOST_IP%:%CERT_PORT%/ipad-cert.crt  を開き、「許可」
echo   2. 設定 → 「プロファイルがダウンロードされました」→ インストール
echo   3. 設定 → 一般 → 情報 → 証明書信頼設定 → 「Caddy Local Authority」をオン
echo.
echo  [アプリを開く]
echo   iPad:          https://%HOST_IP%:%HTTPS_PORT%/
echo   このパソコン:  https://localhost:%HTTPS_PORT%/
echo.
echo  ※ パソコンの IP アドレスが変わったら、もう一度このファイルを実行してください
echo  止めるときは stop-docker.bat を実行します（データは残ります）
echo ============================================================
echo.
pause
