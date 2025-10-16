// IndexedDB ヘルパー関数
const DB_NAME = 'SoundLibraryDB';
const DB_VERSION = 1;
const STORE_NAME = 'songs';

// データベースを開く
const openDB = () => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

// データを保存
export const saveSongData = async (songData) => {
  try {
    const db = await openDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
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
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);
    
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
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    
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

// localStorage からの移行ヘルパー
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
