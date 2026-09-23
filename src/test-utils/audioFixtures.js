// 音声まわりのテスト用データとモック

// jsdom の Blob から中身のバイト列を取り出す（jsdom 16 には blob.arrayBuffer() が無い）
export const readBlobBytes = (blob) => {
  const implSymbol = Object.getOwnPropertySymbols(blob).find((symbol) => String(symbol) === 'Symbol(impl)');
  const impl = implSymbol ? blob[implSymbol] : null;
  if (impl && impl._buffer) return new Uint8Array(impl._buffer);
  throw new Error('Blob の中身を読み出せませんでした');
};

const bytesToBinary = (bytes) => {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return binary;
};

// 本物と同じように Blob を読む FileReader（setupTests の固定値モックの代わり）
export class TestFileReader {
  constructor() {
    this.result = null;
    this.error = null;
    this.onload = null;
    this.onerror = null;
  }

  finish(computeResult) {
    setTimeout(() => {
      try {
        this.result = computeResult();
        if (this.onload) this.onload({ target: this });
      } catch (error) {
        this.error = error;
        if (this.onerror) this.onerror({ target: this });
      }
    }, 0);
  }

  readAsDataURL(blob) {
    this.finish(() => `data:${blob.type || 'application/octet-stream'};base64,${btoa(bytesToBinary(readBlobBytes(blob)))}`);
  }

  readAsArrayBuffer(blob) {
    this.finish(() => {
      const bytes = readBlobBytes(blob);
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    });
  }

  readAsText(blob) {
    this.finish(() => Buffer.from(readBlobBytes(blob)).toString('utf8'));
  }
}

// 各形式の先頭バイト（形式判定のテスト用）
export const HEADERS = {
  wav: [0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45, 0x66, 0x6d, 0x74, 0x20],
  mp4: [0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x4d, 0x34, 0x41, 0x20, 0x00, 0x00, 0x00, 0x00],
  webm: [0x1a, 0x45, 0xdf, 0xa3, 0x9f, 0x42, 0x86, 0x81, 0x01, 0x42, 0xf7, 0x81, 0x01, 0x42, 0xf2, 0x81],
  ogg: [0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  flac: [0x66, 0x4c, 0x61, 0x43, 0x00, 0x00, 0x00, 0x22, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  caf: [0x63, 0x61, 0x66, 0x66, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  mp3Id3: [0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  mp3Frame: [0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
  aac: [0xff, 0xf1, 0x50, 0x80, 0x02, 0x1f, 0xfc, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]
};

// 指定形式の先頭バイトに続けて、padding バイトの適当なデータを付けたバイト列
export const makeAudioBytes = (format, padding = 64) => {
  const header = HEADERS[format];
  const bytes = new Uint8Array(header.length + padding);
  bytes.set(header, 0);
  for (let i = header.length; i < bytes.length; i++) bytes[i] = i % 251;
  return bytes;
};

export const bytesToBase64 = (bytes) => btoa(bytesToBinary(bytes));

// 例: makeDataUrl('mp4', 'audio/wav') → 中身は mp4 なのに audio/wav と表記された Data URL
export const makeDataUrl = (format, declaredMime, padding = 64) =>
  `data:${declaredMime};base64,${bytesToBase64(makeAudioBytes(format, padding))}`;

// Web Audio API のモック。decodeAudioData に渡された長さから duration を決める。
export const createMockAudioContext = ({ secondsPerByte = 0.01, failDecode = () => false, state = 'running' } = {}) => {
  const started = [];
  const ctx = {
    state,
    sampleRate: 1000,
    currentTime: 0,
    destination: {},
    started,
    createBuffer: jest.fn((channels, length, sampleRate) => ({ numberOfChannels: channels, length, sampleRate, duration: length / sampleRate })),
    createBufferSource: jest.fn(() => {
      const source = {
        buffer: null,
        onended: null,
        connect: jest.fn(),
        disconnect: jest.fn(),
        start: jest.fn((when = 0, offset = 0) => {
          started.push({ source, when, offset });
        }),
        stop: jest.fn(() => {
          source.stopped = true;
        })
      };
      return source;
    }),
    decodeAudioData: jest.fn((arrayBuffer, onSuccess, onError) => {
      const byteLength = arrayBuffer.byteLength;
      if (failDecode(arrayBuffer)) {
        const error = new Error('decode failed');
        if (onError) onError(error);
        return Promise.reject(error);
      }
      const length = Math.max(1, Math.round(byteLength * secondsPerByte * 1000));
      const channelData = new Float32Array(length).fill(0.25);
      const buffer = {
        duration: byteLength * secondsPerByte,
        numberOfChannels: 1,
        sampleRate: 1000,
        length,
        getChannelData: () => channelData
      };
      if (onSuccess) onSuccess(buffer);
      return Promise.resolve(buffer);
    }),
    resume: jest.fn(() => {
      ctx.state = 'running';
      return Promise.resolve();
    }),
    close: jest.fn(() => {
      ctx.state = 'closed';
      return Promise.resolve();
    })
  };
  return ctx;
};
