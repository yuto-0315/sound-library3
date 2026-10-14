<?php
// エラー表示を有効化（デバッグ用）
error_reporting(E_ALL);
ini_set('display_errors', 0); // ブラウザには表示しない
ini_set('log_errors', 1);

require_once 'config.php';
require_once 'audio_utils.php';
require_once 'admin_auth.php';
require_once 'validation.php';
require_once 'room_access.php';

setCORSHeaders();
allowAdminPinHeader();

// 1 ファイルの上限（60 秒の録音は AAC で約 1MB、WAV でも約 6MB）
const AUDIO_UPLOAD_MAX_BYTES = 20 * 1024 * 1024;
// 1 つの部屋に置ける合計（同じ操作を繰り返してサーバーのディスクがいっぱいになるのを防ぐ）
const AUDIO_ROOM_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

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
            requireAdmin();
            handleDeleteAudio($pdo);
            break;
        default:
            sendError('許可されていないメソッドです', 405);
    }
} catch (Exception $e) {
    // 詳しい内容（SQL のエラーなど）は画面に出さず、サーバーの記録にだけ残す
    error_log('Exception in audio.php: ' . $e->getMessage());
    error_log('Stack trace: ' . $e->getTraceAsString());
    sendError('サーバーエラーが発生しました', 500);
}

// 音声ファイル一覧取得・検索
function handleGetAudio($pdo) {
    $roomId = $_GET['room_id'] ?? null;
    $searchTag = $_GET['tag'] ?? null;
    $searchName = $_GET['name'] ?? null;

    // 部屋番号も合っているときだけ一覧を返す（部屋の ID は順番なので、ID だけだとどの部屋も見られた）
    requireRoomAccess($pdo, $roomId, $_GET['room_number'] ?? null);

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

    // タグは文字列だけを返す（以前に保存された不正な値で、画面が止まらないように）
    foreach ($audioFiles as &$file) {
        $file['tags'] = normalizeTags(json_decode($file['tags'] ?? '[]', true));
    }
    unset($file);

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
    $studentName = readText($_POST['student_name'] ?? null, 255);
    $fileName = readText($_POST['file_name'] ?? null, 255);
    $originalFileName = truncateText($file['name'] ?? '', 255);
    $tags = normalizeTags(json_decode($_POST['tags'] ?? '[]', true));

    // アップロード自体の失敗（サイズ超過など）を先に判定する
    if ($file['error'] !== UPLOAD_ERR_OK) {
        if ($file['error'] === UPLOAD_ERR_INI_SIZE || $file['error'] === UPLOAD_ERR_FORM_SIZE) {
            sendError('ファイルサイズが大きすぎます');
        } else {
            sendError('ファイルのアップロードに失敗しました（エラーコード: ' . $file['error'] . '）');
        }
        return;
    }

    // 部屋番号も合っているときだけ受け付ける（部屋の存在確認もここで行う）
    requireRoomAccess($pdo, $roomId, $_POST['room_number'] ?? null);

    if ($studentName === false || $fileName === false) {
        sendError('名前が長すぎます（255文字まで）');
        return;
    }
    if ($fileName === null) {
        $fileName = $originalFileName !== '' ? $originalFileName : '音声';
    }

    // ファイルサイズチェック
    $maxBytes = defined('MAX_FILE_SIZE') ? min(MAX_FILE_SIZE, AUDIO_UPLOAD_MAX_BYTES) : AUDIO_UPLOAD_MAX_BYTES;
    if ($file['size'] > $maxBytes) {
        sendError('ファイルサイズが制限を超えています（最大' . floor($maxBytes / 1024 / 1024) . 'MB）');
        return;
    }

    $totalStmt = $pdo->prepare("SELECT COALESCE(SUM(file_size), 0) FROM audio_files WHERE room_id = ?");
    $totalStmt->execute([$roomId]);
    if ((int)$totalStmt->fetchColumn() + (int)$file['size'] > AUDIO_ROOM_MAX_TOTAL_BYTES) {
        sendError('この部屋に共有できる音の量の上限に達しました。先生に古い音を削除してもらってください。');
        return;
    }

    // ファイルタイプチェック。
    // 中身から音声の形式を判定できないファイルは受け付けない（以前はブラウザの申告を信じて、
    // 音声ではないファイルでも .wav として保存できていた）。
    $mimeType = detectAudioMimeTypeFromFile($file['tmp_name']);
    if ($mimeType === null || !isAllowedAudioMimeType($mimeType)) {
        sendError('音声ファイルとして読み取れませんでした（対応形式: MP3, WAV, M4A, WebM, OGG など）');
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

    // データベースに保存（失敗したら、置いたファイルも消す。以前は行の無いファイルが残っていた）
    try {
        $sql = "INSERT INTO audio_files (uid, room_id, student_name, file_name, original_filename, file_path, file_size, mime_type, tags)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

        $stmt = $pdo->prepare($sql);
        $stmt->execute([
            $uid,
            $roomId,
            $studentName,
            $fileName,
            $originalFileName,
            $savedFileName,
            $file['size'],
            $mimeType,
            json_encode($tags, JSON_UNESCAPED_UNICODE)
        ]);
    } catch (Exception $e) {
        @unlink($filePath);
        throw $e;
    }

    sendSuccess([
        'uid' => $uid,
        'file_name' => $fileName,
        'original_filename' => $originalFileName,
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

    // 物理ファイル削除（basename: DB の値にパス区切りが含まれていても uploads の外は消さない）
    $filePath = UPLOAD_DIR . basename((string)$fileInfo['file_path']);
    if (is_file($filePath)) {
        unlink($filePath);
    }

    sendSuccess(null, '音声ファイルを削除しました');
}
?>
