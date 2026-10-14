@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
rem データベースと共有された音を backup フォルダに保存する（アプリは起動したままでよい）

docker compose ps --status running --services 2>nul | findstr /x "db" >nul
if errorlevel 1 (
  echo [エラー] アプリが起動していません。start-docker.bat で起動してから実行してください。
  pause
  exit /b 1
)

for /f "delims=" %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "STAMP=%%t"
set "DEST=backup\%STAMP%"
mkdir "%DEST%" 2>nul

echo データベースを保存しています...
docker compose exec -T db sh -c "exec mysqldump -uroot -p\"$MYSQL_ROOT_PASSWORD\" --single-transaction --default-character-set=utf8mb4 --databases sound_library_cloud" > "%DEST%\database.sql"
if errorlevel 1 (
  echo [エラー] データベースを保存できませんでした。
  pause
  exit /b 1
)

echo 共有された音のファイルを保存しています...
docker compose cp web:/var/www/html/api/uploads/audio "%DEST%\audio"
if errorlevel 1 (
  echo [エラー] 音のファイルを保存できませんでした。
  pause
  exit /b 1
)

echo.
echo 保存しました: %CD%\%DEST%
echo 戻し方は DOCKER.md の「7. データの保存と戻し方」を見てください。
pause
