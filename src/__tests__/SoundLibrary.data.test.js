import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SoundLibrary from '../pages/SoundLibrary';
import * as db from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { makeDataUrl } from '../test-utils/audioFixtures';

let idb;
let storage;

beforeEach(() => {
  idb = installFakeIndexedDB();
  storage = installMemoryLocalStorage();
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const seed = async () => {
  await db.addRecording({ name: 'たいこ', tags: ['楽器'], audioData: makeDataUrl('mp4', 'audio/wav'), createdAt: '2026-04-01T00:00:00Z' });
  await db.addRecording({ name: '雨の音', tags: ['自然'], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-02T00:00:00Z' });
  await db.addRecording({ name: '鳥の声', tags: ['自然', '動物'], audioData: makeDataUrl('webm', 'audio/webm'), createdAt: '2026-04-03T00:00:00Z' });
};

const cards = () => Array.from(document.querySelectorAll('.library-sound-card'));
const cardNames = () => cards().map((card) => card.querySelector('h4').textContent);
const cardFor = (name) => cards().find((card) => card.querySelector('h4').textContent === name);

const renderLibrary = async () => {
  const utils = render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());
  return utils;
};

test('IndexedDB の音素材とタグを表示する', async () => {
  await seed();
  await renderLibrary();
  expect(cardNames()).toEqual(['たいこ', '雨の音', '鳥の声']);
  const stats = document.querySelector('.library-stats');
  expect(within(stats).getAllByText('3')).toHaveLength(3); // 総数・表示中・タグ数（楽器/自然/動物）
  expect(within(document.querySelector('.tag-filters')).getByRole('button', { name: '動物' })).toBeInTheDocument();
});

test('<audio> には中身に合った MIME の Data URL を渡し、一覧を開いただけで全部読み込まない', async () => {
  await seed();
  await renderLibrary();
  const audio = cardFor('たいこ').querySelector('audio');
  expect(audio.getAttribute('src').startsWith('data:audio/mp4;base64,')).toBe(true);
  expect(audio.getAttribute('preload')).toBe('metadata');
});

test('名前とタグで検索、タグで絞り込み、クリアできる', async () => {
  await seed();
  await renderLibrary();
  fireEvent.change(screen.getByPlaceholderText(/音の名前やタグで検索/), { target: { value: '動物' } });
  expect(cardNames()).toEqual(['鳥の声']);
  fireEvent.click(screen.getByRole('button', { name: /フィルターをクリア/ }));
  expect(cardNames()).toHaveLength(3);
  fireEvent.click(within(document.querySelector('.tag-filters')).getByRole('button', { name: '自然' }));
  expect(cardNames()).toEqual(['雨の音', '鳥の声']);
  fireEvent.change(screen.getByPlaceholderText(/音の名前やタグで検索/), { target: { value: '存在しない' } });
  expect(screen.getByText(/検索条件に合う音が見つかりませんでした/)).toBeInTheDocument();
});

test('削除すると一覧と IndexedDB から消える（全件を読み込み直さない）', async () => {
  await seed();
  const getAll = jest.spyOn(db, 'getAllRecordings');
  await renderLibrary();
  const card = cardFor('雨の音');
  fireEvent.click(within(card).getByTitle('削除'));
  fireEvent.click(within(card).getByRole('button', { name: '削除する' }));
  await waitFor(() => expect(cardNames()).toEqual(['たいこ', '鳥の声']));
  expect((await db.getAllRecordings()).map((r) => r.name)).toEqual(['たいこ', '鳥の声']);
  expect(getAll).toHaveBeenCalledTimes(2); // 画面の初回読み込み + このテストでの確認
});

test('削除の確認でキャンセルできる', async () => {
  await seed();
  await renderLibrary();
  const card = cardFor('たいこ');
  fireEvent.click(within(card).getByTitle('削除'));
  fireEvent.click(within(card).getByRole('button', { name: 'キャンセル' }));
  expect(cardNames()).toHaveLength(3);
});

test('タグを追加・削除できる。日本語変換の確定 Enter では追加しない', async () => {
  await seed();
  await renderLibrary();
  const card = cardFor('たいこ');
  fireEvent.click(within(card).getByTitle('タグを編集'));
  const input = within(card).getByPlaceholderText('新しいタグを入力...');
  fireEvent.change(input, { target: { value: 'たたく' } });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  expect(within(card).queryByText('たたく')).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
  await waitFor(() => expect(within(cardFor('たいこ')).getByText('たたく')).toBeInTheDocument());
  expect((await db.getAllRecordings()).find((r) => r.name === 'たいこ').tags).toEqual(['楽器', 'たたく']);

  fireEvent.click(within(cardFor('たいこ')).getAllByTitle('タグを削除')[0]);
  await waitFor(() => expect(within(cardFor('たいこ')).queryByText('楽器')).not.toBeInTheDocument());
  expect((await db.getAllRecordings()).find((r) => r.name === 'たいこ').tags).toEqual(['たたく']);
});

test('絞り込み中のタグが無くなったら「すべて」に戻す', async () => {
  await db.addRecording({ name: 'ひとつだけ', tags: ['めずらしい'], audioData: makeDataUrl('wav', 'audio/wav') });
  await db.addRecording({ name: 'ほか', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
  await renderLibrary();
  fireEvent.click(within(document.querySelector('.tag-filters')).getByRole('button', { name: 'めずらしい' }));
  expect(cardNames()).toEqual(['ひとつだけ']);
  const card = cardFor('ひとつだけ');
  fireEvent.click(within(card).getByTitle('タグを編集'));
  fireEvent.click(within(card).getByTitle('タグを削除'));
  await waitFor(() => expect(cardNames()).toEqual(['ひとつだけ', 'ほか']));
});

test('旧 localStorage の音素材を移行して表示する', async () => {
  storage.soundRecordings = JSON.stringify([{ id: 1, name: '昔の録音', tags: [], audioData: makeDataUrl('mp4', 'audio/wav'), createdAt: '2025-01-01T00:00:00Z' }]);
  await renderLibrary();
  expect(cardNames()).toEqual(['昔の録音']);
  expect(storage.soundRecordings).toBeUndefined();
});

test('読み込みに失敗したら「音素材がありません」ではなくエラーを表示し、再読み込みできる', async () => {
  await seed();
  idb.openFailure = new Error('broken');
  await renderLibrary();
  expect(screen.getByRole('alert')).toHaveTextContent('音素材を読み込めませんでした');
  expect(screen.queryByText(/まだ音素材がありません/)).not.toBeInTheDocument();
  idb.openFailure = null;
  fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }));
  await waitFor(() => expect(cardNames()).toHaveLength(3));
});

test('音素材が無ければ案内を表示する', async () => {
  await renderLibrary();
  expect(screen.getByText(/まだ音素材がありません/)).toBeInTheDocument();
});

test('カードはドラッグさせず（別ページには置けないため）、音楽づくりページでの使い方を案内する', async () => {
  await seed();
  render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
  await waitFor(() => expect(cards()).toHaveLength(3));
  const card = cardFor('たいこ');
  expect(card).not.toHaveAttribute('draggable');
  expect(within(card).queryByText(/ドラッグ&ドロップできます/)).not.toBeInTheDocument();
  expect(within(card).getByRole('link', { name: '音楽づくり' })).toHaveAttribute('href', '/daw');
});

test('タグ編集・削除ボタンには音の名前付きの読み上げ用ラベルがある', async () => {
  await seed();
  await renderLibrary();
  expect(screen.getByRole('button', { name: 'たいこのタグを編集' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: '雨の音を削除' })).toBeInTheDocument();
});

test('削除に失敗したら知らせて一覧は残す', async () => {
  await seed();
  await renderLibrary();
  idb.failNextCommit(new Error('write failed'), (tx) => tx.mode === 'readwrite');
  const card = cardFor('たいこ');
  fireEvent.click(within(card).getByTitle('削除'));
  fireEvent.click(within(card).getByRole('button', { name: '削除する' }));
  await waitFor(() => expect(window.alert).toHaveBeenCalledWith('音素材の削除に失敗しました。'));
  expect(cardNames()).toHaveLength(3);
});
