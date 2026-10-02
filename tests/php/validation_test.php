<?php
// api/validation.php（入力の確認）と api/admin_auth.php（先生用の暗証番号）のテスト
// 実行: php tests/php/validation_test.php
require_once __DIR__ . '/../../api/validation.php';

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

// 先生用の暗証番号: 設定が無ければ確認しない
putenv('SOUND_LIBRARY_ADMIN_PIN');
check('pin not configured', getConfiguredAdminPin(), is_file(__DIR__ . '/../../api/admin_pin.php') ? getConfiguredAdminPin() : null);
putenv('SOUND_LIBRARY_ADMIN_PIN= 4321 ');
check('pin from env', getConfiguredAdminPin(), '4321');
$_SERVER['HTTP_X_ADMIN_PIN'] = '4321';
requireAdmin();
check('pin accepted', count($sentErrors), 0);
putenv('SOUND_LIBRARY_ADMIN_PIN');

echo $fails ? "\n{$fails} 件失敗\n" : "\nすべて成功\n";
exit($fails ? 1 : 0);
