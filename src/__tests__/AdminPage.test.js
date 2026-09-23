import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
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
    { id: 1, uid: 'song_small', song_title: '小さな曲', student_name: 'はなこ', group_number: '1', song_data: songData, data_omitted: false, song_data_size: 100, created_at: '2026-04-03', updated_at: '2026-04-03' },
    { id: 2, uid: 'song_big', song_title: '大きな曲', student_name: 'たろう', group_number: '2', song_data: null, data_omitted: true, song_data_size: 5000000, created_at: '2026-04-03', updated_at: '2026-04-03' }
  ]
};

const json = (data) => ({ ok: true, status: 200, json: () => Promise.resolve(data), text: () => Promise.resolve(JSON.stringify(data)) });

let newWindow;

beforeEach(() => {
  installFakeIndexedDB();
  installMemoryLocalStorage();
  global.fetch = jest.fn((url) => {
    if (url.includes('rooms.php')) return Promise.resolve(json(ROOMS));
    if (url.includes('audio.php')) return Promise.resolve(json(AUDIO));
    if (url.includes('songs.php?uid=song_big')) return Promise.resolve(json({ success: true, data: { song_data: { ...songData, tracks: [{ id: 9, name: 'big', clips: [] }] } } }));
    if (url.includes('songs.php')) return Promise.resolve(json(SONGS));
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

const openSongsTab = async () => {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '管理' }));
  fireEvent.click(await screen.findByRole('button', { name: /生徒の楽曲 \(2\)/ }));
};

test('「DAWで開く」はデータの準備を待つ前にタブを開く（iPad のポップアップブロック対策）', async () => {
  await openSongsTab();
  let resolveSave;
  const pending = new Promise((resolve) => { resolveSave = resolve; });
  global.fetch.mockImplementationOnce(() => pending.then(() => json({ success: true, data: { song_data: songData } })));
  fireEvent.click(screen.getAllByRole('button', { name: 'DAWで開く' })[1]);
  expect(window.open).toHaveBeenCalledWith('', '_blank'); // クリックの処理中に同期的に開く
  expect(newWindow.location.href).toBe('');
  await act(async () => {
    resolveSave();
  });
  await waitFor(() => expect(newWindow.location.href).toMatch(/#\/daw$/));
  await expect(getSongData()).resolves.toEqual(songData);
});

test('一覧に含まれている楽曲はそのまま保存して開く', async () => {
  await openSongsTab();
  fireEvent.click(screen.getAllByRole('button', { name: 'DAWで開く' })[0]);
  await waitFor(() => expect(newWindow.location.href).toMatch(/#\/daw$/));
  await expect(getSongData()).resolves.toEqual(songData);
  expect(global.fetch.mock.calls.some(([url]) => url.includes('uid=song_small'))).toBe(false);
});

test('大きな楽曲は個別に取得してから開く', async () => {
  await openSongsTab();
  fireEvent.click(screen.getAllByRole('button', { name: 'DAWで開く' })[1]);
  await waitFor(() => expect(newWindow.location.href).toMatch(/#\/daw$/));
  const saved = await getSongData();
  expect(saved.tracks[0].name).toBe('big');
});

test('タブを開けなかったときは同じタブで DAW を開く', async () => {
  window.open = jest.fn(() => null);
  await openSongsTab();
  fireEvent.click(screen.getAllByRole('button', { name: 'DAWで開く' })[0]);
  await waitFor(() => expect(window.location.hash).toBe('#/daw'));
  window.location.hash = '';
});

test('壊れた楽曲データは開かずに知らせ、開いたタブを閉じる', async () => {
  await openSongsTab();
  global.fetch.mockImplementationOnce(() => Promise.resolve(json({ success: true, data: { song_data: { broken: true } } })));
  fireEvent.click(screen.getAllByRole('button', { name: 'DAWで開く' })[1]);
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('楽曲データが壊れています')));
  expect(newWindow.close).toHaveBeenCalled();
  await expect(getSongData()).resolves.toBeNull();
});

test('音声ファイルの一覧を開いただけでは全ファイルをダウンロードしない', async () => {
  render(<AdminPage />);
  fireEvent.click(await screen.findByRole('button', { name: '管理' }));
  fireEvent.click(await screen.findByRole('button', { name: /音声ファイル \(1\)/ }));
  const audio = document.querySelector('.audio-section audio');
  expect(audio.getAttribute('preload')).toBe('none');
  expect(audio.getAttribute('src')).toBe('/api/download.php?uid=audio_x&user_id=teacher-admin');
  expect(screen.getByText('太鼓')).toBeInTheDocument(); // tags が null でも表示できる
});
