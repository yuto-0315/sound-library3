import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import SoundCollection from '../pages/SoundCollection';
import { getAllRecordings } from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, makeAudioBytes } from '../test-utils/audioFixtures';

let idb;
let recorders;
let tracks;
let urlCounter;

// iPad Safari の MediaRecorder を再現する（mp4 で録音される）
class FakeMediaRecorder {
  constructor(stream, options = {}) {
    this.stream = stream;
    this.mimeType = options.mimeType || 'audio/mp4';
    this.state = 'inactive';
    this.ondataavailable = null;
    this.onstop = null;
    this.onerror = null;
    recorders.push(this);
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    if (this.state === 'inactive') throw Object.assign(new Error('inactive'), { name: 'InvalidStateError' });
    this.state = 'inactive';
    setTimeout(() => {
      if (this.ondataavailable) this.ondataavailable({ data: new Blob([makeAudioBytes('mp4', 200)], { type: this.mimeType }) });
      if (this.onstop) this.onstop();
    }, 0);
  }
}
FakeMediaRecorder.isTypeSupported = (type) => type === 'audio/mp4';

beforeEach(() => {
  idb = installFakeIndexedDB();
  installMemoryLocalStorage();
  recorders = [];
  tracks = [];
  urlCounter = 0;
  global.MediaRecorder = FakeMediaRecorder;
  global.FileReader = TestFileReader;
  URL.createObjectURL.mockImplementation(() => `blob:rec-${++urlCounter}`);
  navigator.mediaDevices.getUserMedia.mockImplementation(() => {
    const track = { stop: jest.fn(), kind: 'audio' };
    tracks.push(track);
    return Promise.resolve({ getTracks: () => [track] });
  });
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const record = async () => {
  fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
  const stopButton = await screen.findByRole('button', { name: /録音停止/ });
  fireEvent.click(stopButton);
  await screen.findByLabelText(/音の名前/);
};

const saveWithName = async (name) => {
  fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: name } });
  fireEvent.click(screen.getByRole('button', { name: /保存/ }));
  await waitFor(() => expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument());
};

describe('録音と保存', () => {
  test('iPad の録音（mp4）を audio/mp4 として保存する（以前は audio/wav と表記して再生できなかった）', async () => {
    render(<SoundCollection />);
    await record();
    await saveWithName('手をたたく音');

    const [saved] = await getAllRecordings();
    expect(saved.name).toBe('手をたたく音');
    expect(saved.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(saved).not.toHaveProperty('url');
    expect(saved).not.toHaveProperty('audioBlob');
    expect(recorders[0].mimeType).toBe('audio/mp4');
    expect(screen.getByText('手をたたく音')).toBeInTheDocument();
  });

  test('マイクは 1 回だけ取得し、録音が終わったら止める', async () => {
    render(<SoundCollection />);
    await record();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  test('2 つ目を保存しても 1 つ目の音の URL を解放しない（以前は再生できなくなっていた）', async () => {
    render(<SoundCollection />);
    await record();
    await saveWithName('1つ目');
    await record();
    await saveWithName('2つ目');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    const players = document.querySelectorAll('.recordings-grid audio');
    expect(Array.from(players).map((audio) => audio.getAttribute('src'))).toEqual(['blob:rec-1', 'blob:rec-2']);
    expect(await getAllRecordings()).toHaveLength(2);
  });

  test('キャンセルした録音の URL は解放する', async () => {
    render(<SoundCollection />);
    await record();
    fireEvent.click(screen.getByRole('button', { name: /キャンセル/ }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rec-1');
    expect(await getAllRecordings()).toHaveLength(0);
  });

  test('ページを離れたら録音を止め、作った URL をすべて解放する', async () => {
    const { unmount } = render(<SoundCollection />);
    await record();
    await saveWithName('残す音');
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    unmount();
    expect(recorders[1].state).toBe('inactive');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rec-1');
  });

  test('保存ボタンを連打しても 1 回だけ保存する', async () => {
    render(<SoundCollection />);
    await record();
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '連打' } });
    const button = screen.getByRole('button', { name: /保存/ });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument());
    expect(await getAllRecordings()).toHaveLength(1);
  });

  test('保存中はキャンセルできない（以前は保存されたのに再生できないカードができた）', async () => {
    render(<SoundCollection />);
    await record();
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '保存中' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(screen.getByRole('button', { name: /キャンセル/ })).toBeDisabled();
    await waitFor(() => expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument());
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:rec-1');
    expect(document.querySelector('.recordings-grid audio').getAttribute('src')).toBe('blob:rec-1');
  });

  test('保存中に次の録音をしても、保存した音も次の音も使える', async () => {
    render(<SoundCollection />);
    await record();
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '1つ目' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    // 保存が終わる前に次の録音
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    fireEvent.click(await screen.findByRole('button', { name: /録音停止/ }));
    await waitFor(() => expect(screen.getByText('1つ目')).toBeInTheDocument());
    expect(URL.revokeObjectURL).not.toHaveBeenCalledWith('blob:rec-1');
    // 次の音の編集画面は残っている
    await waitFor(() => expect(screen.getByLabelText(/音の名前/)).toHaveValue(''));
  });

  test('録音が自動的に止まった場合（マイクが切れたなど）も「録音中」の表示を戻す', async () => {
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    act(() => {
      recorders[0].stop();
    });
    expect(await screen.findByRole('button', { name: /録音開始/ })).toBeInTheDocument();
    expect(screen.queryByText('録音中...')).not.toBeInTheDocument();
  });

  test('録音開始の連打で録音が二重に始まらない', async () => {
    render(<SoundCollection />);
    const button = screen.getByRole('button', { name: /録音開始/ });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('button', { name: /録音停止/ });
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(recorders).toHaveLength(1);
  });

  test('容量不足で保存できなかったら、編集画面を残したまま知らせる', async () => {
    render(<SoundCollection />);
    await record();
    idb.failNextCommit(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '大きな音' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('容量が足りません'));
    expect(screen.getByLabelText(/音の名前/)).toBeInTheDocument();
    expect(screen.queryByText('大きな音', { selector: 'h4' })).not.toBeInTheDocument();
  });

  test('タグを追加して保存できる。日本語変換の確定 Enter ではタグを追加しない', async () => {
    render(<SoundCollection />);
    await record();
    const tagInput = screen.getByLabelText(/タグ/);
    fireEvent.change(tagInput, { target: { value: 'しぜ' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', keyCode: 229 });
    expect(screen.queryByText('追加されたタグ:')).not.toBeInTheDocument();
    fireEvent.change(tagInput, { target: { value: '自然' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', keyCode: 13 });
    expect(screen.getByText('追加されたタグ:')).toBeInTheDocument();
    await saveWithName('雨の音');
    const [saved] = await getAllRecordings();
    expect(saved.tags).toEqual(['自然']);
  });

  test('空の録音データはエラーにする', async () => {
    jest.spyOn(FakeMediaRecorder.prototype, 'stop').mockImplementation(function stop() {
      this.state = 'inactive';
      setTimeout(() => this.onstop && this.onstop(), 0);
    });
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    fireEvent.click(await screen.findByRole('button', { name: /録音停止/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('録音データが空でした'));
    expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument();
  });
});

describe('エラー表示', () => {
  test('マイクを拒否されたら理由を表示し、再描画されても消えない', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    const { rerender } = render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('マイクの使用が拒否されました'));
    rerender(<SoundCollection />);
    expect(document.querySelector('[role="alert"]').textContent).toContain('マイクの使用が拒否されました');
    expect(screen.getByRole('button', { name: /録音開始/ })).toBeInTheDocument();
  });

  test('MediaRecorder が無いブラウザ（古い iPad）では案内を表示する', async () => {
    global.MediaRecorder = undefined;
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('iPadOS 14.3 以降'));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  test('マイクが他のアプリで使用中の場合の案内', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })));
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('他のアプリケーションで使用中'));
  });
});

describe('ファイルのアップロード', () => {
  const selectFile = (file) => {
    const input = document.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [file] } });
    return input;
  };

  test('type が空の m4a（iPad のファイルアプリ）でも読み込み、ファイル名を音の名前にする', async () => {
    render(<SoundCollection />);
    selectFile(new File([makeAudioBytes('mp4', 50)], 'ボイスメモ.m4a', { type: '' }));
    const nameInput = await screen.findByLabelText(/音の名前/);
    expect(nameInput.value).toBe('ボイスメモ');
    await saveWithName('ボイスメモ');
    const [saved] = await getAllRecordings();
    expect(saved.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
  });

  test('音声以外のファイルはエラーにする', async () => {
    render(<SoundCollection />);
    selectFile(new File(['hello'], 'memo.txt', { type: 'text/plain' }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('音声ファイルを選択してください'));
    expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument();
  });

  test('同じファイルを選び直せるよう入力をリセットする', async () => {
    render(<SoundCollection />);
    const input = document.querySelector('input[type="file"]');
    const setValue = jest.spyOn(input, 'value', 'set');
    selectFile(new File([makeAudioBytes('wav', 10)], 'a.wav', { type: 'audio/wav' }));
    await screen.findByLabelText(/音の名前/);
    expect(setValue).toHaveBeenCalledWith('');
  });

  test('別のファイルを選び直したら、前の編集中の音の URL を解放する', async () => {
    render(<SoundCollection />);
    selectFile(new File([makeAudioBytes('wav', 10)], 'first.wav', { type: 'audio/wav' }));
    await waitFor(() => expect(screen.getByLabelText(/音の名前/).value).toBe('first'));
    selectFile(new File([makeAudioBytes('wav', 10)], 'second.wav', { type: 'audio/wav' }));
    await waitFor(() => expect(screen.getByLabelText(/音の名前/).value).toBe('second'));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rec-1');
  });

  test('ボタンからファイル選択を開く', () => {
    render(<SoundCollection />);
    const input = document.querySelector('input[type="file"]');
    const click = jest.spyOn(input, 'click').mockImplementation(() => {});
    fireEvent.click(screen.getByRole('button', { name: /ファイルを選択/ }));
    expect(click).toHaveBeenCalled();
  });
});

describe('保存に IndexedDB が使えない環境', () => {
  test('一時的に localStorage に保存し、一覧にも表示する', async () => {
    render(<SoundCollection />);
    await record();
    idb.openFailure = new Error('IndexedDB is broken');
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '予備保存' } });
    fireEvent.click(screen.getByRole('button', { name: /保存/ }));
    expect(await screen.findByText('予備保存')).toBeInTheDocument();
    expect(window.localStorage.setItem).toHaveBeenCalledWith('soundRecordings', expect.stringContaining('予備保存'));
  });
});
