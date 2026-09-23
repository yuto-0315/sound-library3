# セットアップガイド

このガイドでは、音楽づくり支援アプリ（クラウド対応版）のセットアップ手順を説明します。

## 必要な環境

- Node.js 16以上
- XAMPP（PHP 7.4+, MySQL 8.0+）
- モダンなWebブラウザ

## 1. フロントエンドのセットアップ

```bash
# リポジトリをクローン
git clone <リポジトリURL>
cd sound-library3

# 依存関係をインストール
npm install

# 開発サーバーを起動
npm start
```

アプリケーションは `http://localhost:3000` で開始されます。

## 2. XAMPPのセットアップ

### 2.1 XAMPPのインストール
1. [XAMPP公式サイト](https://www.apachefriends.org/)からダウンロード
2. インストーラーを実行し、Apache、PHP、MySQLを選択してインストール

### 2.2 XAMPPの設定
1. XAMPPコントロールパネルを開く
2. ApacheとMySQLを「Start」ボタンで開始
3. ブラウザで `http://localhost/phpmyadmin` にアクセスしてMySQLが動作していることを確認

## 3. データベースのセットアップ

### 3.1 データベースの作成
1. phpMyAdminにアクセス（`http://localhost/phpmyadmin`）
2. 「SQL」タブをクリック
3. `database/create_database.sql` ファイルの内容をコピー&ペースト
4. 「実行」ボタンをクリック

これにより以下が作成されます：
- `sound_library_cloud` データベース
- 必要なテーブル（rooms, audio_files, song_data, download_history）
- 初期テストデータ

### 3.2 データベース設定の確認
`api/config.php` ファイルでデータベース接続設定を確認：

```php
private const HOST = 'localhost';
private const DB_NAME = 'sound_library_cloud';
private const USERNAME = 'root';      // XAMPPデフォルト
private const PASSWORD = '';          // XAMPPデフォルト
```

## 4. APIファイルの配置

### 4.1 プロジェクトフォルダをhtdocsに配置
```bash
# XAMPPのhtdocsディレクトリにプロジェクトを配置
# Windowsの場合: C:\xampp\htdocs\sound-library3
# macOSの場合: /Applications/XAMPP/xamppfiles/htdocs/sound-library3
```

### 4.2 アップロードディレクトリの権限設定
```bash
# macOS/Linuxの場合
chmod 755 api/uploads
chmod 755 api/uploads/audio

# Windowsの場合は通常、権限設定は不要
```

## 5. API動作テスト

### 5.1 基本的な接続テスト
ブラウザで以下のURLにアクセス：

- `http://localhost/sound-library3/api/rooms.php` - 部屋一覧API
- 正常に動作している場合、JSON形式のレスポンスが返されます

### 5.2 エラーが発生した場合

**「データベースに接続できませんでした」エラー:**
- MySQLサービスが開始されているか確認
- データベース名、ユーザー名、パスワードが正しいか確認

**「404 Not Found」エラー:**
- プロジェクトが正しいhtdocsディレクトリに配置されているか確認
- ApacheサービスがWEBサーバーとして動作しているか確認

**「Permission Denied」エラー:**
- アップロードディレクトリの権限設定を確認
- PHPからファイル書き込みができるか確認

### 5.3 開発サーバー（`npm start`）から API を使う
アプリは API を `/api` に問い合わせます（`src/utils/api.js` の `API_BASE_URL`）。
開発サーバー（`http://localhost:3000`）では `src/setupProxy.js` が `/api` へのアクセスを XAMPP に中継するので、
XAMPP を起動しておけばクラウド機能（みんなで共有・クラウド保存・先生用ページ）もそのまま試せます。

- 既定の中継先：`http://localhost/sound-library3/api`（4.1 の手順どおりに置いた場所）
- 別の場所の API を使うとき：

```bash
API_PROXY_TARGET=http://localhost:8080/api npm start
```

中継がうまくいかないときは、ブラウザで `http://localhost:3000/api/rooms.php` を開いて JSON が返るか確認してください。

## 6. 本番環境での運用

### 6.1 データベースの設定変更
本番環境では `api/config.php` でデータベース接続情報を適切に設定：

```php
private const HOST = 'your-db-host';
private const DB_NAME = 'your-db-name';
private const USERNAME = 'your-username';
private const PASSWORD = 'your-password';
```

### 6.2 セキュリティの強化
- データベースユーザーに適切な権限のみを付与
- ファイルアップロードディレクトリへの直接アクセス制限（下記）
- HTTPS接続の設定

**アップロードディレクトリへの直接アクセス制限**

アップロードされた音声は `api/download.php` を通して配信します。`api/uploads/audio/` を直接開けないようにしてください。
（保存するファイルの拡張子はファイルの中身から判定した音声形式で決めるので、`.php` などが置かれることはありませんが、念のための対策です）

- **Apache（XAMPP を含む）**：`api/uploads/audio/.htaccess` で設定済みです。
  `.htaccess` が効くように、そのディレクトリで `AllowOverride All`（または `AuthConfig Limit`）が有効になっている必要があります（XAMPP の初期設定では有効）。
- **nginx**：`.htaccess` は読まれないので、サーバー設定に次を追加してください（パスは配置に合わせて変更）。

```nginx
# ^~ を付けると、PHP 用の「location ~ \.php$」より優先される
location ^~ /api/uploads/ {
    deny all;
}
```

設定後、`https://（サーバー）/api/uploads/audio/.gitkeep` を開いて 403 になることを確認してください（200 で空のページが出るなら制限が効いていません）。

### 6.3 API の置き場所を変える
本番（`https://sound-library.redosila.com`）はドメイン直下の `api/` に API を置いています。
別の場所に置く場合は、ビルド時に `REACT_APP_API_BASE_URL` で指定します。

```bash
REACT_APP_API_BASE_URL=https://example.com/sound-library3/api npm run build
```

### 6.4 パフォーマンス最適化
- データベースインデックスの最適化
- 大きな音声ファイルのための適切なサーバー設定
- CDN配信の検討

## 7. 使用方法

### 7.1 初期設定（先生用）
1. `http://localhost:3000/#/admin` にアクセス
2. 新しい部屋を作成（例：部屋番号 101、部屋名「1年1組」）

### 7.2 生徒の利用
1. メインアプリ（`http://localhost:3000`）にアクセス
2. 「みんなで共有」ページで部屋番号を入力
3. 音声のアップロード・ダウンロードが可能

## トラブルシューティング

### よくある問題と解決方法

**Q: 音声ファイルがアップロードできない**
A: 
- ブラウザが対応している音声形式か確認（MP3, WAV, WebM, OGG, MP4）
- ファイルサイズが50MB以下か確認
- サーバーのPHP設定（upload_max_filesize、post_max_size）を確認

**Q: クラウド保存ダイアログが表示されない**
A:
- ブラウザのJavaScriptが有効になっているか確認
- ブラウザの開発者ツールでエラーがないか確認

**Q: 部屋に入れない**
A:
- 入力した部屋番号が存在するか管理ページで確認
- データベースサーバーが動作しているか確認

## サポート

問題が解決しない場合は、以下の情報と合わせてお問い合わせください：
- 使用OS
- ブラウザの種類とバージョン
- エラーメッセージの詳細
- ブラウザの開発者ツールに表示されるエラー
