// Jest設定のセットアップファイル
import '@testing-library/jest-dom';

// Web Audio API のモック
global.AudioContext = jest.fn().mockImplementation(() => ({
  createMediaStreamSource: jest.fn(),
  createAnalyser: jest.fn(() => ({
    connect: jest.fn(),
    getByteFrequencyData: jest.fn(),
    frequencyBinCount: 1024,
    fftSize: 2048
  })),
  createGain: jest.fn(() => ({
    connect: jest.fn(),
    gain: { value: 1 }
  })),
  destination: {},
  sampleRate: 44100,
  state: 'running',
  suspend: jest.fn(),
  resume: jest.fn(),
  close: jest.fn()
}));

// MediaRecorder API のモック
global.MediaRecorder = jest.fn().mockImplementation(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  pause: jest.fn(),
  resume: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  state: 'inactive',
  mimeType: 'audio/webm',
  stream: {
    getTracks: jest.fn(() => [
      { stop: jest.fn() }
    ])
  }
}));

// MediaRecorder.isTypeSupported のモック
global.MediaRecorder.isTypeSupported = jest.fn().mockReturnValue(true);

// getUserMedia API のモック
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: jest.fn(() => 
      Promise.resolve({
        getTracks: jest.fn(() => [
          { stop: jest.fn(), kind: 'audio', enabled: true }
        ]),
        getAudioTracks: jest.fn(() => [
          { stop: jest.fn(), kind: 'audio', enabled: true }
        ])
      })
    ),
    enumerateDevices: jest.fn(() => 
      Promise.resolve([
        {
          deviceId: 'default',
          kind: 'audioinput',
          label: 'Default - Microphone',
          groupId: 'default'
        }
      ])
    )
  }
});

// URL オブジェクトのモック
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// FileReader API のモック
global.FileReader = jest.fn().mockImplementation(() => ({
  readAsArrayBuffer: jest.fn(function() {
    setTimeout(() => {
      this.onload({ target: { result: new ArrayBuffer(8) } });
    }, 0);
  }),
  readAsDataURL: jest.fn(function() {
    setTimeout(() => {
      this.onload({ target: { result: 'data:audio/wav;base64,mock-data' } });
    }, 0);
  }),
  result: null,
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  onload: null,
  onerror: null
}));

// Audio要素のモック
global.Audio = jest.fn().mockImplementation(() => ({
  play: jest.fn().mockResolvedValue(undefined),
  pause: jest.fn(),
  load: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  currentTime: 0,
  duration: 10,
  paused: true,
  ended: false,
  volume: 1,
  src: ''
}));

// ローカルストレージのモック
const localStorageMock = {
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn(),
  length: 0,
  key: jest.fn()
};

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// matchMedia のモック
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: jest.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: jest.fn(),
    removeListener: jest.fn(),
    addEventListener: jest.fn(),
    removeEventListener: jest.fn(),
    dispatchEvent: jest.fn(),
  })),
});

// IntersectionObserver のモック
global.IntersectionObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// ResizeObserver のモック
global.ResizeObserver = jest.fn().mockImplementation(() => ({
  observe: jest.fn(),
  unobserve: jest.fn(),
  disconnect: jest.fn()
}));

// コンソールエラーを無視する設定（テスト中の不要なエラーメッセージを抑制）
const originalError = console.error;
beforeAll(() => {
  console.error = (...args) => {
    if (
      typeof args[0] === 'string' &&
      args[0].includes('Warning: ReactDOM.render is deprecated')
    ) {
      return;
    }
    originalError.call(console, ...args);
  };
});

afterAll(() => {
  console.error = originalError;
});

// テスト後のクリーンアップ
afterEach(() => {
  jest.clearAllMocks();
  localStorageMock.clear();
});
