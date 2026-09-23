import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CloudPage from '../pages/CloudPage';
import { addRecording, getAllRecordings } from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, makeAudioBytes, makeDataUrl, readBlobBytes } from '../test-utils/audioFixtures';

let storage;
let audioElements;
let responses;

// PHP 8.1 未満では数値の列も文字列で返る
const ROOMS = { success: true, data: [{ id: '3', room_number: '101', room_name: '1年1組' }] };
const FILES = {
  success: true,
  data: [
    { id: '10', uid: 'audio_abc', file_name: 'みんなの太鼓', student_name: 'はなこ', file_size: '2048', download_count: '0', upload_date: '2026-05-01 10:00:00', tags: ['楽器'] },
    { id: '11', uid: 'audio_def', file_name: 'かえるの声', student_name: null, file_size: '1024', download_count: '2', upload_date: '2026-05-02 10:00:00', tags: null }
  ]
};

const jsonResponse = (data, status = 200) => ({ ok: status < 400, status, text: () => Promise.resolve(JSON.stringify(data)) });
const blobResponse = (blob) => ({ ok: true, status: 200, blob: () => Promise.resolve(blob) });

beforeEach(() => {
  installFakeIndexedDB();
  storage = installMemoryLocalStorage();
  global.FileReader = TestFileReader;
  let urlCounter = 0;
  URL.createObjectURL.mockImplementation(() => `blob:cloud-${++urlCounter}`);
  audioElements = [];
  global.Audio.mockImplementation(() => {
    const audio = {
      src: '',
      play: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
      onended: null,
      onerror: null
    };
    audioElements.push(audio);
    return audio;
  });
  responses = {
    rooms: () => jsonResponse(ROOMS),
    list: () => jsonResponse(FILES),
    upload: () => jsonResponse({ success: true }),
    download: () => blobResponse(new Blob([makeAudioBytes('mp4', 40)], { type: 'audio/wav' }))
  };
  global.fetch = jest.fn((url, options = {}) => {
    if (url.includes('rooms.php')) return Promise.resolve(responses.rooms());
    if (url.includes('download.php')) return Promise.resolve(responses.download());
    if (url.includes('audio.php') && options.method === 'POST') return Promise.resolve(responses.upload(options));
    if (url.includes('audio.php')) return Promise.resolve(responses.list());
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

const joinRoom = async (number = '101') => {
  fireEvent.change(screen.getByLabelText('部屋番号:'), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: '部屋に入る' }));
};

const renderInRoom = async () => {
  storage['sound-library-room'] = '101';
  const utils = render(<CloudPage />);
  await screen.findByText(/部屋: 101/);
  await screen.findByText('みんなの太鼓');
  return utils;
};

describe('部屋に入る', () => {
  test('部屋番号が文字列で返ってきても入れる（PHP 8.1 未満のサーバー）', async () => {
    render(<CloudPage />);
    await joinRoom('101');
    expect(await screen.findByText(/部屋: 101 - 1年1組/)).toBeInTheDocument();
    expect(storage['sound-library-room']).toBe('101');
    expect(await screen.findByText('みんなの太鼓')).toBeInTheDocument();
    expect(global.fetch.mock.calls.map(([url]) => url)).toContainEqual(expect.stringContaining('audio.php?room_id=3'));
    // 以前はこのページだけ '../api' を使っていた。他のページと同じ '/api' にそろえた
    global.fetch.mock.calls.forEach(([url]) => expect(url).toMatch(/^\/api\/(rooms|audio)\.php/));
  });

  test('前回の部屋に自動で入る', async () => {
    await renderInRoom();
    expect(screen.getByText('共有された音声ファイル (2件)')).toBeInTheDocument();
  });

  test('存在しない部屋はエラーを表示する', async () => {
    render(<CloudPage />);
    await joinRoom('999');
    expect(await screen.findByText('指定された部屋番号が見つかりません')).toBeInTheDocument();
  });

  test('サーバーに接続できないときはエラーを表示する', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    render(<CloudPage />);
    await joinRoom('101');
    expect(await screen.findByText('サーバーに接続できませんでした')).toBeInTheDocument();
  });

  test('退室すると部屋番号の記録を消す', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: '退室' }));
    expect(screen.getByRole('button', { name: '部屋に入る' })).toBeInTheDocument();
    expect(storage['sound-library-room']).toBeUndefined();
  });
});

describe('音ライブラリとアップロード', () => {
  test('IndexedDB の音素材を一覧に出す（以前は古い localStorage を見ていて何も出なかった）', async () => {
    await addRecording({ name: '録音した音', tags: ['声'], audioData: makeDataUrl('mp4', 'audio/wav') });
    storage.soundRecordings = undefined;
    await renderInRoom();
    const list = document.querySelector('.library-sounds-list');
    expect(await within(list).findByText('録音した音')).toBeInTheDocument();
    expect(list.querySelector('audio').getAttribute('src').startsWith('data:audio/mp4;base64,')).toBe(true);
  });

  test('中身に合った形式・拡張子でアップロードする（mp4 を .wav として送らない）', async () => {
    await addRecording({ name: 'たいこ/ドン', tags: [], audioData: makeDataUrl('mp4', 'audio/wav', 30) });
    let sentForm = null;
    responses.upload = (options) => {
      sentForm = options.body;
      return jsonResponse({ success: true });
    };
    await renderInRoom();
    const list = document.querySelector('.library-sounds-list');
    fireEvent.click(await within(list).findByRole('button', { name: /たいこ\/ドン/ }));
    fireEvent.change(screen.getByLabelText('名前:'), { target: { value: 'たろう' } });
    const tagInput = screen.getByLabelText('タグ:');
    fireEvent.change(tagInput, { target: { value: '楽器' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', keyCode: 13 });
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('アップロードが完了しました！'));

    const file = sentForm.get('audio_file');
    expect(file.name).toBe('たいこ_ドン.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(readBlobBytes(file).length).toBe(46);
    expect(sentForm.get('room_id')).toBe('3');
    expect(sentForm.get('student_name')).toBe('たろう');
    expect(JSON.parse(sentForm.get('tags'))).toEqual(['楽器']);
  });

  test('音素材を選ばずにアップロードするとエラー', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }));
    expect(await screen.findByText('音ライブラリーから音素材を選択してください')).toBeInTheDocument();
  });

  test('サーバーのエラーメッセージを表示する', async () => {
    await addRecording({ name: 'x', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
    responses.upload = () => jsonResponse({ success: false, error: 'サポートされていないファイル形式です' }, 400);
    await renderInRoom();
    const list = document.querySelector('.library-sounds-list');
    fireEvent.click(await within(list).findByRole('button', { name: /音素材「x」を選択/ }));
    fireEvent.click(screen.getByRole('button', { name: 'アップロード' }));
    expect(await screen.findByText('サポートされていないファイル形式です')).toBeInTheDocument();
  });

  test('ライブラリの検索とタグの絞り込み', async () => {
    await addRecording({ name: '犬', tags: ['動物'], audioData: makeDataUrl('wav', 'audio/wav') });
    await addRecording({ name: 'ピアノ', tags: ['楽器'], audioData: makeDataUrl('wav', 'audio/wav') });
    await renderInRoom();
    const list = document.querySelector('.library-sounds-list');
    await within(list).findByText('犬');
    fireEvent.change(screen.getByPlaceholderText('音素材を検索...'), { target: { value: 'ぴ' } });
    expect(within(list).getByText('音素材が見つかりません')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('音素材を検索...'), { target: { value: '' } });
    fireEvent.click(within(document.querySelector('.library-tag-filters')).getByRole('button', { name: '動物' }));
    expect(within(list).getByText('犬')).toBeInTheDocument();
    expect(within(list).queryByText('ピアノ')).not.toBeInTheDocument();
  });
});

describe('ダウンロード（音ライブラリに追加）', () => {
  test('IndexedDB に中身に合った形式で保存する', async () => {
    await renderInRoom();
    fireEvent.click(screen.getAllByRole('button', { name: '音ライブラリーに追加' })[0]);
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('「みんなの太鼓」を音ライブラリーに追加しました！'));
    const [saved] = await getAllRecordings();
    expect(saved.name).toBe('みんなの太鼓');
    expect(saved.cloudUid).toBe('audio_abc');
    expect(saved.tags).toEqual(['楽器']);
    expect(saved.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(storage.soundRecordings).toBeUndefined(); // localStorage には保存しない
  });

  test('同じ音声を二重に追加しない', async () => {
    await renderInRoom();
    const button = screen.getAllByRole('button', { name: '音ライブラリーに追加' })[0];
    fireEvent.click(button);
    await waitFor(() => expect(window.alert).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getAllByRole('button', { name: '音ライブラリーに追加' })[0]);
    expect(window.alert).toHaveBeenLastCalledWith('「みんなの太鼓」は既に音ライブラリーに追加されています');
    expect(await getAllRecordings()).toHaveLength(1);
  });

  test('ダウンロード数を 1 人 1 回で数えるための ID を送る', async () => {
    await renderInRoom();
    fireEvent.click(screen.getAllByRole('button', { name: '音ライブラリーに追加' })[1]);
    await waitFor(() => expect(window.alert).toHaveBeenCalled());
    const url = global.fetch.mock.calls.map(([u]) => u).find((u) => u.includes('download.php'));
    expect(url).toMatch(/uid=audio_def&user_id=user_[a-z0-9]+/);
    expect(storage['user-identifier']).toMatch(/^user_/);
  });

  test('ダウンロードに失敗したらエラーを表示する', async () => {
    responses.download = () => ({ ok: false, status: 404 });
    await renderInRoom();
    fireEvent.click(screen.getAllByRole('button', { name: '音ライブラリーに追加' })[0]);
    expect(await screen.findByText('ダウンロードに失敗しました')).toBeInTheDocument();
    expect(await getAllRecordings()).toHaveLength(0);
  });
});

describe('共有された音の再生', () => {
  test('タップ直後に要素の再生許可を取り、ダウンロード後に中身に合った形式で再生する', async () => {
    let resolveDownload;
    responses.download = () => new Promise((resolve) => { resolveDownload = resolve; });
    global.fetch = jest.fn((url) => {
      if (url.includes('rooms.php')) return Promise.resolve(jsonResponse(ROOMS));
      if (url.includes('download.php')) return responses.download();
      return Promise.resolve(jsonResponse(FILES));
    });
    await renderInRoom();
    fireEvent.click(screen.getAllByTitle('再生')[0]);

    // ダウンロードを待つ前に（タップの処理中に）無音で play() している（iOS の再生制限対策）
    expect(audioElements).toHaveLength(1);
    const audio = audioElements[0];
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true);

    await act(async () => {
      resolveDownload(blobResponse(new Blob([makeAudioBytes('mp4', 20)], { type: 'audio/wav' })));
    });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    expect(audio.src).toBe('blob:cloud-1');
    expect(URL.createObjectURL.mock.calls[0][0].type).toBe('audio/mp4');
    expect(screen.getAllByTitle('停止')).toHaveLength(1);
  });

  test('もう一度押すと止め、URL を解放する', async () => {
    await renderInRoom();
    fireEvent.click(screen.getAllByTitle('再生')[0]);
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByTitle('停止'));
    expect(audioElements[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-1');
    expect(screen.getAllByTitle('再生')).toHaveLength(2);
  });

  test('再生が終わったらボタンを戻す', async () => {
    await renderInRoom();
    fireEvent.click(screen.getAllByTitle('再生')[1]);
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    act(() => {
      audioElements[0].onended();
    });
    expect(screen.getAllByTitle('再生')).toHaveLength(2);
  });

  test('この端末で再生できない音は分かるように知らせる', async () => {
    await renderInRoom();
    fireEvent.click(screen.getAllByTitle('再生')[0]);
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    act(() => {
      audioElements[0].onerror();
    });
    expect(screen.getByText('この音声はこの端末では再生できませんでした')).toBeInTheDocument();
  });

  test('ページを離れたら再生を止める', async () => {
    const { unmount } = await renderInRoom();
    fireEvent.click(screen.getAllByTitle('再生')[0]);
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    unmount();
    expect(audioElements[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-1');
  });
});
