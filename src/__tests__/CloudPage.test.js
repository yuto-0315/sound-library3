import React from 'react';
import { act, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CloudPage from '../pages/CloudPage';
import * as audioUtils from '../utils/audio';
import { addRecording, getAllRecordings } from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, makeAudioBytes, makeDataUrl, readBlobBytes } from '../test-utils/audioFixtures';

let storage;
let audioElements;
let responses;
let defaultFetch;

// PHP 8.1 未満では数値の列も文字列で返る
const ROOMS = { success: true, data: [{ id: '3', room_number: '101', room_name: '1年1組' }] };
const FILES = {
  success: true,
  data: [
    { id: '10', uid: 'audio_abc', file_name: 'みんなの太鼓', student_name: 'はなこ', file_size: '2048', download_count: '0', upload_date: '2026-05-01 10:00:00', tags: ['楽器'] },
    { id: '11', uid: 'audio_def', file_name: 'カエルの声', student_name: null, file_size: '1024', download_count: '2', upload_date: '2026-05-02 10:00:00', tags: null }
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
  defaultFetch = jest.fn((url, options = {}) => {
    if (url.includes('rooms.php')) return Promise.resolve(responses.rooms());
    if (url.includes('download.php')) return Promise.resolve(responses.download());
    if (url.includes('audio.php') && options.method === 'POST') return Promise.resolve(responses.upload(options));
    if (url.includes('audio.php')) return Promise.resolve(responses.list());
    return Promise.reject(new Error(`unexpected ${url}`));
  });
  global.fetch = defaultFetch;
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
  delete window.OfflineAudioContext;
  delete document.visibilityState;
});

const typeRoomAndJoin = (number = '101') => {
  fireEvent.change(screen.getByLabelText('部屋番号'), { target: { value: number } });
  fireEvent.click(screen.getByRole('button', { name: /部屋に入る/ }));
};

const renderInRoom = async () => {
  storage['sound-library-room'] = '101';
  const utils = render(<CloudPage />);
  await screen.findByRole('button', { name: /部屋を出る/ });
  await screen.findByText('みんなの太鼓');
  return utils;
};

// 部屋に入ったときの useEffect（自動の読み込み直しの登録）が終わるまで待つ。
// fetch のモックはすぐ返るので、一覧が表示された時点ではまだ登録されていないことがある
const renderInRoomWithAutoRefresh = async () => {
  const addListener = jest.spyOn(document, 'addEventListener');
  const utils = await renderInRoom();
  await waitFor(() => expect(addListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function)));
  return utils;
};

const cardFor = (name) => screen.getByRole('heading', { level: 4, name }).closest('.cloud-sound-card');
const addButtonFor = (name) => within(cardFor(name)).getByRole('button', { name: new RegExp(`「${name}」`) });
const openShareTab = () => fireEvent.click(screen.getByRole('tab', { name: /自分の音を共有する/ }));
const shareButton = () => screen.getByRole('button', { name: /みんなに共有する/ });
const listGetCount = () => global.fetch.mock.calls
  .filter(([url, options]) => url.includes('audio.php') && !(options && options.method)).length;
const postCount = () => global.fetch.mock.calls.filter(([, options]) => options && options.method === 'POST').length;

describe('部屋に入る', () => {
  test('部屋番号が文字列で返ってきても入れる（PHP 8.1 未満のサーバー）', async () => {
    render(<CloudPage />);
    typeRoomAndJoin('101');
    expect(await screen.findByRole('button', { name: /部屋を出る/ })).toBeInTheDocument();
    expect(screen.getByText('（1年1組）')).toBeInTheDocument();
    expect(storage['sound-library-room']).toBe('101');
    expect(await screen.findByText('みんなの太鼓')).toBeInTheDocument();
    const urls = global.fetch.mock.calls.map(([url]) => url);
    // 部屋の一覧は先生だけが見られる。部屋番号で 1 つだけ探し、一覧の読み込みでも部屋番号を送る
    expect(urls).toContain('/api/rooms.php?room_number=101');
    expect(urls).toContainEqual(expect.stringContaining('audio.php?room_id=3&room_number=101'));
    // 以前はこのページだけ '../api' を使っていた。他のページと同じ '/api' にそろえた
    global.fetch.mock.calls.forEach(([url]) => expect(url).toMatch(/^\/api\/(rooms|audio)\.php/));
  });

  test('全角の数字で入れた部屋番号でも入れる（iPad の日本語入力）', async () => {
    render(<CloudPage />);
    typeRoomAndJoin('１０１');
    expect(await screen.findByRole('button', { name: /部屋を出る/ })).toBeInTheDocument();
    expect(storage['sound-library-room']).toBe('101');
    expect(global.fetch.mock.calls[0][0]).toBe('/api/rooms.php?room_number=101');
  });

  test('前回の部屋に自動で入り、「みんなの音」に数を出す', async () => {
    await renderInRoom();
    const listTab = screen.getByRole('tab', { name: /みんなの音/ });
    expect(listTab).toHaveAttribute('aria-selected', 'true');
    expect(listTab).toHaveTextContent('2');
  });

  test('数字以外の部屋番号は、サーバーに問い合わせずに知らせる', async () => {
    render(<CloudPage />);
    typeRoomAndJoin('abc');
    expect(screen.getByRole('alert')).toHaveTextContent('部屋番号は数字で入れてください');
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByLabelText('部屋番号')).toHaveAttribute('aria-invalid', 'true');
  });

  test('部屋番号の欄は iPad で数字のキーボードを出す', () => {
    render(<CloudPage />);
    const input = screen.getByLabelText('部屋番号');
    expect(input).toHaveAttribute('inputmode', 'numeric');
    // type="number" だと 1e3 や -1 も入り、スクロールで値が変わってしまう
    expect(input).toHaveAttribute('type', 'text');
  });

  test('存在しない部屋は分かるように知らせる', async () => {
    render(<CloudPage />);
    typeRoomAndJoin('999');
    expect(await screen.findByRole('alert')).toHaveTextContent('部屋 999 が見つかりません');
    expect(storage['sound-library-room']).toBeUndefined();
  });

  test('前に入っていた部屋が消えていたら、覚えている番号を消して知らせる', async () => {
    storage['sound-library-room'] = '555';
    render(<CloudPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('前に入っていた部屋 555 が見つかりませんでした');
    expect(storage['sound-library-room']).toBeUndefined();
    expect(screen.getByLabelText('部屋番号')).toHaveValue('555');
  });

  test('サーバーに接続できないときは知らせ、部屋番号は覚えたまま。つながったら入り直せる', async () => {
    global.fetch = jest.fn(() => Promise.reject(new TypeError('Failed to fetch')));
    storage['sound-library-room'] = '101';
    render(<CloudPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('サーバーに接続できませんでした');
    expect(storage['sound-library-room']).toBe('101');
    global.fetch = defaultFetch;
    fireEvent.click(screen.getByRole('button', { name: /部屋に入る/ }));
    expect(await screen.findByText('みんなの太鼓')).toBeInTheDocument();
  });

  test('部屋を出ると部屋番号の記録を消す', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: /部屋を出る/ }));
    expect(screen.getByRole('button', { name: /部屋に入る/ })).toBeEnabled();
    expect(screen.getByLabelText('部屋番号')).toHaveValue('');
    expect(storage['sound-library-room']).toBeUndefined();
  });

  test('一覧の読み込み中に部屋を出ても「入っています...」のまま止まらず、あとから届いた一覧も出さない', async () => {
    let resolveList;
    responses.list = () => new Promise((resolve) => { resolveList = resolve; });
    storage['sound-library-room'] = '101';
    render(<CloudPage />);
    fireEvent.click(await screen.findByRole('button', { name: /部屋を出る/ }));
    expect(screen.getByRole('button', { name: /部屋に入る/ })).toBeEnabled();
    await act(async () => {
      resolveList(jsonResponse(FILES));
    });
    expect(screen.queryByText('みんなの太鼓')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /部屋に入る/ })).toBeEnabled();
  });
});

describe('みんなの音', () => {
  test('名前・つくった人・日付（Safari でも読める形で）・もらった人の数・タグを出す', async () => {
    await renderInRoom();
    const taiko = cardFor('みんなの太鼓');
    expect(within(taiko).getByText('はなこ')).toBeInTheDocument();
    // 「2026-05-01 10:00:00」は Safari の new Date では読めず、以前は日付が出なかった
    expect(within(taiko).getByText(new Date(2026, 4, 1).toLocaleDateString('ja-JP'))).toBeInTheDocument();
    expect(within(taiko).getByText('楽器')).toBeInTheDocument();
    expect(within(taiko).queryByText(/人がもらいました/)).not.toBeInTheDocument(); // 0 人のときは出さない
    expect(within(cardFor('カエルの声')).getByText('2人がもらいました')).toBeInTheDocument();
  });

  test('ひらがな・カタカナを区別せずに、名前・タグ・つくった人で探せ、タグで絞り込める', async () => {
    await renderInRoom();
    const search = screen.getByRole('searchbox', { name: /みんなの音を探す/ });
    fireEvent.change(search, { target: { value: 'かえる' } });
    expect(screen.getByText('カエルの声')).toBeInTheDocument();
    expect(screen.queryByText('みんなの太鼓')).not.toBeInTheDocument();
    expect(screen.getByText('1 こ見つかりました（全部で 2 こ）')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'ハナコ' } });
    expect(screen.getByText('みんなの太鼓')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: 'ないもの' } });
    expect(screen.getByText('見つかりませんでした')).toBeInTheDocument();
    fireEvent.change(search, { target: { value: '' } });

    const filters = screen.getByRole('group', { name: /タグで絞り込み/ });
    fireEvent.click(within(filters).getByRole('button', { name: '楽器' }));
    expect(within(filters).getByRole('button', { name: '楽器' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByText('カエルの声')).not.toBeInTheDocument();
    fireEvent.click(within(filters).getByRole('button', { name: '楽器' }));
    expect(screen.getByText('カエルの声')).toBeInTheDocument();
  });

  test('検索欄で Enter を押しても何も送らない（以前は共有のフォームが送られていた）', async () => {
    await renderInRoom();
    const search = screen.getByRole('searchbox', { name: /みんなの音を探す/ });
    expect(search.closest('form')).toBeNull();
    fireEvent.keyDown(search, { key: 'Enter', keyCode: 13 });
    expect(postCount()).toBe(0);
  });

  test('30 秒ごとに読み込み直す。新しい音はすぐには並べず、押してから並べる（押そうとしたボタンがずれない）', async () => {
    const setIntervalSpy = jest.spyOn(window, 'setInterval');
    await renderInRoom();
    await waitFor(() => expect(setIntervalSpy.mock.calls.some(([, ms]) => ms === 30000)).toBe(true));
    const [refresh] = setIntervalSpy.mock.calls.find(([, ms]) => ms === 30000);

    // 画面が隠れている間は読み込まない
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
    const before = listGetCount();
    act(() => refresh());
    expect(listGetCount()).toBe(before);
    delete document.visibilityState;

    responses.list = () => jsonResponse({
      success: true,
      data: [
        { id: '12', uid: 'audio_new', file_name: 'チャイム', student_name: 'さくら', file_size: '10', download_count: '0', upload_date: '2026-05-03 10:00:00', tags: [] },
        { ...FILES.data[0], download_count: '3' },
        FILES.data[1]
      ]
    });
    act(() => refresh());
    const banner = await screen.findByRole('button', { name: /新しい音が 1 こ届きました/ });
    expect(screen.queryByText('チャイム')).not.toBeInTheDocument();
    // 今ある音の「もらった人」の数は新しくする
    expect(within(cardFor('みんなの太鼓')).getByText('3人がもらいました')).toBeInTheDocument();

    // 読み上げにも伝わるよう、お知らせは live region の中に出す
    expect(banner.closest('[role="status"]')).not.toBeNull();

    fireEvent.click(banner);
    expect(screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent)).toEqual(['チャイム', 'みんなの太鼓', 'カエルの声']);
    expect(screen.queryByRole('button', { name: /新しい音が/ })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /みんなの音/ })).toHaveTextContent('3');
    // 押したお知らせが消えても、フォーカスがページの先頭に飛ばず、いちばん新しい音に移る
    await waitFor(() => expect(screen.getByRole('button', { name: 'チャイムをきく' })).toHaveFocus());
  });

  test('部屋に入った直後の読み込みを自動の読み込み直しが追い越して失敗しても、「読み込み中...」のまま止まらない', async () => {
    let resolveFirst;
    responses.list = () => new Promise((resolve) => { resolveFirst = resolve; });
    const addListener = jest.spyOn(document, 'addEventListener');
    storage['sound-library-room'] = '101';
    render(<CloudPage />);
    await screen.findByRole('button', { name: /部屋を出る/ });
    await waitFor(() => expect(addListener).toHaveBeenCalledWith('visibilitychange', expect.any(Function)));
    expect(screen.getByText('読み込み中...', { selector: '.cloud-loading' })).toBeInTheDocument();
    // 画面に戻ってきたときの読み込みが失敗する（オフラインなど）
    responses.list = () => Promise.reject(new TypeError('Failed to fetch'));
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('みんなの音を読み込めませんでした');
    expect(screen.queryByText('読み込み中...', { selector: '.cloud-loading' })).not.toBeInTheDocument();
    // 追い越された最初の読み込みの結果は使わない
    await act(async () => {
      resolveFirst(jsonResponse(FILES));
    });
    expect(screen.queryByText('みんなの太鼓')).not.toBeInTheDocument();
  });

  test('画面に戻ってきたときも読み込み直す', async () => {
    await renderInRoomWithAutoRefresh();
    const before = listGetCount();
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(listGetCount()).toBe(before + 1));
  });

  test('古い読み込みの結果で、新しい一覧を上書きしない', async () => {
    await renderInRoomWithAutoRefresh();
    let resolveSlow;
    responses.list = () => new Promise((resolve) => { resolveSlow = resolve; });
    fireEvent.click(screen.getByRole('button', { name: /最新にする/ }));
    expect(screen.getByRole('button', { name: /読み込み中/ })).toBeDisabled();
    // あとから始まった読み込みが先に終わる
    responses.list = () => jsonResponse({ success: true, data: [FILES.data[1]] });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(screen.queryByText('みんなの太鼓')).not.toBeInTheDocument());
    await act(async () => {
      resolveSlow(jsonResponse(FILES));
    });
    expect(screen.queryByText('みんなの太鼓')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /最新にする/ })).toBeEnabled();
  });

  test('一覧を読み込めなかったら知らせ、「最新にする」で読み込み直せる', async () => {
    responses.list = () => jsonResponse({ success: false, error: 'サーバーエラーが発生しました' }, 500);
    storage['sound-library-room'] = '101';
    render(<CloudPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('みんなの音を読み込めませんでした');
    expect(screen.queryByText(/まだだれも音を共有していません/)).not.toBeInTheDocument();
    responses.list = () => jsonResponse(FILES);
    fireEvent.click(screen.getByRole('button', { name: /最新にする/ }));
    expect(await screen.findByText('みんなの太鼓')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('まだだれも共有していないときは、自分の音を共有する画面へ案内する', async () => {
    responses.list = () => jsonResponse({ success: true, data: [] });
    storage['sound-library-room'] = '101';
    render(<CloudPage />);
    expect(await screen.findByText(/まだだれも音を共有していません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /自分の音を共有する/ }));
    const shareTab = screen.getByRole('tab', { name: /自分の音を共有する/ });
    expect(shareTab).toHaveAttribute('aria-selected', 'true');
    expect(shareTab).toHaveFocus();
    // 共有できる音もまだ無ければ、音あつめへ案内する
    expect(screen.getByRole('link', { name: '音あつめで録音する' })).toHaveAttribute('href', '#/collection');
  });
});

describe('みんなの音を音ライブラリに入れる', () => {
  test('中身に合った形式で IndexedDB に長さと一緒に保存し、ボタンを「入っています」にする', async () => {
    window.OfflineAudioContext = jest.fn(() => ({ decodeAudioData: (buffer, ok) => ok({ duration: 1.5 }) }));
    await renderInRoom();
    fireEvent.click(addButtonFor('みんなの太鼓'));
    expect(await screen.findByText('「みんなの太鼓」を音ライブラリに入れました。音楽づくりで使えます。')).toBeInTheDocument();
    const [saved] = await getAllRecordings();
    expect(saved).toMatchObject({ name: 'みんなの太鼓', cloudUid: 'audio_abc', tags: ['楽器'], source: 'cloud-download', duration: 1.5 });
    expect(saved.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(storage.soundRecordings).toBeUndefined(); // localStorage には保存しない
    expect(within(cardFor('みんなの太鼓')).getByRole('button', { name: '「みんなの太鼓」は音ライブラリに入っています' })).toBeDisabled();
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('すでに音ライブラリにある音は「入っています」と表示し、二重に入れない', async () => {
    await addRecording({ name: 'みんなの太鼓', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), cloudUid: 'audio_abc' });
    await renderInRoom();
    await waitFor(() => expect(within(cardFor('みんなの太鼓')).getByRole('button', { name: /入っています/ })).toBeDisabled());
    expect(addButtonFor('カエルの声')).toBeEnabled();
  });

  test('1 人 1 回で数えるための ID を送る', async () => {
    await renderInRoom();
    fireEvent.click(addButtonFor('カエルの声'));
    await screen.findByText(/「カエルの声」を音ライブラリに入れました/);
    const url = global.fetch.mock.calls.map(([u]) => u).find((u) => u.includes('download.php'));
    expect(url).toMatch(/uid=audio_def&user_id=user_[a-z0-9]+/);
    expect(url).not.toContain('preview');
    expect(storage['user-identifier']).toMatch(/^user_/);
  });

  test('入れている間はほかの「入れる」ボタンを押せない', async () => {
    let resolveDownload;
    responses.download = () => new Promise((resolve) => { resolveDownload = resolve; });
    await renderInRoom();
    fireEvent.click(addButtonFor('みんなの太鼓'));
    expect(within(cardFor('みんなの太鼓')).getByRole('button', { name: /入れています/ })).toBeDisabled();
    expect(addButtonFor('カエルの声')).toBeDisabled();
    await act(async () => {
      resolveDownload(blobResponse(new Blob([makeAudioBytes('mp4', 40)], { type: 'audio/mp4' })));
    });
    await screen.findByText(/「みんなの太鼓」を音ライブラリに入れました/);
    expect(addButtonFor('カエルの声')).toBeEnabled();
  });

  test('入れられなかったら知らせ、何も保存しない', async () => {
    responses.download = () => ({ ok: false, status: 404 });
    await renderInRoom();
    fireEvent.click(addButtonFor('みんなの太鼓'));
    expect(await screen.findByRole('alert')).toHaveTextContent('「みんなの太鼓」を音ライブラリに入れられませんでした');
    expect(await getAllRecordings()).toHaveLength(0);
    expect(addButtonFor('みんなの太鼓')).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'メッセージを閉じる' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('みんなの音をきく', () => {
  test('試し聞きは preview=1 で読み込み、「もらった人」の数に数えない', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓をきく' }));
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    const url = global.fetch.mock.calls.map(([u]) => u).find((u) => u.includes('download.php'));
    expect(url).toBe('/api/download.php?uid=audio_abc&preview=1');
  });

  test('タップ直後に要素の再生許可を取り、ダウンロード後に中身に合った形式で再生する', async () => {
    let resolveDownload;
    responses.download = () => new Promise((resolve) => { resolveDownload = resolve; });
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓をきく' }));

    // ダウンロードを待つ前に（タップの処理中に）無音で play() している（iOS の再生制限対策）
    expect(audioElements).toHaveLength(1);
    const audio = audioElements[0];
    expect(audio.play).toHaveBeenCalledTimes(1);
    expect(audio.src.startsWith('data:audio/wav;base64,')).toBe(true);
    // 読み込み中も「止める」で取り消せる
    expect(screen.getByRole('button', { name: 'みんなの太鼓を止める' })).toBeInTheDocument();

    await act(async () => {
      resolveDownload(blobResponse(new Blob([makeAudioBytes('mp4', 20)], { type: 'audio/wav' })));
    });
    await waitFor(() => expect(audio.play).toHaveBeenCalledTimes(2));
    expect(audio.src).toBe('blob:cloud-1');
    expect(URL.createObjectURL.mock.calls[0][0].type).toBe('audio/mp4');
    expect(screen.getAllByRole('button', { name: /を止める$/ })).toHaveLength(1);
  });

  test('もう一度押すと止め、URL を解放する', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓をきく' }));
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓を止める' }));
    expect(audioElements[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-1');
    expect(screen.getAllByRole('button', { name: /をきく$/ })).toHaveLength(2);
  });

  test('再生が終わったらボタンを戻す', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'カエルの声をきく' }));
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    act(() => {
      audioElements[0].onended();
    });
    expect(screen.getByRole('button', { name: 'カエルの声をきく' })).toBeInTheDocument();
  });

  test('この端末で再生できない音は分かるように知らせる', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓をきく' }));
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    act(() => {
      audioElements[0].onerror();
    });
    expect(screen.getByRole('alert')).toHaveTextContent('「みんなの太鼓」はこの端末では再生できませんでした');
  });

  test('タブを切り替えると、見えなくなる側の再生を止める', async () => {
    await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓をきく' }));
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    openShareTab();
    expect(audioElements[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-1');
  });

  test('ページを離れたら再生を止める', async () => {
    const { unmount } = await renderInRoom();
    fireEvent.click(screen.getByRole('button', { name: 'みんなの太鼓をきく' }));
    await waitFor(() => expect(audioElements[0].play).toHaveBeenCalledTimes(2));
    unmount();
    expect(audioElements[0].pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:cloud-1');
  });
});

describe('自分の音を共有する', () => {
  test('タブは矢印キーで切り替えられ、見えない側は読み上げない', async () => {
    await renderInRoom();
    const listTab = screen.getByRole('tab', { name: /みんなの音/ });
    const shareTab = screen.getByRole('tab', { name: /自分の音を共有する/ });
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'cloud-panel-list');
    listTab.focus();
    fireEvent.keyDown(listTab, { key: 'ArrowRight' });
    expect(shareTab).toHaveAttribute('aria-selected', 'true');
    expect(shareTab).toHaveFocus();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('id', 'cloud-panel-share');
    fireEvent.keyDown(shareTab, { key: 'Home' });
    expect(listTab).toHaveFocus();
    expect(listTab).toHaveAttribute('aria-selected', 'true');
  });

  test('音ライブラリの音を新しい順に出し、「きく」で試し聞きできる', async () => {
    await addRecording({ name: '前の音', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-01T00:00:00Z' });
    await addRecording({ name: '新しい音', tags: ['声'], audioData: makeDataUrl('mp4', 'audio/mp4'), createdAt: '2026-04-02T00:00:00Z', duration: 1.2 });
    await renderInRoom();
    openShareTab();
    const radios = await screen.findAllByRole('radio');
    expect(radios.map((radio) => radio.closest('label').querySelector('.cloud-picker-name').textContent)).toEqual(['新しい音', '前の音']);
    expect(screen.getByText('1.2秒・声')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '新しい音をきく' }));
    expect(audioElements[0].src.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(screen.getByRole('button', { name: '新しい音を止める' })).toBeInTheDocument();
  });

  test('中身に合った形式・拡張子で、名前とタグを付けて共有する（mp4 を .wav として送らない）', async () => {
    await addRecording({ name: 'たいこ/ドン', tags: ['楽器'], audioData: makeDataUrl('mp4', 'audio/wav', 30) });
    let sentForm = null;
    responses.upload = (options) => {
      sentForm = options.body;
      return jsonResponse({ success: true });
    };
    await renderInRoom();
    openShareTab();
    fireEvent.click(await screen.findByRole('radio', { name: /たいこ\/ドン/ }));
    // 音ライブラリでつけた名前とタグが入る
    expect(screen.getByLabelText('共有するときの音の名前')).toHaveValue('たいこ/ドン');
    expect(within(screen.getByRole('list', { name: '付けるタグ' })).getByText('楽器')).toBeInTheDocument();
    expect(screen.getByText('たいこ/ドン', { selector: 'strong' })).toBeInTheDocument(); // ボタンの近くに選んだ音を出す

    fireEvent.change(screen.getByLabelText(/あなたの名前/), { target: { value: 'たろう' } });
    const tagInput = screen.getByRole('textbox', { name: 'タグ' });
    fireEvent.change(tagInput, { target: { value: 'ドン' } });
    fireEvent.keyDown(tagInput, { key: 'Enter', keyCode: 13 });
    expect(postCount()).toBe(0); // タグの Enter では共有しない
    fireEvent.click(shareButton());
    expect(await screen.findByText('「たいこ/ドン」をみんなに共有しました！')).toBeInTheDocument();

    const file = sentForm.get('audio_file');
    expect(file.name).toBe('たいこ_ドン.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(readBlobBytes(file).length).toBe(46);
    expect(sentForm.get('room_id')).toBe('3');
    expect(sentForm.get('room_number')).toBe('101');
    expect(sentForm.get('file_name')).toBe('たいこ/ドン');
    expect(sentForm.get('student_name')).toBe('たろう');
    expect(JSON.parse(sentForm.get('tags'))).toEqual(['楽器', 'ドン']);

    // 名前は覚えておき、選んだ音は外す。みんなの音を読み込み直す
    expect(storage['sound-library-student-name']).toBe('たろう');
    expect(screen.getByRole('radio', { name: /たいこ\/ドン/ })).not.toBeChecked();
    expect(screen.getByText('まだ音をえらんでいません')).toBeInTheDocument();
    await waitFor(() => expect(listGetCount()).toBe(2));
    expect(window.alert).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: /みんなの音を見る/ }));
    expect(screen.getByRole('tab', { name: /みんなの音/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('共有するときの名前を変えられる', async () => {
    await addRecording({ name: 'ろくおん1', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
    let sentForm = null;
    responses.upload = (options) => {
      sentForm = options.body;
      return jsonResponse({ success: true });
    };
    await renderInRoom();
    openShareTab();
    fireEvent.click(await screen.findByRole('radio', { name: /ろくおん1/ }));
    fireEvent.change(screen.getByLabelText('共有するときの音の名前'), { target: { value: '  ドアの音  ' } });
    fireEvent.click(shareButton());
    await screen.findByText('「ドアの音」をみんなに共有しました！');
    expect(sentForm.get('file_name')).toBe('ドアの音');
    expect(sentForm.get('audio_file').name).toBe('ドアの音.wav');
  });

  test('前に入力した名前を最初から入れておく（「先生に送る」と共通）', async () => {
    storage['sound-library-student-name'] = 'はなこ';
    await renderInRoom();
    openShareTab();
    expect(screen.getByLabelText(/あなたの名前/)).toHaveValue('はなこ');
  });

  test('音を選ばずに共有しようとすると知らせる', async () => {
    await renderInRoom();
    openShareTab();
    fireEvent.click(shareButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('共有する音をえらんでください');
    expect(postCount()).toBe(0);
  });

  test('サーバーのエラーメッセージを表示し、選んだ音はそのまま', async () => {
    await addRecording({ name: 'x', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
    responses.upload = () => jsonResponse({ success: false, error: 'サポートされていないファイル形式です' }, 400);
    await renderInRoom();
    openShareTab();
    fireEvent.click(await screen.findByRole('radio', { name: 'x' }));
    fireEvent.click(shareButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('サポートされていないファイル形式です');
    expect(screen.getByRole('radio', { name: 'x' })).toBeChecked();
    expect(shareButton()).toBeEnabled();
  });

  test('大きすぎる音は送らずに知らせる（サーバーの上限は 20MB）', async () => {
    await addRecording({ name: '長い録音', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
    await renderInRoom();
    openShareTab();
    fireEvent.click(await screen.findByRole('radio', { name: /長い録音/ }));
    jest.spyOn(audioUtils, 'dataUrlToBlob').mockReturnValue({ size: 21 * 1024 * 1024, type: 'audio/wav' });
    fireEvent.click(shareButton());
    expect(await screen.findByRole('alert')).toHaveTextContent('大きすぎて共有できません（20MB まで）');
    expect(postCount()).toBe(0);
  });

  test('名前の欄で「次へ」（Enter）を押すと、次の欄へ移る', async () => {
    await renderInRoom();
    openShareTab();
    const name = screen.getByLabelText('共有するときの音の名前');
    const student = screen.getByLabelText(/あなたの名前/);
    name.focus();
    fireEvent.keyDown(name, { key: 'Enter', keyCode: 13 });
    expect(student).toHaveFocus();
    fireEvent.keyDown(student, { key: 'Enter', keyCode: 13 });
    expect(screen.getByRole('textbox', { name: 'タグ' })).toHaveFocus();
    expect(postCount()).toBe(0);
  });

  test('入力欄の Enter では共有しない（日本語入力の確定の Enter はそのまま通す）', async () => {
    await renderInRoom();
    openShareTab();
    ['共有するときの音の名前', /あなたの名前/].forEach((label) => {
      const input = screen.getByLabelText(label);
      const enter = createEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
      fireEvent(input, enter);
      expect(enter.defaultPrevented).toBe(true);
      const imeEnter = createEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
      fireEvent(input, imeEnter);
      expect(imeEnter.defaultPrevented).toBe(false);
    });
  });

  test('タグは 10 こまで（サーバーと同じ）', async () => {
    await addRecording({ name: 'たくさん', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
    await renderInRoom();
    openShareTab();
    fireEvent.click(await screen.findByRole('radio', { name: /たくさん/ }));
    const tagInput = screen.getByRole('textbox', { name: 'タグ' });
    for (let i = 1; i <= 11; i++) {
      fireEvent.change(tagInput, { target: { value: `タグ${i}` } });
      fireEvent.click(screen.getByRole('button', { name: /追加/ }));
    }
    expect(within(screen.getByRole('list', { name: '付けるタグ' })).getAllByRole('listitem')).toHaveLength(10);
    expect(screen.getByRole('alert')).toHaveTextContent('タグは 10 こまでです');
    fireEvent.click(screen.getByRole('button', { name: 'タグ「タグ1」を外す' }));
    expect(within(screen.getByRole('list', { name: '付けるタグ' })).getAllByRole('listitem')).toHaveLength(9);
  });
});
