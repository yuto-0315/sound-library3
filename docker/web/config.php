<?php
// Docker で動かすときの設定（コンテナの中で api/config.php として使う）。
//
// 本番の api/config.php には DB の接続情報が直接書かれているので、Docker のイメージには入れない
// （.dockerignore で外している）。ここでは接続先を環境変数（docker-compose.yml）から読む。
// API のほかのファイルが使う sendError / sendSuccess / setCORSHeaders / DatabaseConfig /
// UPLOAD_DIR / MAX_FILE_SIZE を用意する。

// 共有された音の置き場所（末尾の / が必要）
define('UPLOAD_DIR', __DIR__ . '/uploads/audio/');
// 1 ファイルの上限（api/audio.php の上限 20MB と同じ）
define('MAX_FILE_SIZE', 20 * 1024 * 1024);

class DatabaseConfig {
    private static $pdo = null;

    private static function env($name, $default) {
        $value = getenv($name);
        return ($value === false || $value === '') ? $default : $value;
    }

    public static function getConnection() {
        if (self::$pdo === null) {
            $dsn = sprintf(
                'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
                self::env('DB_HOST', 'db'),
                self::env('DB_PORT', '3306'),
                self::env('DB_NAME', 'sound_library_cloud')
            );
            self::$pdo = new PDO($dsn, self::env('DB_USER', 'sound_library'), self::env('DB_PASSWORD', ''), [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                // 列名だけの配列で受け取る（番号の列が混ざると、一覧の JSON が 2 倍の大きさになる）
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false
            ]);
        }
        return self::$pdo;
    }
}

// 画面と API を同じアドレスで配信するので、本来 CORS は要らないが、別のアドレスから使う場合にも備える
function setCORSHeaders() {
    header('Content-Type: application/json; charset=utf-8');
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: GET, POST, DELETE, OPTIONS');
    // 先生用の暗証番号（X-Admin-Pin）もここで許可しておく（プリフライトはここで終わるため）
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Admin-Pin');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function sendJsonResponse($payload, $code) {
    if (!headers_sent()) {
        http_response_code($code);
        header('Content-Type: application/json; charset=utf-8');
    }
    echo json_encode($payload, JSON_UNESCAPED_UNICODE);
}

function sendSuccess($data = null, $message = '') {
    sendJsonResponse(['success' => true, 'message' => $message, 'data' => $data], 200);
}

function sendError($message, $code = 400) {
    sendJsonResponse(['success' => false, 'error' => $message, 'message' => $message], $code);
}
?>
