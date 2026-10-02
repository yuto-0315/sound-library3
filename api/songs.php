<?php
// エラー表示を有効化（デバッグ用）
error_reporting(E_ALL);
ini_set('display_errors', 0); // ブラウザには表示しない
ini_set('log_errors', 1);

require_once 'config.php';
require_once 'admin_auth.php';
require_once 'validation.php';
require_once 'room_access.php';

setCORSHeaders();
allowAdminPinHeader();

// 1 つの部屋に送れる楽曲の合計（音声入りなので大きい。同じ操作を繰り返してサーバーのディスクが
// いっぱいになるのを防ぐ。共有される音の上限 api/audio.php と同じ）
const SONG_ROOM_MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

$method = $_SERVER['REQUEST_METHOD'];

try {
    $pdo = DatabaseConfig::getConnection();

    switch ($method) {
        case 'GET':
            // 楽曲の一覧・中身は先生用ページだけが使う
            requireAdmin();
            handleGetSongs($pdo);
            break;
        case 'POST':
            // 生徒が音楽づくりページから「先生に送る」
            handleSaveSong($pdo);
            break;
        case 'DELETE':
            requireAdmin();
            handleDeleteSong($pdo);
            break;
        default:
            // 以前の PUT（楽曲の上書き）は画面から使われておらず、誰でも他の人の楽曲を書き換えられたので廃止した
            sendError('許可されていないメソッドです', 405);
    }
} catch (Exception $e) {
    // 詳しい内容（SQL のエラーなど）は画面に出さず、サーバーの記録にだけ残す
    error_log('Exception in songs.php: ' . $e->getMessage());
    error_log('Stack trace: ' . $e->getTraceAsString());
    sendError('サーバーエラーが発生しました', 500);
}

// 楽曲一覧取得
function handleGetSongs($pdo) {
    // 個別楽曲の詳細取得
    $uid = $_GET['uid'] ?? null;

    if ($uid) {
        handleGetSongDetail($pdo, $uid);
        return;
    }

    $roomId = $_GET['room_id'] ?? null;
    $groupNumber = $_GET['group_number'] ?? null;
    $studentName = $_GET['student_name'] ?? null;

    if (!$roomId) {
        sendError('部屋IDは必須です');
        return;
    }

    // 一覧には楽曲データ（音声を含み大きい）を含めない。
    // 以前は全員分の楽曲データを読み込んでいたため、楽曲が多い部屋ではサーバーのメモリが足りず、
    // 先生用ページに何も表示されなかった。中身は「DAWで開く」のときに uid で 1 曲ずつ取得する。
    $sql = "SELECT sd.id, sd.uid, sd.room_id, sd.student_name, sd.group_number, sd.song_title,
                   sd.created_at, sd.updated_at, LENGTH(sd.song_data) AS song_data_size,
                   r.room_number, r.room_name
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

    foreach ($songs as &$song) {
        $song['song_data_size'] = (int)$song['song_data_size'];
        $song['song_data'] = null;
        $song['data_omitted'] = true;
    }
    unset($song);

    sendSuccess($songs, '楽曲一覧を取得しました');
}

// 個別楽曲の詳細取得
function handleGetSongDetail($pdo, $uid) {
    $sql = "SELECT sd.id, sd.uid, sd.room_id, sd.student_name, sd.group_number, sd.song_title,
                   sd.created_at, sd.updated_at, sd.song_data, r.room_number, r.room_name
            FROM song_data sd
            JOIN rooms r ON sd.room_id = r.id
            WHERE sd.uid = ?";

    $stmt = $pdo->prepare($sql);
    $stmt->execute([$uid]);
    $song = $stmt->fetch();

    if (!$song) {
        sendError('楽曲が見つかりませんでした', 404);
        return;
    }

    // 保存されている JSON をそのまま返す（デコードして作り直すと、楽曲の何倍ものメモリを使う）
    $rawSongData = $song['song_data'];
    unset($song['song_data']);
    $song['song_data_size'] = strlen($rawSongData);
    $song['data_omitted'] = false;

    $meta = json_encode($song, JSON_UNESCAPED_UNICODE);
    if ($meta === false || $rawSongData === null || $rawSongData === '') {
        sendError('楽曲データを読み込めませんでした', 500);
        return;
    }

    if (!headers_sent()) {
        header('Content-Type: application/json; charset=utf-8');
    }
    // {"success":true,"message":"…","data":{…楽曲の情報…,"song_data":<保存されている JSON>}}
    echo '{"success":true,"message":"楽曲詳細を取得しました","data":'
        . substr($meta, 0, -1) . ',"song_data":' . $rawSongData . '}}';
}

// 楽曲保存
function handleSaveSong($pdo) {
    $rawInput = file_get_contents('php://input');
    $input = json_decode($rawInput, true);
    if (!is_array($input)) {
        // post_max_size を超えると本文が空になる
        sendError('楽曲データを読み取れませんでした。データが大きすぎる可能性があります。', 413);
        return;
    }

    $roomId = $input['room_id'] ?? null;
    $studentName = readText($input['student_name'] ?? null, 255);
    $groupNumber = readText($input['group_number'] ?? null, 50);
    $songTitle = readText($input['song_title'] ?? null, 255);
    $songData = $input['song_data'] ?? null;

    // 部屋番号も合っているときだけ受け付ける（部屋の ID は順番なので、ID だけだとどの部屋にも送れた）
    requireRoomAccess($pdo, $roomId, $input['room_number'] ?? null);

    if ($songTitle === null) {
        sendError('楽曲タイトルは必須です');
        return;
    }

    if ($songTitle === false || $studentName === false || $groupNumber === false) {
        sendError('名前やタイトルが長すぎます（タイトル・名前は255文字、班番号は50文字まで）');
        return;
    }

    // 楽曲データの形を確かめる（壊れたデータを保存すると、先生の端末で開いたときに止まってしまう）
    if (!is_array($songData) || !isset($songData['tracks']) || !is_array($songData['tracks'])) {
        sendError('楽曲データは必須です');
        return;
    }
    foreach ($songData['tracks'] as $track) {
        if (!is_array($track) || (isset($track['clips']) && !is_array($track['clips']))) {
            sendError('楽曲データの形式が正しくありません');
            return;
        }
    }

    $totalStmt = $pdo->prepare("SELECT COALESCE(SUM(LENGTH(song_data)), 0) FROM song_data WHERE room_id = ?");
    $totalStmt->execute([$roomId]);
    if ((int)$totalStmt->fetchColumn() + strlen((string)$rawInput) > SONG_ROOM_MAX_TOTAL_BYTES) {
        sendError('この部屋に送れる楽曲の量の上限に達しました。先生に古い楽曲を削除してもらってください。', 413);
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
