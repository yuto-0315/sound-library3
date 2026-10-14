<?php
// 先生用の操作（部屋の作成・削除、部屋の一覧、共有された音や楽曲の削除、楽曲の一覧）を、暗証番号で守る。
//
// 先生用ページ（#/admin）はメニューには出ていないが、URL を知っていれば誰でも開けるため、
// 生徒が部屋ごと全員のデータを消せてしまっていた。
//
// 暗証番号は次のどちらかで設定する（両方無ければ、これまでどおり確認しない）:
//   1. 環境変数 SOUND_LIBRARY_ADMIN_PIN
//   2. api/admin_pin.php（git の管理対象外。api/admin_pin.example.php をコピーして作る）
// 先生用ページでは、画面上部の「先生用の暗証番号」に入力した値を X-Admin-Pin ヘッダーで送る。

// 暗証番号の決まり: 半角の英数字・記号で 6 文字以上。
// （ブラウザは HTTP ヘッダーに日本語や全角文字を入れられず、先生用ページのすべての操作が失敗していた）
const ADMIN_PIN_MIN_LENGTH = 6;
const ADMIN_PIN_MAX_LENGTH = 128;
// api/admin_pin.example.php の値。例のままコピーしても使えないようにする（git で公開されているため）
const ADMIN_PIN_PLACEHOLDER = 'ここに暗証番号';

// 間違えたあとの待ち時間（同じ端末・同じネットワークから続けて試されるのを防ぐ）。
// 学校では全員の iPad が同じ IP アドレスになることがあるので、締め出し（ロック）ではなく、
// 間違えるたびに次に試せるまでの時間を延ばす（最大 60 秒）。
const ADMIN_FAILURE_FREE_COUNT = 3;
const ADMIN_FAILURE_MAX_WAIT_SECONDS = 60;
const ADMIN_FAILURE_WINDOW_SECONDS = 900;

function getConfiguredAdminPin() {
    $fromEnv = getenv('SOUND_LIBRARY_ADMIN_PIN');
    if ($fromEnv !== false && trim($fromEnv) !== '') {
        return trim($fromEnv);
    }
    $file = __DIR__ . '/admin_pin.php';
    if (is_file($file)) {
        $pin = include $file;
        if (is_string($pin) || is_int($pin)) {
            $pin = trim((string)$pin);
            return $pin === '' ? null : $pin;
        }
    }
    return null;
}

// 設定された暗証番号として使えるか
function isUsableAdminPin($pin) {
    if (!is_string($pin) || $pin === ADMIN_PIN_PLACEHOLDER) {
        return false;
    }
    $pattern = '/^[\x21-\x7E]{' . ADMIN_PIN_MIN_LENGTH . ',' . ADMIN_PIN_MAX_LENGTH . '}$/';
    return preg_match($pattern, $pin) === 1;
}

// 暗証番号の設定の状態: 'off'（設定していない）/ 'on'（使える）/ 'invalid'（例のまま・短い・全角などで使えない）
function getAdminPinState($pin) {
    if ($pin === null) {
        return 'off';
    }
    return isUsableAdminPin($pin) ? 'on' : 'invalid';
}

// 送られた暗証番号を確かめる: 'ok' / 'wrong' / 'invalid-config'
function checkAdminPin($expected, $given) {
    $state = getAdminPinState($expected);
    if ($state === 'off') {
        return 'ok';
    }
    if ($state === 'invalid') {
        return 'invalid-config';
    }
    $given = is_string($given) ? trim($given) : '';
    if ($given === '' || !hash_equals($expected, $given)) {
        return 'wrong';
    }
    return 'ok';
}

// 間違えた回数から、次に試せるまでの秒数（3 回目までは待たない。4 回目から 2・4・8… 秒、最大 60 秒）
function adminFailureWaitSeconds($failureCount) {
    if ($failureCount < ADMIN_FAILURE_FREE_COUNT) {
        return 0;
    }
    return (int)min(ADMIN_FAILURE_MAX_WAIT_SECONDS, pow(2, $failureCount - ADMIN_FAILURE_FREE_COUNT + 1));
}

// ===== 間違えた記録（サーバーの一時フォルダに、IP アドレスのハッシュごとに置く。書けなければ記録しない） =====

function adminFailureFile($key) {
    $dir = rtrim(sys_get_temp_dir(), '/\\') . DIRECTORY_SEPARATOR . 'sound-library-admin-failures';
    if (!is_dir($dir)) {
        @mkdir($dir, 0700, true);
    }
    return $dir . DIRECTORY_SEPARATOR . hash('sha256', 'sound-library:' . $key) . '.json';
}

// 直近 15 分の失敗の時刻（古い順）
function readAdminFailures($key, $now) {
    $file = adminFailureFile($key);
    if (!is_file($file)) {
        return [];
    }
    $data = json_decode((string)@file_get_contents($file), true);
    if (!is_array($data)) {
        return [];
    }
    $recent = array_filter($data, function ($time) use ($now) {
        return is_int($time) && $time > $now - ADMIN_FAILURE_WINDOW_SECONDS && $time <= $now;
    });
    sort($recent);
    return array_values($recent);
}

function recordAdminFailure($key, $now) {
    $failures = readAdminFailures($key, $now);
    $failures[] = $now;
    @file_put_contents(adminFailureFile($key), json_encode(array_slice($failures, -20)), LOCK_EX);
}

function clearAdminFailures($key) {
    $file = adminFailureFile($key);
    if (is_file($file)) {
        @unlink($file);
    }
}

// あと何秒待てば試せるか（0 なら今すぐ試せる）
function adminRetryAfterSeconds($key, $now) {
    $failures = readAdminFailures($key, $now);
    $count = count($failures);
    if ($count === 0) {
        return 0;
    }
    $wait = adminFailureWaitSeconds($count);
    $last = $failures[$count - 1];
    return max(0, $last + $wait - $now);
}

function adminClientKey() {
    return (string)($_SERVER['REMOTE_ADDR'] ?? 'unknown');
}

// 暗証番号を送れるよう CORS で許可するヘッダーに加える（setCORSHeaders() の後に呼ぶ）
function allowAdminPinHeader() {
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Admin-Pin');
}

// 暗証番号が設定されていて、送られた値が違えば止める
function requireAdmin() {
    $expected = getConfiguredAdminPin();
    $state = getAdminPinState($expected);
    if ($state === 'off') {
        return;
    }
    if ($state === 'invalid') {
        // 例のままの値・日本語・短すぎる暗証番号では、先生用ページから送れない（送れても安全ではない）
        error_log('sound-library: admin PIN is not usable (placeholder, non-ASCII or shorter than ' . ADMIN_PIN_MIN_LENGTH . ')');
        sendError('サーバーの暗証番号の設定が正しくありません。半角の英数字・記号で ' . ADMIN_PIN_MIN_LENGTH . ' 文字以上にしてください（SETUP.md）', 500);
        exit;
    }

    $key = adminClientKey();
    $now = time();
    $retryAfter = adminRetryAfterSeconds($key, $now);
    if ($retryAfter > 0) {
        header('Retry-After: ' . $retryAfter);
        sendError("暗証番号を何回も間違えたので、{$retryAfter} 秒待ってからもう一度ためしてください", 429);
        exit;
    }

    $given = $_SERVER['HTTP_X_ADMIN_PIN'] ?? '';
    if (checkAdminPin($expected, $given) !== 'ok') {
        recordAdminFailure($key, $now);
        error_log('sound-library: wrong admin PIN from ' . $key);
        sendError('先生用の暗証番号が違います', 401);
        exit;
    }
    clearAdminFailures($key);
}
?>
