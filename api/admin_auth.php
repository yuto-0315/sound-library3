<?php
// 先生用の操作（部屋の作成・削除、共有された音や楽曲の削除、楽曲の一覧）を、暗証番号で守る。
//
// 先生用ページ（#/admin）はメニューには出ていないが、URL を知っていれば誰でも開けるため、
// 生徒が部屋ごと全員のデータを消せてしまっていた。
//
// 暗証番号は次のどちらかで設定する（両方無ければ、これまでどおり確認しない）:
//   1. 環境変数 SOUND_LIBRARY_ADMIN_PIN
//   2. api/admin_pin.php（git の管理対象外。api/admin_pin.example.php をコピーして作る）
// 先生用ページでは、画面上部の「先生用の暗証番号」に入力した値を X-Admin-Pin ヘッダーで送る。

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

// 暗証番号を送れるよう CORS で許可するヘッダーに加える（setCORSHeaders() の後に呼ぶ）
function allowAdminPinHeader() {
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With, X-Admin-Pin');
}

// 暗証番号が設定されていて、送られた値が違えば 401 で止める
function requireAdmin() {
    $expected = getConfiguredAdminPin();
    if ($expected === null) {
        return;
    }
    $given = isset($_SERVER['HTTP_X_ADMIN_PIN']) ? trim((string)$_SERVER['HTTP_X_ADMIN_PIN']) : '';
    if ($given === '' || !hash_equals($expected, $given)) {
        sendError('先生用の暗証番号が違います', 401);
        exit;
    }
}
?>
