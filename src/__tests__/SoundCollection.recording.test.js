import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import SoundCollection, { MAX_RECORDING_SECONDS } from '../pages/SoundCollection';
import { addRecording, getAllRecordings } from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, makeAudioBytes, makeDataUrl } from '../test-utils/audioFixtures';
import { hasUnsavedDraft, takeUnsavedDraft } from '../utils/unsavedDraft';

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
  takeUnsavedDraft(); // 前のテストで残った「保存前の録音」を捨てる
  idb = installFakeIndexedDB();
  installMemoryLocalStorage();
  window.confirm = jest.fn(() => true);
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

// 画面を片付けてから、アンマウント時の保存が終わるのを待つ（次のテストが差し替えた
// localStorage や IndexedDB に前のテストの保存処理が書き込まないように）
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  delete window.OfflineAudioContext;
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
  fireEvent.click(screen.getByRole('button', { name: /保存する/ }));
  await waitFor(() => expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument());
};

const recentList = () => screen.getByRole('region', { name: /さいきん集めた音/ });

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
    expect(within(recentList()).getByText('手をたたく音')).toBeInTheDocument();
    // お知らせは 1 か所だけ（読み上げが 2 回にならないように）
    expect(screen.getAllByText('「手をたたく音」を保存しました。')).toHaveLength(1);
  });

  test('マイクは 1 回だけ取得し、録音が終わったら止める', async () => {
    render(<SoundCollection />);
    await record();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(tracks[0].stop).toHaveBeenCalled();
  });

  test('録音を止めると、録音ボタンの所に名前をつける画面が出て、見出しにフォーカスが移る', async () => {
    render(<SoundCollection />);
    await record();
    expect(screen.queryByRole('button', { name: /録音開始/ })).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('heading', { name: /音に名前をつけよう/ })).toHaveFocus());
  });

  test('保存した音は一覧で、保存した音声データを使って再生する。編集用の URL は保存したら解放する', async () => {
    const audio = { play: jest.fn(() => Promise.resolve()), pause: jest.fn(), src: '' };
    global.Audio = jest.fn(() => audio);
    render(<SoundCollection />);
    await record();
    await saveWithName('1つ目');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rec-1');
    fireEvent.click(within(recentList()).getByRole('button', { name: '1つ目をきく' }));
    expect(audio.src.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(audio.play).toHaveBeenCalled();
    expect(within(recentList()).getByRole('button', { name: '1つ目を止める' })).toBeInTheDocument();
  });

  test('「この音をすてる」は確認してから捨て、URL を解放する', async () => {
    render(<SoundCollection />);
    await record();
    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: /この音をすてる/ }));
    expect(screen.getByLabelText(/音の名前/)).toBeInTheDocument(); // やめたら残す
    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole('button', { name: /この音をすてる/ }));
    expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument();
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
    const button = screen.getByRole('button', { name: /保存する/ });
    fireEvent.click(button);
    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument());
    expect(await getAllRecordings()).toHaveLength(1);
  });

  test('保存中は「すてる」「録音しなおす」を押せない（保存に失敗したとき音が消えないように）', async () => {
    render(<SoundCollection />);
    await record();
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '保存中' } });
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }));
    expect(screen.getByRole('button', { name: /この音をすてる/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /録音しなおす/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /保存中/ })).toBeDisabled();
    await waitFor(() => expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument());
    // 保存が終われば次の録音ができる
    expect(screen.getByRole('button', { name: /録音開始/ })).not.toBeDisabled();
    expect(within(recentList()).getByText('保存中')).toBeInTheDocument();
  });

  test('保存中にほかのページへ移動して保存に失敗しても、戻ると入力した名前ごと復元される', async () => {
    const { unmount } = render(<SoundCollection />);
    await record();
    idb.failNextCommit(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '大事な音' } });
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }));
    unmount();
    await waitFor(() => expect(hasUnsavedDraft()).toBe(true));
    render(<SoundCollection />);
    expect(await screen.findByLabelText(/音の名前/)).toHaveValue('大事な音');
  });

  test('名前を入力している途中でほかのページへ移動しても、入力した名前とタグが戻る', async () => {
    const { unmount } = render(<SoundCollection />);
    await record();
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '書きかけ' } });
    const tagInput = screen.getByRole('textbox', { name: /タグ/ });
    fireEvent.change(tagInput, { target: { value: '自然' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', keyCode: 13 });
    unmount();
    render(<SoundCollection />);
    expect(await screen.findByLabelText(/音の名前/)).toHaveValue('書きかけ');
    expect(document.querySelector('.tags-list')).toHaveTextContent('自然');
    // 復元した音の再生用 URL も作り直されている
    await waitFor(() => expect(screen.getByRole('button', { name: '録音した音をきく' })).not.toBeDisabled());
  });

  test('録音が自動的に止まった場合（マイクが切れたなど）も「録音中」の表示を戻す', async () => {
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    act(() => {
      recorders[0].stop();
    });
    expect(await screen.findByLabelText(/音の名前/)).toBeInTheDocument();
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

  test('容量不足で保存できなかったら、編集画面を残したまま、保存ボタンの近くで知らせる', async () => {
    render(<SoundCollection />);
    await record();
    idb.failNextCommit(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }));
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '大きな音' } });
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }));
    const editor = screen.getByRole('region', { name: /音に名前をつけよう/ });
    // 編集画面には「録音しなおす」のエラーの場所（空のときは見えない）もあるので、文字で探す
    expect(await within(editor).findByText(/容量が足りません/)).toHaveAttribute('role', 'alert');
    expect(screen.getByLabelText(/音の名前/)).toBeInTheDocument();
    expect(screen.queryByText('大きな音', { selector: 'h4' })).not.toBeInTheDocument();
  });

  test('タグを追加して保存できる。日本語変換の確定 Enter ではタグを追加しない', async () => {
    render(<SoundCollection />);
    await record();
    const tagInput = screen.getByRole('textbox', { name: /タグ/ });
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

  test('タグの候補（よく使うタグとライブラリのタグ）を押して追加できる', async () => {
    await addRecording({ name: '前の音', tags: ['ひくい音'], audioData: 'data:audio/wav;base64,UklGRg==' });
    render(<SoundCollection />);
    await record();
    const suggestions = await screen.findByRole('group', { name: 'タグの候補' });
    fireEvent.click(await within(suggestions).findByRole('button', { name: /ひくい音/ }));
    fireEvent.click(within(suggestions).getByRole('button', { name: /動物/ }));
    expect(document.querySelector('.tags-list')).toHaveTextContent('ひくい音');
    expect(document.querySelector('.tags-list')).toHaveTextContent('動物');
    // 追加した候補は候補から消える
    expect(within(suggestions).queryByRole('button', { name: /動物/ })).not.toBeInTheDocument();
    await saveWithName('犬の声');
    const saved = (await getAllRecordings()).find((sound) => sound.name === '犬の声');
    expect(saved.tags).toEqual(['ひくい音', '動物']);
  });

  test('音の長さが分かれば一緒に保存し、画面にも出す', async () => {
    window.OfflineAudioContext = jest.fn(() => ({
      decodeAudioData: jest.fn((buffer, ok) => {
        const result = { duration: 1.234 };
        if (ok) ok(result);
        return Promise.resolve(result);
      })
    }));
    render(<SoundCollection />);
    await record();
    expect(await screen.findByText('長さ 1.2秒')).toBeInTheDocument();
    await saveWithName('長さのある音');
    const [saved] = await getAllRecordings();
    expect(saved.duration).toBe(1.23);
    expect(within(recentList()).getByText('1.2秒')).toBeInTheDocument();
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

describe('録音の長さ', () => {
  test(`録音中は経過時間を表示し、${MAX_RECORDING_SECONDS} 秒になったら自動で止める（止め忘れて大きな音にならないように）`, async () => {
    let now = 1000000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    expect(screen.getByText('0:00')).toBeInTheDocument();
    expect(screen.getByText(/\/ 1:00/)).toBeInTheDocument();

    now += 52000;
    expect(await screen.findByText('あと 8 秒で止まります')).toBeInTheDocument();
    expect(screen.getByText('0:52')).toBeInTheDocument();

    now += 9000;
    expect(await screen.findByLabelText(/音の名前/)).toBeInTheDocument();
    expect(recorders[0].state).toBe('inactive');
    expect(screen.getByText(`${MAX_RECORDING_SECONDS}秒になったので、録音を止めました。`)).toBeInTheDocument();
  });
});

describe('エラー表示', () => {
  test('マイクを拒否されたら理由と、読み込み直すボタン・設定の説明を出し、再描画されても消えない', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    const { rerender } = render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('マイクの使用が拒否されました'));
    expect(await screen.findByRole('button', { name: /ページを読み込み直す/ })).toBeInTheDocument();
    expect(document.querySelector('.mic-help')).toHaveAttribute('open');
    rerender(<SoundCollection />);
    expect(document.querySelector('[role="alert"]').textContent).toContain('マイクの使用が拒否されました');
    expect(screen.getByRole('button', { name: /録音開始/ })).toBeInTheDocument();
  });

  test('MediaRecorder が無いブラウザ（古い iPad）では案内を表示する', async () => {
    global.MediaRecorder = undefined;
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('iPadOS 14.5 以降'));
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  test('マイクが他のアプリで使用中の場合の案内', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })));
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(document.querySelector('[role="alert"]').textContent).toContain('他のアプリケーションで使用中'));
    expect(screen.queryByRole('button', { name: /ページを読み込み直す/ })).not.toBeInTheDocument();
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

  test('録音中はファイルを選べない（録音が終わると、選んだファイルが黙って置き換わっていた）', async () => {
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    expect(screen.getByRole('button', { name: /ファイルを選択/ })).toBeDisabled();
  });
});

describe('保存前の録音を失わない', () => {
  test('名前をつける前にほかのページへ移動しても、戻ると編集画面に復元される', async () => {
    const { unmount } = render(<SoundCollection />);
    await record();
    unmount();
    expect(hasUnsavedDraft()).toBe(true);

    render(<SoundCollection />);
    expect(await screen.findByText(/前に録音した音がまだ保存されていません/)).toBeInTheDocument();
    await saveWithName('あとで保存した音');
    const [saved] = await getAllRecordings();
    expect(saved.name).toBe('あとで保存した音');
    expect(saved.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(hasUnsavedDraft()).toBe(false);
  });

  test('録音中にほかのページへ移動しても、戻ると録音した音が残っている', async () => {
    const { unmount } = render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    unmount();
    await waitFor(() => expect(hasUnsavedDraft()).toBe(true));

    render(<SoundCollection />);
    expect(await screen.findByLabelText(/音の名前/)).toBeInTheDocument();
    expect(screen.getByText(/前に録音した音がまだ保存されていません/)).toBeInTheDocument();
  });

  test('「録音しなおす」は確認してから新しく録音し、キャンセルすれば残す', async () => {
    render(<SoundCollection />);
    await record();
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '残したい音' } });
    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: /録音しなおす/ }));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('まだ保存していない音があります'));
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText(/音の名前/)).toHaveValue('残したい音');

    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole('button', { name: /録音しなおす/ }));
    expect(await screen.findByRole('button', { name: /録音停止/ })).toBeInTheDocument();
    expect(screen.queryByLabelText(/音の名前/)).not.toBeInTheDocument();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2);
  });

  test('保存前の音があるときにファイルを選ぶ場合も確認する', async () => {
    render(<SoundCollection />);
    await record();
    window.confirm = jest.fn(() => false);
    fireEvent.change(document.querySelector('input[type="file"]'), {
      target: { files: [new File([makeAudioBytes('wav', 10)], 'other.wav', { type: 'audio/wav' })] }
    });
    expect(window.confirm).toHaveBeenCalled();
    expect(screen.getByLabelText(/音の名前/)).toHaveValue('');
    expect(URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('すてた音は次に開いたときに戻さない', async () => {
    const { unmount } = render(<SoundCollection />);
    await record();
    fireEvent.click(screen.getByRole('button', { name: /この音をすてる/ }));
    unmount();
    expect(hasUnsavedDraft()).toBe(false);
  });
});

describe('さいきん集めた音', () => {
  test('前に集めた音を新しい順に 6 つまで出し、音ライブラリへのリンクを出す', async () => {
    for (let i = 1; i <= 8; i++) {
      // eslint-disable-next-line no-await-in-loop
      await addRecording({ name: `音${i}`, tags: [], audioData: 'data:audio/wav;base64,UklGRg==', createdAt: `2026-01-0${i}T00:00:00Z` });
    }
    render(<SoundCollection />);
    await waitFor(() => expect(within(recentList()).getAllByRole('listitem')).toHaveLength(6));
    const names = within(recentList()).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(names).toEqual(['音8', '音7', '音6', '音5', '音4', '音3']);
    expect(within(recentList()).getByRole('link', { name: '音ライブラリですべて見る' })).toHaveAttribute('href', '#/library');
  });
});

describe('保存に IndexedDB が使えない環境', () => {
  test('一時的に localStorage に保存し、一覧にも表示する', async () => {
    render(<SoundCollection />);
    await record();
    idb.openFailure = new Error('IndexedDB is broken');
    fireEvent.change(screen.getByLabelText(/音の名前/), { target: { value: '予備保存' } });
    fireEvent.click(screen.getByRole('button', { name: /保存する/ }));
    expect(await within(recentList()).findByText('予備保存')).toBeInTheDocument();
    expect(window.localStorage.setItem).toHaveBeenCalledWith('soundRecordings', expect.stringContaining('予備保存'));
  });
});

describe('レビューで見つかった不具合（エラー・読み上げ・フォーカス）', () => {
  test('「録音しなおす」でマイクが使えなかったら、編集画面の中で知らせ、読み込み直すボタンを出す', async () => {
    render(<SoundCollection />);
    await record();
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('denied'), { name: 'NotAllowedError' })));
    fireEvent.click(screen.getByRole('button', { name: /録音しなおす/ }));
    const editor = screen.getByRole('region', { name: /音に名前をつけよう/ });
    // 以前はエラーの場所が編集画面の外（表示されていない所）にあり、画面に何も出なかった
    await waitFor(() => expect(within(editor).getAllByRole('alert').some((alert) => alert.textContent.trim() !== '')).toBe(true));
    expect(await within(editor).findByRole('button', { name: /ページを読み込み直す/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/音の名前/)).toBeInTheDocument(); // 前に録った音は残っている
  });

  test('エラーは 1 回だけ読み上げる（エラーの場所と読み上げ用の場所の両方には書かない）', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('busy'), { name: 'NotReadableError' })));
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    const alert = document.querySelector('.recording-section [role="alert"]');
    await waitFor(() => expect(alert.textContent).not.toBe(''));
    Array.from(document.querySelectorAll('[aria-live]'))
      .filter((element) => element.getAttribute('role') !== 'alert')
      .forEach((element) => expect(element.textContent).not.toContain(alert.textContent));
  });

  test('録音中は読み上げない（残り秒数などの読み上げの声が、録音に入らないように）', async () => {
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await screen.findByRole('button', { name: /録音停止/ });
    const status = document.querySelector('.recording-status');
    expect(status).toHaveAttribute('aria-hidden', 'true');
    expect(status).not.toHaveAttribute('role');
    expect(document.body.textContent).not.toContain('録音を開始しました');
  });

  test('保存・すてる・録音しなおすのあとは、録音ボタンにフォーカスが移る（ページの先頭に戻らない）', async () => {
    render(<SoundCollection />);
    await record();
    await saveWithName('ひとつめ');
    await waitFor(() => expect(screen.getByRole('button', { name: /録音開始/ })).toHaveFocus());
    await record();
    fireEvent.click(screen.getByRole('button', { name: /この音をすてる/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /録音開始/ })).toHaveFocus());
    await record();
    fireEvent.click(screen.getByRole('button', { name: /録音しなおす/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /録音停止/ })).toHaveFocus());
  });

  test('タグの候補や × を押したあとは、タグの入力欄にフォーカスが移る', async () => {
    render(<SoundCollection />);
    await record();
    const suggestions = screen.getByRole('group', { name: 'タグの候補' });
    fireEvent.click(within(suggestions).getAllByRole('button')[0]);
    const tagInput = screen.getByRole('textbox', { name: /タグ/ });
    expect(tagInput).toHaveFocus();
    fireEvent.click(screen.getAllByRole('button', { name: /タグ「.*」を削除/ })[0]);
    expect(tagInput).toHaveFocus();
  });

  test('以前の版が Date のまま保存した音が、「さいきん集めた音」に居座らない', async () => {
    // 2025 年 10 月の版と同じく、作成日時を Date のまま書き込む（addRecording は文字列に直すので使わない）
    idb.seed('SoundLibraryDB', 'recordings', Array.from({ length: 6 }, (_, i) => ({
      name: `去年の音${i}`, tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: new Date(Date.UTC(2025, 9, 16, i))
    })), { autoIncrement: true });
    idb.seed('SoundLibraryDB', 'songs', []);
    await addRecording({ name: '今年の音', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-01T00:00:00.000Z' });
    render(<SoundCollection />);
    await waitFor(() => expect(within(recentList()).getAllByRole('heading', { level: 4 })).toHaveLength(6));
    const names = within(recentList()).getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent);
    expect(names[0]).toBe('今年の音');
    expect(names).not.toContain('去年の音0');
  });
});
