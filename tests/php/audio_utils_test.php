<?php
// api/audio_utils.php の形式判定と Range の解釈のテスト
// 実行: php tests/php/audio_utils_test.php
require_once __DIR__ . '/../../api/audio_utils.php';
$fails = 0;
function check($label, $actual, $expected) { global $fails; $ok = $actual === $expected; if (!$ok) $fails++; echo ($ok ? "ok   " : "FAIL ") . $label . " => " . var_export($actual, true) . "\n"; }
check('wav', detectAudioMimeTypeFromBytes("RIFF\x00\x00\x00\x00WAVEfmt "), 'audio/wav');
check('mp4', detectAudioMimeTypeFromBytes("\x00\x00\x00\x18ftypM4A "), 'audio/mp4');
check('webm', detectAudioMimeTypeFromBytes("\x1A\x45\xDF\xA3\x01"), 'audio/webm');
check('ogg', detectAudioMimeTypeFromBytes("OggS\x00"), 'audio/ogg');
check('mp3 id3', detectAudioMimeTypeFromBytes("ID3\x04\x00"), 'audio/mpeg');
check('mp3 frame', detectAudioMimeTypeFromBytes("\xFF\xFB\x90\x00"), 'audio/mpeg');
check('aac adts', detectAudioMimeTypeFromBytes("\xFF\xF1\x50\x80"), 'audio/aac');
check('php', detectAudioMimeTypeFromBytes("<?php echo 1;"), null);
check('short', detectAudioMimeTypeFromBytes("ab"), null);
check('normalize codecs', normalizeAudioMimeType('audio/webm;codecs=opus'), 'audio/webm');
check('normalize alias', normalizeAudioMimeType('Audio/X-M4A'), 'audio/mp4');
check('allowed wave', isAllowedAudioMimeType('audio/x-wav'), true);
check('not allowed php', isAllowedAudioMimeType('application/x-php'), false);
check('ext mp4', extensionForAudioMimeType('audio/mp4'), 'm4a');
check('ext unknown', extensionForAudioMimeType('text/html'), null);
check('range none', parseByteRange(null, 1000), null);
check('range 0-1', parseByteRange('bytes=0-1', 1000), [0, 1]);
check('range open', parseByteRange('bytes=100-', 1000), [100, 999]);
check('range suffix', parseByteRange('bytes=-100', 1000), [900, 999]);
check('range clamp', parseByteRange('bytes=900-5000', 1000), [900, 999]);
check('range beyond', parseByteRange('bytes=1000-', 1000), false);
check('range inverted is ignored', parseByteRange('bytes=10-5', 1000), null);
check('range multi', parseByteRange('bytes=0-1,5-6', 1000), null);
check('range garbage', parseByteRange('items=0-1', 1000), null);
echo $fails ? "\n{$fails} 件失敗\n" : "\nすべて成功\n";
exit($fails ? 1 : 0);
