<?php
// エラー表示を有効化（デバッグ用）
error_reporting(E_ALL);
ini_set('display_errors', 0); // ブラウザには表示しない
ini_set('log_errors', 1);

require_once 'config.php';
require_once 'audio_utils.php';

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
} catch (PDOException $e) {
    error_log('PDO Error in audio.php: ' . $e->getMessage());
    error_log('Stack trace: ' . $e->getTraceAsString());
    sendError('データベースエラーが発生しました: ' . $e->getMessage(), 500);
} catch (Exception $e) {
    error_log('Exception in audio.php: ' . $e->getMessage());
    error_log('Stack trace: ' . $e->getTraceAsString());
    sendError('サーバーエラーが発生しました: ' . $e->getMessage(), 500);
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
    if (!is_array($tags)) {
        $tags = [];
    }
    
    // アップロード自体の失敗（サイズ超過など）を先に判定する
    if ($file['error'] !== UPLOAD_ERR_OK) {
        if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) {
            sendError('ファイルサイズが大きすぎます');
        } else {
            sendError('ファイルのアップロードに失敗しました（エラーコード: ' . $file['error'] . '）');
        }
        return;
    }
    
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
    
    // ファイルタイプチェック。
    // ブラウザの申告（$file['type']）は iPad では誤っていることがあるので、中身から判定した形式を優先する。
    $mimeType = detectAudioMimeTypeFromFile($file['tmp_name']) ?? normalizeAudioMimeType($file['type']);
    if (!isAllowedAudioMimeType($mimeType)) {
        sendError('サポートされていないファイル形式です');
        return;
    }
    $mimeType = normalizeAudioMimeType($mimeType);
    
    // ユニークIDとファイル名の生成。
    // 拡張子は判定した形式から決める（送られてきたファイル名の拡張子を使うと、
    // 「.php」などのファイルがサーバーに置かれてしまう危険がある）
    $uid = uniqid('audio_', true);
    $savedFileName = $uid . '.' . extensionForAudioMimeType($mimeType);
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
        $mimeType,
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
