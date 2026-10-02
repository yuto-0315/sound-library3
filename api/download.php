<?php
require_once 'config.php';
require_once 'audio_utils.php';

// ほかの API と同じく、別のアドレスに置いたアプリからも再生・取り込みできるようにする
// （JSON 用の Content-Type は付けない。音声そのものを返すため）
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
header('Access-Control-Allow-Headers: Range');
header('Access-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges');
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

// 端末ごとの ID（ダウンロード数を 1 人 1 回で数えるため）。
// 長すぎる値や想定外の文字は使わない（以前は 255 文字を超えると保存エラーで再生できなかった）
function readUserIdentifier() {
    $value = $_GET['user_id'] ?? '';
    if (is_string($value) && preg_match('/^[A-Za-z0-9_-]{1,64}$/', $value)) {
        return $value;
    }
    return 'anonymous_' . substr(hash('sha256', $_SERVER['REMOTE_ADDR'] ?? ''), 0, 16);
}

try {
    $uid = $_GET['uid'] ?? null;
    $userIdentifier = readUserIdentifier();

    if (!$uid) {
        sendError('音声ファイルUIDは必須です');
        exit;
    }

    $pdo = DatabaseConfig::getConnection();

    // ファイル情報取得
    $stmt = $pdo->prepare("SELECT * FROM audio_files WHERE uid = ?");
    $stmt->execute([$uid]);
    $fileInfo = $stmt->fetch();

    if (!$fileInfo) {
        sendError('音声ファイルが見つかりませんでした', 404);
        exit;
    }

    // basename: DB の値にパス区切りが含まれていても uploads の外は読ませない
    $filePath = UPLOAD_DIR . basename($fileInfo['file_path']);

    if (!is_file($filePath)) {
        sendError('ファイルが存在しません', 404);
        exit;
    }

    // ダウンロード数は 1 人 1 回だけ数える。
    // 以前は「調べてから記録する」の 2 段階で、同時に 2 回届くと（再生ボタンの連打など）
    // 2 回目が重複エラーになって音声を返せなかった。INSERT IGNORE で 1 回の処理にする。
    // HEAD（中身を送らない確認だけのリクエスト）は数えない。
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') {
        $insertHistoryStmt = $pdo->prepare("INSERT IGNORE INTO download_history (audio_uid, user_identifier) VALUES (?, ?)");
        $insertHistoryStmt->execute([$uid, $userIdentifier]);
        if ($insertHistoryStmt->rowCount() === 1) {
            $updateStmt = $pdo->prepare("UPDATE audio_files SET download_count = download_count + 1 WHERE uid = ?");
            $updateStmt->execute([$uid]);
        }
    }

    // 保存時の申告が誤っていた古いファイル（中身は mp4 なのに audio/wav など）も
    // iPad で再生できるよう、中身から判定した形式で返す
    $mimeType = detectAudioMimeTypeFromFile($filePath) ?? normalizeAudioMimeType($fileInfo['mime_type']);

    sendAudioFile($filePath, $mimeType, $fileInfo['original_filename'] ?: basename($filePath));

} catch (Exception $e) {
    error_log($e->getMessage());
    sendError('ダウンロードエラーが発生しました');
}
?>
