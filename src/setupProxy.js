// 開発サーバー（npm start）専用の設定。本番のビルドには含まれない。
//
// アプリは API を /api（src/utils/api.js の API_BASE_URL）に問い合わせる。
// 開発中は localhost:3000 の React 開発サーバーが代わりに index.html を返してしまい、
// クラウド機能が動かなかったので、/api へのアクセスを XAMPP に中継する。
// 既定の中継先は SETUP.md の手順どおりに置いたときの場所（htdocs/sound-library3/api）。
// 別の場所の API を使うときは API_PROXY_TARGET で指定する（例: API_PROXY_TARGET=http://localhost:8080/api npm start）。
const { createProxyMiddleware } = require('http-proxy-middleware');

const DEFAULT_API_PROXY_TARGET = 'http://localhost/sound-library3/api';

module.exports = function setupProxy(app) {
  const target = new URL(process.env.API_PROXY_TARGET || DEFAULT_API_PROXY_TARGET);
  const targetPath = target.pathname.replace(/\/+$/, '');

  app.use('/api', createProxyMiddleware({
    target: target.origin,
    changeOrigin: true,
    // "/api/rooms.php?id=1" → "/sound-library3/api/rooms.php?id=1"
    pathRewrite: (path) => targetPath + path.replace(/^\/api/, ''),
    logLevel: 'warn'
  }));
};
