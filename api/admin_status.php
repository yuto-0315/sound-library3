<?php
// 先生用ページに、暗証番号が設定されているかを知らせる（暗証番号そのものは返さない）。
// 'off' のときは、URL を知っている人なら誰でも部屋を削除できることを先生用ページで伝える。
require_once 'config.php';
require_once 'admin_auth.php';

setCORSHeaders();
allowAdminPinHeader();

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'GET') {
    sendError('許可されていないメソッドです', 405);
    exit;
}

sendSuccess([
    'pin' => getAdminPinState(getConfiguredAdminPin()),
    'pin_min_length' => ADMIN_PIN_MIN_LENGTH
], '暗証番号の設定を確かめました');
?>
