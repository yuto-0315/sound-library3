// ビルドした結果（build/）を配信する。E2E テスト（tests/playwright）用。
//   npm run build && npm run start:static
// 公開用のビルドを確かめるときは BUILD_DIR=docs npm run start:static
const express = require('express');
const path = require('path');

// 5000 番は macOS の「AirPlay レシーバー」が使っていて起動できないことがあるので、既定は 5050 番にする
const port = Number(process.env.PORT) || 5050;
const buildDir = path.resolve(__dirname, '..', process.env.BUILD_DIR || 'build');

const app = express();

app.use(express.static(buildDir));
// どのパスでも index.html を返す（画面の切り替えは HashRouter なので、パスは常に / になる）。
// Express 5 では app.get('*') が使えず、起動時にエラーで止まっていた
app.use((req, res) => {
  res.sendFile(path.join(buildDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Static server running at http://localhost:${port} (${buildDir})`);
});
