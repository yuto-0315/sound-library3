import React from 'react';
import { render } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';

/**
 * React Routerを使用するコンポーネントのテスト用レンダラー
 * @param {React.Component} component - レンダリングするコンポーネント
 * @param {Object} options - レンダリングオプション
 * @param {string[]} options.initialEntries - 初期のルート履歴
 * @param {string} options.initialIndex - 初期のルートインデックス
 * @returns {Object} testing-libraryのrenderの戻り値
 */
export const renderWithRouter = (component, options = {}) => {
  const { 
    initialEntries = ['/'], 
    initialIndex = 0,
    ...renderOptions 
  } = options;

  const Wrapper = ({ children }) => (
    <MemoryRouter initialEntries={initialEntries} initialIndex={initialIndex}>
      {children}
    </MemoryRouter>
  );

  return render(component, { wrapper: Wrapper, ...renderOptions });
};

/**
 * BrowserRouterを使用するコンポーネントのテスト用レンダラー
 * @param {React.Component} component - レンダリングするコンポーネント
 * @param {Object} options - レンダリングオプション
 * @returns {Object} testing-libraryのrenderの戻り値
 */
export const renderWithBrowserRouter = (component, options = {}) => {
  const Wrapper = ({ children }) => (
    <BrowserRouter>
      {children}
    </BrowserRouter>
  );

  return render(component, { wrapper: Wrapper, ...options });
};

/**
 * 音声ファイルのモックデータを作成
 * @param {Object} options - ファイルオプション
 * @param {string} options.name - ファイル名
 * @param {string} options.type - MIMEタイプ
 * @param {number} options.size - ファイルサイズ
 * @returns {File} モックファイル
 */
export const createMockAudioFile = (options = {}) => {
  const {
    name = 'test-audio.mp3',
    type = 'audio/mp3',
    size = 1024
  } = options;

  const content = new Array(size).fill('a').join('');
  return new File([content], name, { type });
};

/**
 * MediaRecorderイベントをシミュレート
 * @param {Object} mediaRecorder - MediaRecorderのモックインスタンス
 * @param {string} eventType - イベントタイプ
 * @param {any} data - イベントデータ
 */
export const simulateMediaRecorderEvent = (mediaRecorder, eventType, data = null) => {
  const event = new Event(eventType);
  if (data) {
    event.data = data;
  }
  
  // addEventListener で登録されたハンドラーを呼び出す
  const handlers = mediaRecorder.addEventListener.mock.calls
    .filter(call => call[0] === eventType)
    .map(call => call[1]);
  
  handlers.forEach(handler => handler(event));
};

/**
 * キーボードイベントをシミュレート
 * @param {string} key - キー名
 * @param {Object} options - イベントオプション
 * @returns {KeyboardEvent} キーボードイベント
 */
export const createKeyboardEvent = (key, options = {}) => {
  return new KeyboardEvent('keydown', {
    key,
    code: key,
    bubbles: true,
    cancelable: true,
    ...options
  });
};

/**
 * ドラッグ&ドロップイベントをシミュレート
 * @param {File[]} files - ドロップするファイル
 * @returns {Object} ドラッグイベント
 */
export const createDragEvent = (files = []) => {
  const event = new Event('drop', { bubbles: true });
  event.dataTransfer = {
    files,
    items: files.map(file => ({
      kind: 'file',
      type: file.type,
      getAsFile: () => file
    }))
  };
  return event;
};

/**
 * 音声再生のモック
 * @param {number} duration - 再生時間（秒）
 * @returns {Promise} 再生完了のPromise
 */
export const mockAudioPlayback = (duration = 1) => {
  return new Promise(resolve => {
    setTimeout(() => {
      resolve();
    }, duration * 100); // 実際の時間より短縮
  });
};

/**
 * ローカルストレージにテストデータを設定
 * @param {string} key - ストレージキー
 * @param {any} value - 保存する値
 */
export const setLocalStorageItem = (key, value) => {
  const serializedValue = typeof value === 'string' ? value : JSON.stringify(value);
  window.localStorage.setItem(key, serializedValue);
};

/**
 * ローカルストレージからテストデータを取得
 * @param {string} key - ストレージキー
 * @returns {any} 取得した値
 */
export const getLocalStorageItem = (key) => {
  const value = window.localStorage.getItem(key);
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
};

/**
 * テスト用のアクセシビリティチェッカー
 * @param {HTMLElement} element - チェックする要素
 * @returns {Object} アクセシビリティチェック結果
 */
export const checkAccessibility = (element) => {
  const results = {
    hasRole: !!element.getAttribute('role'),
    hasAriaLabel: !!element.getAttribute('aria-label'),
    hasAriaLabelledBy: !!element.getAttribute('aria-labelledby'),
    hasAriaDescribedBy: !!element.getAttribute('aria-describedby'),
    isFocusable: element.tabIndex >= 0 || ['A', 'BUTTON', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName),
    isInteractive: ['BUTTON', 'A', 'INPUT', 'SELECT', 'TEXTAREA'].includes(element.tagName) || 
                   element.getAttribute('role') === 'button' ||
                   element.getAttribute('onclick') !== null
  };

  return results;
};

/**
 * 非同期テスト用のヘルパー関数
 * @param {Function} asyncFn - 非同期関数
 * @param {number} timeout - タイムアウト時間（ミリ秒）
 * @returns {Promise} 実行結果
 */
export const waitForAsync = async (asyncFn, timeout = 1000) => {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout after ${timeout}ms`));
    }, timeout);

    asyncFn()
      .then(result => {
        clearTimeout(timer);
        resolve(result);
      })
      .catch(error => {
        clearTimeout(timer);
        reject(error);
      });
  });
};

/**
 * エラーメッセージのアサーション用ヘルパー
 * @param {Function} fn - エラーを投げる関数
 * @param {string} expectedMessage - 期待するエラーメッセージ
 */
export const expectToThrow = (fn, expectedMessage) => {
  let error;
  try {
    fn();
  } catch (e) {
    error = e;
  }
  
  expect(error).toBeDefined();
  if (expectedMessage) {
    expect(error.message).toContain(expectedMessage);
  }
};
