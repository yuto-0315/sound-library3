<?php
require_once 'config.php';

setCORSHeaders();

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DatabaseConfig::getConnection();
    
    switch ($method) {
        case 'GET':
            handleGetRooms($pdo);
            break;
        case 'POST':
            handleCreateRoom($pdo);
            break;
        case 'PUT':
            handleUpdateRoom($pdo);
            break;
        case 'DELETE':
            handleDeleteRoom($pdo);
            break;
        default:
            sendError('許可されていないメソッドです', 405);
    }
} catch (Exception $e) {
    error_log($e->getMessage());
    sendError('サーバーエラーが発生しました');
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
    
    $roomNumber = $input['room_number'] ?? null;
    $roomName = $input['room_name'] ?? 'Room';
    $teacherName = $input['teacher_name'] ?? null;
    
    if (!$roomNumber) {
        sendError('部屋番号は必須です');
        return;
    }
    
    if (!is_numeric($roomNumber) || $roomNumber <= 0) {
        sendError('部屋番号は正の数値で入力してください');
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

// 部屋更新
function handleUpdateRoom($pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $roomId = $input['id'] ?? null;
    $roomName = $input['room_name'] ?? null;
    $teacherName = $input['teacher_name'] ?? null;
    
    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }
    
    $sql = "UPDATE rooms SET room_name = ?, teacher_name = ? WHERE id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$roomName, $teacherName, $roomId]);
    
    if ($stmt->rowCount() === 0) {
        sendError('部屋が見つかりませんでした', 404);
        return;
    }
    
    sendSuccess(null, '部屋情報を更新しました');
}

// 部屋削除
function handleDeleteRoom($pdo) {
    $roomId = $_GET['id'] ?? null;
    
    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }
    
    $sql = "DELETE FROM rooms WHERE id = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$roomId]);
    
    if ($stmt->rowCount() === 0) {
        sendError('部屋が見つかりませんでした', 404);
        return;
    }
    
    sendSuccess(null, '部屋を削除しました');
}
?>
