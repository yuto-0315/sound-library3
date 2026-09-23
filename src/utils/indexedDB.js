// IndexedDB ヘルパー関数
import { normalizeAudioDataUrl } from './audio';

const DB_NAME = 'SoundLibraryDB';
const DB_VERSION = 2; // バージョンアップ: 録音データストアを追加
const STORE_NAME_SONGS = 'songs';
const STORE_NAME_RECORDINGS = 'recordings'; // 録音データ用ストア

const IMPORT_SONG_KEY = 'daw-import-song'; // 先生ページから DAW へ渡す楽曲
const AUTOSAVE_KEY = 'daw-autosave'; // DAW の自動保存
const LEGACY_RECORDINGS_KEY = 'soundRecordings'; // 旧バージョンの localStorage キー

const OPEN_TIMEOUT_MS = 10000;

// ========== 接続 ==========

// Safari 14.1〜15 には「ページ読み込み直後の indexedDB.open が永遠に応答しない」不具合がある。
// indexedDB.databases() が応答するまで待つと回避できる (safari-14-idb-fix と同じ方法)。
let safariReadyPromise = null;

const waitForSafariIndexedDB = () => {
  if (safariReadyPromise) return safariReadyPromise;
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent || '' : '';
  const isSafari = typeof navigator !== 'undefined' && !navigator.userAgentData &&
    /Safari\//.test(ua) && !/Chrom(e|ium)\//.test(ua);
  if (!isSafari || typeof indexedDB === 'undefined' || typeof indexedDB.databases !== 'function') {
    safariReadyPromise = Promise.resolve();
    return safariReadyPromise;
  }
  safariReadyPromise = new Promise((resolve) => {
    let intervalId = null;
    let timeoutId = null;
    const finish = () => {
      clearInterval(intervalId);
      clearTimeout(timeoutId);
      resolve();
    };
    const tryDatabases = () => {
      Promise.resolve(indexedDB.databases()).then(finish, finish);
    };
    intervalId = setInterval(tryDatabases, 100);
    timeoutId = setTimeout(finish, OPEN_TIMEOUT_MS);
    tryDatabases();
  });
  return safariReadyPromise;
};

const upgradeDatabase = (db) => {
  // 楽曲データ用ストア
  if (!db.objectStoreNames.contains(STORE_NAME_SONGS)) {
    db.createObjectStore(STORE_NAME_SONGS, { keyPath: 'id' });
  }

  // 録音データ用ストア (タグ検索用のインデックス付き)
  if (!db.objectStoreNames.contains(STORE_NAME_RECORDINGS)) {
    const recordingStore = db.createObjectStore(STORE_NAME_RECORDINGS, { keyPath: 'id', autoIncrement: true });
    recordingStore.createIndex('name', 'name', { unique: false });
    recordingStore.createIndex('tags', 'tags', { unique: false, multiEntry: true }); // タグで検索可能
    recordingStore.createIndex('createdAt', 'createdAt', { unique: false });
  }
};

// 操作ごとに接続を開いて閉じる。
// iPad はアプリ切り替え時に IndexedDB の接続を切ることがあるため、接続を使い回さない。
const openDB = () => waitForSafariIndexedDB().then(() => new Promise((resolve, reject) => {
  if (typeof indexedDB === 'undefined' || !indexedDB) {
    reject(new Error('このブラウザでは IndexedDB が使えません'));
    return;
  }

  let settled = false;
  const timeoutId = setTimeout(() => {
    if (settled) return;
    settled = true;
    reject(new Error('データベースを開けませんでした（タイムアウト）。他のタブを閉じてから再読み込みしてください。'));
  }, OPEN_TIMEOUT_MS);

  let request;
  try {
    request = indexedDB.open(DB_NAME, DB_VERSION);
  } catch (error) {
    settled = true;
    clearTimeout(timeoutId);
    reject(error);
    return;
  }

  request.onupgradeneeded = () => upgradeDatabase(request.result);
  request.onsuccess = () => {
    const db = request.result;
    if (settled) {
      db.close();
      return;
    }
    settled = true;
    clearTimeout(timeoutId);
    // 別タブで新しいバージョンが開かれたら接続を譲る（譲らないと相手のアップグレードが止まる）
    db.onversionchange = () => db.close();
    resolve(db);
  };
  request.onerror = () => {
    if (settled) return;
    settled = true;
    clearTimeout(timeoutId);
    reject(request.error);
  };
  request.onblocked = () => {
    console.warn('IndexedDB のアップグレードが他のタブにブロックされています');
  };
}));

// トランザクションを実行し、complete（ディスクへの書き込み完了）まで待つ。
// request の onsuccess 時点では、まだ保存が確定していない（容量不足などで abort されうる）。
// executor(tx, setResult, abort) は同期的にリクエストを発行すること。
const runTransaction = (storeNames, mode, executor) => openDB().then((db) => new Promise((resolve, reject) => {
  let result;
  let executorError = null;
  let tx;

  try {
    tx = db.transaction(storeNames, mode);
  } catch (error) {
    db.close();
    reject(error);
    return;
  }

  tx.oncomplete = () => {
    db.close();
    resolve(result);
  };
  tx.onabort = () => {
    db.close();
    reject(executorError || tx.error || new Error('データベースの処理が中断されました'));
  };

  const abort = (error) => {
    executorError = error;
    try {
      tx.abort();
    } catch (abortError) {
      // 既に終了している
    }
  };

  try {
    executor(tx, (value) => { result = value; }, abort);
  } catch (error) {
    abort(error);
  }
}));

export const isQuotaExceededError = (error) => !!error && (
  error.name === 'QuotaExceededError' ||
  error.name === 'NS_ERROR_DOM_QUOTA_REACHED' ||
  error.code === 22
);

// ブラウザによる自動削除（Safari は 7 日間使わないサイトのデータを消すことがある）を防ぐよう依頼する
export const requestPersistentStorage = async () => {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage || typeof navigator.storage.persist !== 'function') {
      return false;
    }
    if (typeof navigator.storage.persisted === 'function' && await navigator.storage.persisted()) {
      return true;
    }
    return await navigator.storage.persist();
  } catch (error) {
    console.warn('永続ストレージの要求に失敗しました:', error);
    return false;
  }
};

// ========== songs ストア（キー付きの単一レコード） ==========

const putSongRecord = (key, data) => runTransaction([STORE_NAME_SONGS], 'readwrite', (tx) => {
  tx.objectStore(STORE_NAME_SONGS).put({ id: key, data, timestamp: Date.now() });
});

const getSongRecord = (key) => runTransaction([STORE_NAME_SONGS], 'readonly', (tx, setResult) => {
  const request = tx.objectStore(STORE_NAME_SONGS).get(key);
  request.onsuccess = () => setResult(request.result ? request.result.data : null);
});

const deleteSongRecord = (key) => runTransaction([STORE_NAME_SONGS], 'readwrite', (tx) => {
  tx.objectStore(STORE_NAME_SONGS).delete(key);
});

// 先生ページから DAW に渡す楽曲
export const saveSongData = async (songData) => {
  await putSongRecord(IMPORT_SONG_KEY, songData);
  return true;
};

export const getSongData = () => getSongRecord(IMPORT_SONG_KEY);

export const deleteSongData = async () => {
  await deleteSongRecord(IMPORT_SONG_KEY);
  return true;
};

// DAW の自動保存（localStorage は 5MB 制限ですぐ溢れるため IndexedDB に保存する）
export const saveProjectAutoSave = async (projectData) => {
  await putSongRecord(AUTOSAVE_KEY, projectData);
  return true;
};

export const getProjectAutoSave = () => getSongRecord(AUTOSAVE_KEY);

export const deleteProjectAutoSave = async () => {
  await deleteSongRecord(AUTOSAVE_KEY);
  return true;
};

// ========== 録音データ ==========

const isValidKey = (id) => (typeof id === 'number' && isFinite(id)) || (typeof id === 'string' && id !== '');

// 保存してはいけない一時的な値（Blob や blob: URL）を取り除く
const toStoredRecording = (recording) => {
  const { audioBlob, url, ...rest } = recording;
  const createdAt = rest.createdAt instanceof Date ? rest.createdAt.toISOString() : rest.createdAt;
  return {
    ...rest,
    audioData: rest.audioData ? normalizeAudioDataUrl(rest.audioData) : rest.audioData,
    tags: Array.isArray(rest.tags) ? rest.tags : [],
    createdAt: createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
};

// 読み込んだデータの MIME 表記を中身に合わせる（旧データは mp4 でも audio/wav と書かれている）
const fromStoredRecording = (recording) => ({
  ...recording,
  tags: Array.isArray(recording.tags) ? recording.tags : [],
  audioData: recording.audioData ? normalizeAudioDataUrl(recording.audioData) : recording.audioData
});

// 新しい録音を追加する（ID は IndexedDB が採番する）。追加された ID を返す。
export const addRecording = (recording) => runTransaction([STORE_NAME_RECORDINGS], 'readwrite', (tx, setResult) => {
  const { id, ...data } = toStoredRecording(recording);
  const request = tx.objectStore(STORE_NAME_RECORDINGS).add(data);
  request.onsuccess = () => setResult(request.result);
});

// 複数の録音をまとめて追加する（途中で失敗したら 1 件も保存されない）。追加された ID の配列を返す。
export const addRecordings = (recordings) => runTransaction([STORE_NAME_RECORDINGS], 'readwrite', (tx, setResult) => {
  const store = tx.objectStore(STORE_NAME_RECORDINGS);
  const ids = new Array(recordings.length);
  recordings.forEach((recording, index) => {
    const { id, ...data } = toStoredRecording(recording);
    const request = store.add(data);
    request.onsuccess = () => { ids[index] = request.result; };
  });
  setResult(ids);
});

// ID があれば上書き、無ければ追加する。保存された ID を返す。
export const saveRecording = (recording) => {
  if (!isValidKey(recording.id)) {
    return addRecording(recording);
  }
  return runTransaction([STORE_NAME_RECORDINGS], 'readwrite', (tx, setResult) => {
    const request = tx.objectStore(STORE_NAME_RECORDINGS).put(toStoredRecording(recording));
    request.onsuccess = () => setResult(request.result);
  });
};

const getAllRecordingsFromDB = () => runTransaction([STORE_NAME_RECORDINGS], 'readonly', (tx, setResult) => {
  const request = tx.objectStore(STORE_NAME_RECORDINGS).getAll();
  request.onsuccess = () => setResult(request.result || []);
});

const readLegacyRecordings = () => {
  try {
    const localData = localStorage.getItem(LEGACY_RECORDINGS_KEY);
    const parsed = localData ? JSON.parse(localData) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    console.warn('localStorage読み込みエラー:', error);
    return [];
  }
};

// すべての録音データを取得（旧 localStorage のデータがあれば先に移行する）
export const getAllRecordings = async () => {
  const legacyRecordings = readLegacyRecordings();
  try {
    if (legacyRecordings.length > 0) {
      try {
        await migrateRecordingsFromLocalStorage(legacyRecordings);
      } catch (migrationError) {
        // 移行に失敗しても localStorage のデータは消さないので次回また試せる
        console.error('録音データの移行に失敗しました:', migrationError);
      }
    }
    const recordings = await getAllRecordingsFromDB();
    return recordings.map(fromStoredRecording);
  } catch (error) {
    console.error('IndexedDB get recordings error:', error);
    // IndexedDB が使えない環境では、少なくとも旧データは表示する
    if (legacyRecordings.length > 0) {
      return legacyRecordings.map(fromStoredRecording);
    }
    throw error;
  }
};

// 既存レコードを読み込み → 変更 → 保存 を 1 つのトランザクションで行う
const modifyRecording = (id, modify) => runTransaction([STORE_NAME_RECORDINGS], 'readwrite', (tx, setResult, abort) => {
  const store = tx.objectStore(STORE_NAME_RECORDINGS);
  const getRequest = store.get(id);
  getRequest.onsuccess = () => {
    const existing = getRequest.result;
    if (!existing) {
      abort(new Error(`Recording with id ${id} not found`));
      return;
    }
    const updated = {
      ...modify(existing),
      id, // IDは変更しない
      updatedAt: new Date().toISOString()
    };
    store.put(updated);
    setResult(fromStoredRecording(updated));
  };
});

// 録音データを更新 (タグ追加などに使用)
export const updateRecording = (id, updates) => modifyRecording(id, (existing) => {
  const { audioBlob, url, ...safeUpdates } = updates;
  return { ...existing, ...safeUpdates };
});

// 録音データを削除
export const deleteRecording = async (id) => {
  await runTransaction([STORE_NAME_RECORDINGS], 'readwrite', (tx) => {
    tx.objectStore(STORE_NAME_RECORDINGS).delete(id);
  });
  return true;
};

// タグで録音データを検索
export const searchRecordingsByTag = async (tag) => {
  try {
    const recordings = await runTransaction([STORE_NAME_RECORDINGS], 'readonly', (tx, setResult) => {
      const request = tx.objectStore(STORE_NAME_RECORDINGS).index('tags').getAll(tag);
      request.onsuccess = () => setResult(request.result || []);
    });
    return recordings.map(fromStoredRecording);
  } catch (error) {
    console.error('IndexedDB search by tag error:', error);
    return [];
  }
};

// 録音にタグを追加 (重複は追加しない)
export const addTagToRecording = (id, tag) => modifyRecording(id, (existing) => {
  const tags = Array.isArray(existing.tags) ? existing.tags : [];
  return { ...existing, tags: tags.includes(tag) ? tags : [...tags, tag] };
});

// 録音からタグを削除
export const removeTagFromRecording = (id, tag) => modifyRecording(id, (existing) => ({
  ...existing,
  tags: (existing.tags || []).filter((t) => t !== tag)
}));

// ========== 移行ヘルパー ==========

// localStorage からの移行ヘルパー (楽曲データ)
export const migrateFromLocalStorage = async () => {
  try {
    const oldData = localStorage.getItem(IMPORT_SONG_KEY);
    if (oldData) {
      await saveSongData(JSON.parse(oldData));
      localStorage.removeItem(IMPORT_SONG_KEY);
      console.log('✓ Migrated song data from localStorage to IndexedDB');
    }
  } catch (error) {
    console.error('Migration error:', error);
  }
};

// 同じ録音かどうかの判定用。名前だけで判定すると「同じ名前の別の録音」が消えてしまうため、
// 作成日時と音声データの長さも含める。
const recordingFingerprint = (recording) => {
  const time = recording.createdAt ? new Date(recording.createdAt).getTime() : '';
  const size = recording.audioData ? recording.audioData.length : 0;
  return `${recording.name}|${time}|${size}`;
};

// localStorage からの移行ヘルパー (録音データ)。
// すべて 1 つのトランザクションで追加し、完了を確認してから localStorage を消す。
export const migrateRecordingsFromLocalStorage = async (recordings) => {
  const migratedCount = await runTransaction([STORE_NAME_RECORDINGS], 'readwrite', (tx, setResult) => {
    const store = tx.objectStore(STORE_NAME_RECORDINGS);
    const getAllRequest = store.getAll();
    getAllRequest.onsuccess = () => {
      const existing = new Set((getAllRequest.result || []).map(recordingFingerprint));
      let count = 0;
      recordings.forEach((recording) => {
        if (!recording || existing.has(recordingFingerprint(recording))) return;
        existing.add(recordingFingerprint(recording));
        const { id, ...data } = toStoredRecording({
          ...recording,
          source: recording.source || 'localStorage-migration'
        });
        store.add(data);
        count++;
      });
      setResult(count);
    };
  });

  // ここに来た時点で全件の保存が確定している（重複分は既に IndexedDB にある）
  localStorage.removeItem(LEGACY_RECORDINGS_KEY);
  if (migratedCount > 0) {
    console.log(`✓ ${migratedCount}件の録音をlocalStorageからIndexedDBに移行しました`);
  }
  return migratedCount;
};

// すべてのデータをクリア (デバッグ用)
export const clearAllData = async () => {
  await runTransaction([STORE_NAME_SONGS, STORE_NAME_RECORDINGS], 'readwrite', (tx) => {
    tx.objectStore(STORE_NAME_SONGS).clear();
    tx.objectStore(STORE_NAME_RECORDINGS).clear();
  });
  console.log('✓ すべてのIndexedDBデータをクリアしました');
  return true;
};
