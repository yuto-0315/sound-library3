<?php
require_once 'config.php';

setCORSHeaders();

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DatabaseConfig::getConnection();
    
    switch ($method) {
        case 'GET':
            handleGetSongs($pdo);
            break;
        case 'POST':
            handleSaveSong($pdo);
            break;
        case 'PUT':
            handleUpdateSong($pdo);
            break;
        case 'DELETE':
            handleDeleteSong($pdo);
            break;
        default:
            sendError('許可されていないメソッドです', 405);
    }
} catch (Exception $e) {
    error_log($e->getMessage());
    sendError('サーバーエラーが発生しました');
}

// 楽曲一覧取得
function handleGetSongs($pdo) {
    $roomId = $_GET['room_id'] ?? null;
    $groupNumber = $_GET['group_number'] ?? null;
    $studentName = $_GET['student_name'] ?? null;
    
    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }
    
    $sql = "SELECT sd.*, r.room_number, r.room_name 
            FROM song_data sd 
            JOIN rooms r ON sd.room_id = r.id 
            WHERE sd.room_id = ?";
    $params = [$roomId];
    
    // グループ番号での絞り込み
    if ($groupNumber) {
        $sql .= " AND sd.group_number = ?";
        $params[] = $groupNumber;
    }
    
    // 生徒名での絞り込み
    if ($studentName) {
        $sql .= " AND sd.student_name LIKE ?";
        $params[] = "%$studentName%";
    }
    
    $sql .= " ORDER BY sd.created_at DESC";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    $songs = $stmt->fetchAll();
    
    // song_dataをデコード
    foreach ($songs as &$song) {
        $song['song_data'] = json_decode($song['song_data'], true);
    }
    
    sendSuccess($songs, '楽曲一覧を取得しました');
}

// 楽曲保存
function handleSaveSong($pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $roomId = $input['room_id'] ?? null;
    $studentName = $input['student_name'] ?? null;
    $groupNumber = $input['group_number'] ?? null;
    $songTitle = $input['song_title'] ?? null;
    $songData = $input['song_data'] ?? null;
    
    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }
    
    if (!$songTitle) {
        sendError('楽曲タイトルは必須です');
        return;
    }
    
    if (!$songData) {
        sendError('楽曲データは必須です');
        return;
    }
    
    // 部屋の存在確認
    $roomStmt = $pdo->prepare("SELECT id FROM rooms WHERE id = ?");
    $roomStmt->execute([$roomId]);
    if (!$roomStmt->fetch()) {
        sendError('指定された部屋が見つかりません', 404);
        return;
    }
    
    // ユニークIDの生成
    $uid = uniqid('song_', true);
    
    $sql = "INSERT INTO song_data (uid, room_id, student_name, group_number, song_title, song_data) 
            VALUES (?, ?, ?, ?, ?, ?)";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute([
        $uid,
        $roomId,
        $studentName,
        $groupNumber,
        $songTitle,
        json_encode($songData, JSON_UNESCAPED_UNICODE)
    ]);
    
    $songId = $pdo->lastInsertId();
    
    sendSuccess([
        'id' => $songId,
        'uid' => $uid,
        'song_title' => $songTitle,
        'group_number' => $groupNumber,
        'student_name' => $studentName
    ], '楽曲を保存しました');
}

// 楽曲更新
function handleUpdateSong($pdo) {
    $input = json_decode(file_get_contents('php://input'), true);
    
    $uid = $input['uid'] ?? null;
    $songTitle = $input['song_title'] ?? null;
    $songData = $input['song_data'] ?? null;
    $groupNumber = $input['group_number'] ?? null;
    
    if (!$uid) {
        sendError('楽曲UIDは必須です');
        return;
    }
    
    $updateFields = [];
    $params = [];
    
    if ($songTitle) {
        $updateFields[] = "song_title = ?";
        $params[] = $songTitle;
    }
    
    if ($songData) {
        $updateFields[] = "song_data = ?";
        $params[] = json_encode($songData, JSON_UNESCAPED_UNICODE);
    }
    
    if ($groupNumber !== null) {
        $updateFields[] = "group_number = ?";
        $params[] = $groupNumber;
    }
    
    if (empty($updateFields)) {
        sendError('更新するフィールドがありません');
        return;
    }
    
    $params[] = $uid;
    $sql = "UPDATE song_data SET " . implode(", ", $updateFields) . " WHERE uid = ?";
    
    $stmt = $pdo->prepare($sql);
    $stmt->execute($params);
    
    if ($stmt->rowCount() === 0) {
        sendError('楽曲が見つかりませんでした', 404);
        return;
    }
    
    sendSuccess(null, '楽曲を更新しました');
}

// 楽曲削除
function handleDeleteSong($pdo) {
    $uid = $_GET['uid'] ?? null;
    
    if (!$uid) {
        sendError('楽曲UIDは必須です');
        return;
    }
    
    $sql = "DELETE FROM song_data WHERE uid = ?";
    $stmt = $pdo->prepare($sql);
    $stmt->execute([$uid]);
    
    if ($stmt->rowCount() === 0) {
        sendError('楽曲が見つかりませんでした', 404);
        return;
    }
    
    sendSuccess(null, '楽曲を削除しました');
}
?>
