/**
 * @jest-environment node
 */
// 開発サーバー（npm start）で /api を XAMPP に中継する設定のテスト。
// 本物の HTTP サーバーを 2 つ（XAMPP の代わりと、開発サーバーの代わり）立てて確かめる。
const http = require('http');
const express = require('express');

const listen = (server) => new Promise((resolve) => {
  server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
const close = (server) => new Promise((resolve) => server.close(resolve));

const request = (port, path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ host: '127.0.0.1', port, path, method }, (res) => {
    let data = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => { data += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body: data }));
  });
  req.on('error', reject);
  if (body) req.write(body);
  req.end();
});

describe('src/setupProxy.js', () => {
  let apiServer;
  let apiPort;
  let devServer;
  let received;
  const originalTarget = process.env.API_PROXY_TARGET;

  beforeEach(async () => {
    received = [];
    // XAMPP の代わり: 受け取ったパスをそのまま返す
    apiServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        received.push({ method: req.method, url: req.url, host: req.headers.host, body });
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, url: req.url }));
      });
    });
    apiPort = await listen(apiServer);
  });

  afterEach(async () => {
    if (devServer) await close(devServer);
    await close(apiServer);
    devServer = null;
    if (originalTarget === undefined) {
      delete process.env.API_PROXY_TARGET;
    } else {
      process.env.API_PROXY_TARGET = originalTarget;
    }
  });

  const startDevServer = async () => {
    const app = express();
    jest.isolateModules(() => {
      require('../setupProxy')(app);
    });
    app.use((req, res) => res.status(200).send('<!doctype html><title>index.html</title>'));
    devServer = http.createServer(app);
    return listen(devServer);
  };

  test('/api/* を中継先のパス（例: /sound-library3/api）に付け替えて渡す', async () => {
    process.env.API_PROXY_TARGET = `http://127.0.0.1:${apiPort}/sound-library3/api`;
    const port = await startDevServer();

    const response = await request(port, '/api/rooms.php?id=3');
    expect(response.status).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ success: true, url: '/sound-library3/api/rooms.php?id=3' });
    expect(received[0].host).toBe(`127.0.0.1:${apiPort}`); // changeOrigin
  });

  test('POST の本文もそのまま届く（クラウド保存）', async () => {
    process.env.API_PROXY_TARGET = `http://127.0.0.1:${apiPort}/api/`;
    const port = await startDevServer();

    const response = await request(port, '/api/songs.php', { method: 'POST', body: '{"title":"曲"}' });
    expect(response.status).toBe(200);
    expect(received[0]).toMatchObject({ method: 'POST', url: '/api/songs.php', body: '{"title":"曲"}' });
  });

  test('/api 以外（アプリの画面）は中継しない', async () => {
    process.env.API_PROXY_TARGET = `http://127.0.0.1:${apiPort}/sound-library3/api`;
    const port = await startDevServer();

    const response = await request(port, '/static/js/bundle.js');
    expect(response.body).toContain('index.html');
    expect(received).toHaveLength(0);
  });

  test('中継先を指定しなければ SETUP.md どおりの XAMPP（localhost/sound-library3/api）を使う', () => {
    delete process.env.API_PROXY_TARGET;
    const use = jest.fn();
    jest.isolateModules(() => {
      jest.doMock('http-proxy-middleware', () => ({ createProxyMiddleware: jest.fn((options) => options) }));
      require('../setupProxy')({ use });
    });
    const [mountPath, options] = use.mock.calls[0];
    expect(mountPath).toBe('/api');
    expect(options.target).toBe('http://localhost');
    expect(options.pathRewrite('/api/audio.php?room_id=1')).toBe('/sound-library3/api/audio.php?room_id=1');
    jest.dontMock('http-proxy-middleware');
  });
});
