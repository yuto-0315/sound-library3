<?php
// データベース設定
class DatabaseConfig {
    private const HOST = 'localhost';
    private const DB_NAME = 'redosila_soundlibrary';
    private const USERNAME = 'redosila_root'; // XAMPPのデフォルト
    private const PASSWORD = 'rootpass';     // XAMPPのデフォルト
    private const CHARSET = 'utf8mb4';

    public static function getConnection() {
        try {
            $dsn = "mysql:host=" . self::HOST . ";dbname=" . self::DB_NAME . ";charset=" . self::CHARSET;
            $pdo = new PDO($dsn, self::USERNAME, self::PASSWORD);
            $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
            $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
            return $pdo;
        } catch (PDOException $e) {
            error_log("Database connection failed: " . $e->getMessage());
            throw new Exception("データベースに接続できませんでした。");
        }
    }
}

// CORS設定（React アプリからのAPIアクセスのため）
function setCORSHeaders() {
    header("Access-Control-Allow-Origin: *");
    header("Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS");
    header("Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With");
    header("Content-Type: application/json; charset=utf-8");
    
    // OPTIONSリクエストに対するレスポンス
    if ($_SERVER['REQUEST_METHOD'] == 'OPTIONS') {
        http_response_code(200);
        exit();
    }
}

// レスポンスJSON出力
function sendJSON($data, $statusCode = 200) {
    http_response_code($statusCode);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
}

// エラーレスポンス
function sendError($message, $statusCode = 400) {
    sendJSON([
        'success' => false,
        'error' => $message
    ], $statusCode);
}

// 成功レスポンス
function sendSuccess($data = null, $message = "成功しました") {
    $response = [
        'success' => true,
        'message' => $message
    ];
    
    if ($data !== null) {
        $response['data'] = $data;
    }
    
    sendJSON($response);
}

// ファイルアップロード用のディレクトリ設定
define('UPLOAD_DIR', __DIR__ . '/uploads/audio/');
define('MAX_FILE_SIZE', 50 * 1024 * 1024); // 50MB

// アップロードディレクトリが存在しない場合は作成
if (!is_dir(UPLOAD_DIR)) {
    mkdir(UPLOAD_DIR, 0755, true);
}
?>
