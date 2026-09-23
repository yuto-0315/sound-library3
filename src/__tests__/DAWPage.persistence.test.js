import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DAWPage from '../pages/DAWPage';
import {
  addRecording,
  getAllRecordings,
  getProjectAutoSave,
  getProjectAutoSaveBackup,
  getSongData,
  saveProjectAutoSave,
  saveSongData
} from '../utils/indexedDB';
import { serializeProject } from '../utils/project';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, createMockAudioContext, makeDataUrl } from '../test-utils/audioFixtures';

const drumAudio = makeDataUrl('mp4', 'audio/mp4', 84); // 100 バイト → モックでは 1 秒
const bellAudio = makeDataUrl('wav', 'audio/wav', 184); // 200 バイト → 2 秒

let idb;
let storage;
let audioContext;

beforeEach(() => {
  idb = installFakeIndexedDB();
  storage = installMemoryLocalStorage();
  audioContext = createMockAudioContext();
  window.AudioContext = jest.fn(() => audioContext);
  global.FileReader = TestFileReader;
  let urlCounter = 0;
  URL.createObjectURL.mockImplementation(() => `blob:test-${++urlCounter}`);
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

// 画面を片付けてから、アンマウント時の保存が終わるのを待つ（次のテストが差し替えた
// localStorage や IndexedDB に前のテストの保存処理が書き込まないように）
afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  jest.restoreAllMocks();
});

const waitForLoaded = async () => {
  await waitFor(() => expect(screen.queryByText('前回の作業内容を読み込んでいます...')).not.toBeInTheDocument());
};

const renderDAW = async () => {
  const utils = render(<DAWPage />);
  await waitForLoaded();
  return utils;
};

const getClipNames = (container) =>
  Array.from(container.querySelectorAll('.clip-name')).map((element) => element.textContent);

const getTrackHeaders = () => screen.getAllByRole('heading', { level: 4 }).filter((h) => /^トラック \d+$/.test(h.textContent));

const seedLibrary = async () => {
  const drumId = await addRecording({ name: 'たいこ', tags: ['楽器'], audioData: drumAudio, createdAt: '2026-01-01T00:00:00Z' });
  const bellId = await addRecording({ name: 'すず', tags: [], audioData: bellAudio, createdAt: '2026-01-02T00:00:00Z' });
  return { drumId, bellId };
};

const projectWithClips = () => serializeProject({
  tracks: [
    {
      id: 101,
      name: 'トラック 1',
      clips: [
        { id: 1, startTime: 0, duration: 100, trackId: 101, soundData: { id: 1, name: 'たいこ', tags: [], audioData: drumAudio } },
        { id: 2, startTime: 250, duration: 200, trackId: 101, soundData: { id: 2, name: 'すず', tags: [], audioData: bellAudio } }
      ]
    },
    { id: 102, name: 'トラック 2', clips: [] }
  ],
  pixelsPerSecond: 100,
  trackNameCounter: 2,
  trackIdCounter: 3
});

const waitForAutoSaveCompleted = async () => {
  expect(await screen.findByText('自動保存しました', {}, { timeout: 3000 })).toBeInTheDocument();
};

describe('自動保存と復元（ページ移動でタイムラインが消える不具合の回帰テスト）', () => {
  test('ページを開いた直後に、保存済みの作業内容を空のタイムラインで上書きしない', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();

    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
    expect(getTrackHeaders()).toHaveLength(2);

    const saved = await getProjectAutoSave();
    expect(saved.tracks[0].clips).toHaveLength(2);
  });

  test('音あつめページへ移動して戻っても（アンマウント→再マウント）タイムラインが残る', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container: firstContainer, unmount } = await renderDAW();
    await waitFor(() => expect(getClipNames(firstContainer)).toHaveLength(2));
    unmount();

    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
    expect(getTrackHeaders()).toHaveLength(2);
  });

  test('追加したトラックが自動保存され、戻ったときに復元される', async () => {
    const { unmount } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(getTrackHeaders()).toHaveLength(3);
    await waitForAutoSaveCompleted();
    unmount();

    await renderDAW();
    expect(getTrackHeaders()).toHaveLength(3);
  });

  test('変更直後（自動保存の待ち時間中）にページを離れても保存される', async () => {
    const { unmount } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    unmount(); // 0.5 秒待たずに移動

    await waitFor(async () => {
      const saved = await getProjectAutoSave();
      expect(saved && saved.tracks).toHaveLength(2);
    });
  });

  test('アプリを切り替えた（画面が隠れた）ときは待たずに保存する', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    Object.defineProperty(document, 'hidden', { value: true, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    await waitFor(async () => {
      const saved = await getProjectAutoSave();
      expect(saved && saved.tracks).toHaveLength(2);
    });
  });

  test('自動保存は音声データを重複させずに保存する（同じ音を 3 回置いても 1 回分）', async () => {
    const tracks = [{ id: 1, name: 'トラック 1', clips: [0, 200, 400].map((start, i) => ({ id: i + 1, startTime: start, duration: 100, trackId: 1, soundData: { name: 'たいこ', audioData: drumAudio } })) }];
    await saveProjectAutoSave(serializeProject({ tracks, pixelsPerSecond: 100 }));
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    await waitForAutoSaveCompleted();
    const saved = await getProjectAutoSave();
    expect(Object.keys(saved.assets)).toHaveLength(1);
    expect(saved.tracks[0].clips.every((clip) => clip.audioRef === 'a1')).toBe(true);
  });

  test('旧バージョン（localStorage）の自動保存を読み込み、IndexedDB に移して localStorage を消す', async () => {
    await seedLibrary();
    storage.dawProjectAutoSave = JSON.stringify({
      version: '1.0',
      pixelsPerSecond: 100,
      tracks: [{ id: 5, name: 'トラック 1', clips: [{ id: 9, startTime: 100, duration: 100, trackId: 5, soundData: { name: 'たいこ', audioBlob: {} } }] }]
    });
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ']));
    await waitForAutoSaveCompleted();
    expect(storage.dawProjectAutoSave).toBeUndefined();
    const saved = await getProjectAutoSave();
    expect(saved.tracks[0].clips[0].audioRef).toBeTruthy();
    expect(saved.assets[saved.tracks[0].clips[0].audioRef]).toBe(drumAudio);
  });

  test('作業内容の読み込みに失敗したら、自動保存を止めて上書きしない', async () => {
    await saveProjectAutoSave(projectWithClips());
    // 最初の songs ストアの読み込み（インポート楽曲の確認）を失敗させる
    idb.failNextCommit(new Error('Connection to Indexed Database server lost'), (tx) => tx.mode === 'readonly' && tx.storeNames.includes('songs'));
    await renderDAW();
    expect(screen.getByText(/前回の作業内容を読み込めませんでした/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
    const saved = await getProjectAutoSave();
    expect(saved.tracks[0].clips).toHaveLength(2); // 空で上書きされていない
  });

  test('自動保存に失敗したら画面で知らせる', async () => {
    await renderDAW();
    idb.failNextCommit(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }), (tx) => tx.mode === 'readwrite');
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(await screen.findByText('自動保存に失敗', {}, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getAllByText(/保存できる容量が足りない/).length).toBeGreaterThan(0);
  });

  test('リセットすると自動保存も空のプロジェクトになる', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(getClipNames(container)).toHaveLength(0));
    expect(window.confirm).toHaveBeenCalled();
    await waitForAutoSaveCompleted();
    const saved = await getProjectAutoSave();
    expect(saved.tracks).toHaveLength(1);
    expect(saved.tracks[0].clips).toHaveLength(0);
  });

  test('リセットの確認でキャンセルしたら何も消さない', async () => {
    window.confirm = jest.fn(() => false);
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    expect(getClipNames(container)).toHaveLength(2);
  });
});

describe('読み込みに失敗したとき（レビューで見つかったデータ消失の対策）', () => {
  const failFirstSongsRead = () => idb.failNextCommit(
    new Error('Connection to Indexed Database server lost'),
    (tx) => tx.mode === 'readonly' && tx.storeNames.includes('songs')
  );

  test('「自動保存停止中」を閉じられない形で表示し、「もう一度読み込む」で読み込み直せる', async () => {
    await saveProjectAutoSave(projectWithClips());
    failFirstSongsRead();
    const { container } = await renderDAW();
    expect(screen.getByText('自動保存停止中')).toBeInTheDocument();
    // エラーの帯を閉じても、停止中の表示は残る
    fireEvent.click(screen.getByRole('button', { name: 'メッセージを閉じる' }));
    expect(screen.getByText('自動保存停止中')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /もう一度読み込む/ }));
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
    expect(screen.queryByText('自動保存停止中')).not.toBeInTheDocument();
    // 読み込めたので自動保存も再開する
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    await waitForAutoSaveCompleted();
    expect((await getProjectAutoSave()).tracks).toHaveLength(3);
  });

  test('読み込めない状態でリセットしても、保存データはバックアップに残る', async () => {
    const original = projectWithClips();
    await saveProjectAutoSave(original);
    failFirstSongsRead();
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('プロジェクトをリセットしました'));
    const backup = await getProjectAutoSaveBackup();
    expect(backup.tracks[0].clips).toHaveLength(2);
  });

  test('バックアップもできないときはリセットを中止して、保存データを消さない', async () => {
    await saveProjectAutoSave(projectWithClips());
    failFirstSongsRead();
    await renderDAW();
    idb.failNextCommit(new Error('still broken'), (tx) => tx.mode === 'readwrite');
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    expect(await screen.findByText(/リセットを中止しました/)).toBeInTheDocument();
    expect(window.alert).not.toHaveBeenCalled();
    expect((await getProjectAutoSave()).tracks[0].clips).toHaveLength(2);
    expect(screen.getByText('自動保存停止中')).toBeInTheDocument();
  });

  test('自動保存が止まっている間はタイムラインを操作できない（保存されない編集をさせない）', async () => {
    await saveProjectAutoSave(projectWithClips());
    failFirstSongsRead();
    const { container } = await renderDAW();
    expect(container.querySelector('.daw-main-area')).toHaveAttribute('inert');
    // ファイル読み込みや「もう一度読み込む」は使える
    expect(container.querySelector('.daw-controls')).not.toHaveAttribute('inert');
  });

  test('音素材の読み込みに失敗したときも、作業内容を空で上書きしない', async () => {
    await saveProjectAutoSave(projectWithClips());
    idb.failNextCommit(new Error('lost'), (tx) => tx.mode === 'readonly' && tx.storeNames.includes('recordings'));
    await renderDAW();
    expect(screen.getByText('自動保存停止中')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 800)));
    expect((await getProjectAutoSave()).tracks[0].clips).toHaveLength(2);
  });
});

describe('自動保存の再試行と別のタブ', () => {
  test('自動保存に失敗したあと何も操作せずにページを離れても、もう一度保存する', async () => {
    const { unmount } = await renderDAW();
    idb.failNextCommit(new Error('write failed once'), (tx) => tx.mode === 'readwrite');
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(await screen.findByText('自動保存に失敗', {}, { timeout: 3000 })).toBeInTheDocument();
    unmount();
    await waitFor(async () => {
      const saved = await getProjectAutoSave();
      expect(saved && saved.tracks).toHaveLength(2);
    });
  });

  test('別のタブで保存された新しい作業内容は、このタブに戻ったときに読み込み直す（古い内容で上書きしない）', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 700))); // 読み込み直後の保存を終わらせる

    // 別のタブが新しい内容を保存した
    const newer = serializeProject({
      tracks: [{ id: 7, name: 'トラック 1', clips: [{ id: 3, startTime: 0, duration: 100, trackId: 7, soundData: { name: '別のタブの音', audioData: bellAudio } }] }],
      pixelsPerSecond: 100
    });
    newer.timestamp = Date.now() + 1000;
    await saveProjectAutoSave(newer);

    Object.defineProperty(document, 'hidden', { value: false, configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await waitFor(() => expect(getClipNames(container)).toEqual(['別のタブの音']));
    // 読み込み直しただけなので、保存し直して時刻を進めない
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    expect((await getProjectAutoSave()).timestamp).toBe(newer.timestamp);
  });

  test('別のタブの内容を読み込んでいる間にこのタブで編集したら、置き換えない', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    const newer = serializeProject({ tracks: [{ id: 7, name: 'x', clips: [] }], pixelsPerSecond: 100 });
    newer.timestamp = Date.now() + 1000;
    await saveProjectAutoSave(newer);
    idb.openDelayMs = 30; // 読み込みに少し時間がかかる
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    fireEvent.click(screen.getByRole('button', { name: 'たいこを削除' })); // 読み込み中に編集
    idb.openDelayMs = 0;
    await act(() => new Promise((resolve) => setTimeout(resolve, 100)));
    expect(getClipNames(container)).toEqual(['すず']);
  });

  test('このタブに保存待ちの変更があるときは、別のタブの内容で置き換えない', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    const newer = serializeProject({ tracks: [{ id: 7, name: 'x', clips: [] }], pixelsPerSecond: 100 });
    newer.timestamp = Date.now() + 1000;
    await saveProjectAutoSave(newer);
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ })); // 保存待ちの変更
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(getClipNames(container)).toEqual(['たいこ', 'すず']);
  });
});

describe('1つ前の作業に戻す（バックアップの復元）', () => {
  test('リセットした後で「1つ前の作業に戻す」を押すと元に戻り、もう一度押すとリセット後に戻る', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    expect(screen.queryByRole('button', { name: /1つ前の作業に戻す/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(getClipNames(container)).toHaveLength(0));
    fireEvent.click(await screen.findByRole('button', { name: /1つ前の作業に戻す/ }));
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
    expect((await getProjectAutoSave()).tracks[0].clips).toHaveLength(2);

    fireEvent.click(screen.getByRole('button', { name: /1つ前の作業に戻す/ }));
    await waitFor(() => expect(getClipNames(container)).toHaveLength(0));
  });

  test('入れ替えている間は操作できず、戻した内容は保存される', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(getClipNames(container)).toHaveLength(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));

    idb.openDelayMs = 20; // 入れ替えに時間がかかる
    fireEvent.click(await screen.findByRole('button', { name: /1つ前の作業に戻す/ }));
    expect(container.querySelector('.daw-main-area')).toHaveAttribute('inert');
    expect(container.querySelector('.daw-controls')).toHaveAttribute('inert');
    idb.openDelayMs = 0;
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
    expect(container.querySelector('.daw-main-area')).not.toHaveAttribute('inert');
    await waitForAutoSaveCompleted();
    expect((await getProjectAutoSave()).tracks[0].clips).toHaveLength(2);
  });

  test('今の作業内容を保存できないときは、入れ替えを中止して古い版をバックアップしない', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(getClipNames(container)).toHaveLength(0));
    await act(() => new Promise((resolve) => setTimeout(resolve, 700)));
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ })); // 保存待ちの変更
    idb.failNextCommit(Object.assign(new Error('quota'), { name: 'QuotaExceededError' }), (tx) => tx.mode === 'readwrite');
    fireEvent.click(await screen.findByRole('button', { name: /1つ前の作業に戻す/ }));
    expect(await screen.findByText(/1つ前の作業に戻すのを中止しました/)).toBeInTheDocument();
    expect(getClipNames(container)).toHaveLength(0);
    expect((await getProjectAutoSaveBackup()).tracks[0].clips).toHaveLength(2); // バックアップはそのまま
  });

  test('バックアップが無いときはボタンを出さない（空の作業内容をリセットしただけのとき）', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('プロジェクトをリセットしました'));
    expect(screen.queryByRole('button', { name: /1つ前の作業に戻す/ })).not.toBeInTheDocument();
  });

  test('先生の楽曲を開いた後でも、自分の作業に戻せる', async () => {
    await saveProjectAutoSave(projectWithClips());
    await saveSongData(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 9, startTime: 0, duration: 100, trackId: 1, soundData: { name: '先生の音', audioData: bellAudio } }] }],
      pixelsPerSecond: 100
    }));
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['先生の音']));
    fireEvent.click(await screen.findByRole('button', { name: /1つ前の作業に戻す/ }));
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
  });
});

describe('プロジェクトファイルの読み込みで作業内容を失わない', () => {
  const projectFile = () => new File([JSON.stringify(serializeProject({
    tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, trackId: 1, soundData: { name: 'ファイルの音', audioData: bellAudio } }] }],
    pixelsPerSecond: 100
  }, { includeSounds: 'all' }))], 'song.json', { type: 'application/json' });

  test('今の作業内容があるときは確認し、読み込むときはバックアップする', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [projectFile()] } });
    await waitFor(() => expect(getClipNames(container)).toEqual(['ファイルの音']));
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('今の作業内容は置き換わります'));
    expect((await getProjectAutoSaveBackup()).tracks[0].clips).toHaveLength(2);
  });

  test('確認でキャンセルしたら読み込まない', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toHaveLength(2));
    window.confirm = jest.fn(() => false);
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [projectFile()] } });
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)));
    expect(getClipNames(container)).toEqual(['たいこ', 'すず']);
  });

  test('読み込みに失敗している状態でファイルを読み込んでも、読めなかった作業内容はバックアップに残る', async () => {
    await saveProjectAutoSave(projectWithClips());
    idb.failNextCommit(new Error('lost'), (tx) => tx.mode === 'readonly' && tx.storeNames.includes('songs'));
    const { container } = await renderDAW();
    expect(screen.getByText('自動保存停止中')).toBeInTheDocument();
    fireEvent.change(container.querySelector('input[type="file"]'), { target: { files: [projectFile()] } });
    await waitFor(() => expect(getClipNames(container)).toEqual(['ファイルの音']));
    expect((await getProjectAutoSaveBackup()).tracks[0].clips).toHaveLength(2);
    expect(screen.queryByText('自動保存停止中')).not.toBeInTheDocument();
  });
});

describe('読み込み中の操作', () => {
  test('前回の作業内容を読み込んでいる間は操作できないようにする（置いたクリップが上書きで消えるのを防ぐ）', async () => {
    await saveProjectAutoSave(projectWithClips());
    const { container } = render(<DAWPage />);
    expect(screen.getByText('前回の作業内容を読み込んでいます...')).toBeInTheDocument();
    expect(container.querySelector('.daw-main-area')).toHaveClass('is-loading');
    expect(container.querySelector('.daw-main-area')).toHaveAttribute('aria-busy', 'true');
    expect(container.querySelector('.daw-controls')).toHaveClass('is-loading');
    // キーボードでも操作できないように inert にする
    expect(container.querySelector('.daw-controls')).toHaveAttribute('inert');
    expect(container.querySelector('.daw-main-area')).toHaveAttribute('inert');
    await waitForLoaded();
    expect(container.querySelector('.daw-controls')).not.toHaveAttribute('inert');
    expect(container.querySelector('.daw-main-area')).not.toHaveClass('is-loading');
    expect(container.querySelector('.daw-main-area')).toHaveAttribute('aria-busy', 'false');
  });
});

describe('先生ページからの楽曲インポート（今の作業内容の扱い）', () => {
  const teacherSong = () => serializeProject({
    tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, trackId: 1, soundData: { name: '先生の曲の音', audioData: makeDataUrl('ogg', 'audio/ogg', 40) } }] }],
    pixelsPerSecond: 100
  });

  test('今の作業内容があるときは確認し、開く場合は作業内容をバックアップする', async () => {
    await saveProjectAutoSave(projectWithClips());
    await saveSongData(teacherSong());
    const { container } = await renderDAW();
    expect(window.confirm).toHaveBeenCalledWith(expect.stringContaining('今の作業内容はこの楽曲に置き換わります'));
    await waitFor(() => expect(getClipNames(container)).toEqual(['先生の曲の音']));
    const backup = await getProjectAutoSaveBackup();
    expect(backup.tracks[0].clips.map((clip) => clip.soundData.name)).toEqual(['たいこ', 'すず']);
    await expect(getSongData()).resolves.toBeNull();
    expect((await getProjectAutoSave()).tracks[0].clips[0].soundData.name).toBe('先生の曲の音');
  });

  test('確認でキャンセルしたら今の作業内容を続け、渡された楽曲は捨てる', async () => {
    window.confirm = jest.fn(() => false);
    await saveProjectAutoSave(projectWithClips());
    await saveSongData(teacherSong());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['たいこ', 'すず']));
    await expect(getSongData()).resolves.toBeNull();
    expect(window.alert).not.toHaveBeenCalled();
  });

  test('旧バージョンの作業内容（localStorage）しか無い場合も確認し、バックアップしてから開く', async () => {
    storage.dawProjectAutoSave = JSON.stringify({
      version: '1.0',
      pixelsPerSecond: 100,
      tracks: [{ id: 5, name: 'トラック 1', clips: [{ id: 9, startTime: 0, duration: 100, trackId: 5, soundData: { name: '昔の作業', audioData: drumAudio } }] }]
    });
    await saveSongData(teacherSong());
    const { container } = await renderDAW();
    expect(window.confirm).toHaveBeenCalled();
    await waitFor(() => expect(getClipNames(container)).toEqual(['先生の曲の音']));
    const backup = await getProjectAutoSaveBackup();
    expect(backup.tracks[0].clips[0].soundData.name).toBe('昔の作業');
  });

  test('今の作業内容が空なら確認せずに開く', async () => {
    await saveSongData(teacherSong());
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['先生の曲の音']));
    expect(window.confirm).not.toHaveBeenCalled();
  });
});

describe('先生ページからの楽曲インポート', () => {
  test('既存の音素材を上書きせず、新しい ID で音素材を追加する（以前は ID が重なって消えていた）', async () => {
    const { drumId, bellId } = await seedLibrary();
    const fluteAudio = makeDataUrl('ogg', 'audio/ogg', 50);
    // 生徒の端末の ID（1）が、先生の端末の既存の音素材の ID と重なるケース
    await saveSongData(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, trackId: 1, soundData: { id: drumId, name: 'ふえ', tags: [], audioData: fluteAudio } }] }],
      pixelsPerSecond: 100
    }));

    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['ふえ']));
    expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('1個の音素材'));

    const library = await getAllRecordings();
    expect(library.map((sound) => sound.name).sort()).toEqual(['すず', 'たいこ', 'ふえ']);
    expect(library.find((sound) => sound.id === drumId).name).toBe('たいこ');
    expect(library.find((sound) => sound.id === bellId).name).toBe('すず');
    await expect(getSongData()).resolves.toBeNull(); // 読み込み済みの楽曲は消す
  });

  test('ライブラリに同じ音声がある場合は二重に追加しない', async () => {
    await seedLibrary();
    await saveSongData(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, soundData: { name: 'たいこ', audioData: drumAudio } }] }],
      pixelsPerSecond: 100
    }));
    await renderDAW();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith(expect.stringContaining('0個の音素材')));
    expect(await getAllRecordings()).toHaveLength(2);
  });

  test('同じ名前で音声が違う場合は名前に番号を付けて追加する', async () => {
    await seedLibrary();
    await saveSongData(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, soundData: { name: 'たいこ', audioData: makeDataUrl('webm', 'audio/webm', 30) } }] }],
      pixelsPerSecond: 100
    }));
    await renderDAW();
    await waitFor(async () => {
      const names = (await getAllRecordings()).map((sound) => sound.name);
      expect(names).toContain('たいこ (1)');
    });
  });

  test('旧形式（v1: クリップに音声を埋め込み）の楽曲も開ける', async () => {
    await saveSongData({
      version: '1.0',
      pixelsPerSecond: 100,
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, trackId: 1, soundData: { name: 'かね', audioData: makeDataUrl('mp4', 'audio/wav') } }] }],
      sounds: []
    });
    const { container } = await renderDAW();
    await waitFor(() => expect(getClipNames(container)).toEqual(['かね']));
  });
});

describe('音素材パネル', () => {
  test('ライブラリの音素材とタグを表示し、タグで絞り込める', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    await waitFor(() => expect(within(panel).getByText('たいこ')).toBeInTheDocument());
    expect(within(panel).getByText('すず')).toBeInTheDocument();
    fireEvent.click(within(panel).getByRole('button', { name: '楽器' }));
    expect(within(panel).queryByText('すず')).not.toBeInTheDocument();
    expect(within(panel).getByText('たいこ')).toBeInTheDocument();
  });

  test('壊れた音声データの音素材は表示しない', async () => {
    await addRecording({ name: '壊れた音', audioData: 'data:audio/wav;base64,' });
    await addRecording({ name: '正常な音', audioData: drumAudio });
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    await waitFor(() => expect(within(panel).getByText('正常な音')).toBeInTheDocument());
    expect(within(panel).queryByText('壊れた音')).not.toBeInTheDocument();
  });

  test('音素材が無ければ案内を表示する', async () => {
    await renderDAW();
    expect(screen.getByText('音素材がありません')).toBeInTheDocument();
  });

  test('試聴ボタンで Web Audio で再生し、もう一度押すと止まる', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    const playButton = await within(panel).findByRole('button', { name: 'たいこを試聴' });
    fireEvent.click(playButton);
    await waitFor(() => expect(audioContext.started).toHaveLength(2)); // unlock 用の無音 + 試聴
    const stopButton = within(panel).getByRole('button', { name: 'たいこを停止' });
    const previewSource = audioContext.started[1].source;
    fireEvent.click(stopButton);
    expect(previewSource.stop).toHaveBeenCalled();
    expect(within(panel).getByRole('button', { name: 'たいこを試聴' })).toBeInTheDocument();
  });

  test('試聴の音が終わるとボタンが元に戻る', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    fireEvent.click(await within(panel).findByRole('button', { name: 'すずを試聴' }));
    await waitFor(() => expect(audioContext.started).toHaveLength(2));
    act(() => {
      audioContext.started[1].source.onended();
    });
    expect(within(panel).getByRole('button', { name: 'すずを試聴' })).toBeInTheDocument();
  });
});
