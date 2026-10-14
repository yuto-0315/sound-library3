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

echo.
echo 音楽づくり支援アプリを起動しています...
echo （初めてのときは、部品のダウンロードと組み立てに 5〜10 分ほどかかります）
echo.
docker compose up -d --build --wait
if errorlevel 1 (
  echo.
  echo [エラー] 起動できませんでした。次のコマンドでくわしい内容を確かめられます:
  echo   docker compose logs
  echo よくある原因と直し方は DOCKER.md の「8. うまくいかないとき」を見てください。
  echo.
  pause
  exit /b 1
)

set "PORT="
for /f "delims=" %%a in ('docker compose port web 80 2^>nul') do set "ADDR=%%a"
if defined ADDR set "PORT=%ADDR:*:=%"
if not defined PORT set "PORT=8080"

echo.
echo ============================================================
echo  起動しました！
echo   このパソコン:     http://localhost:%PORT%/
echo   先生用ページ:     http://localhost:%PORT%/#/admin
echo.
echo   ほかの端末（同じ Wi-Fi）からは http://このパソコンの IP アドレス:%PORT%/
echo   ※ iPad から「録音」するには HTTPS が必要です。
echo     start-docker-https.bat を使ってください（DOCKER.md の「5. iPad で使う」）
echo.
echo   止めるときは stop-docker.bat を実行します（データは残ります）
echo ============================================================
echo.
start "" "http://localhost:%PORT%/"
pause
