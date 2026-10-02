import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import SoundLibrary from '../pages/SoundLibrary';
import * as db from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, makeDataUrl } from '../test-utils/audioFixtures';

let idb;
let storage;

beforeEach(() => {
  idb = installFakeIndexedDB();
  storage = installMemoryLocalStorage();
  global.FileReader = TestFileReader;
  window.alert = jest.fn();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  delete window.OfflineAudioContext;
  jest.restoreAllMocks();
});

const seed = async () => {
  await db.addRecording({ name: 'たいこ', tags: ['楽器'], audioData: makeDataUrl('mp4', 'audio/wav'), createdAt: '2026-04-01T00:00:00Z' });
  await db.addRecording({ name: '雨の音', tags: ['自然'], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-02T00:00:00Z' });
  await db.addRecording({ name: '鳥の声', tags: ['自然', '動物'], audioData: makeDataUrl('webm', 'audio/webm'), createdAt: '2026-04-03T00:00:00Z' });
};

const cards = () => Array.from(document.querySelectorAll('.library-sound-card'));
const cardNames = () => cards().map((card) => card.querySelector('h4').textContent);
const cardFor = (name) => cards().find((card) => card.querySelector('h4') && card.querySelector('h4').textContent === name);
const tagFilters = () => document.querySelector('.tag-filters');

const renderLibrary = async () => {
  const utils = render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());
  return utils;
};

const confirmDelete = (name) => {
  fireEvent.click(within(cardFor(name)).getByTitle('削除'));
  return screen.getByRole('dialog', { name: '削除の確認' });
};

test('IndexedDB の音素材を新しい順に表示し、タグで絞り込める', async () => {
  await seed();
  await renderLibrary();
  expect(cardNames()).toEqual(['鳥の声', '雨の音', 'たいこ']);
  expect(screen.getByText('全部で 3 こ')).toBeInTheDocument();
  expect(within(tagFilters()).getByRole('button', { name: '動物' })).toBeInTheDocument();
});

test('ならべかたを「古い順」「名前順」に変えられる', async () => {
  await seed();
  await renderLibrary();
  fireEvent.change(screen.getByRole('combobox', { name: 'ならべかた' }), { target: { value: 'oldest' } });
  expect(cardNames()).toEqual(['たいこ', '雨の音', '鳥の声']);
  fireEvent.change(screen.getByRole('combobox', { name: 'ならべかた' }), { target: { value: 'name' } });
  expect(cardNames()).toEqual(['たいこ', '鳥の声', '雨の音'].sort((a, b) => a.localeCompare(b, 'ja')));
});

test('ならべかた「タグごと」（仕様の「タグごとにソート」）: タグの見出しごとにまとめ、次に開いたときも同じならべかたにする', async () => {
  await seed();
  await db.addRecording({ name: 'なにもなし', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-04T00:00:00Z' });
  const { unmount } = await renderLibrary();
  fireEvent.change(screen.getByRole('combobox', { name: 'ならべかた' }), { target: { value: 'tag' } });

  const groupTitles = () => Array.from(document.querySelectorAll('.sound-group-title')).map((h) => h.textContent.trim());
  const namesIn = (title) => Array.from(screen.getByRole('region', { name: new RegExp(`^${title} \\d+ こ$`) }).querySelectorAll('h4'))
    .map((h) => h.textContent);
  const sortedTags = ['楽器', '自然', '動物'].sort((a, b) => a.localeCompare(b, 'ja'));
  const counts = { 楽器: 1, 自然: 2, 動物: 1 };
  // タグの無い音は最後の「タグなし」にまとめる
  expect(groupTitles()).toEqual([...sortedTags.map((tag) => `${tag} ${counts[tag]} こ`), 'タグなし 1 こ']);
  // タグが 2 つある「鳥の声」は両方に出る。見出しの中は新しい順
  expect(namesIn('自然')).toEqual(['鳥の声', '雨の音']);
  expect(namesIn('動物')).toEqual(['鳥の声']);
  expect(namesIn('タグなし')).toEqual(['なにもなし']);
  // 全体の数は重ねて数えない
  expect(screen.getByText('全部で 4 こ')).toBeInTheDocument();

  // タグで絞り込むと、その見出しだけになる
  fireEvent.click(within(tagFilters()).getByRole('button', { name: '自然' }));
  expect(groupTitles()).toEqual(['自然 2 こ']);

  // 同じ音が 2 か所に出ても、入力欄の id は重ならない
  fireEvent.click(within(tagFilters()).getByRole('button', { name: 'すべて' }));
  screen.getAllByRole('button', { name: '鳥の声の名前を変える' }).forEach((button) => fireEvent.click(button));
  const ids = screen.getAllByLabelText('「鳥の声」の新しい名前').map((input) => input.id);
  expect(ids).toHaveLength(2);
  expect(new Set(ids).size).toBe(2);

  expect(storage['sound-library-sort-order']).toBe('tag');
  unmount();
  await renderLibrary();
  expect(screen.getByRole('combobox', { name: 'ならべかた' })).toHaveValue('tag');
  expect(groupTitles()).toHaveLength(4);
});

test('一覧を開いただけでは音声を読み込まない（音素材が多いと古い iPad でメモリが足りなくなるため）', async () => {
  global.Audio = jest.fn(() => ({ play: jest.fn(() => Promise.resolve()), pause: jest.fn() }));
  await seed();
  await renderLibrary();
  expect(document.querySelectorAll('audio')).toHaveLength(0);
  expect(global.Audio).not.toHaveBeenCalled();
});

test('名前とタグで検索、タグで絞り込み、クリアできる', async () => {
  await seed();
  await renderLibrary();
  fireEvent.change(screen.getByPlaceholderText(/音の名前やタグで検索/), { target: { value: '動物' } });
  expect(cardNames()).toEqual(['鳥の声']);
  fireEvent.click(screen.getByRole('button', { name: /フィルターをクリア/ }));
  expect(cardNames()).toHaveLength(3);
  fireEvent.click(within(tagFilters()).getByRole('button', { name: '自然' }));
  expect(cardNames()).toEqual(['鳥の声', '雨の音']);
  fireEvent.change(screen.getByPlaceholderText(/音の名前やタグで検索/), { target: { value: '存在しない' } });
  expect(screen.getByText(/検索条件に合う音が見つかりませんでした/)).toBeInTheDocument();
});

test('削除すると一覧と IndexedDB から消える（全件を読み込み直さない）', async () => {
  await seed();
  const getAll = jest.spyOn(db, 'getAllRecordings');
  await renderLibrary();
  fireEvent.click(within(confirmDelete('雨の音')).getByRole('button', { name: /削除する/ }));
  await waitFor(() => expect(cardNames()).toEqual(['鳥の声', 'たいこ']));
  expect((await db.getAllRecordings()).map((r) => r.name)).toEqual(['たいこ', '鳥の声']);
  expect(getAll).toHaveBeenCalledTimes(2); // 画面の初回読み込み + このテストでの確認
});

test('削除の確認でキャンセルできる（Esc でも閉じる）', async () => {
  await seed();
  await renderLibrary();
  fireEvent.click(within(confirmDelete('たいこ')).getByRole('button', { name: 'キャンセル' }));
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  const dialog = confirmDelete('たいこ');
  fireEvent.keyDown(within(dialog).getByRole('button', { name: 'キャンセル' }), { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(cardNames()).toHaveLength(3);
});

test('名前を変えられる（仕様の「録った素材に名前をつける」。以前は保存後に直せなかった）', async () => {
  await seed();
  await renderLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'たいこの名前を変える' }));
  const input = screen.getByLabelText('「たいこ」の新しい名前');
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: '  おおだいこ  ' } });
  fireEvent.click(screen.getByRole('button', { name: /決定/ }));
  await waitFor(() => expect(cardFor('おおだいこ')).toBeTruthy());
  expect((await db.getAllRecordings()).map((r) => r.name)).toContain('おおだいこ');
  // 名前の欄が消えたら「名前」ボタンにフォーカスを戻す
  await waitFor(() => expect(screen.getByRole('button', { name: 'おおだいこの名前を変える' })).toHaveFocus());
});

test('名前の変更は Esc や「やめる」で取り消せ、空の名前にはできない', async () => {
  await seed();
  await renderLibrary();
  fireEvent.click(screen.getByRole('button', { name: 'たいこの名前を変える' }));
  const input = screen.getByLabelText('「たいこ」の新しい名前');
  fireEvent.change(input, { target: { value: '   ' } });
  expect(screen.getByRole('button', { name: /決定/ })).toBeDisabled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(cardFor('たいこ')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'たいこの名前を変える' }));
  fireEvent.click(screen.getByRole('button', { name: 'やめる' }));
  expect(screen.queryByLabelText('「たいこ」の新しい名前')).not.toBeInTheDocument();
  expect((await db.getAllRecordings()).map((r) => r.name)).toContain('たいこ');
});

test('タグを追加・削除できる。日本語変換の確定 Enter では追加しない。ほかの音のタグを候補から選べる', async () => {
  await seed();
  await renderLibrary();
  fireEvent.click(within(cardFor('たいこ')).getByTitle('タグを編集'));
  const input = within(cardFor('たいこ')).getByPlaceholderText('新しいタグを入力...');
  fireEvent.change(input, { target: { value: 'たたく' } });
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
  expect(within(cardFor('たいこ')).queryByText('たたく')).not.toBeInTheDocument();
  fireEvent.keyDown(input, { key: 'Enter', keyCode: 13 });
  await waitFor(() => expect(within(cardFor('たいこ')).getByText('たたく')).toBeInTheDocument());
  expect((await db.getAllRecordings()).find((r) => r.name === 'たいこ').tags).toEqual(['楽器', 'たたく']);

  const suggestions = within(cardFor('たいこ')).getByRole('group', { name: 'ほかの音に付いているタグ' });
  fireEvent.click(within(suggestions).getByRole('button', { name: /動物/ }));
  await waitFor(async () => expect((await db.getAllRecordings()).find((r) => r.name === 'たいこ').tags).toEqual(['楽器', 'たたく', '動物']));

  fireEvent.click(within(cardFor('たいこ')).getAllByTitle('タグを削除')[0]);
  await waitFor(() => expect(within(cardFor('たいこ')).queryByText('楽器')).not.toBeInTheDocument());
  expect((await db.getAllRecordings()).find((r) => r.name === 'たいこ').tags).toEqual(['たたく', '動物']);
});

test('絞り込み中のタグが無くなったら「すべて」に戻す', async () => {
  await db.addRecording({ name: 'ひとつだけ', tags: ['めずらしい'], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-02T00:00:00Z' });
  await db.addRecording({ name: 'ほか', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-01T00:00:00Z' });
  await renderLibrary();
  fireEvent.click(within(tagFilters()).getByRole('button', { name: 'めずらしい' }));
  expect(cardNames()).toEqual(['ひとつだけ']);
  fireEvent.click(within(cardFor('ひとつだけ')).getByTitle('タグを編集'));
  fireEvent.click(within(cardFor('ひとつだけ')).getByTitle('タグを削除'));
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

test('カードはドラッグさせず（別ページには置けないため）、音楽づくりページでの使い方を 1 か所で案内する', async () => {
  await seed();
  render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
  await waitFor(() => expect(cards()).toHaveLength(3));
  const card = cardFor('たいこ');
  expect(card).not.toHaveAttribute('draggable');
  expect(within(card).queryByText(/ドラッグ&ドロップできます/)).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: '音楽づくり' })).toHaveLength(1);
  expect(screen.getByRole('link', { name: '音楽づくり' })).toHaveAttribute('href', '/daw');
});

test('タグ編集・削除・名前のボタンには音の名前付きの読み上げ用ラベルがある', async () => {
  await seed();
  await renderLibrary();
  expect(screen.getByRole('button', { name: 'たいこのタグを編集' })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.getByRole('button', { name: '雨の音を削除' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: '鳥の声の名前を変える' })).toBeInTheDocument();
});

test('削除に失敗したら画面で知らせて一覧は残す', async () => {
  await seed();
  await renderLibrary();
  idb.failNextCommit(new Error('write failed'), (tx) => tx.mode === 'readwrite');
  fireEvent.click(within(confirmDelete('たいこ')).getByRole('button', { name: /削除する/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('音素材の削除に失敗しました。');
  expect(window.alert).not.toHaveBeenCalled();
  expect(cardNames()).toHaveLength(3);
});

test('長さが保存されていない以前の音は、1 つずつ長さを調べて保存し、表示する', async () => {
  let decodeCount = 0;
  window.OfflineAudioContext = jest.fn(() => ({
    decodeAudioData: (buffer, ok) => {
      decodeCount++;
      ok({ duration: 1.5 * decodeCount });
    }
  }));
  await db.addRecording({ name: '前の音', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-01T00:00:00Z' });
  await db.addRecording({ name: '長さのある音', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-04-02T00:00:00Z', duration: 0.6 });
  await renderLibrary();
  expect(within(cardFor('長さのある音')).getByText('0.6秒')).toBeInTheDocument();
  expect(await within(cardFor('前の音')).findByText('1.5秒')).toBeInTheDocument();
  expect(decodeCount).toBe(1); // 長さが分かっている音は調べない
  expect((await db.getAllRecordings()).find((r) => r.name === '前の音').duration).toBe(1.5);
});

describe('レビューで見つかった不具合', () => {
  test('以前の版が Date のまま保存した音も、日時の順に並び、日付を表示する', async () => {
    const lastYear = new Date(Date.UTC(2025, 9, 16));
    // 2025 年 10 月の版と同じく、作成日時を Date のまま書き込む（addRecording は文字列に直すので使わない）
    idb.seed('SoundLibraryDB', 'recordings', [
      { name: '去年の音', tags: [], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: lastYear }
    ], { autoIncrement: true });
    idb.seed('SoundLibraryDB', 'songs', []);
    await seed();
    await renderLibrary();
    // 以前は文字にした「Thu Oct 16 2025 …」で比べていて、去年の音がいちばん新しい扱いになった
    expect(cardNames()).toEqual(['鳥の声', '雨の音', 'たいこ', '去年の音']);
    fireEvent.change(screen.getByRole('combobox', { name: 'ならべかた' }), { target: { value: 'oldest' } });
    expect(cardNames()[0]).toBe('去年の音');
    expect(within(cardFor('去年の音')).getByText(lastYear.toLocaleDateString('ja-JP'))).toBeInTheDocument();
  });

  test('以前に保存された「 楽器 」や数字のタグも × で消せる', async () => {
    await db.addRecording({ name: '古いタグの音', tags: [' 楽器 ', 1], audioData: makeDataUrl('wav', 'audio/wav') });
    await renderLibrary();
    fireEvent.click(within(cardFor('古いタグの音')).getByTitle('タグを編集'));
    fireEvent.click(within(cardFor('古いタグの音')).getByRole('button', { name: 'タグ「1」を削除' }));
    await waitFor(() => expect(within(cardFor('古いタグの音')).queryByRole('button', { name: 'タグ「1」を削除' })).not.toBeInTheDocument());
    expect(within(cardFor('古いタグの音')).getByText('楽器')).toBeInTheDocument();
  });

  test('失敗したときは、その音のカードの中で知らせる（下の方のカードでも見える）', async () => {
    await seed();
    await renderLibrary();
    idb.failNextCommit(new Error('write failed'), (tx) => tx.mode === 'readwrite');
    fireEvent.click(within(confirmDelete('たいこ')).getByRole('button', { name: /削除する/ }));
    const alert = await within(cardFor('たいこ')).findByRole('alert');
    expect(alert).toHaveTextContent('音素材の削除に失敗しました。');
    fireEvent.click(within(alert).getByRole('button', { name: 'メッセージを閉じる' }));
    expect(within(cardFor('たいこ')).queryByRole('alert')).not.toBeInTheDocument();
  });

  test('削除したあとは、となりの音の ▶ にフォーカスが移る（最後の 1 つなら「音あつめへ」）', async () => {
    await seed();
    await renderLibrary(); // 新しい順: 鳥の声, 雨の音, たいこ
    fireEvent.click(within(confirmDelete('雨の音')).getByRole('button', { name: /削除する/ }));
    await waitFor(() => expect(cardNames()).toEqual(['鳥の声', 'たいこ']));
    await waitFor(() => expect(screen.getByRole('button', { name: 'たいこをきく' })).toHaveFocus());
  });

  test('「フィルターをクリア」を押したら検索欄に、タグの編集を開いたら入力欄にフォーカスが移る', async () => {
    await seed();
    await renderLibrary();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'たい' } });
    fireEvent.click(screen.getByRole('button', { name: /フィルターをクリア/ }));
    expect(screen.getByRole('searchbox')).toHaveFocus();
    fireEvent.click(within(cardFor('たいこ')).getByTitle('タグを編集'));
    const input = within(cardFor('たいこ')).getByPlaceholderText('新しいタグを入力...');
    expect(input).toHaveFocus();
    const suggestions = within(cardFor('たいこ')).getByRole('group', { name: 'ほかの音に付いているタグ' });
    fireEvent.click(within(suggestions).getAllByRole('button')[0]);
    expect(input).toHaveFocus();
  });
});
