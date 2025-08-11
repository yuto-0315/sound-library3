<?php
require_once 'config.php';

setCORSHeaders();

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DatabaseConfig::getConnection();
    
    switch ($method) {
        case 'GET':
            handleGetAudio($pdo);
            break;
        case 'POST':
            handleUploadAudio($pdo);
            break;
        case 'DELETE':
            handleDeleteAudio($pdo);
            break;
        default:
            sendError('許可されていないメソッドです', 405);
    }
} catch (Exception $e) {
    error_log($e->getMessage());
    sendError('サーバーエラーが発生しました');
}

// 音声ファイル一覧取得・検索
function handleGetAudio($pdo) {
    $roomId = $_GET['room_id'] ?? null;
    $searchTag = $_GET['tag'] ?? null;
    $searchName = $_GET['name'] ?? null;
    
    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }
    
    $sql = "SELECT af.*, r.room_number, r.room_name 
            FROM audio_files af 
            JOIN rooms r ON af.room_id = r.id 
            WHERE af.room_id = ?";
    $params = [$roomId];
    
    // タグ検索
    if ($searchTag) {
        $sql .= " AND JSON_SEARCH(af.tags, 'one', ?) IS NOT NULL";
        $params[] = $searchTag;
    }
    
    // ファイル名検索
    if ($searchName) {
        $sql .= " AND (af.file_name LIKE ? OR af.original_filename LIKE ?)";
        $searchTerm = "%$searchName%";
        $params[] = $searchTerm;
        $params[] = $searchTerm;
    }
    
    $sql .= " ORDER BY af.upload_date DESC";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $audioFiles = $stmt->fetchAll();
    
    // JSONタグをデコード
    foreach ($audioFiles as &$file) {
        $file['tags'] = json_decode($file['tags'], true) ?? [];
    }
    
    sendSuccess($audioFiles, '音声ファイル一覧を取得しました');
}

// 音声ファイルアップロード
function handleUploadAudio($pdo) {
    if (!isset($_FILES['audio_file'])) {
        sendError('音声ファイルがアップロードされていません');
        return;
    }
    
    $file = $_FILES['audio_file'];
    $roomId = $_POST['room_id'] ?? null;
    $studentName = $_POST['student_name'] ?? null;
    $fileName = $_POST['file_name'] ?? $file['name'];
    $tags = json_decode($_POST['tags'] ?? '[]', true);
    
    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }
    
    // 部屋の存在確認
    $roomStmt = $pdo->prepare("SELECT id FROM rooms WHERE id = ?");
    $roomStmt->execute([$roomId]);
    if (!$roomStmt->fetch()) {
        sendError('指定された部屋が見つかりません', 404);
        return;
    }
    
    // ファイルサイズチェック
    if ($file['size'] > MAX_FILE_SIZE) {
        sendError('ファイルサイズが制限を超えています（最大50MB）');
        return;
    }
    
    // ファイルタイプチェック
    $allowedMimeTypes = [
        'audio/mp3',
        'audio/mpeg',
        'audio/wav',
        'audio/wave',
        'audio/x-wav',
        'audio/webm',
        'audio/ogg',
        'audio/mp4'
    ];
    
    if (!in_array($file['type'], $allowedMimeTypes)) {
        sendError('サポートされていないファイル形式です');
        return;
    }
    
    // ユニークIDとファイル名の生成
    $uid = uniqid('audio_', true);
    $fileExtension = pathinfo($file['name'], PATHINFO_EXTENSION);
    $savedFileName = $uid . '.' . $fileExtension;
    $filePath = UPLOAD_DIR . $savedFileName;
    
    // ファイル移動
    if (!move_uploaded_file($file['tmp_name'], $filePath)) {
        sendError('ファイルの保存に失敗しました');
        return;
    }
    
    // データベースに保存
    $sql = "INSERT INTO audio_files (uid, room_id, student_name, file_name, original_filename, file_path, file_size, mime_type, tags) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        $uid,
        $roomId,
        $studentName,
        $fileName,
        $file['name'],
        $savedFileName,
        $file['size'],
        $file['type'],
        json_encode($tags, JSON_UNESCAPED_UNICODE)
    ]);
    
    sendSuccess([
        'uid' => $uid,
        'file_name' => $fileName,
        'original_filename' => $file['name'],
        'file_size' => $file['size'],
        'tags' => $tags
    ], '音声ファイルをアップロードしました');
}

// 音声ファイル削除
function handleDeleteAudio($pdo) {
    $uid = $_GET['uid'] ?? null;
    
    if (!$uid) {
        sendError('音声ファイルUIDは必須です');
        return;
    }
    
    // ファイル情報取得
    $stmt = $pdo->prepare("SELECT file_path FROM audio_files WHERE uid = ?");
    $stmt->execute([$uid]);
    $fileInfo = $stmt->fetch();
    
    if (!$fileInfo) {
        sendError('音声ファイルが見つかりませんでした', 404);
        return;
    }
    
    // データベースから削除
    $deleteStmt = $pdo->prepare("DELETE FROM audio_files WHERE uid = ?");
    $deleteStmt->execute([$uid]);
    
    // 物理ファイル削除
    $filePath = UPLOAD_DIR . $fileInfo['file_path'];
    if (file_exists($filePath)) {
        unlink($filePath);
    }
    
    sendSuccess(null, '音声ファイルを削除しました');
}
?>
