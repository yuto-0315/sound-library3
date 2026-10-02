<?php
// 送られてきた値の確認（文字数・文字コード・タグ）
//
// データベースの列には文字数の上限がある（VARCHAR(255) など）。上限を超えると MySQL の
// 標準設定（strict モード）では保存がエラーになり、アップロード済みのファイルだけが残っていた。

function textLength($value) {
    if (function_exists('mb_strlen')) {
        return mb_strlen($value, 'UTF-8');
    }
    return preg_match_all('/./us', $value);
}

function isValidUtf8($value) {
    return is_string($value) && preg_match('//u', $value) === 1;
}

// 文字列として受け取る。空なら null。上限を超える・文字コードが壊れているときは false
function readText($value, $maxLength) {
    if ($value === null) {
        return null;
    }
    if (is_int($value) || is_float($value)) {
        $value = (string)$value;
    }
    if (!is_string($value) || !isValidUtf8($value)) {
        return false;
    }
    $value = trim($value);
    if ($value === '') {
        return null;
    }
    return textLength($value) > $maxLength ? false : $value;
}

// 長すぎる値は切り詰める（ブラウザが付けた元のファイル名など、利用者が直せない値に使う）
function truncateText($value, $maxLength) {
    $value = is_string($value) && isValidUtf8($value) ? trim($value) : '';
    if (function_exists('mb_substr')) {
        return mb_substr($value, 0, $maxLength, 'UTF-8');
    }
    preg_match('/^.{0,' . (int)$maxLength . '}/us', $value, $matches);
    return $matches[0] ?? '';
}

// タグは文字列だけを残す（数字やオブジェクトが入ると、画面に表示するときにエラーで止まっていた）
function normalizeTags($value, $maxTags = 10, $maxLength = 30) {
    if (!is_array($value)) {
        return [];
    }
    $tags = [];
    foreach ($value as $tag) {
        if (is_int($tag) || is_float($tag)) {
            $tag = (string)$tag;
        }
        if (!is_string($tag) || !isValidUtf8($tag)) {
            continue;
        }
        $tag = trim($tag);
        if ($tag === '' || textLength($tag) > $maxLength || in_array($tag, $tags, true)) {
            continue;
        }
        $tags[] = $tag;
        if (count($tags) >= $maxTags) {
            break;
        }
    }
    return $tags;
}
?>
