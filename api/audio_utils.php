<?php
// 音声ファイルの形式判定と配信の共通処理

// 受け付ける音声形式と、保存時の拡張子
const AUDIO_MIME_EXTENSIONS = [
    'audio/mp4' => 'm4a',
    'audio/aac' => 'aac',
    'audio/mpeg' => 'mp3',
    'audio/wav' => 'wav',
    'audio/webm' => 'webm',
    'audio/ogg' => 'ogg',
    'audio/flac' => 'flac',
    'audio/x-caf' => 'caf',
];

// 同じ形式の別名をまとめる
const AUDIO_MIME_ALIASES = [
    'audio/mp3' => 'audio/mpeg',
    'audio/x-mp3' => 'audio/mpeg',
    'audio/mpeg3' => 'audio/mpeg',
    'audio/wave' => 'audio/wav',
    'audio/x-wav' => 'audio/wav',
    'audio/vnd.wave' => 'audio/wav',
    'audio/x-m4a' => 'audio/mp4',
    'audio/m4a' => 'audio/mp4',
    'video/mp4' => 'audio/mp4',
    'audio/x-aac' => 'audio/aac',
    'audio/x-flac' => 'audio/flac',
    'video/webm' => 'audio/webm',
];

// "audio/webm;codecs=opus" → "audio/webm"、別名は正規の名前に直す
function normalizeAudioMimeType($mimeType) {
    $base = strtolower(trim(explode(';', (string)$mimeType)[0]));
    return AUDIO_MIME_ALIASES[$base] ?? $base;
}

function isAllowedAudioMimeType($mimeType) {
    return array_key_exists(normalizeAudioMimeType($mimeType), AUDIO_MIME_EXTENSIONS);
}

function extensionForAudioMimeType($mimeType) {
    return AUDIO_MIME_EXTENSIONS[normalizeAudioMimeType($mimeType)] ?? null;
}

// ファイルの先頭バイトから実際の音声形式を判定する（判定できなければ null）。
// iPad の録音（mp4）が「audio/wav」と申告されていても正しく扱えるようにする。
function detectAudioMimeTypeFromBytes($bytes) {
    if (strlen($bytes) < 4) {
        return null;
    }
    if (substr($bytes, 0, 4) === 'RIFF' && substr($bytes, 8, 4) === 'WAVE') return 'audio/wav';
    if (substr($bytes, 4, 4) === 'ftyp') return 'audio/mp4';
    if (substr($bytes, 0, 4) === "\x1A\x45\xDF\xA3") return 'audio/webm';
    if (substr($bytes, 0, 4) === 'OggS') return 'audio/ogg';
    if (substr($bytes, 0, 4) === 'fLaC') return 'audio/flac';
    if (substr($bytes, 0, 4) === 'caff') return 'audio/x-caf';
    if (substr($bytes, 0, 3) === 'ID3') return 'audio/mpeg';
    $b0 = ord($bytes[0]);
    $b1 = ord($bytes[1]);
    if ($b0 === 0xFF && ($b1 & 0xF6) === 0xF0) return 'audio/aac';
    if ($b0 === 0xFF && ($b1 & 0xE0) === 0xE0) return 'audio/mpeg';
    return null;
}

function detectAudioMimeTypeFromFile($path) {
    $handle = @fopen($path, 'rb');
    if (!$handle) {
        return null;
    }
    $bytes = fread($handle, 32);
    fclose($handle);
    return $bytes === false ? null : detectAudioMimeTypeFromBytes($bytes);
}

// "bytes=START-END" を解釈する。範囲外なら false、Range 指定が無ければ null を返す。
function parseByteRange($rangeHeader, $fileSize) {
    if ($rangeHeader === null || $rangeHeader === '') {
        return null;
    }
    if (!preg_match('/^bytes=(\d*)-(\d*)$/', trim($rangeHeader), $matches)) {
        return null; // 複数範囲などには対応せず、全体を返す
    }
    if ($matches[1] === '' && $matches[2] === '') {
        return null;
    }
    if ($matches[1] === '') {
        // 末尾から N バイト
        $length = (int)$matches[2];
        if ($length <= 0) {
            return false;
        }
        $start = max(0, $fileSize - $length);
        $end = $fileSize - 1;
    } else {
        $start = (int)$matches[1];
        $end = $matches[2] === '' ? $fileSize - 1 : min((int)$matches[2], $fileSize - 1);
    }
    if ($start >= $fileSize || $start > $end) {
        return false;
    }
    return [$start, $end];
}

// Safari の <audio> は Range リクエスト（部分取得）に対応していないサーバーの音声を再生しないため、
// 206 Partial Content で応答できるようにする。
function sendAudioFile($path, $mimeType, $downloadName) {
    $fileSize = filesize($path);
    $range = parseByteRange($_SERVER['HTTP_RANGE'] ?? null, $fileSize);

    $asciiName = preg_replace('/[^A-Za-z0-9._-]/', '_', $downloadName);
    header('Content-Type: ' . $mimeType);
    header('Accept-Ranges: bytes');
    header("Content-Disposition: attachment; filename=\"{$asciiName}\"; filename*=UTF-8''" . rawurlencode($downloadName));
    header('Cache-Control: private, max-age=0, must-revalidate');

    if ($range === false) {
        http_response_code(416);
        header("Content-Range: bytes */{$fileSize}");
        return;
    }

    [$start, $end] = $range ?? [0, $fileSize - 1];
    $length = $fileSize > 0 ? $end - $start + 1 : 0;

    if ($range !== null) {
        http_response_code(206);
        header("Content-Range: bytes {$start}-{$end}/{$fileSize}");
    }
    header('Content-Length: ' . $length);

    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'HEAD' || $length === 0) {
        return;
    }

    $handle = fopen($path, 'rb');
    if (!$handle) {
        return;
    }
    fseek($handle, $start);
    $remaining = $length;
    while ($remaining > 0 && !feof($handle)) {
        $chunk = fread($handle, min(8192, $remaining));
        if ($chunk === false) {
            break;
        }
        echo $chunk;
        $remaining -= strlen($chunk);
        flush();
    }
    fclose($handle);
}
?>
