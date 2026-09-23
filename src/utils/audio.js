// 音声データ処理の共通ユーティリティ
// iPad (Safari / WebKit) の古いバージョンでも動くことを最優先にしている。

// ========== 形式判定 ==========

const readAscii = (bytes, start, length) => {
  let text = '';
  for (let i = start; i < start + length && i < bytes.length; i++) {
    text += String.fromCharCode(bytes[i]);
  }
  return text;
};

// 先頭バイト列から実際の音声形式を判定する。
// iPad の録音は mp4 なのに「audio/wav」と表記されていると Safari は再生を拒否する
// (NotSupportedError) ため、表記ではなく中身で判断する。
export const detectAudioMimeType = (bytes) => {
  if (!bytes || bytes.length < 4) return null;

  if (readAscii(bytes, 0, 4) === 'RIFF' && readAscii(bytes, 8, 4) === 'WAVE') return 'audio/wav';
  if (readAscii(bytes, 4, 4) === 'ftyp') return 'audio/mp4';
  if (bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return 'audio/webm';
  if (readAscii(bytes, 0, 4) === 'OggS') return 'audio/ogg';
  if (readAscii(bytes, 0, 4) === 'fLaC') return 'audio/flac';
  if (readAscii(bytes, 0, 4) === 'caff') return 'audio/x-caf';
  if (readAscii(bytes, 0, 3) === 'ID3') return 'audio/mpeg';
  // ADTS (AAC) は layer ビットが 00、MPEG オーディオはそれ以外
  if (bytes[0] === 0xff && (bytes[1] & 0xf6) === 0xf0) return 'audio/aac';
  if (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0) return 'audio/mpeg';
  return null;
};

const MIME_EXTENSIONS = {
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/wav': 'wav',
  'audio/wave': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/flac': 'flac',
  'audio/x-caf': 'caf'
};

// "audio/webm;codecs=opus" → "audio/webm"
export const getBaseMimeType = (mimeType) =>
  (mimeType || '').split(';')[0].trim().toLowerCase();

export const getExtensionForMimeType = (mimeType) =>
  MIME_EXTENSIONS[getBaseMimeType(mimeType)] || 'bin';

// ファイル名の拡張子から音声ファイルかどうかを判定（iPad では file.type が空のことがある）
const AUDIO_FILE_EXTENSIONS = ['m4a', 'mp4', 'aac', 'mp3', 'wav', 'wave', 'webm', 'ogg', 'oga', 'flac', 'caf', 'aif', 'aiff'];

export const isAudioFile = (file) => {
  if (!file) return false;
  if (file.type && file.type.startsWith('audio/')) return true;
  const match = /\.([a-z0-9]+)$/i.exec(file.name || '');
  return !!match && AUDIO_FILE_EXTENSIONS.includes(match[1].toLowerCase());
};

// ========== Base64 / Data URL ==========

export const base64ToBytes = (base64) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
};

export const parseDataUrl = (dataUrl) => {
  if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
  const commaIndex = dataUrl.indexOf(',');
  if (commaIndex < 0) return null;
  const header = dataUrl.slice(5, commaIndex);
  return {
    mimeType: getBaseMimeType(header),
    isBase64: /;base64$/i.test(header),
    data: dataUrl.slice(commaIndex + 1)
  };
};

// 先頭 24 文字 (18 バイト) だけデコードして形式を判定する
const sniffBase64 = (base64) => {
  try {
    return detectAudioMimeType(base64ToBytes(base64.slice(0, 24)));
  } catch (error) {
    return null;
  }
};

// Data URL の MIME 表記を中身に合わせて直す。
// 既に保存済みの「中身は mp4 なのに audio/wav と書かれたデータ」もこれで再生できるようになる。
export const normalizeAudioDataUrl = (dataUrl) => {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !parsed.isBase64 || !parsed.data) return dataUrl;
  const detected = sniffBase64(parsed.data);
  if (!detected || detected === parsed.mimeType) return dataUrl;
  return `data:${detected};base64,${parsed.data}`;
};

export const getAudioDataUrlMimeType = (dataUrl) => {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return '';
  return (parsed.isBase64 && sniffBase64(parsed.data)) || parsed.mimeType;
};

export const dataUrlToBlob = (dataUrl) => {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !parsed.isBase64) {
    throw new Error('音声データの形式が正しくありません');
  }
  const bytes = base64ToBytes(parsed.data);
  if (bytes.length === 0) {
    throw new Error('音声データが空です');
  }
  const mimeType = detectAudioMimeType(bytes) || parsed.mimeType || 'application/octet-stream';
  return new Blob([bytes], { type: mimeType });
};

const readBlob = (blob, method) => new Promise((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = (event) => resolve(event && event.target ? event.target.result : reader.result);
  reader.onerror = () => reject(reader.error || new Error('ファイルの読み込みに失敗しました'));
  reader[method](blob);
});

// Blob を Data URL に変換し、MIME 表記を中身に合わせる
export const blobToAudioDataUrl = async (blob) =>
  normalizeAudioDataUrl(await readBlob(blob, 'readAsDataURL'));

// Blob.arrayBuffer() は Safari 14 未満に無いので FileReader で代替する
export const blobToArrayBuffer = (blob) => {
  if (blob && typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }
  return readBlob(blob, 'readAsArrayBuffer');
};

// 形式が不明・誤っている Blob を、中身に合った type の Blob に作り直す
export const withDetectedMimeType = async (blob) => {
  const header = new Uint8Array(await blobToArrayBuffer(blob.slice(0, 32)));
  const detected = detectAudioMimeType(header);
  if (!detected || detected === getBaseMimeType(blob.type)) return blob;
  return new Blob([blob], { type: detected });
};

// ========== 録音 ==========

// mp4 (AAC) を最優先: すべての iPad で再生でき、PC とクラウド共有しても互換性が高い。
// Chrome は「audio/mp4」だけだと中身が Opus になり古い iPad で再生できないので、AAC を明示する。
const RECORDING_MIME_CANDIDATES = [
  'audio/mp4;codecs=mp4a.40.2',
  'audio/mp4',
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus'
];

export const getSupportedRecordingMimeType = () => {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  for (const candidate of RECORDING_MIME_CANDIDATES) {
    try {
      if (MediaRecorder.isTypeSupported(candidate)) return candidate;
    } catch (error) {
      // 古い実装は例外を投げることがある
    }
  }
  return '';
};

// ========== Web Audio ==========

export const getAudioContextClass = () => {
  if (typeof window === 'undefined') return null;
  return window.AudioContext || window.webkitAudioContext || null;
};

export const createAudioContext = () => {
  const AudioContextClass = getAudioContextClass();
  if (!AudioContextClass) return null;
  try {
    return new AudioContextClass();
  } catch (error) {
    console.error('AudioContext を作成できませんでした:', error);
    return null;
  }
};

export const closeAudioContext = (ctx) => {
  if (!ctx || ctx.state === 'closed' || typeof ctx.close !== 'function') return;
  try {
    const result = ctx.close();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (error) {
    // 既に閉じている
  }
};

// Safari 14.0 以前は Promise 版の decodeAudioData が無いのでコールバック版も渡す
export const decodeAudioData = (ctx, arrayBuffer) => new Promise((resolve, reject) => {
  let settled = false;
  const onSuccess = (buffer) => {
    if (settled) return;
    settled = true;
    resolve(buffer);
  };
  const onError = (error) => {
    if (settled) return;
    settled = true;
    reject(error || new Error('音声データをデコードできませんでした'));
  };
  try {
    const result = ctx.decodeAudioData(arrayBuffer, onSuccess, onError);
    if (result && typeof result.then === 'function') {
      result.then(onSuccess, onError);
    }
  } catch (error) {
    onError(error);
  }
});

// iOS はユーザー操作の中で resume() しないと音が出ない。
// await より前（タップのイベントハンドラ内で同期的に）呼ぶこと。
export const unlockAudioContext = (ctx) => {
  if (!ctx || ctx.state === 'closed') return Promise.resolve();
  try {
    // 古い iOS はバッファを 1 回鳴らさないとロックが解除されない
    const buffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start(0);
  } catch (error) {
    // 無音バッファの再生に失敗しても resume は試す
  }
  if (ctx.state !== 'running' && typeof ctx.resume === 'function') {
    try {
      const result = ctx.resume();
      if (result && typeof result.then === 'function') {
        return result.catch((error) => {
          console.warn('AudioContext を再開できませんでした:', error);
        });
      }
    } catch (error) {
      console.warn('AudioContext を再開できませんでした:', error);
    }
  }
  return Promise.resolve();
};

// ========== iOS の消音スイッチ対策 ==========

export const isIOSDevice = () => {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  // iPadOS 13 以降は Mac と同じ UA を名乗るのでタッチ対応で判別する
  return /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

let silentWavDataUrl = null;

const getSilentWavDataUrl = () => {
  if (silentWavDataUrl) return silentWavDataUrl;
  const sampleRate = 8000;
  const samples = 800; // 0.1 秒
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples * 2, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples * 2, true);
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  silentWavDataUrl = `data:audio/wav;base64,${btoa(binary)}`;
  return silentWavDataUrl;
};

let silentAudioElement = null;

// iPad の消音（マナー）モードでは Web Audio の音が消される。
// iOS 17 以降は audioSession API、それ以前は無音の <audio> をループ再生して
// 「メディア再生中」扱いにすることで音が出るようにする。
// ユーザー操作の中で同期的に呼ぶこと。
export const enableSilentModePlayback = () => {
  try {
    if (typeof navigator !== 'undefined' && navigator.audioSession && 'type' in navigator.audioSession) {
      navigator.audioSession.type = 'playback';
      return;
    }
  } catch (error) {
    // 非対応
  }
  if (!isIOSDevice() || typeof document === 'undefined') return;
  try {
    if (!silentAudioElement) {
      silentAudioElement = document.createElement('audio');
      silentAudioElement.setAttribute('x-webkit-airplay', 'deny');
      silentAudioElement.setAttribute('playsinline', '');
      silentAudioElement.preload = 'auto';
      silentAudioElement.loop = true;
      silentAudioElement.src = getSilentWavDataUrl();
    }
    const result = silentAudioElement.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (error) {
    // 失敗しても通常モードでは音が出る
  }
};

export const disableSilentModePlayback = () => {
  if (!silentAudioElement) return;
  try {
    silentAudioElement.pause();
  } catch (error) {
    // 無視
  }
};

// iOS は 1 つの <audio> 要素につき「最初の play() がユーザー操作内」でないと
// 以降の play() も拒否する。タップ直後に同期的に呼んで要素を使える状態にしておく。
export const primeAudioElement = (audio) => {
  if (!audio) return;
  try {
    audio.src = getSilentWavDataUrl();
    const result = audio.play();
    if (result && typeof result.catch === 'function') {
      result.catch(() => {});
    }
  } catch (error) {
    // 無視
  }
};

// ========== WAV 書き出し ==========

// channels: Float32Array の配列
export const encodeWav = (channels, sampleRate) => {
  const numberOfChannels = channels.length;
  const length = numberOfChannels > 0 ? channels[0].length : 0;
  const bytesPerSample = 2;
  const blockAlign = numberOfChannels * bytesPerSample;
  const dataSize = length * blockAlign;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeString = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numberOfChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < length; i++) {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const sample = Math.max(-1, Math.min(1, channels[channel][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: 'audio/wav' });
};

// iOS Safari は click 直後に Object URL を解放するとダウンロードが失敗するので少し待つ
export const downloadBlob = (blob, fileName) => {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};
