<?php
require_once 'config.php';
require_once 'admin_auth.php';
require_once 'validation.php';

setCORSHeaders();
allowAdminPinHeader();

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DatabaseConfig::getConnection();

    switch ($method) {
        case 'GET':
            // 部屋の一覧は、生徒が部屋に入るときにも使う
            handleGetRooms($pdo);
            break;
        case 'POST':
            requireAdmin();
            handleCreateRoom($pdo);
            break;
        case 'DELETE':
            requireAdmin();
            handleDeleteRoom($pdo);
            break;
        default:
            // 以前の PUT（部屋名の変更）は画面から使われておらず、送らなかった項目まで空にしていたので廃止した
            sendError('許可されていないメソッドです', 405);
    }
} catch (Exception $e) {
    error_log('Exception in rooms.php: ' . $e->getMessage());
    sendError('サーバーエラーが発生しました', 500);
}

// 部屋一覧取得
function handleGetRooms($pdo) {
    $sql = "SELECT id, room_number, room_name, teacher_name, created_at FROM rooms ORDER BY room_number";
    $stmt = $pdo->prepare($sql);
    $stmt->execute();
    $rooms = $stmt->fetchAll();

    sendSuccess($rooms, '部屋一覧を取得しました');
}

// 部屋作成（先生用）
function handleCreateRoom($pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    if (!is_array($input)) {
        sendError('送られてきた内容を読み取れませんでした');
        return;
    }

    $roomNumber = $input['room_number'] ?? null;
    $roomName = readText($input['room_name'] ?? null, 255);
    $teacherName = readText($input['teacher_name'] ?? null, 255);

    if ($roomNumber === null || $roomNumber === '') {
        sendError('部屋番号は必須です');
        return;
    }

    // 部屋番号は 1〜999999 の整数（「1.5」や「1e3」のような値は受け付けない）
    if (!preg_match('/^[0-9]{1,6}$/', trim((string)$roomNumber)) || (int)$roomNumber <= 0) {
        sendError('部屋番号は 1〜999999 の数字で入力してください');
        return;
    }
    $roomNumber = (int)$roomNumber;

    if ($roomName === false || $teacherName === false) {
        sendError('部屋名・先生名は255文字までです');
        return;
    }

    // 重複チェック
    $checkSql = "SELECT id FROM rooms WHERE room_number = ?";
    $checkStmt = $pdo->prepare($checkSql);
    $checkStmt->execute([$roomNumber]);

    if ($checkStmt->fetch()) {
        sendError('この部屋番号は既に使用されています');
        return;
    }

    $roomName = $roomName ?? 'Room';
    $sql = "INSERT INTO rooms (room_number, room_name, teacher_name) VALUES (?, ?, ?)";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$roomNumber, $roomName, $teacherName]);

    $roomId = $pdo->lastInsertId();

    sendSuccess([
        'id' => $roomId,
        'room_number' => $roomNumber,
        'room_name' => $roomName,
        'teacher_name' => $teacherName
    ], '部屋を作成しました');
}

// 部屋削除
function handleDeleteRoom($pdo) {
    $roomId = $_GET['id'] ?? null;

    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }

    // 部屋の音声ファイルの場所を先に調べておく。
    // 以前はデータベースの行だけが（外部キーの CASCADE で）消え、子どもの録音ファイルがサーバーに残り続けていた
    $fileStmt = $pdo->prepare("SELECT file_path FROM audio_files WHERE room_id = ?");
    $fileStmt->execute([$roomId]);
    $filePaths = $fileStmt->fetchAll(PDO::FETCH_COLUMN);

    $sql = "DELETE FROM rooms WHERE id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$roomId]);

    if ($stmt->rowCount() === 0) {
        sendError('部屋が見つかりませんでした', 404);
        return;
    }

    foreach ($filePaths as $filePath) {
        $path = UPLOAD_DIR . basename((string)$filePath);
        if (is_file($path) && !@unlink($path)) {
            error_log('音声ファイルを削除できませんでした: ' . $path);
        }
    }

    sendSuccess(['deleted_files' => count($filePaths)], '部屋を削除しました');
}
?>
