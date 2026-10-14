// setupTests.js の localStorage モックは jest.fn() で、CRA の既定設定 (resetMocks: true) により
// テストごとに中身が空になる。各テストの beforeEach で呼び、実際に値を覚える実装を入れる。
export const installMemoryLocalStorage = (initial = {}) => {
  const store = { ...initial };
  window.localStorage.getItem.mockImplementation((key) => (
    Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null
  ));
  window.localStorage.setItem.mockImplementation((key, value) => {
    store[key] = String(value);
  });
  window.localStorage.removeItem.mockImplementation((key) => {
    delete store[key];
  });
  window.localStorage.clear.mockImplementation(() => {
    Object.keys(store).forEach((key) => delete store[key]);
  });
  return store;
};
