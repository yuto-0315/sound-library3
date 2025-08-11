<?php
require_once 'config.php';

try {
    $uid = $_GET['uid'] ?? null;
    $userIdentifier = $_GET['user_id'] ?? 'anonymous_' . $_SERVER['REMOTE_ADDR'];
    
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
    
    $filePath = UPLOAD_DIR . $fileInfo['file_path'];
    
    if (!file_exists($filePath)) {
        sendError('ファイルが存在しません', 404);
        exit;
    }
    
    // ダウンロード履歴チェック（重複ダウンロード防止）
    $historyStmt = $pdo->prepare("SELECT id FROM download_history WHERE audio_uid = ? AND user_identifier = ?");
    $historyStmt->execute([$uid, $userIdentifier]);
    
    $isFirstDownload = !$historyStmt->fetch();
    
    if ($isFirstDownload) {
        // 初回ダウンロードの場合、履歴を記録
        $insertHistoryStmt = $pdo->prepare("INSERT INTO download_history (audio_uid, user_identifier) VALUES (?, ?)");
        $insertHistoryStmt->execute([$uid, $userIdentifier]);
        
        // ダウンロード数をインクリメント
        $updateStmt = $pdo->prepare("UPDATE audio_files SET download_count = download_count + 1 WHERE uid = ?");
        $updateStmt->execute([$uid]);
    }
    
    // ファイルダウンロード
    header('Content-Type: ' . $fileInfo['mime_type']);
    header('Content-Disposition: attachment; filename="' . $fileInfo['original_filename'] . '"');
    header('Content-Length: ' . filesize($filePath));
    header('Cache-Control: must-revalidate');
    header('Pragma: public');
    
    readfile($filePath);
    
} catch (Exception $e) {
    error_log($e->getMessage());
    sendError('ダウンロードエラーが発生しました');
}
?>
