// API の置き場所（API_BASE_URL）のテスト。
// 以前はページごとに '/api' と '../api' が混ざっていたので、src/utils/api.js の 1 か所にまとめた。
describe('API_BASE_URL', () => {
  const original = process.env.REACT_APP_API_BASE_URL;

  afterEach(() => {
    if (original === undefined) {
      delete process.env.REACT_APP_API_BASE_URL;
    } else {
      process.env.REACT_APP_API_BASE_URL = original;
    }
  });

  const loadApiBaseUrl = () => {
    let value;
    jest.isolateModules(() => {
      value = require('../../utils/api').API_BASE_URL;
    });
    return value;
  };

  test('指定が無ければ本番と同じドメイン直下の /api を使う', () => {
    delete process.env.REACT_APP_API_BASE_URL;
    expect(loadApiBaseUrl()).toBe('/api');
  });

  test('ビルド時に REACT_APP_API_BASE_URL で別の場所を指定できる', () => {
    process.env.REACT_APP_API_BASE_URL = 'https://example.com/sound-library3/api';
    expect(loadApiBaseUrl()).toBe('https://example.com/sound-library3/api');
  });

  test('末尾のスラッシュは取り除く（"//rooms.php" にならない）', () => {
    process.env.REACT_APP_API_BASE_URL = '/sound-library3/api/';
    expect(loadApiBaseUrl()).toBe('/sound-library3/api');
  });
});
