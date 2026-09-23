// テスト用のインメモリ IndexedDB。
// src/utils/indexedDB.js が使う機能（open / upgrade / transaction / get / put / add / delete /
// getAll / clear / index.getAll）だけを、実物と同じ非同期のタイミングで再現する。
// トランザクションは complete まで反映されず、abort すると変更が捨てられる。
// 範囲が重なる書き込みトランザクションは、本物と同じく作られた順に 1 つずつ実行する。

const clone = (value) => {
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return new Date(value.getTime());
  if (typeof Blob !== 'undefined' && value instanceof Blob) return value;
  if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) return value.slice(0);
  if (Array.isArray(value)) return value.map(clone);
  const result = {};
  Object.keys(value).forEach((key) => {
    if (value[key] !== undefined) result[key] = clone(value[key]);
  });
  return result;
};

const createDomError = (name, message) => {
  const error = new Error(message || name);
  error.name = name;
  return error;
};

const compareKeys = (a, b) => {
  if (typeof a === typeof b) return a < b ? -1 : a > b ? 1 : 0;
  return typeof a === 'number' ? -1 : 1;
};

const later = (fn) => setTimeout(fn, 0);

class FakeRequest {
  constructor(source, transaction) {
    this.source = source;
    this.transaction = transaction;
    this.result = undefined;
    this.error = null;
    this.readyState = 'pending';
    this.onsuccess = null;
    this.onerror = null;
  }
}

class FakeIndex {
  constructor(store, definition) {
    this.store = store;
    this.name = definition.name;
    this.keyPath = definition.keyPath;
    this.multiEntry = !!definition.multiEntry;
  }

  getAll(query) {
    return this.store.queueRequest((records) => records
      .filter((record) => {
        const value = record[this.keyPath];
        if (query === undefined) return value !== undefined;
        if (this.multiEntry && Array.isArray(value)) return value.includes(query);
        return value === query;
      })
      .map(clone));
  }
}

class FakeObjectStore {
  constructor(transaction, name) {
    this.transaction = transaction;
    this.name = name;
    const schema = transaction.db.backend.schema[name];
    this.keyPath = schema.keyPath;
    this.autoIncrement = schema.autoIncrement;
  }

  get data() {
    return this.transaction.working[this.name];
  }

  queueRequest(operation) {
    return this.transaction.queueRequest(this, () => operation(Array.from(this.data.records.values())));
  }

  resolveKey(value) {
    let key = value[this.keyPath];
    if (key === undefined && this.autoIncrement) {
      key = this.data.nextKey;
      value[this.keyPath] = key;
    }
    if (key === undefined || key === null || (typeof key === 'number' && isNaN(key))) {
      throw createDomError('DataError', 'Invalid key');
    }
    if (typeof key === 'number' && this.autoIncrement && key >= this.data.nextKey) {
      this.data.nextKey = Math.floor(key) + 1;
    }
    return key;
  }

  put(value) {
    this.transaction.assertWritable();
    return this.transaction.queueRequest(this, () => {
      const copy = clone(value);
      const key = this.resolveKey(copy);
      this.data.records.set(key, copy);
      this.transaction.recordChange(this.name, { type: 'set', key, value: copy });
      return key;
    });
  }

  add(value) {
    this.transaction.assertWritable();
    return this.transaction.queueRequest(this, () => {
      const copy = clone(value);
      const key = this.resolveKey(copy);
      if (this.data.records.has(key)) {
        throw createDomError('ConstraintError', 'Key already exists');
      }
      this.data.records.set(key, copy);
      this.transaction.recordChange(this.name, { type: 'set', key, value: copy });
      return key;
    });
  }

  get(key) {
    return this.transaction.queueRequest(this, () => clone(this.data.records.get(key)));
  }

  getAll() {
    return this.transaction.queueRequest(this, () => Array.from(this.data.records.entries())
      .sort(([a], [b]) => compareKeys(a, b))
      .map(([, value]) => clone(value)));
  }

  delete(key) {
    this.transaction.assertWritable();
    return this.transaction.queueRequest(this, () => {
      this.data.records.delete(key);
      this.transaction.recordChange(this.name, { type: 'delete', key });
      return undefined;
    });
  }

  clear() {
    this.transaction.assertWritable();
    return this.transaction.queueRequest(this, () => {
      this.data.records.clear();
      this.transaction.recordChange(this.name, { type: 'clear' });
      return undefined;
    });
  }

  index(name) {
    const definition = this.transaction.db.backend.schema[this.name].indexes[name];
    if (!definition) throw createDomError('NotFoundError', `Index ${name} not found`);
    return new FakeIndex(this, definition);
  }

  createIndex(name, keyPath, options = {}) {
    this.transaction.db.backend.schema[this.name].indexes[name] = { name, keyPath, multiEntry: !!options.multiEntry };
    return new FakeIndex(this, this.transaction.db.backend.schema[this.name].indexes[name]);
  }
}

class FakeTransaction {
  constructor(db, storeNames, mode, factory) {
    this.db = db;
    this.factory = factory;
    this.storeNames = storeNames;
    this.mode = mode;
    this.error = null;
    this.oncomplete = null;
    this.onabort = null;
    this.onerror = null;
    this.finished = false;
    this.pending = 0;
    this.changes = [];
    this.waiting = [];
    this.started = false;
    this.stalled = factory.takeStall();
    this.done = new Promise((resolve) => { this.resolveDone = resolve; });

    // 本物と同じく、範囲が重なるトランザクションのうち書き込みを含むものは作られた順に 1 つずつ実行する
    const blockers = factory.activeTransactions.filter((other) =>
      other.storeNames.some((name) => storeNames.includes(name)) &&
      (other.mode === 'readwrite' || mode === 'readwrite'));
    factory.activeTransactions.push(this);
    Promise.all(blockers.map((other) => other.done)).then(() => this.start());
  }

  start() {
    if (this.finished) return;
    // 変更は作業用コピーに対して行い、complete 時に反映する
    this.working = {};
    this.storeNames.forEach((name) => {
      const source = this.db.backend.stores[name];
      this.working[name] = { records: new Map(Array.from(source.records.entries()).map(([k, v]) => [k, clone(v)])), nextKey: source.nextKey };
    });
    this.started = true;
    if (this.stalled) return; // 応答しないトランザクションの再現
    const waiting = this.waiting;
    this.waiting = [];
    waiting.forEach((run) => later(run));
    this.scheduleCommitCheck();
  }

  release() {
    this.factory.activeTransactions = this.factory.activeTransactions.filter((tx) => tx !== this);
    this.resolveDone();
  }

  objectStore(name) {
    if (!this.storeNames.includes(name)) {
      throw createDomError('NotFoundError', `Store ${name} is not in this transaction`);
    }
    return new FakeObjectStore(this, name);
  }

  recordChange(storeName, change) {
    this.changes.push({ storeName, change });
  }

  assertWritable() {
    if (this.mode === 'readonly') throw createDomError('ReadOnlyError', 'Transaction is readonly');
    if (this.finished) throw createDomError('TransactionInactiveError', 'Transaction has finished');
  }

  queueRequest(source, operation) {
    if (this.finished) throw createDomError('TransactionInactiveError', 'Transaction has finished');
    const request = new FakeRequest(source, this);
    this.pending++;
    const run = () => {
      if (this.finished) return;
      try {
        request.result = operation();
        request.readyState = 'done';
        if (request.onsuccess) request.onsuccess({ target: request });
      } catch (error) {
        request.error = error;
        request.readyState = 'done';
        let prevented = false;
        const event = { target: request, preventDefault: () => { prevented = true; } };
        if (request.onerror) request.onerror(event);
        if (this.onerror) this.onerror(event);
        if (!prevented) {
          this.pending--;
          this.abortWith(error);
          return;
        }
      }
      this.pending--;
      this.scheduleCommitCheck();
    };
    if (this.started && !this.stalled) {
      later(run);
    } else {
      this.waiting.push(run);
    }
    return request;
  }

  scheduleCommitCheck() {
    later(() => {
      if (this.finished || !this.started || this.stalled || this.pending > 0) return;
      this.commit();
    });
  }

  commit() {
    if (this.finished) return;
    const failure = this.factory.takeCommitFailure(this);
    if (failure) {
      this.abortWith(failure);
      return;
    }
    this.finished = true;
    // 読み取り専用は何も書き戻さない。書き込みは「このトランザクションで行った変更」だけを反映する
    // （開始時のコピーで丸ごと上書きすると、並行して完了した別の書き込みを消してしまう）
    this.changes.forEach(({ storeName, change }) => {
      const store = this.db.backend.stores[storeName];
      if (change.type === 'set') store.records.set(change.key, change.value);
      if (change.type === 'delete') store.records.delete(change.key);
      if (change.type === 'clear') store.records.clear();
    });
    Object.keys(this.working).forEach((name) => {
      const store = this.db.backend.stores[name];
      store.nextKey = Math.max(store.nextKey, this.working[name].nextKey);
    });
    this.factory.log.push({ type: 'commit', mode: this.mode, stores: this.storeNames });
    this.release();
    if (this.oncomplete) this.oncomplete({ target: this });
  }

  abortWith(error) {
    if (this.finished) return;
    this.finished = true;
    this.error = error;
    this.factory.log.push({ type: 'abort', mode: this.mode, stores: this.storeNames, error });
    this.release();
    later(() => {
      if (this.onabort) this.onabort({ target: this });
    });
  }

  abort() {
    if (this.finished) throw createDomError('InvalidStateError', 'Transaction has finished');
    this.abortWith(null);
  }
}

class FakeDatabase {
  constructor(backend, factory) {
    this.backend = backend;
    this.factory = factory;
    this.name = backend.name;
    this.version = backend.version;
    this.closed = false;
    this.onversionchange = null;
    this.upgradeTransaction = null;
  }

  get objectStoreNames() {
    const names = Object.keys(this.backend.schema);
    return { contains: (name) => names.includes(name), length: names.length };
  }

  createObjectStore(name, options = {}) {
    this.backend.schema[name] = { keyPath: options.keyPath, autoIncrement: !!options.autoIncrement, indexes: {} };
    this.backend.stores[name] = { records: new Map(), nextKey: 1 };
    const store = {
      createIndex: (indexName, keyPath, indexOptions = {}) => {
        this.backend.schema[name].indexes[indexName] = { name: indexName, keyPath, multiEntry: !!indexOptions.multiEntry };
      }
    };
    return store;
  }

  transaction(storeNames, mode = 'readonly') {
    if (this.closed) throw createDomError('InvalidStateError', 'The database connection is closing');
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    names.forEach((name) => {
      if (!this.backend.schema[name]) throw createDomError('NotFoundError', `Store ${name} not found`);
    });
    this.factory.transactionCount++;
    return new FakeTransaction(this, names, mode, this.factory);
  }

  close() {
    this.closed = true;
    this.factory.openConnections.delete(this);
  }
}

export const createFakeIndexedDB = () => {
  const databases = {};
  const factory = {
    log: [],
    transactionCount: 0,
    openConnections: new Set(),
    commitFailures: [],
    activeTransactions: [],
    stallCount: 0,
    openFailure: null,
    openDelayMs: 0,
    // 次の count 個のトランザクションを、いつまでも終わらない状態にする（WebKit の不具合の再現）
    stallNextTransactions(count = 1) {
      factory.stallCount += count;
    },
    takeStall() {
      if (factory.stallCount <= 0) return false;
      factory.stallCount -= 1;
      return true;
    },
    // 次のトランザクションの commit を失敗させる（容量不足などの再現）
    failNextCommit(error, predicate = () => true) {
      factory.commitFailures.push({ error, predicate });
    },
    takeCommitFailure(transaction) {
      const index = factory.commitFailures.findIndex((entry) => entry.predicate(transaction));
      if (index === -1) return null;
      return factory.commitFailures.splice(index, 1)[0].error;
    },
    // 保存されている内容を直接読む（テストの検証用）
    dump(dbName, storeName) {
      const backend = databases[dbName];
      if (!backend || !backend.stores[storeName]) return [];
      return Array.from(backend.stores[storeName].records.values()).map(clone);
    },
    // テスト前に直接データを入れる（schema が無ければ作る）
    seed(dbName, storeName, records, { keyPath = 'id', autoIncrement = false } = {}) {
      const backend = databases[dbName] || (databases[dbName] = { name: dbName, version: 0, schema: {}, stores: {} });
      if (!backend.schema[storeName]) {
        backend.schema[storeName] = { keyPath, autoIncrement, indexes: {} };
        backend.stores[storeName] = { records: new Map(), nextKey: 1 };
      }
      const store = backend.stores[storeName];
      records.forEach((record) => {
        const copy = clone(record);
        if (copy[keyPath] === undefined && autoIncrement) copy[keyPath] = store.nextKey;
        if (typeof copy[keyPath] === 'number' && copy[keyPath] >= store.nextKey) store.nextKey = Math.floor(copy[keyPath]) + 1;
        store.records.set(copy[keyPath], copy);
      });
    }
  };

  const indexedDB = {
    open(name, version) {
      const request = new FakeRequest(null, null);
      request.onupgradeneeded = null;
      request.onblocked = null;
      setTimeout(() => {
        if (factory.openFailure) {
          request.error = factory.openFailure;
          if (request.onerror) request.onerror({ target: request });
          return;
        }
        const backend = databases[name] || (databases[name] = { name, version: 0, schema: {}, stores: {} });
        const db = new FakeDatabase(backend, factory);
        if (version > backend.version) {
          backend.version = version;
          db.version = version;
          request.result = db;
          if (request.onupgradeneeded) request.onupgradeneeded({ target: request, oldVersion: 0, newVersion: version });
        }
        request.result = db;
        factory.openConnections.add(db);
        if (request.onsuccess) request.onsuccess({ target: request });
      }, factory.openDelayMs);
      return request;
    },
    deleteDatabase(name) {
      delete databases[name];
      const request = new FakeRequest(null, null);
      later(() => request.onsuccess && request.onsuccess({ target: request }));
      return request;
    }
  };

  return { indexedDB, factory };
};

// グローバルの indexedDB を差し替える。戻り値の factory でデータの確認や失敗の注入ができる。
export const installFakeIndexedDB = () => {
  const { indexedDB, factory } = createFakeIndexedDB();
  Object.defineProperty(window, 'indexedDB', { value: indexedDB, configurable: true, writable: true });
  return factory;
};
