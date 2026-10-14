# Docker で動かす（別のパソコンで使うとき）

XAMPP などを入れなくても、**Docker Desktop だけ**で、このアプリ（画面・PHP の API・MySQL）をまとめて動かせます。
Windows では **`start-docker.bat` をダブルクリックするだけ**で、コンテナの作成から起動、ブラウザで開くところまで行います。

| ファイル | 役目 |
|:--|:--|
| `start-docker.bat` | 起動する（初回はコンテナを作る）。終わるとブラウザでアプリを開く |
| `start-docker-https.bat` | iPad から**録音**も使えるよう、HTTPS でも起動する（→ 5 章） |
| `stop-docker.bat` | 止める（データは残る） |
| `backup-docker-data.bat` | データベースと共有された音を `backup\日時` に保存する（→ 7 章） |
| `start-docker.command` / `stop-docker.command` | Mac / Linux 用（`./start-docker.command https` で HTTPS も） |
| `docker-compose.yml` | コンテナの組み合わせ（データベース・アプリ・HTTPS） |
| `docker/web/` | アプリのコンテナの作り方（Dockerfile・Apache・PHP の設定、Docker 用の `config.php`） |
| `docker/https/Caddyfile` | HTTPS の設定 |
| `docker/env.example` | 設定の例（ポート番号・パスワード・暗証番号） |

---

## 1. 準備（そのパソコンで 1 回だけ）

### Windows 10 / 11

1. **Docker Desktop** をインストールする: <https://www.docker.com/products/docker-desktop/>
   - インストールの途中で「WSL 2 を使う（Use WSL 2 instead of Hyper-V）」にチェックが付いたままにする
   - 「WSL のインストール・更新が必要」と出たら、表示に従う（管理者の PowerShell で `wsl --install` → 再起動）
   - パソコンの BIOS で仮想化（Intel VT-x / AMD-V）がオフだと動かない（→ 8 章）
2. Docker Desktop を一度開き、利用規約に同意する。左下が **Engine running**（緑）になれば準備完了
   - アカウントの作成・サインインはしなくても使える
3. このアプリのファイルを置く
   - git を使うとき: `git clone https://github.com/yuto-0315/sound-library3.git`
   - git を使わないとき: GitHub の「Code」→「Download ZIP」で取ってきて、**展開**してから使う（ZIP のままでは動かない）
   - 置く場所は、パスに日本語や空白が無い所が無難（例: `C:\sound-library3`）

### Mac

1. Docker Desktop for Mac をインストールして一度開く
2. ファイルを置き、`start-docker.command` をダブルクリック（初回は「開発元が未確認」と出たら、右クリック →「開く」）

> 必要なもの: メモリ 8GB 以上がおすすめ。最初の起動でインターネットから部品（約 1〜2GB）を取ってくる。2 回目からはインターネット無しでも起動できる。

---

## 2. 起動する

1. **`start-docker.bat` をダブルクリック**する
2. 黒い画面に進み具合が出る。初回は 5〜10 分ほどかかる（部品のダウンロードと画面のビルド）
3. 「起動しました！」と出ると、ブラウザで <http://localhost:8080/> が開く

`start-docker.bat` がしていること:

1. Docker Desktop が入っているか、動いているかを確かめる（止まっていれば起動して待つ）
2. `docker compose up -d --build --wait` で、次の 2 つのコンテナを作って起動し、使える状態になるまで待つ
   - `db`: MySQL 8.0。初回だけ `database/create_database.sql` で表を作る
   - `web`: 画面（React をビルドしたもの）と PHP の API（Apache）
3. ブラウザでアプリを開く

2 回目からは数秒〜数十秒で起動する。パソコンを再起動しても、Docker Desktop が起動すればアプリも自動で起動する（`restart: unless-stopped`）。`stop-docker.bat` で止めたときは自動では起動しない。

### 最初にすること

1. 先生用ページ <http://localhost:8080/#/admin> で**部屋を作る**（例: 部屋番号 `482913`、部屋名「1年1組」）
   - 部屋番号は生徒が入るときの「合言葉」。推測されにくい番号がおすすめ（SETUP.md の「部屋番号は「合言葉」です」）
2. 必要なら**暗証番号**を設定する（→ 6 章）
3. 生徒は「みんなで共有」でその部屋番号を入れる

---

## 3. 止める・もう一度起動する

- 止める: **`stop-docker.bat`**（録音・部屋・楽曲のデータは消えない）
- もう一度起動: `start-docker.bat`
- 新しい版にする: ファイルを新しくして（`git pull` か ZIP を取り直して上書き）から `start-docker.bat`。画面と API は作り直されるが、データは残る

> 生徒の iPad に保存された音（音あつめ・音ライブラリ・音楽づくりの作業内容）は、**iPad のブラウザの中**に保存されている。サーバー（このパソコン）には、「みんなで共有」で共有した音と「先生に送る」で送った楽曲だけが保存される。

---

## 4. ほかのパソコン・タブレットから開く

同じ Wi-Fi（同じネットワーク）の端末から `http://このパソコンの IP アドレス:8080/` で開ける。

- IP アドレスの調べ方（Windows）: コマンドプロンプトで `ipconfig` →「IPv4 アドレス」（例: `192.168.1.23`）
- 開けないときは、Windows ファイアウォールで Docker を許可する（初回に出る確認で「許可」。出なかったときは 8 章）

**ただし、iPad などほかの端末から `http://` で開くと、「録音」は使えない**（ブラウザは `http://localhost` 以外の `http://` ではマイクを使わせないため）。
音ライブラリ・音楽づくり・みんなで共有は使える。iPad で録音もするときは 5 章の HTTPS を使う。

---

## 5. iPad で使う（録音も使う: HTTPS）

1. **`start-docker-https.bat` をダブルクリック**する（このパソコンの IP アドレスを自動で調べ、HTTPS でも起動する）
2. 表示された手順で、**iPad ごとに 1 回だけ**証明書を入れる
   1. iPad の Safari で `http://（パソコンの IP）:8081/ipad-cert.crt` を開き、「許可」
   2. 設定アプリ → 上に出る「プロファイルがダウンロードされました」→「インストール」
   3. 設定 → 一般 → 情報 → **証明書信頼設定** →「Caddy Local Authority」をオン
3. iPad の Safari で **`https://（パソコンの IP）:8443/`** を開く。「録音開始」でマイクの許可を聞かれたら「許可」

しくみ: `docker-compose.yml` の `https`（Caddy）が、このパソコンの中で作った証明書で HTTPS にして、アプリにつなぐ。証明書はインターネットから取らないので、学校のネットワークの中だけで使える。

注意:

- **パソコンの IP アドレスが変わったら**（別の Wi-Fi・再起動で変わることがある）、`start-docker-https.bat` をもう一度実行する。iPad に入れた証明書はそのまま使える
- 証明書は Docker の中（`caddy-data`）に保存される。`docker compose down -v` で消すと作り直されるので、iPad にも入れ直す
- 学校の端末管理（MDM）でプロファイルのインストールが禁止されている iPad では、この方法は使えない。その場合は、HTTPS のある本物のサーバー（SETUP.md）に置く
- 録音した音は iPad に保存される。`http://` と `https://` は別のアプリとして扱われるので、**同じ iPad では毎回同じ URL（https の方）で開く**

---

## 6. 設定を変える（`.env`）

`docker/env.example` を、`docker-compose.yml` と同じフォルダに **`.env`** という名前でコピーし、値を変える。`.env` は git に入らない。

| 項目 | 既定値 | 内容 |
|:--|:--|:--|
| `WEB_PORT` | `8080` | ブラウザで開く番号。ほかのソフトと重なるとき（8 章）に変える |
| `DB_PASSWORD` / `DB_ROOT_PASSWORD` | `change-me-…` | データベースのパスワード。**最初の起動の前に**変えておく（データベースはパソコンの外には公開していない） |
| `ADMIN_PIN` | 空 | 先生用ページの暗証番号。**半角の英数字・記号で 6 文字以上**（例: `ongaku2026`）。空なら確認しない |
| `HTTPS_PORT` / `CERT_PORT` | `8443` / `8081` | HTTPS と、iPad に証明書を配る番号 |

変えたら `start-docker.bat` をもう一度実行すると反映される。

> データベースのパスワードは、**データベースを最初に作ったときの値**で固定される。あとから `.env` だけ変えると、アプリがデータベースにつながらなくなる。あとから変えるときは、7 章の方法で保存してから `docker compose down -v`（データも消える）→ 起動 → 戻す。

---

## 7. データの保存と戻し方

データは Docker の「ボリューム」に保存されている（コンテナを作り直しても消えない）。

| ボリューム | 中身 |
|:--|:--|
| `sound-library_db-data` | データベース（部屋・共有された音の情報・送られた楽曲） |
| `sound-library_uploads` | 共有された音のファイル |
| `sound-library_caddy-data` | HTTPS の証明書 |

### 保存する

**`backup-docker-data.bat`** をダブルクリック（アプリを起動したまま）。`backup\20261014-153000\` のようなフォルダに、`database.sql` と `audio\` ができる。

### 戻す（別のパソコンへ引っ越すときも同じ）

アプリを起動してから、`docker-compose.yml` のあるフォルダでコマンドプロンプトを開き:

```bat
docker compose exec -T db sh -c "exec mysql -uroot -p\"$MYSQL_ROOT_PASSWORD\"" < backup\20261014-153000\database.sql
docker compose cp backup\20261014-153000\audio\. web:/var/www/html/api/uploads/audio/
docker compose exec web chown -R www-data:www-data /var/www/html/api/uploads/audio
```

### すべて消して最初からにする

```bat
docker compose --profile https down -v
```

`-v` を付けると、部屋・共有された音・楽曲・証明書が**すべて消える**（元に戻せない）。先に保存しておくこと。

---

## 8. うまくいかないとき

| 症状 | 直し方 |
|:--|:--|
| 「Docker Desktop が入っていません」 | 1 章のとおりインストールする |
| 「Docker Desktop が起動しませんでした」 | Docker Desktop を開いて、エラーが出ていないか見る。「WSL」「Virtualization」と出たら、`wsl --update`（管理者の PowerShell）や、BIOS で仮想化をオンにする |
| `port is already allocated` / `ports are not available` | 8080 などをほかのソフトが使っている。`.env` で `WEB_PORT=8090` などに変えて、もう一度起動 |
| 起動の途中で止まる・失敗する | `docker compose logs` で内容を見る。初回はインターネットにつながっている必要がある |
| 画面は出るが「サーバーに接続できませんでした」 | `docker compose ps` で `db` と `web` が `healthy` か確かめる。`docker compose logs web` / `docker compose logs db` を見る。パスワードを変えた場合は 6 章の注意を見る |
| ほかの端末から開けない | 同じネットワークか確かめる。Windows の「セキュリティ」→「ファイアウォールとネットワーク保護」→「ファイアウォールによるアプリケーションの許可」で Docker Desktop（Docker Desktop Backend）を「プライベート」で許可 |
| iPad で録音ボタンを押しても何も起きない・マイクが使えない | `http://` で開いている。5 章の HTTPS（`https://…:8443/`）で開く |
| iPad で「この接続ではプライバシーが保護されません」 | 5 章の証明書を入れて、「証明書信頼設定」をオンにしたか確かめる |
| 黒い画面の文字が化ける | Windows 10 の古いコマンドプロンプトでは日本語が化けることがある（動作には影響しない）。Windows Terminal なら化けない |

コマンドは、`docker-compose.yml` のあるフォルダで実行する（エクスプローラーでそのフォルダを開き、アドレス欄に `cmd` と入れて Enter）。

---

## 9. しくみ（開発する人向け）

```
ブラウザ ──http://:8080──▶ web（Apache + PHP 8.2）
   │                        ├─ /        … React をビルドした画面（docker/web/Dockerfile の 1 段目でビルド）
   │                        └─ /api/    … api/*.php（config.php だけ docker/web/config.php に差し替え）
   │                                         │
   └──https://:8443──▶ https（Caddy）──▶ web    └──▶ db（MySQL 8.0、外には公開しない）
```

- **本物の `api/config.php`（DB の接続情報入り）はイメージに入れない**（`.dockerignore`）。Docker 用の `docker/web/config.php` が、接続先を環境変数（`DB_HOST` など）から読む
- 共有された音は `/var/www/html/api/uploads/audio`（ボリューム `uploads`）。直接は開けず、`api/download.php` から配信する（`docker/web/apache.conf`）
- アップロードの上限は `docker/web/php.ini`（1 ファイル 25MB・1 回の送信 120MB）
- `web` の健康チェックは、データベースまで使う `api/rooms.php?room_number=1` を呼ぶ。`--wait` はこれが通るまで待つ
- 試しの部屋（101 など）を入れたいときは: `docker compose exec -T db sh -c "exec mysql -uroot -p\"$MYSQL_ROOT_PASSWORD\"" < database/sample_data.sql`
- 開発中（`npm start`）は今までどおり XAMPP を使うか、`API_PROXY_TARGET=http://localhost:8080/api npm start` で、Docker の API につなげられる
