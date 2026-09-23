import {
  base64ToBytes,
  blobToArrayBuffer,
  blobToAudioDataUrl,
  closeAudioContext,
  createAudioContext,
  dataUrlToBlob,
  decodeAudioData,
  detectAudioMimeType,
  disableSilentModePlayback,
  enableSilentModePlayback,
  encodeWav,
  getAudioDataUrlMimeType,
  getBaseMimeType,
  getExtensionForMimeType,
  getSupportedRecordingMimeType,
  isAudioFile,
  isIOSDevice,
  normalizeAudioDataUrl,
  parseDataUrl,
  primeAudioElement,
  unlockAudioContext,
  withDetectedMimeType
} from '../../utils/audio';
import {
  TestFileReader,
  bytesToBase64,
  createMockAudioContext,
  makeAudioBytes,
  makeDataUrl,
  readBlobBytes
} from '../../test-utils/audioFixtures';

const originalFileReader = global.FileReader;
const originalUserAgent = navigator.userAgent;

const setUserAgent = (userAgent, { platform = 'MacIntel', maxTouchPoints = 0 } = {}) => {
  Object.defineProperty(navigator, 'userAgent', { value: userAgent, configurable: true });
  Object.defineProperty(navigator, 'platform', { value: platform, configurable: true });
  Object.defineProperty(navigator, 'maxTouchPoints', { value: maxTouchPoints, configurable: true });
};

beforeEach(() => {
  global.FileReader = TestFileReader;
});

afterEach(() => {
  global.FileReader = originalFileReader;
  setUserAgent(originalUserAgent);
});

describe('detectAudioMimeType（中身から形式を判定）', () => {
  test.each([
    ['wav', 'audio/wav'],
    ['mp4', 'audio/mp4'],
    ['webm', 'audio/webm'],
    ['ogg', 'audio/ogg'],
    ['flac', 'audio/flac'],
    ['caf', 'audio/x-caf'],
    ['mp3Id3', 'audio/mpeg'],
    ['mp3Frame', 'audio/mpeg'],
    ['aac', 'audio/aac']
  ])('%s のデータを %s と判定する', (format, expected) => {
    expect(detectAudioMimeType(makeAudioBytes(format))).toBe(expected);
  });

  test('判定できないデータは null', () => {
    expect(detectAudioMimeType(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull();
    expect(detectAudioMimeType(new TextEncoderLike('<?php echo 1;').bytes)).toBeNull();
  });

  test('短すぎる・空のデータは null', () => {
    expect(detectAudioMimeType(new Uint8Array([0x52, 0x49]))).toBeNull();
    expect(detectAudioMimeType(null)).toBeNull();
    expect(detectAudioMimeType(undefined)).toBeNull();
  });

  test('RIFF でも WAVE でなければ wav と判定しない', () => {
    const bytes = makeAudioBytes('wav');
    bytes.set([0x41, 0x56, 0x49, 0x20], 8); // "AVI "
    expect(detectAudioMimeType(bytes)).toBeNull();
  });
});

// TextEncoder が jsdom に無いので簡易版
function TextEncoderLike(text) {
  this.bytes = new Uint8Array(text.split('').map((char) => char.charCodeAt(0)));
}

describe('MIME 表記の扱い', () => {
  test('getBaseMimeType はパラメータを除いて小文字にする', () => {
    expect(getBaseMimeType('audio/webm;codecs=opus')).toBe('audio/webm');
    expect(getBaseMimeType(' Audio/MP4 ')).toBe('audio/mp4');
    expect(getBaseMimeType(undefined)).toBe('');
  });

  test.each([
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/webm;codecs=opus', 'webm'],
    ['audio/mpeg', 'mp3'],
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav'],
    ['audio/ogg', 'ogg'],
    ['audio/aac', 'aac'],
    ['application/octet-stream', 'bin'],
    ['', 'bin']
  ])('%s の拡張子は %s', (mime, extension) => {
    expect(getExtensionForMimeType(mime)).toBe(extension);
  });

  test('isAudioFile は type または拡張子で判定する（iPad は type が空のことがある）', () => {
    expect(isAudioFile({ type: 'audio/x-m4a', name: 'a.m4a' })).toBe(true);
    expect(isAudioFile({ type: '', name: '録音.M4A' })).toBe(true);
    expect(isAudioFile({ type: '', name: 'voice.wav' })).toBe(true);
    expect(isAudioFile({ type: 'image/png', name: 'photo.png' })).toBe(false);
    expect(isAudioFile({ type: '', name: 'notes.txt' })).toBe(false);
    expect(isAudioFile({ type: '', name: 'noextension' })).toBe(false);
    expect(isAudioFile(null)).toBe(false);
  });
});

describe('Data URL', () => {
  test('parseDataUrl は MIME と base64 かどうかを返す', () => {
    expect(parseDataUrl('data:audio/webm;codecs=opus;base64,AAAA')).toEqual({
      mimeType: 'audio/webm',
      isBase64: true,
      data: 'AAAA'
    });
    expect(parseDataUrl('data:,hello')).toEqual({ mimeType: '', isBase64: false, data: 'hello' });
    expect(parseDataUrl('blob:abc')).toBeNull();
    expect(parseDataUrl('data:audio/wav;base64')).toBeNull();
    expect(parseDataUrl(null)).toBeNull();
  });

  test('base64ToBytes は元のバイト列に戻す', () => {
    const bytes = makeAudioBytes('mp4', 300);
    expect(Array.from(base64ToBytes(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  test('中身が mp4 なのに audio/wav と書かれた Data URL を audio/mp4 に直す（iPad の再生不具合の原因）', () => {
    const wrong = makeDataUrl('mp4', 'audio/wav');
    const fixed = normalizeAudioDataUrl(wrong);
    expect(fixed.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(fixed.split(',')[1]).toBe(wrong.split(',')[1]);
  });

  test('正しい表記の Data URL はそのまま（codecs 指定も残す）', () => {
    const correct = makeDataUrl('webm', 'audio/webm;codecs=opus');
    expect(normalizeAudioDataUrl(correct)).toBe(correct);
    const wav = makeDataUrl('wav', 'audio/wav');
    expect(normalizeAudioDataUrl(wav)).toBe(wav);
  });

  test('判定できない・不正な Data URL は変更しない', () => {
    expect(normalizeAudioDataUrl('data:audio/wav;base64,')).toBe('data:audio/wav;base64,');
    expect(normalizeAudioDataUrl('not a data url')).toBe('not a data url');
    expect(normalizeAudioDataUrl(undefined)).toBeUndefined();
    const unknown = `data:audio/wav;base64,${bytesToBase64(new Uint8Array(32))}`;
    expect(normalizeAudioDataUrl(unknown)).toBe(unknown);
  });

  test('getAudioDataUrlMimeType は中身の形式を優先する', () => {
    expect(getAudioDataUrlMimeType(makeDataUrl('mp4', 'audio/wav'))).toBe('audio/mp4');
    expect(getAudioDataUrlMimeType(`data:audio/ogg;base64,${bytesToBase64(new Uint8Array(32))}`)).toBe('audio/ogg');
    expect(getAudioDataUrlMimeType('nope')).toBe('');
  });

  test('dataUrlToBlob は中身に合った type の Blob を作る', () => {
    const blob = dataUrlToBlob(makeDataUrl('mp4', 'audio/wav', 100));
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('audio/mp4');
    expect(blob.size).toBe(116);
    expect(Array.from(readBlobBytes(blob).slice(4, 8))).toEqual([0x66, 0x74, 0x79, 0x70]);
  });

  test('dataUrlToBlob は形式が分からなければ表記の type を使う', () => {
    const blob = dataUrlToBlob(`data:audio/x-custom;base64,${bytesToBase64(new Uint8Array(10))}`);
    expect(blob.type).toBe('audio/x-custom');
  });

  test('dataUrlToBlob は空・不正なデータで例外を投げる', () => {
    expect(() => dataUrlToBlob('data:audio/wav;base64,')).toThrow('音声データが空です');
    expect(() => dataUrlToBlob('data:,plain')).toThrow();
    expect(() => dataUrlToBlob('blob:xyz')).toThrow();
  });
});

describe('Blob の読み込み（古い Safari 対応）', () => {
  test('blobToAudioDataUrl は表記を中身に合わせた Data URL を返す', async () => {
    const blob = new Blob([makeAudioBytes('mp4')], { type: 'audio/wav' });
    const dataUrl = await blobToAudioDataUrl(blob);
    expect(dataUrl.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(Array.from(base64ToBytes(dataUrl.split(',')[1]))).toEqual(Array.from(makeAudioBytes('mp4')));
  });

  test('blobToArrayBuffer は blob.arrayBuffer が無ければ FileReader を使う', async () => {
    const bytes = makeAudioBytes('ogg', 10);
    const blob = new Blob([bytes]);
    expect(typeof blob.arrayBuffer).toBe('undefined');
    const buffer = await blobToArrayBuffer(blob);
    expect(Array.from(new Uint8Array(buffer))).toEqual(Array.from(bytes));
  });

  test('blobToArrayBuffer は blob.arrayBuffer があればそれを使う', async () => {
    const expected = new ArrayBuffer(4);
    const fakeBlob = { arrayBuffer: jest.fn(() => Promise.resolve(expected)) };
    await expect(blobToArrayBuffer(fakeBlob)).resolves.toBe(expected);
    expect(fakeBlob.arrayBuffer).toHaveBeenCalled();
  });

  test('FileReader のエラーは reject される', async () => {
    class FailingReader extends TestFileReader {
      readAsDataURL() {
        setTimeout(() => {
          this.error = new Error('read failed');
          this.onerror({ target: this });
        }, 0);
      }
    }
    global.FileReader = FailingReader;
    await expect(blobToAudioDataUrl(new Blob([new Uint8Array(4)]))).rejects.toThrow('read failed');
  });

  test('withDetectedMimeType は type が誤った Blob を作り直す', async () => {
    const blob = new Blob([makeAudioBytes('mp4')], { type: 'audio/wav' });
    const fixed = await withDetectedMimeType(blob);
    expect(fixed.type).toBe('audio/mp4');
    expect(fixed.size).toBe(blob.size);
  });

  test('withDetectedMimeType は正しい Blob をそのまま返す', async () => {
    const blob = new Blob([makeAudioBytes('webm')], { type: 'audio/webm;codecs=opus' });
    await expect(withDetectedMimeType(blob)).resolves.toBe(blob);
    const unknown = new Blob([new Uint8Array(40)], { type: 'audio/x-foo' });
    await expect(withDetectedMimeType(unknown)).resolves.toBe(unknown);
  });
});

describe('録音形式の選択', () => {
  const originalMediaRecorder = global.MediaRecorder;
  afterEach(() => {
    global.MediaRecorder = originalMediaRecorder;
  });

  test('AAC の mp4 に対応していれば最優先で選ぶ（すべての iPad で再生できる）', () => {
    global.MediaRecorder = { isTypeSupported: jest.fn(() => true) };
    expect(getSupportedRecordingMimeType()).toBe('audio/mp4;codecs=mp4a.40.2');
  });

  test('コーデック指定に非対応なら audio/mp4 を選ぶ', () => {
    global.MediaRecorder = { isTypeSupported: jest.fn((type) => type === 'audio/mp4' || type.startsWith('audio/webm')) };
    expect(getSupportedRecordingMimeType()).toBe('audio/mp4');
  });

  test('mp4 に非対応なら webm/opus を選ぶ', () => {
    global.MediaRecorder = { isTypeSupported: jest.fn((type) => type.startsWith('audio/webm')) };
    expect(getSupportedRecordingMimeType()).toBe('audio/webm;codecs=opus');
  });

  test('どれにも対応していない・例外を投げる場合は空文字（ブラウザの既定に任せる）', () => {
    global.MediaRecorder = { isTypeSupported: jest.fn(() => { throw new Error('boom'); }) };
    expect(getSupportedRecordingMimeType()).toBe('');
    global.MediaRecorder = { isTypeSupported: jest.fn(() => false) };
    expect(getSupportedRecordingMimeType()).toBe('');
  });

  test('MediaRecorder が無いブラウザでは空文字', () => {
    global.MediaRecorder = undefined;
    expect(getSupportedRecordingMimeType()).toBe('');
  });
});

describe('Web Audio', () => {
  const originalAudioContext = window.AudioContext;
  afterEach(() => {
    window.AudioContext = originalAudioContext;
    delete window.webkitAudioContext;
  });

  test('createAudioContext は webkitAudioContext（古い iPad）にも対応する', () => {
    window.AudioContext = undefined;
    const WebkitContext = jest.fn(function WebkitContext() { this.kind = 'webkit'; });
    window.webkitAudioContext = WebkitContext;
    expect(createAudioContext().kind).toBe('webkit');
  });

  test('createAudioContext は作成に失敗したら null を返す', () => {
    window.AudioContext = jest.fn(() => { throw new Error('too many contexts'); });
    expect(createAudioContext()).toBeNull();
    window.AudioContext = undefined;
    expect(createAudioContext()).toBeNull();
  });

  test('decodeAudioData はコールバック版だけの実装（Safari 14.0 以前）でも動く', async () => {
    const buffer = { duration: 1 };
    const ctx = { decodeAudioData: jest.fn((data, onSuccess) => { setTimeout(() => onSuccess(buffer), 0); return undefined; }) };
    await expect(decodeAudioData(ctx, new ArrayBuffer(4))).resolves.toBe(buffer);
  });

  test('decodeAudioData は Promise 版とコールバックが両方呼ばれても 1 回だけ解決する', async () => {
    const ctx = createMockAudioContext();
    const result = await decodeAudioData(ctx, new ArrayBuffer(100));
    expect(result.duration).toBeCloseTo(1);
  });

  test('decodeAudioData の失敗は reject される', async () => {
    const ctx = createMockAudioContext({ failDecode: () => true });
    await expect(decodeAudioData(ctx, new ArrayBuffer(4))).rejects.toThrow('decode failed');
    const throwing = { decodeAudioData: () => { throw new TypeError('Not enough arguments'); } };
    await expect(decodeAudioData(throwing, new ArrayBuffer(4))).rejects.toThrow('Not enough arguments');
  });

  test('unlockAudioContext は無音を鳴らして resume する', async () => {
    const ctx = createMockAudioContext({ state: 'suspended' });
    await unlockAudioContext(ctx);
    expect(ctx.createBufferSource).toHaveBeenCalled();
    expect(ctx.started.length).toBe(1);
    expect(ctx.resume).toHaveBeenCalled();
    expect(ctx.state).toBe('running');
  });

  test('unlockAudioContext は実行中・閉じた・null のコンテキストでも例外を出さない', async () => {
    const running = createMockAudioContext();
    await unlockAudioContext(running);
    expect(running.resume).not.toHaveBeenCalled();
    const closed = createMockAudioContext({ state: 'closed' });
    await unlockAudioContext(closed);
    expect(closed.createBufferSource).not.toHaveBeenCalled();
    await expect(unlockAudioContext(null)).resolves.toBeUndefined();
    // resume が Promise を返さない古い実装
    await expect(unlockAudioContext({ state: 'suspended', resume: () => undefined })).resolves.toBeUndefined();
    // resume が拒否しても reject しない
    const rejecting = { state: 'suspended', resume: () => Promise.reject(new Error('not allowed')) };
    await expect(unlockAudioContext(rejecting)).resolves.toBeUndefined();
  });

  test('closeAudioContext は close が無い・失敗する場合も安全', () => {
    expect(() => closeAudioContext(null)).not.toThrow();
    expect(() => closeAudioContext({ state: 'running' })).not.toThrow();
    expect(() => closeAudioContext({ state: 'running', close: () => { throw new Error('x'); } })).not.toThrow();
    const ctx = createMockAudioContext();
    closeAudioContext(ctx);
    expect(ctx.close).toHaveBeenCalled();
    closeAudioContext(ctx);
    expect(ctx.close).toHaveBeenCalledTimes(1); // 閉じたものは閉じない
  });
});

describe('iOS 判定と消音モード対策', () => {
  test('iPad / iPhone / iPadOS 13 以降（Mac の UA）を iOS と判定する', () => {
    setUserAgent('Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X)', { platform: 'iPad' });
    expect(isIOSDevice()).toBe(true);
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', { platform: 'MacIntel', maxTouchPoints: 5 });
    expect(isIOSDevice()).toBe(true);
    setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', { platform: 'MacIntel', maxTouchPoints: 0 });
    expect(isIOSDevice()).toBe(false);
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', { platform: 'Win32' });
    expect(isIOSDevice()).toBe(false);
  });

  test('audioSession API があれば playback にし、止めたら auto に戻す（iOS 17 以降）', () => {
    const audioSession = { type: 'auto' };
    Object.defineProperty(navigator, 'audioSession', { value: audioSession, configurable: true });
    enableSilentModePlayback();
    expect(audioSession.type).toBe('playback');
    disableSilentModePlayback();
    expect(audioSession.type).toBe('auto');
    delete navigator.audioSession;
  });

  test('audioSession が無い iOS では無音の <audio> をループ再生し、停止できる', () => {
    setUserAgent('Mozilla/5.0 (iPad; CPU OS 15_0 like Mac OS X)', { platform: 'iPad' });
    const play = jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    const pause = jest.spyOn(window.HTMLMediaElement.prototype, 'pause').mockImplementation(() => {});
    enableSilentModePlayback();
    expect(play).toHaveBeenCalled();
    disableSilentModePlayback();
    expect(pause).toHaveBeenCalled();
    play.mockRestore();
    pause.mockRestore();
  });

  test('iOS 以外では何もしない', () => {
    setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120', { platform: 'Win32' });
    const play = jest.spyOn(window.HTMLMediaElement.prototype, 'play').mockImplementation(() => Promise.resolve());
    enableSilentModePlayback();
    expect(play).not.toHaveBeenCalled();
    play.mockRestore();
  });

  test('primeAudioElement は無音 WAV をセットして再生を試みる（失敗しても例外なし）', () => {
    const audio = { src: '', play: jest.fn(() => Promise.reject(new Error('NotAllowedError'))) };
    expect(() => primeAudioElement(audio)).not.toThrow();
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(detectAudioMimeType(base64ToBytes(audio.src.split(',')[1]))).toBe('audio/wav');
    expect(() => primeAudioElement(null)).not.toThrow();
  });
});

describe('encodeWav（音源出力）', () => {
  test('正しいヘッダーと長さの WAV を作る', () => {
    const left = new Float32Array([0, 0.5, -0.5, 1]);
    const right = new Float32Array([0, -1, 2, -2]); // 範囲外はクリップされる
    const blob = encodeWav([left, right], 44100);
    const bytes = readBlobBytes(blob);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(blob.type).toBe('audio/wav');
    expect(bytes.length).toBe(44 + 4 * 2 * 2);
    expect(detectAudioMimeType(bytes)).toBe('audio/wav');
    expect(view.getUint16(22, true)).toBe(2); // チャンネル数
    expect(view.getUint32(24, true)).toBe(44100);
    expect(view.getUint32(40, true)).toBe(16); // データサイズ
    expect(view.getInt16(44 + 4 * 1, true)).toBe(16383); // 0.5 * 0x7fff（小数は切り捨て）
    expect(view.getInt16(44 + 4 * 2, true)).toBe(-16384); // -0.5 * 0x8000
    expect(view.getInt16(44 + 4 * 2 + 2, true)).toBe(0x7fff); // 2 → 1.0 にクリップ
    expect(view.getInt16(44 + 4 * 3 + 2, true)).toBe(-0x8000); // -2 → -1.0 にクリップ
  });

  test('長さ 0 でもヘッダーだけの WAV を作る', () => {
    const blob = encodeWav([new Float32Array(0)], 8000);
    expect(blob.size).toBe(44);
  });
});
