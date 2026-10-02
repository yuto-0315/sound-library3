import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import AdminPage from '../pages/AdminPage';
import { getSongData } from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';

const ROOMS = { success: true, data: [{ id: 3, room_number: 101, room_name: '1年1組', teacher_name: '山田', created_at: '2026-04-01' }] };
const AUDIO = { success: true, data: [{ id: 1, uid: 'audio_x', file_name: '太鼓', file_size: 2048, download_count: 0, upload_date: '2026-04-02', tags: null }] };
const songData = { version: '2.0', pixelsPerSecond: 100, tracks: [{ id: 1, name: 'トラック 1', clips: [] }], assets: {} };
const SONGS = {
  success: true,
  data: [
    // 以前のサーバーは小さな楽曲のデータを一覧に含めていた
    { id: 1, uid: 'song_small', song_title: '小さな曲', student_name: 'はなこ', group_number: '1', song_data: songData, data_omitted: false, song_data_size: 100, created_at: '2026-04-03', updated_at: '2026-04-03' },
    { id: 2, uid: 'song_big', song_title: '大きな曲', student_name: 'たろう', group_number: '2', song_data: null, data_omitted: true, song_data_size: 5000000, created_at: '2026-04-03', updated_at: '2026-04-03' }
  ]
};

const json = (data, status = 200) => ({
  ok: status < 400,
  status,
  json: () => Promise.resolve(data),
  text: () => Promise.resolve(JSON.stringify(data))
});

let newWindow;
let responses;

beforeEach(() => {
  installFakeIndexedDB();
  installMemoryLocalStorage();
  sessionStorage.clear();
  responses = {
    rooms: () => json(ROOMS),
    audio: () => json(AUDIO),
    songs: () => json(SONGS),
    status: () => json({ success: true, data: { pin: 'on', pin_min_length: 6 } })
  };
  global.fetch = jest.fn((url) => {
    if (url.includes('admin_status.php')) return Promise.resolve(responses.status());
    if (url.includes('rooms.php')) return Promise.resolve(responses.rooms());
    if (url.includes('audio.php')) return Promise.resolve(responses.audio());
    if (url.includes('songs.php?uid=song_big')) return Promise.resolve(json({ success: true, data: { song_data: { ...songData, tracks: [{ id: 9, name: 'big', clips: [] }] } } }));
    if (url.includes('songs.php')) return Promise.resolve(responses.songs());
    return Promise.reject(new Error(url));
  });
  newWindow = { closed: false, close: jest.fn(), location: { href: '' }, document: { title: '', body: { textContent: '' } } };
  window.open = jest.fn(() => newWindow);
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

const openRoom = async () => {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '部屋 101 を開く' }));
  // 部屋を開くと「生徒の楽曲」のタブに切り替わる
  await waitFor(() => expect(screen.getByRole('tab', { name: /生徒の楽曲 \(2\)/ })).toHaveAttribute('aria-selected', 'true'));
};

const openButtons = () => screen.getAllByRole('button', { name: /を音楽づくりで開く/ });

test('部屋を開くと生徒の楽曲のタブに切り替わり、開いている部屋が分かる', async () => {
  await openRoom();
  expect(document.querySelector('.admin-selected-room')).toHaveTextContent('開いている部屋: 部屋 101 1年1組');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('小さな曲');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('作った人: はなこ');
});

test('「音楽づくりで開く」はデータの準備を待つ前にタブを開く（iPad のポップアップブロック対策）', async () => {
  await openRoom();
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  global.fetch.mockImplementationOnce(() => pending.then(() => json({ success: true, data: { song_data: songData } })));
  fireEvent.click(openButtons()[1]);
  expect(window.open).toHaveBeenCalledWith('', '_blank'); // クリックの処理中に同期的に開く
  expect(newWindow.location.href).toBe('');
  await act(async () => {
    resolveSave();
  });
  await waitFor(() => expect(newWindow.location.href).toMatch(/#\/daw$/));
  await expect(getSongData()).resolves.toEqual(songData);
});

test('一覧に含まれている楽曲（以前のサーバー）はそのまま保存して開く', async () => {
  await openRoom();
  fireEvent.click(openButtons()[0]);
  await waitFor(() => expect(newWindow.location.href).toMatch(/#\/daw$/));
  await expect(getSongData()).resolves.toEqual(songData);
  expect(global.fetch.mock.calls.some(([url]) => url.includes('uid=song_small'))).toBe(false);
});

test('一覧に中身が無い楽曲は個別に取得してから開く', async () => {
  await openRoom();
  fireEvent.click(openButtons()[1]);
  await waitFor(() => expect(newWindow.location.href).toMatch(/#\/daw$/));
  const saved = await getSongData();
  expect(saved.tracks[0].name).toBe('big');
});

test('タブを開けなかったときは同じタブで音楽づくりページを開く', async () => {
  window.open = jest.fn(() => null);
  await openRoom();
  fireEvent.click(openButtons()[0]);
  await waitFor(() => expect(window.location.hash).toBe('#/daw'));
  window.location.hash = '';
});

test('壊れた楽曲データは開かずにページ内で知らせ、開いたタブを閉じる', async () => {
  await openRoom();
  global.fetch.mockImplementationOnce(() => Promise.resolve(json({ success: true, data: { song_data: { broken: true } } })));
  fireEvent.click(openButtons()[1]);
  expect(await screen.findByRole('alert')).toHaveTextContent('楽曲データが壊れています');
  expect(newWindow.close).toHaveBeenCalled();
  expect(window.alert).not.toHaveBeenCalled();
  await expect(getSongData()).resolves.toBeNull();
});

test('共有された音の一覧を開いただけでは全ファイルをダウンロードしない', async () => {
  await openRoom();
  fireEvent.click(screen.getByRole('tab', { name: /共有された音 \(1\)/ }));
  const audio = document.querySelector('.audio-section audio');
  expect(audio.getAttribute('preload')).toBe('none');
  // 共有された音の一覧は、部屋の ID と部屋番号の両方を送って読み込む
  expect(global.fetch.mock.calls.map(([url]) => url)).toContain('/api/audio.php?room_id=3&room_number=101');
  // 先生が聞いただけでは、生徒の音の「もらった人」の数に数えない
  expect(audio.getAttribute('src')).toBe('/api/download.php?uid=audio_x&preview=1');
  expect(screen.getByText('太鼓')).toBeInTheDocument(); // tags が null でも表示できる
});

test('楽曲の読み込みに失敗しても、共有された音の一覧は表示する', async () => {
  responses.songs = () => json({ success: false, error: 'サーバーエラーが発生しました' }, 500);
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '部屋 101 を開く' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('生徒の楽曲を読み込めませんでした');
  // 「まだありません」「(0)」ではなく、読み込めなかったと出す
  const songsTab = screen.getByRole('tab', { name: /生徒の楽曲/ });
  expect(songsTab).not.toHaveTextContent('(0)');
  expect(screen.getByRole('tabpanel')).toHaveTextContent('生徒の楽曲を読み込めませんでした。上の「読み込み直す」を押してください。');
  expect(screen.queryByText('この部屋に送られた楽曲はまだありません')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('tab', { name: /共有された音 \(1\)/ }));
  expect(screen.getByText('太鼓')).toBeInTheDocument();
});

test('「読み込み直す」では、見ていたタブのままにする', async () => {
  await openRoom();
  fireEvent.click(screen.getByRole('tab', { name: /共有された音/ }));
  fireEvent.click(screen.getByRole('button', { name: /読み込み直す/ }));
  await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());
  expect(screen.getByRole('tab', { name: /共有された音/ })).toHaveAttribute('aria-selected', 'true');
});

test('文字列でないタグや名前が届いても画面が止まらない', async () => {
  responses.audio = () => json({ success: true, data: [{ id: 1, uid: 'audio_y', file_name: { bad: true }, tags: [{}, 12, ' 楽器 ', null], file_size: 10, upload_date: '2026-04-02' }] });
  await openRoom();
  fireEvent.click(screen.getByRole('tab', { name: /共有された音 \(1\)/ }));
  const panel = screen.getByRole('tabpanel');
  expect(within(panel).getByText('名前のない音')).toBeInTheDocument();
  expect(within(panel).getByText('12')).toBeInTheDocument();
  expect(within(panel).getByText('楽器')).toBeInTheDocument();
});

test('先生用の暗証番号を入力すると、サーバーへの要求に付けて送る', async () => {
  render(<AdminPage />);
  await screen.findByRole('button', { name: '部屋 101 を開く' });
  fireEvent.change(screen.getByLabelText(/先生用の暗証番号/), { target: { value: ' ongaku2026 ' } });
  fireEvent.click(screen.getByRole('button', { name: '入力' }));
  expect(document.querySelector('.admin-message-region')).toHaveTextContent('暗証番号を入力しました');
  expect(sessionStorage.getItem('sound-library-admin-pin')).toBe('ongaku2026');
  await screen.findByRole('button', { name: '部屋 101 を削除' });

  fireEvent.click(screen.getByRole('button', { name: '部屋 101 を削除' }));
  await waitFor(() => {
    const call = global.fetch.mock.calls.find(([url, options]) => url.includes('rooms.php?id=3') && options && options.method === 'DELETE');
    expect(call[1].headers['X-Admin-Pin']).toBe('ongaku2026');
  });
});

test('全角で入れた暗証番号は半角にして送り、日本語の暗証番号は送らずに知らせる', async () => {
  render(<AdminPage />);
  await screen.findByRole('button', { name: '部屋 101 を開く' });
  const pinInput = screen.getByLabelText(/先生用の暗証番号/);
  // ブラウザは日本語を HTTP ヘッダーで送れず、以前はすべての読み込みが失敗していた
  fireEvent.change(pinInput, { target: { value: 'さくら' } });
  fireEvent.click(screen.getByRole('button', { name: '入力' }));
  expect(screen.getByRole('alert')).toHaveTextContent('暗証番号は半角の英数字・記号で入力してください');
  expect(sessionStorage.getItem('sound-library-admin-pin')).toBeNull();

  fireEvent.change(pinInput, { target: { value: '１２３４５６' } });
  fireEvent.click(screen.getByRole('button', { name: '入力' }));
  expect(sessionStorage.getItem('sound-library-admin-pin')).toBe('123456');
  expect(pinInput).toHaveValue('123456');
  // 暗証番号を入れ直したら、部屋の一覧も読み込み直す（暗証番号を付けて）
  await waitFor(() => {
    const roomsCalls = global.fetch.mock.calls.filter(([url]) => url === '/api/rooms.php');
    expect(roomsCalls[roomsCalls.length - 1][1].headers['X-Admin-Pin']).toBe('123456');
  });
});

test('前に保存された暗証番号が送れない文字なら使わない（すべての読み込みが失敗しないように）', async () => {
  sessionStorage.setItem('sound-library-admin-pin', 'さくら');
  render(<AdminPage />);
  await screen.findByRole('button', { name: '部屋 101 を開く' });
  const [, options] = global.fetch.mock.calls.find(([url]) => url === '/api/rooms.php');
  expect(options.headers['X-Admin-Pin']).toBeUndefined();
});

test('暗証番号を入れていないときに部屋の一覧を断られたら、入力する場所を案内する', async () => {
  responses.rooms = () => json({ success: false, error: '先生用の暗証番号が違います' }, 401);
  render(<AdminPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('先生用の暗証番号が違います。右上の「先生用の暗証番号」に入力してください。');
});

test('サーバーで暗証番号を設定していなければ、誰でも削除できることを知らせる', async () => {
  responses.status = () => json({ success: true, data: { pin: 'off' } });
  render(<AdminPage />);
  expect(await screen.findByText(/暗証番号が設定されていません/)).toBeInTheDocument();
});

test('サーバーの暗証番号の設定が使えない値なら知らせる', async () => {
  responses.status = () => json({ success: true, data: { pin: 'invalid' } });
  render(<AdminPage />);
  expect(await screen.findByRole('alert')).toHaveTextContent('サーバーの暗証番号の設定が正しくありません');
});

test('暗証番号が設定されていれば、注意は出さない（古いサーバーで分からないときも出さない）', async () => {
  render(<AdminPage />);
  await screen.findByRole('button', { name: '部屋 101 を開く' });
  expect(screen.queryByText(/暗証番号が設定されていません/)).not.toBeInTheDocument();
});

test('暗証番号が違うときはサーバーのメッセージを表示する', async () => {
  render(<AdminPage />);
  await screen.findByRole('button', { name: '部屋 101 を開く' });
  global.fetch.mockImplementationOnce(() => Promise.resolve(json({ success: false, error: '先生用の暗証番号が違います' }, 401)));
  fireEvent.click(screen.getByRole('button', { name: '部屋 101 を削除' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('先生用の暗証番号が違います');
});

test('部屋を作成すると一覧を読み込み直し、ページ内で知らせる', async () => {
  render(<AdminPage />);
  await screen.findByRole('button', { name: '部屋 101 を開く' });
  global.fetch.mockImplementationOnce(() => Promise.resolve(json({ success: true, data: { id: 4, room_number: 102 } })));
  fireEvent.change(screen.getByLabelText(/部屋番号/), { target: { value: '1a02' } });
  expect(screen.getByLabelText(/部屋番号/)).toHaveValue('102'); // 数字だけ入力できる
  fireEvent.change(screen.getByLabelText(/部屋番号/), { target: { value: '１０２' } });
  expect(screen.getByLabelText(/部屋番号/)).toHaveValue('102'); // 全角の数字も使える
  fireEvent.click(screen.getByRole('button', { name: /部屋を作成/ }));
  expect(await screen.findByText('部屋 102 を作成しました。')).toBeInTheDocument();
  expect(window.alert).not.toHaveBeenCalled();
});

test('タブは矢印キーで切り替えられる', async () => {
  await openRoom();
  const songsTab = screen.getByRole('tab', { name: /生徒の楽曲/ });
  songsTab.focus();
  fireEvent.keyDown(songsTab, { key: 'ArrowRight' });
  const audioTab = screen.getByRole('tab', { name: /共有された音/ });
  expect(audioTab).toHaveAttribute('aria-selected', 'true');
  expect(audioTab).toHaveFocus();
  fireEvent.keyDown(audioTab, { key: 'Home' });
  expect(screen.getByRole('tab', { name: /部屋の管理/ })).toHaveFocus();
});
