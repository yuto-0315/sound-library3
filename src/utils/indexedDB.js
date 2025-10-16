// IndexedDB ヘルパー関数
const DB_NAME = 'SoundLibraryDB';
const DB_VERSION = 2; // バージョンアップ: 録音データストアを追加
const STORE_NAME_SONGS = 'songs';
const STORE_NAME_RECORDINGS = 'recordings'; // 録音データ用ストア

// データベースを開く
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      
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
  });
};

// ========== 楽曲データ関連 (既存機能) ==========

// データを保存
export const saveSongData = async (songData) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_SONGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_SONGS);
    
    // 'daw-import-song' というキーで保存
    const data = {
      id: 'daw-import-song',
      data: songData,
      timestamp: Date.now()
    };
    
    await new Promise((resolve, reject) => {
      const request = store.put(data);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return true;
  } catch (error) {
    console.error('IndexedDB save error:', error);
    throw error;
  }
};

// データを取得
export const getSongData = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_SONGS], 'readonly');
    const store = transaction.objectStore(STORE_NAME_SONGS);
    
    const data = await new Promise((resolve, reject) => {
      const request = store.get('daw-import-song');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return data ? data.data : null;
  } catch (error) {
    console.error('IndexedDB get error:', error);
    throw error;
  }
};

// データを削除
export const deleteSongData = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_SONGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_SONGS);
    
    await new Promise((resolve, reject) => {
      const request = store.delete('daw-import-song');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return true;
  } catch (error) {
    console.error('IndexedDB delete error:', error);
    throw error;
  }
};

// ========== 録音データ関連 (新機能) ==========

// 録音データを保存 (localStorageから移行またはIndexedDBに直接保存)
export const saveRecording = async (recording) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    // タグが未定義の場合は空配列を設定
    const recordingData = {
      ...recording,
      tags: recording.tags || [],
      createdAt: recording.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    
    const id = await new Promise((resolve, reject) => {
      const request = recording.id ? store.put(recordingData) : store.add(recordingData);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return id;
  } catch (error) {
    console.error('IndexedDB save recording error:', error);
    throw error;
  }
};

// すべての録音データを取得 (localStorageとマージ)
export const getAllRecordings = async () => {
  try {
    // IndexedDBから取得
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readonly');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    const recordings = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    
    // localStorageから既存データを取得 (後方互換性)
    let localStorageRecordings = [];
    try {
      const localData = localStorage.getItem('soundRecordings');
      if (localData) {
        localStorageRecordings = JSON.parse(localData);
      }
    } catch (e) {
      console.warn('localStorage読み込みエラー:', e);
    }
    
    // localStorageのデータをIndexedDBに移行
    if (localStorageRecordings.length > 0) {
      console.log(`📦 ${localStorageRecordings.length}件の録音をlocalStorageから移行中...`);
      await migrateRecordingsFromLocalStorage(localStorageRecordings);
      
      // 移行後に再度IndexedDBから取得
      const dbAfterMigration = await openDB();
      const txAfterMigration = dbAfterMigration.transaction([STORE_NAME_RECORDINGS], 'readonly');
      const storeAfterMigration = txAfterMigration.objectStore(STORE_NAME_RECORDINGS);
      
      const allRecordings = await new Promise((resolve, reject) => {
        const request = storeAfterMigration.getAll();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      
      dbAfterMigration.close();
      return allRecordings;
    }
    
    return recordings;
  } catch (error) {
    console.error('IndexedDB get recordings error:', error);
    
    // IndexedDBが失敗した場合はlocalStorageからフォールバック
    try {
      const localData = localStorage.getItem('soundRecordings');
      return localData ? JSON.parse(localData) : [];
    } catch (e) {
      console.error('localStorage フォールバックも失敗:', e);
      return [];
    }
  }
};

// 録音データを更新 (タグ追加などに使用)
export const updateRecording = async (id, updates) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    // 既存データを取得
    const existing = await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (!existing) {
      throw new Error(`Recording with id ${id} not found`);
    }
    
    // データを更新
    const updatedData = {
      ...existing,
      ...updates,
      id, // IDは変更しない
      updatedAt: new Date().toISOString()
    };
    
    await new Promise((resolve, reject) => {
      const request = store.put(updatedData);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return updatedData;
  } catch (error) {
    console.error('IndexedDB update recording error:', error);
    throw error;
  }
};

// 録音データを削除
export const deleteRecording = async (id) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    await new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return true;
  } catch (error) {
    console.error('IndexedDB delete recording error:', error);
    throw error;
  }
};

// タグで録音データを検索
export const searchRecordingsByTag = async (tag) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readonly');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    const index = store.index('tags');
    
    const recordings = await new Promise((resolve, reject) => {
      const request = index.getAll(tag);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return recordings;
  } catch (error) {
    console.error('IndexedDB search by tag error:', error);
    return [];
  }
};

// 録音にタグを追加
export const addTagToRecording = async (id, tag) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    const recording = await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (!recording) {
      throw new Error(`Recording with id ${id} not found`);
    }
    
    // タグを追加 (重複チェック)
    const tags = recording.tags || [];
    if (!tags.includes(tag)) {
      tags.push(tag);
    }
    
    const updatedRecording = {
      ...recording,
      tags,
      updatedAt: new Date().toISOString()
    };
    
    await new Promise((resolve, reject) => {
      const request = store.put(updatedRecording);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return updatedRecording;
  } catch (error) {
    console.error('IndexedDB add tag error:', error);
    throw error;
  }
};

// 録音からタグを削除
export const removeTagFromRecording = async (id, tag) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    const recording = await new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    if (!recording) {
      throw new Error(`Recording with id ${id} not found`);
    }
    
    // タグを削除
    const tags = (recording.tags || []).filter(t => t !== tag);
    
    const updatedRecording = {
      ...recording,
      tags,
      updatedAt: new Date().toISOString()
    };
    
    await new Promise((resolve, reject) => {
      const request = store.put(updatedRecording);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    
    db.close();
    return updatedRecording;
  } catch (error) {
    console.error('IndexedDB remove tag error:', error);
    throw error;
  }
};

// ========== 移行ヘルパー ==========

// localStorage からの移行ヘルパー (楽曲データ)
export const migrateFromLocalStorage = async () => {
  try {
    const oldData = localStorage.getItem('daw-import-song');
    if (oldData) {
      const parsedData = JSON.parse(oldData);
      await saveSongData(parsedData);
      localStorage.removeItem('daw-import-song');
      console.log('✓ Migrated song data from localStorage to IndexedDB');
    }
  } catch (error) {
    console.error('Migration error:', error);
  }
};

// localStorage からの移行ヘルパー (録音データ)
export const migrateRecordingsFromLocalStorage = async (recordings) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_RECORDINGS], 'readwrite');
    const store = transaction.objectStore(STORE_NAME_RECORDINGS);
    
    // 既存のデータを確認 (name で重複チェック)
    const existingRecordings = await new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    
    const existingNames = new Set(existingRecordings.map(r => r.name));
    let migratedCount = 0;
    
    for (const recording of recordings) {
      // 名前が重複している場合はスキップ
      if (existingNames.has(recording.name)) {
        console.log(`⏭️  スキップ: ${recording.name} (既に存在)`);
        continue;
      }
      
      const recordingData = {
        ...recording,
        tags: recording.tags || [],
        createdAt: recording.createdAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        source: recording.source || 'localStorage-migration'
      };
      
      // idプロパティを削除してautoIncrementに任せる
      delete recordingData.id;
      
      await new Promise((resolve, reject) => {
        const request = store.add(recordingData);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
      
      migratedCount++;
    }
    
    db.close();
    
    // 移行完了後、localStorageをクリア
    if (migratedCount > 0) {
      localStorage.removeItem('soundRecordings');
      console.log(`✓ ${migratedCount}件の録音をlocalStorageからIndexedDBに移行しました`);
    }
    
    return migratedCount;
  } catch (error) {
    console.error('Recording migration error:', error);
    throw error;
  }
};

// すべてのデータをクリア (デバッグ用)
export const clearAllData = async () => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME_SONGS, STORE_NAME_RECORDINGS], 'readwrite');
    
    await Promise.all([
      new Promise((resolve, reject) => {
        const request = transaction.objectStore(STORE_NAME_SONGS).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      }),
      new Promise((resolve, reject) => {
        const request = transaction.objectStore(STORE_NAME_RECORDINGS).clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      })
    ]);
    
    db.close();
    console.log('✓ すべてのIndexedDBデータをクリアしました');
    return true;
  } catch (error) {
    console.error('Clear data error:', error);
    throw error;
  }
};

