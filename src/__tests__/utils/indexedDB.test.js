import {
  addRecording,
  addRecordings,
  addTagToRecording,
  backupAndClearProjectAutoSave,
  getProjectAutoSaveBackup,
  promoteImportedSongToAutoSave,
  clearAllData,
  deleteProjectAutoSave,
  deleteRecording,
  deleteSongData,
  getAllRecordings,
  getProjectAutoSave,
  getSongData,
  isQuotaExceededError,
  migrateFromLocalStorage,
  migrateRecordingsFromLocalStorage,
  removeTagFromRecording,
  requestPersistentStorage,
  saveProjectAutoSave,
  saveRecording,
  saveSongData,
  searchRecordingsByTag,
  updateRecording
} from '../../utils/indexedDB';
import { installFakeIndexedDB } from '../../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../../test-utils/storage';
import { makeDataUrl } from '../../test-utils/audioFixtures';

const DB = 'SoundLibraryDB';
const quotaError = () => Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });

let idb;
let storage;

beforeEach(() => {
  idb = installFakeIndexedDB();
  storage = installMemoryLocalStorage();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const recording = (overrides = {}) => ({
  name: 'たいこ',
  tags: ['楽器'],
  audioData: makeDataUrl('mp4', 'audio/mp4'),
  createdAt: '2026-01-01T00:00:00.000Z',
  ...overrides
});

describe('録音データの追加・取得', () => {
  test('addRecording は ID を自動で振り、取得できる', async () => {
    const id1 = await addRecording(recording());
    const id2 = await addRecording(recording({ name: 'すず' }));
    expect(id1).toBe(1);
    expect(id2).toBe(2);
    const all = await getAllRecordings();
    expect(all.map((r) => r.name)).toEqual(['たいこ', 'すず']);
  });

  test('addRecording は渡された ID を無視する（既存の音素材を上書きしない）', async () => {
    await addRecording(recording({ name: '既存' }));
    const id = await addRecording(recording({ id: 1, name: '新しい音' }));
    expect(id).toBe(2);
    const names = idb.dump(DB, 'recordings').map((r) => r.name);
    expect(names).toEqual(['既存', '新しい音']);
  });

  test('Blob・blob URL は保存せず、日付は文字列、タグは配列にする', async () => {
    await addRecording({ name: 'x', audioData: makeDataUrl('wav', 'audio/wav'), audioBlob: new Blob(['a']), url: 'blob:1', createdAt: new Date('2026-02-03T04:05:06Z'), tags: undefined });
    const [stored] = idb.dump(DB, 'recordings');
    expect(stored).not.toHaveProperty('audioBlob');
    expect(stored).not.toHaveProperty('url');
    expect(stored.createdAt).toBe('2026-02-03T04:05:06.000Z');
    expect(stored.tags).toEqual([]);
    expect(typeof stored.updatedAt).toBe('string');
  });

  test('保存時に MIME 表記を中身に合わせる（中身 mp4 / 表記 wav）', async () => {
    await addRecording(recording({ audioData: makeDataUrl('mp4', 'audio/wav') }));
    const [stored] = idb.dump(DB, 'recordings');
    expect(stored.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
  });

  test('既に誤った表記で保存されているデータも、読み込み時に直して返す', async () => {
    idb.seed(DB, 'recordings', [{ id: 7, name: '古い録音', audioData: makeDataUrl('mp4', 'audio/wav') }], { autoIncrement: true });
    // schema の songs も必要
    idb.seed(DB, 'songs', []);
    const [loaded] = await getAllRecordings();
    expect(loaded.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(loaded.tags).toEqual([]);
  });

  test('saveRecording は ID があれば上書き、無ければ追加', async () => {
    const id = await saveRecording(recording());
    await saveRecording({ ...recording({ name: '名前を変更' }), id });
    await saveRecording(recording({ id: undefined, name: '追加' }));
    expect(idb.dump(DB, 'recordings').map((r) => r.name)).toEqual(['名前を変更', '追加']);
  });

  test('addRecordings はまとめて追加し、ID を順番どおりに返す', async () => {
    const ids = await addRecordings([recording({ name: 'a' }), recording({ name: 'b' }), recording({ name: 'c' })]);
    expect(ids).toEqual([1, 2, 3]);
    expect(idb.log.filter((entry) => entry.type === 'commit' && entry.mode === 'readwrite')).toHaveLength(1);
  });
});

describe('保存の確定（データ消失の防止）', () => {
  test('書き込みの確定に失敗したら reject し、保存済みにしない', async () => {
    idb.failNextCommit(quotaError());
    await expect(addRecording(recording())).rejects.toMatchObject({ name: 'QuotaExceededError' });
    expect(idb.dump(DB, 'recordings')).toHaveLength(0);
  });

  test('addRecordings は途中で失敗したら 1 件も保存しない', async () => {
    idb.failNextCommit(quotaError());
    await expect(addRecordings([recording({ name: 'a' }), recording({ name: 'b' })])).rejects.toBeTruthy();
    expect(idb.dump(DB, 'recordings')).toHaveLength(0);
  });

  test('isQuotaExceededError は各ブラウザの容量不足エラーを判定する', () => {
    expect(isQuotaExceededError(quotaError())).toBe(true);
    expect(isQuotaExceededError({ name: 'NS_ERROR_DOM_QUOTA_REACHED' })).toBe(true);
    expect(isQuotaExceededError({ code: 22 })).toBe(true);
    expect(isQuotaExceededError(new Error('other'))).toBe(false);
    expect(isQuotaExceededError(null)).toBe(false);
  });

  test('データベースを開けないときは、旧データが無ければエラーを返す（空の一覧と区別する）', async () => {
    idb.openFailure = Object.assign(new Error('blocked'), { name: 'UnknownError' });
    await expect(getAllRecordings()).rejects.toMatchObject({ name: 'UnknownError' });
  });

  test('データベースを開けないときも、旧 localStorage のデータは表示する', async () => {
    idb.openFailure = new Error('private mode');
    storage.soundRecordings = JSON.stringify([recording({ name: '旧データ' })]);
    const all = await getAllRecordings();
    expect(all.map((r) => r.name)).toEqual(['旧データ']);
    expect(storage.soundRecordings).toBeDefined(); // 消さない
  });

  test('IndexedDB が存在しない環境でもエラーとして扱う', async () => {
    Object.defineProperty(window, 'indexedDB', { value: undefined, configurable: true, writable: true });
    await expect(addRecording(recording())).rejects.toThrow('IndexedDB');
  });
});

describe('localStorage からの移行', () => {
  test('同じ名前の別の録音も両方移行する（以前は名前だけで判定して片方が消えていた）', async () => {
    storage.soundRecordings = JSON.stringify([
      recording({ id: 1, name: 'たいこ', createdAt: '2026-01-01T00:00:00Z', audioData: makeDataUrl('mp4', 'audio/wav', 10) }),
      recording({ id: 2, name: 'たいこ', createdAt: '2026-01-02T00:00:00Z', audioData: makeDataUrl('mp4', 'audio/wav', 20) })
    ]);
    const all = await getAllRecordings();
    expect(all).toHaveLength(2);
    expect(all.every((r) => r.source === 'localStorage-migration')).toBe(true);
    expect(storage.soundRecordings).toBeUndefined();
  });

  test('既に移行済みの録音は二重に追加しない', async () => {
    const legacy = recording({ name: 'かね', createdAt: '2026-03-01T00:00:00Z' });
    await addRecording(legacy);
    storage.soundRecordings = JSON.stringify([legacy]);
    const all = await getAllRecordings();
    expect(all).toHaveLength(1);
    expect(storage.soundRecordings).toBeUndefined();
  });

  test('移行の保存に失敗したら localStorage を消さない（次回やり直せる）', async () => {
    storage.soundRecordings = JSON.stringify([recording({ name: '大事な録音' })]);
    idb.failNextCommit(quotaError(), (tx) => tx.mode === 'readwrite');
    const all = await getAllRecordings();
    expect(all).toHaveLength(0);
    expect(storage.soundRecordings).toContain('大事な録音');
    // 次回は成功する
    const retry = await getAllRecordings();
    expect(retry.map((r) => r.name)).toEqual(['大事な録音']);
    expect(storage.soundRecordings).toBeUndefined();
  });

  test('壊れた localStorage のデータは無視する', async () => {
    storage.soundRecordings = '{not json';
    await expect(getAllRecordings()).resolves.toEqual([]);
    storage.soundRecordings = JSON.stringify({ not: 'array' });
    await expect(getAllRecordings()).resolves.toEqual([]);
  });

  test('migrateRecordingsFromLocalStorage は移行件数を返す', async () => {
    const count = await migrateRecordingsFromLocalStorage([recording({ name: 'a' }), null, recording({ name: 'b' })]);
    expect(count).toBe(2);
  });

  test('migrateFromLocalStorage は旧形式のインポート楽曲を移す', async () => {
    storage['daw-import-song'] = JSON.stringify({ version: '1.0', tracks: [] });
    await migrateFromLocalStorage();
    await expect(getSongData()).resolves.toEqual({ version: '1.0', tracks: [] });
    expect(storage['daw-import-song']).toBeUndefined();
  });
});

describe('録音データの更新・削除・検索', () => {
  test('タグの追加（重複しない）と削除', async () => {
    const id = await addRecording(recording({ tags: ['楽器'] }));
    let updated = await addTagToRecording(id, '自然');
    expect(updated.tags).toEqual(['楽器', '自然']);
    updated = await addTagToRecording(id, '自然');
    expect(updated.tags).toEqual(['楽器', '自然']);
    updated = await removeTagFromRecording(id, '楽器');
    expect(updated.tags).toEqual(['自然']);
    expect(idb.dump(DB, 'recordings')[0].tags).toEqual(['自然']);
  });

  test('updateRecording は ID を変えず、Blob は保存しない', async () => {
    const id = await addRecording(recording());
    const updated = await updateRecording(id, { id: 999, name: '新しい名前', audioBlob: new Blob(['z']) });
    expect(updated.id).toBe(id);
    expect(updated.name).toBe('新しい名前');
    expect(idb.dump(DB, 'recordings')[0]).not.toHaveProperty('audioBlob');
  });

  test('存在しない ID の更新はエラーになり、何も変わらない', async () => {
    await addRecording(recording());
    await expect(updateRecording(42, { name: 'x' })).rejects.toThrow('not found');
    await expect(addTagToRecording(42, 'x')).rejects.toThrow('not found');
    await expect(removeTagFromRecording(42, 'x')).rejects.toThrow('not found');
    expect(idb.dump(DB, 'recordings')[0].name).toBe('たいこ');
  });

  test('削除', async () => {
    const id = await addRecording(recording());
    await addRecording(recording({ name: '残す' }));
    await deleteRecording(id);
    expect(idb.dump(DB, 'recordings').map((r) => r.name)).toEqual(['残す']);
  });

  test('タグで検索する', async () => {
    await addRecording(recording({ name: 'a', tags: ['楽器', '自然'] }));
    await addRecording(recording({ name: 'b', tags: ['自然'] }));
    await addRecording(recording({ name: 'c', tags: [] }));
    const result = await searchRecordingsByTag('自然');
    expect(result.map((r) => r.name).sort()).toEqual(['a', 'b']);
  });

  test('検索でエラーが起きても空の一覧を返す', async () => {
    idb.openFailure = new Error('x');
    await expect(searchRecordingsByTag('自然')).resolves.toEqual([]);
  });
});

describe('楽曲データと DAW の自動保存', () => {
  test('インポート楽曲の保存・取得・削除', async () => {
    await expect(getSongData()).resolves.toBeNull();
    await saveSongData({ version: '2.0', tracks: [{ id: 1 }] });
    await expect(getSongData()).resolves.toEqual({ version: '2.0', tracks: [{ id: 1 }] });
    await deleteSongData();
    await expect(getSongData()).resolves.toBeNull();
  });

  test('自動保存はインポート楽曲と別に保存される', async () => {
    await saveSongData({ kind: 'import' });
    await saveProjectAutoSave({ kind: 'autosave' });
    await expect(getProjectAutoSave()).resolves.toEqual({ kind: 'autosave' });
    await expect(getSongData()).resolves.toEqual({ kind: 'import' });
    await deleteProjectAutoSave();
    await expect(getProjectAutoSave()).resolves.toBeNull();
    await expect(getSongData()).resolves.toEqual({ kind: 'import' });
  });

  test('自動保存の確定に失敗したら reject する', async () => {
    idb.failNextCommit(quotaError());
    await expect(saveProjectAutoSave({ big: true })).rejects.toMatchObject({ name: 'QuotaExceededError' });
    await expect(getProjectAutoSave()).resolves.toBeNull();
  });

  test('clearAllData はすべて消す', async () => {
    await addRecording(recording());
    await saveProjectAutoSave({ a: 1 });
    await clearAllData();
    expect(idb.dump(DB, 'recordings')).toHaveLength(0);
    expect(idb.dump(DB, 'songs')).toHaveLength(0);
  });

  test('操作が終わると接続を閉じる（iPad で接続が切れても次の操作は新しい接続で動く）', async () => {
    await addRecording(recording());
    await getAllRecordings();
    expect(idb.openConnections.size).toBe(0);
  });
});

describe('先生ページからの楽曲の確定とバックアップ', () => {
  test('渡された楽曲を自動保存にし、それまでの作業内容をバックアップして、渡された楽曲を消す（1 回で）', async () => {
    await saveProjectAutoSave({ kind: 'mine', timestamp: 1 });
    await saveSongData({ kind: 'teacher', timestamp: 2 });
    const before = idb.log.length;
    await expect(promoteImportedSongToAutoSave()).resolves.toBe(true);
    expect(idb.log.slice(before).filter((entry) => entry.type === 'commit')).toHaveLength(1);
    const autoSave = await getProjectAutoSave();
    expect(autoSave.kind).toBe('teacher');
    await expect(getProjectAutoSaveBackup()).resolves.toEqual({ kind: 'mine', timestamp: 1 });
    await expect(getSongData()).resolves.toBeNull();
  });

  test('確定に失敗したら何も変えない（途中まで書かれた状態にならない）', async () => {
    await saveProjectAutoSave({ kind: 'mine' });
    await saveSongData({ kind: 'teacher' });
    idb.failNextCommit(quotaError());
    await expect(promoteImportedSongToAutoSave()).rejects.toBeTruthy();
    await expect(getProjectAutoSave()).resolves.toEqual({ kind: 'mine' });
    await expect(getSongData()).resolves.toEqual({ kind: 'teacher' });
    await expect(getProjectAutoSaveBackup()).resolves.toBeNull();
  });

  test('渡された楽曲が無ければ何もしない', async () => {
    await saveProjectAutoSave({ kind: 'mine' });
    await expect(promoteImportedSongToAutoSave()).resolves.toBe(false);
    await expect(getProjectAutoSave()).resolves.toEqual({ kind: 'mine' });
  });

  test('リセット用: 自動保存をバックアップに移してから消す', async () => {
    await saveProjectAutoSave({ kind: 'mine' });
    await backupAndClearProjectAutoSave();
    await expect(getProjectAutoSave()).resolves.toBeNull();
    await expect(getProjectAutoSaveBackup()).resolves.toEqual({ kind: 'mine' });
  });

  test('自動保存が無いときのリセットではバックアップを上書きしない', async () => {
    await saveProjectAutoSave({ kind: 'old' });
    await backupAndClearProjectAutoSave();
    await backupAndClearProjectAutoSave();
    await expect(getProjectAutoSaveBackup()).resolves.toEqual({ kind: 'old' });
  });
});

describe('同時に実行されたときのデータの守り方', () => {
  test('移行が同時に 2 回走っても（2 つのタブなど）重複して追加しない', async () => {
    storage.soundRecordings = JSON.stringify([
      recording({ name: 'a', createdAt: undefined }),
      recording({ name: 'b', audioData: makeDataUrl('webm', 'audio/mp4') }) // 表記を直して保存されるもの
    ]);
    const [first, second] = await Promise.all([getAllRecordings(), getAllRecordings()]);
    expect(first).toHaveLength(2);
    expect(second).toHaveLength(2);
    expect(idb.dump(DB, 'recordings')).toHaveLength(2);
  });

  test('移行した後にもう一度同じデータを移行しても重複しない（作成日時が無い古いデータも）', async () => {
    const legacy = [recording({ name: '日時なし', createdAt: undefined })];
    await migrateRecordingsFromLocalStorage(legacy);
    await migrateRecordingsFromLocalStorage(legacy);
    expect(idb.dump(DB, 'recordings')).toHaveLength(1);
  });

  test('移行中に別のタブが localStorage に追加した録音は消さない', async () => {
    const first = recording({ name: '移行する音' });
    storage.soundRecordings = JSON.stringify([first]);
    const promise = getAllRecordings();
    // 移行の途中で、別のタブ（IndexedDB に保存できなかった環境）が追記する
    storage.soundRecordings = JSON.stringify([first, recording({ name: 'あとから追加', createdAt: '2026-05-05T00:00:00Z' })]);
    await promise;
    expect(JSON.parse(storage.soundRecordings).map((r) => r.name)).toEqual(['あとから追加']);
  });

  test('重なる書き込みは順番に実行され、どちらも失われない', async () => {
    await Promise.all([
      addRecording(recording({ name: '1' })),
      addRecording(recording({ name: '2' })),
      addRecordings([recording({ name: '3' }), recording({ name: '4' })])
    ]);
    expect(idb.dump(DB, 'recordings').map((r) => r.name).sort()).toEqual(['1', '2', '3', '4']);
  });
});

describe('データベースを開く処理', () => {
  test('終わらないトランザクションは 20 秒で打ち切り、エラーにする（自動保存が止まったままにならない）', async () => {
    await getSongData(); // データベースを作っておく
    jest.useFakeTimers();
    try {
      idb.stallNextTransactions(1);
      const settled = saveProjectAutoSave({ big: true }).then(() => null, (error) => error);
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
        jest.advanceTimersByTime(1);
      }
      jest.advanceTimersByTime(20001);
      const error = await settled;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('時間内に終わりませんでした');
    } finally {
      jest.useRealTimers();
    }
  });

  test('応答が無いまま 10 秒たったらタイムアウトにする', async () => {
    jest.useFakeTimers();
    try {
      idb.openDelayMs = 60000;
      const settled = getSongData().then(() => null, (error) => error);
      await Promise.resolve();
      jest.advanceTimersByTime(10001);
      const error = await settled;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toContain('タイムアウト');
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('requestPersistentStorage（データの自動削除を防ぐ）', () => {
  const setStorage = (value) => Object.defineProperty(navigator, 'storage', { value, configurable: true });
  afterEach(() => setStorage(undefined));

  test('既に永続化されていれば persist を呼ばない', async () => {
    const persist = jest.fn();
    setStorage({ persisted: jest.fn(() => Promise.resolve(true)), persist });
    await expect(requestPersistentStorage()).resolves.toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  test('永続化を依頼して結果を返す', async () => {
    setStorage({ persisted: jest.fn(() => Promise.resolve(false)), persist: jest.fn(() => Promise.resolve(true)) });
    await expect(requestPersistentStorage()).resolves.toBe(true);
  });

  test('API が無い・失敗する場合は false', async () => {
    setStorage(undefined);
    await expect(requestPersistentStorage()).resolves.toBe(false);
    setStorage({ persist: jest.fn(() => Promise.reject(new Error('no'))) });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });
});
