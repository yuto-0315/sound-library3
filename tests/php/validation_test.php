<?php
// api/validation.php（入力の確認）・api/admin_auth.php（先生用の暗証番号）・api/room_access.php（部屋番号の確認）のテスト
// 実行: php tests/php/validation_test.php
require_once __DIR__ . '/../../api/validation.php';
require_once __DIR__ . '/../../api/room_access.php';

// admin_auth.php は config.php の sendError を使う（ここでは呼ばれたことだけを記録する）
$sentErrors = [];
function sendError($message, $code = 400) {
    global $sentErrors;
    $sentErrors[] = [$message, $code];
}
require_once __DIR__ . '/../../api/admin_auth.php';

$fails = 0;
function check($label, $actual, $expected) {
    global $fails;
    $ok = $actual === $expected;
    if (!$ok) $fails++;
    echo ($ok ? "ok   " : "FAIL ") . $label . " => " . var_export($actual, true) . "\n";
}

// readText: 前後の空白を除き、空なら null、長すぎる・文字コードが壊れていれば false
check('text trim', readText('  たいこ  ', 10), 'たいこ');
check('text empty', readText('   ', 10), null);
check('text null', readText(null, 10), null);
check('text number', readText(3, 10), '3');
check('text japanese length counts characters', readText(str_repeat('あ', 10), 10), str_repeat('あ', 10));
check('text too long', readText(str_repeat('あ', 11), 10), false);
check('text array', readText(['x'], 10), false);
check('text invalid utf8', readText("\xC3\x28", 10), false);

// truncateText: 利用者が直せない値は切り詰める
check('truncate', truncateText('あいうえお.m4a', 3), 'あいう');
check('truncate invalid', truncateText("\xC3\x28", 3), '');

// normalizeTags: 文字列だけ・重複なし・長さと数の上限
check('tags strings only', normalizeTags(['がっき', ['x'], null, 12, ' しぜん ', 'がっき', '']), ['がっき', '12', 'しぜん']);
check('tags not array', normalizeTags('がっき'), []);
check('tags object', normalizeTags(['a' => ['b' => 1]]), []);
check('tags too long', normalizeTags([str_repeat('あ', 31), 'ok']), ['ok']);
check('tags max count', count(normalizeTags(array_map('strval', range(1, 20)))), 10);

// 部屋番号: 1〜6 けたの数字だけ
check('room number string', readRoomNumber(' 101 '), '101');
check('room number int', readRoomNumber(101), '101');
check('room number too long', readRoomNumber('1234567'), null);
check('room number not digits', readRoomNumber('10a'), null);
check('room number fullwidth (画面で半角にしてから送る)', readRoomNumber('１０１'), null);
check('room number array', readRoomNumber(['101']), null);
check('room number empty', readRoomNumber(''), null);

// 部屋番号と ID が合っていれば部屋を返す（データベースの代わりに、渡された値を記録する偽物を使う）
class FakeStatement {
    public $params = null;
    private $row;
    public function __construct($row) { $this->row = $row; }
    public function execute($params) { $this->params = $params; return true; }
    public function fetch() { return $this->row; }
}
class FakePdo {
    public $sql = [];
    public $statement;
    public function __construct($row) { $this->statement = new FakeStatement($row); }
    public function prepare($sql) { $this->sql[] = $sql; return $this->statement; }
}
$room = ['id' => 3, 'room_number' => 101, 'room_name' => '1年1組'];
$pdo = new FakePdo($room);
check('room access returns room', requireRoomAccess($pdo, '3', '101'), $room);
check('room access checks id and number together', $pdo->statement->params, [3, 101]);
check('room access query uses both', strpos($pdo->sql[0], 'id = ? AND room_number = ?') !== false, true);
$pdo = new FakePdo(false);
check('find room by number: not found', findRoomByNumber($pdo, '999'), null);
check('find room by number: invalid number is not queried', findRoomByNumber(new FakePdo($room), 'abc'), null);
$pdo = new FakePdo($room);
check('find room by number: found', findRoomByNumber($pdo, '101'), $room);
check('find room by number: public columns only', strpos($pdo->sql[0], 'teacher_name') === false, true);

// 先生用の暗証番号: 使える値の決まり（半角の英数字・記号で 6 文字以上、例のままは不可）
check('pin usable', isUsableAdminPin('ongaku2026'), true);
check('pin symbols ok', isUsableAdminPin('a!b@c#'), true);
check('pin too short', isUsableAdminPin('4321'), false);
check('pin japanese', isUsableAdminPin('さくらさくらさくら'), false);
check('pin fullwidth digits', isUsableAdminPin('１２３４５６'), false);
check('pin with space', isUsableAdminPin('abc def'), false);
check('pin placeholder', isUsableAdminPin(ADMIN_PIN_PLACEHOLDER), false);
check('pin state off', getAdminPinState(null), 'off');
check('pin state on', getAdminPinState('ongaku2026'), 'on');
check('pin state invalid', getAdminPinState('1234'), 'invalid');

// 送られた暗証番号の確認
check('check: not configured => ok', checkAdminPin(null, ''), 'ok');
check('check: correct', checkAdminPin('ongaku2026', 'ongaku2026'), 'ok');
check('check: correct with spaces', checkAdminPin('ongaku2026', ' ongaku2026 '), 'ok');
check('check: wrong', checkAdminPin('ongaku2026', 'ongaku2025'), 'wrong');
check('check: missing', checkAdminPin('ongaku2026', ''), 'wrong');
check('check: not a string', checkAdminPin('ongaku2026', ['ongaku2026']), 'wrong');
check('check: placeholder config', checkAdminPin(ADMIN_PIN_PLACEHOLDER, ADMIN_PIN_PLACEHOLDER), 'invalid-config');
check('check: japanese config', checkAdminPin('さくらさくらさくら', 'さくらさくらさくら'), 'invalid-config');

// 間違えたあとの待ち時間: 3 回までは待たない。そのあと 2・4・8… 秒、最大 60 秒
check('wait after 0', adminFailureWaitSeconds(0), 0);
check('wait after 2', adminFailureWaitSeconds(2), 0);
check('wait after 3', adminFailureWaitSeconds(3), 2);
check('wait after 4', adminFailureWaitSeconds(4), 4);
check('wait after 7', adminFailureWaitSeconds(7), 32);
check('wait after 8', adminFailureWaitSeconds(8), 60);
check('wait after 30', adminFailureWaitSeconds(30), 60);

// 間違えた記録（一時フォルダに置く。このテストだけの名前を使い、最後に消す）
$key = 'test-' . bin2hex(random_bytes(6));
$now = 1700000000;
check('no failures yet', adminRetryAfterSeconds($key, $now), 0);
recordAdminFailure($key, $now);
recordAdminFailure($key, $now + 1);
check('two failures: no wait', adminRetryAfterSeconds($key, $now + 1), 0);
recordAdminFailure($key, $now + 2);
check('three failures: wait 2s', adminRetryAfterSeconds($key, $now + 2), 2);
check('three failures: after 2s ok', adminRetryAfterSeconds($key, $now + 4), 0);
check('old failures are forgotten after 15 min', adminRetryAfterSeconds($key, $now + 2 + ADMIN_FAILURE_WINDOW_SECONDS), 0);
check('failures are read in order', count(readAdminFailures($key, $now + 2)), 3);
clearAdminFailures($key);
check('cleared', adminRetryAfterSeconds($key, $now + 2), 0);

// 暗証番号の設定: 環境変数が優先。設定が無ければ確認しない
putenv('SOUND_LIBRARY_ADMIN_PIN');
check('pin not configured', getConfiguredAdminPin(), is_file(__DIR__ . '/../../api/admin_pin.php') ? getConfiguredAdminPin() : null);
putenv('SOUND_LIBRARY_ADMIN_PIN= ongaku2026 ');
check('pin from env', getConfiguredAdminPin(), 'ongaku2026');
$_SERVER['REMOTE_ADDR'] = 'test-' . bin2hex(random_bytes(6));
$_SERVER['HTTP_X_ADMIN_PIN'] = 'ongaku2026';
requireAdmin();
check('pin accepted', count($sentErrors), 0);
clearAdminFailures($_SERVER['REMOTE_ADDR']);
putenv('SOUND_LIBRARY_ADMIN_PIN');

echo $fails ? "\n{$fails} 件失敗\n" : "\nすべて成功\n";
exit($fails ? 1 : 0);
