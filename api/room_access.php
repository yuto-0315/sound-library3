<?php
// 生徒の操作（共有された音の一覧・アップロード、楽曲の送信）では、部屋の ID だけでなく部屋番号も確かめる。
//
// 以前は部屋の一覧（rooms.php）を誰でも取得でき、部屋の ID は 1, 2, 3… と順番に振られるため、
// audio.php?room_id=1, 2, 3… と調べるだけで、どの部屋の音とつくった子の名前も見られた。
// 部屋番号は先生が生徒に伝える「合言葉」として扱い、部屋の一覧は先生だけが見られるようにした（rooms.php）。

// 部屋番号として読む（1〜6 けたの数字。それ以外は null）
function readRoomNumber($value) {
    if (is_int($value)) {
        $value = (string)$value;
    }
    if (!is_string($value)) {
        return null;
    }
    $value = trim($value);
    return preg_match('/^[0-9]{1,6}$/', $value) === 1 ? $value : null;
}

// 部屋番号から部屋を探す（無ければ null）。生徒に返してよい項目だけを返す
function findRoomByNumber($pdo, $roomNumber) {
    $number = readRoomNumber($roomNumber);
    if ($number === null) {
        return null;
    }
    $stmt = $pdo->prepare('SELECT id, room_number, room_name FROM rooms WHERE room_number = ?');
    $stmt->execute([(int)$number]);
    $room = $stmt->fetch();
    return $room ?: null;
}

// 部屋の ID と部屋番号が合っていなければ、エラーを返して止める。合っていれば部屋を返す
function requireRoomAccess($pdo, $roomId, $roomNumber) {
    $number = readRoomNumber($roomNumber);
    if ($roomId === null || $roomId === '' || !is_numeric($roomId) || $number === null) {
        sendError('部屋番号を確かめてください（部屋に入り直してください）', 400);
        exit;
    }
    $stmt = $pdo->prepare('SELECT id, room_number, room_name FROM rooms WHERE id = ? AND room_number = ?');
    $stmt->execute([(int)$roomId, (int)$number]);
    $room = $stmt->fetch();
    if (!$room) {
        sendError('指定された部屋が見つかりません', 404);
        exit;
    }
    return $room;
}
?>
