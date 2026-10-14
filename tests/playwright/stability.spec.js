// 実際のブラウザ（本物の IndexedDB / MediaRecorder / Web Audio）で、データが消えないことと
// 主要な操作が動くことを確かめる E2E テスト。
//
// 実行方法:
//   npm run build
//   npm run start:static          # http://localhost:5050 で build/ を配信
//   npm run test:e2e -- stability.spec.js
// 配信先を変える場合は E2E_BASE_URL を指定する。
const { test, expect } = require('@playwright/test');

const BASE_URL = process.env.E2E_BASE_URL || 'http://localhost:5050';

test.use({
  permissions: ['microphone'],
  launchOptions: {
    // インストール済みのブラウザの版が @playwright/test と違う場合は E2E_CHROMIUM_PATH で指定する
    executablePath: process.env.E2E_CHROMIUM_PATH || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required']
  }
});

// マイクの代わりに 440Hz の音を返す（環境によっては偽マイクが使えないため）。
// 録音そのもの（MediaRecorder・保存・デコード）は本物のブラウザの処理で動く。
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext();
      const oscillator = ctx.createOscillator();
      oscillator.frequency.value = 440;
      const destination = ctx.createMediaStreamDestination();
      oscillator.connect(destination);
      oscillator.start();
      return destination.stream;
    };
  });
});

const collectErrors = (page) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  return errors;
};

const goto = async (page, route) => {
  await page.goto(`${BASE_URL}/#${route}`);
};

// 上のナビゲーション（ふつうのリンク）
const navLink = (page, name) => page.getByRole('navigation').getByRole('link', { name });

const recordSound = async (page, name, { seconds = 1.2, tag } = {}) => {
  await goto(page, '/collection');
  await page.getByRole('button', { name: /録音開始/ }).click();
  await page.waitForTimeout(seconds * 1000);
  await page.getByRole('button', { name: /録音停止/ }).click();
  // 録り終わると、その場で名前をつける画面になる
  const nameInput = page.getByLabel(/音の名前/);
  await expect(nameInput).toBeVisible();
  await nameInput.fill(name);
  if (tag) {
    await page.getByRole('textbox', { name: /タグ/ }).fill(tag);
    await page.getByRole('button', { name: '追加', exact: true }).click();
  }
  await page.getByRole('button', { name: /保存する/ }).click();
  await expect(nameInput).toBeHidden();
  // 「さいきん集めた音」に出る
  await expect(page.locator('.recordings-grid')).toContainText(name);
};

const waitForDawLoaded = async (page) => {
  await expect(page.locator('.daw-loading')).toHaveCount(0);
};

const dropSoundOnTrack = async (page, soundName, trackIndex = 0, x = 150) => {
  const source = page.locator('.sound-item', { hasText: soundName });
  const target = page.locator('.track').nth(trackIndex);
  await source.dragTo(target, { targetPosition: { x, y: 30 } });
};

// 「ファイル」メニューの項目を選ぶ
const chooseFileMenuItem = async (page, label) => {
  await page.getByRole('button', { name: 'ファイル', exact: true }).click();
  await page.getByRole('button', { name: label, exact: true }).click();
};

// この端末の IndexedDB に保存されている音（音声データは先頭だけ）
const readStoredRecordings = (page) => page.evaluate(() => new Promise((resolve, reject) => {
  const request = indexedDB.open('SoundLibraryDB');
  request.onerror = () => reject(request.error);
  request.onsuccess = () => {
    const db = request.result;
    const all = db.transaction('recordings', 'readonly').objectStore('recordings').getAll();
    all.onerror = () => reject(all.error);
    all.onsuccess = () => {
      resolve(all.result.map((record) => ({
        name: record.name,
        tags: record.tags,
        duration: record.duration,
        audio: typeof record.audioData === 'string'
          ? record.audioData.slice(0, 40)
          : `data:${record.audioData && record.audioData.type};`
      })));
      db.close();
    };
  };
}));

test.describe('データが消えない', () => {
  test('音楽づくり → 音あつめ → 音楽づくり と移動してもタイムラインが残る', async ({ page }) => {
    const errors = collectErrors(page);
    await recordSound(page, 'テストの音');

    await goto(page, '/daw');
    await waitForDawLoaded(page);
    await expect(page.locator('.sound-item', { hasText: 'テストの音' })).toBeVisible();
    await dropSoundOnTrack(page, 'テストの音', 0, 150);
    await expect(page.locator('.audio-clip')).toHaveCount(1);
    await page.getByRole('button', { name: /トラック追加/ }).click();
    await dropSoundOnTrack(page, 'テストの音', 1, 400);
    await expect(page.locator('.audio-clip')).toHaveCount(2);
    await expect(page.getByText('保存済み')).toBeVisible();

    // ナビゲーションで別のページへ行って戻る（以前はここでタイムラインが空になっていた）
    await navLink(page, /音あつめ/).click();
    await expect(page.getByRole('button', { name: /録音開始/ })).toBeVisible();
    await navLink(page, /音楽づくり/).click();
    await waitForDawLoaded(page);
    await expect(page.locator('.audio-clip')).toHaveCount(2);
    await expect(page.locator('.track')).toHaveCount(2);

    // 再読み込みしても残る
    await page.reload();
    await waitForDawLoaded(page);
    await expect(page.locator('.audio-clip')).toHaveCount(2);

    expect(errors).toEqual([]);
  });

  test('移動の直前（自動保存の待ち時間中）に置いたクリップも残る', async ({ page }) => {
    await recordSound(page, 'すぐ移動');
    await goto(page, '/daw');
    await waitForDawLoaded(page);
    await dropSoundOnTrack(page, 'すぐ移動');
    await expect(page.locator('.audio-clip')).toHaveCount(1);
    // 0.5 秒待たずに移動する
    await navLink(page, /音ライブラリ/).click();
    await navLink(page, /音楽づくり/).click();
    await waitForDawLoaded(page);
    await expect(page.locator('.audio-clip')).toHaveCount(1);
  });

  test('録音した音は、録音した形式・長さ・タグのまま音ライブラリに出て、再読み込みしても残る', async ({ page }) => {
    await recordSound(page, 'ライブラリの音', { tag: '自然' });
    await goto(page, '/library');
    const card = page.locator('.library-sound-card', { hasText: 'ライブラリの音' });
    await expect(card).toBeVisible();
    await expect(card.locator('.tag-label')).toContainText('自然');
    await expect(card.locator('.sound-meta')).toContainText('秒');

    const [stored] = (await readStoredRecordings(page)).filter((record) => record.name === 'ライブラリの音');
    expect(stored.audio).toMatch(/^data:audio\/(mp4|webm|ogg)/); // 実際の録音形式（以前は常に audio/wav と表記）
    expect(stored.duration).toBeGreaterThan(0.5);
    expect(stored.tags).toEqual(['自然']);

    await page.reload();
    await expect(page.locator('.library-sound-card', { hasText: 'ライブラリの音' })).toBeVisible();
  });

  test('音ライブラリで名前を変えると、再読み込みしても残り、音楽づくりの音素材にも出る', async ({ page }) => {
    await recordSound(page, 'まえの名前');
    await goto(page, '/library');
    await page.getByRole('button', { name: 'まえの名前の名前を変える' }).click();
    const input = page.getByLabel('「まえの名前」の新しい名前');
    await input.fill('あたらしい名前');
    await input.press('Enter');
    await expect(page.locator('.library-sound-card h4', { hasText: 'あたらしい名前' })).toBeVisible();
    await page.reload();
    await expect(page.locator('.library-sound-card h4', { hasText: 'あたらしい名前' })).toBeVisible();
    await goto(page, '/daw');
    await waitForDawLoaded(page);
    await expect(page.locator('.sound-item', { hasText: 'あたらしい名前' })).toBeVisible();
  });
});

test.describe('音ライブラリの操作', () => {
  test('▶ で音が鳴り、鳴り終わると「きく」に戻る（1 つの <audio> を使い回す）', async ({ page }) => {
    const errors = collectErrors(page);
    await recordSound(page, '鳴らす音', { seconds: 0.8 });
    await goto(page, '/library');
    await page.getByRole('button', { name: '鳴らす音をきく' }).click();
    await expect(page.getByRole('button', { name: '鳴らす音を止める' })).toBeVisible();
    await expect(page.getByRole('button', { name: '鳴らす音をきく' })).toBeVisible({ timeout: 8000 });
    // 一覧に <audio controls> を並べない
    await expect(page.locator('.library-sound-card audio')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test('ならべかた「タグごと」で、タグの見出しごとにまとまる', async ({ page }) => {
    await recordSound(page, '雨の音', { tag: 'しぜん' });
    await recordSound(page, '太鼓の音', { tag: 'がっき' });
    await goto(page, '/library');
    await page.getByRole('combobox', { name: 'ならべかた' }).selectOption('tag');
    await expect(page.getByRole('region', { name: /^がっき 1 こ$/ })).toContainText('太鼓の音');
    await expect(page.getByRole('region', { name: /^しぜん 1 こ$/ })).toContainText('雨の音');
    // 次に開いたときも同じならべかた
    await page.reload();
    await expect(page.getByRole('combobox', { name: 'ならべかた' })).toHaveValue('tag');
  });
});

test.describe('音楽づくりページの操作', () => {
  test.beforeEach(async ({ page }) => {
    await recordSound(page, '操作用の音', { seconds: 1.5 });
    await goto(page, '/daw');
    await waitForDawLoaded(page);
    await dropSoundOnTrack(page, '操作用の音', 0, 100);
    await expect(page.locator('.audio-clip')).toHaveCount(1);
  });

  test('クリップの長さは録音の長さに合い、拍の頭に置かれる', async ({ page }) => {
    const { left, width } = await page.locator('.audio-clip').evaluate((element) => ({
      left: parseFloat(element.style.left),
      width: parseFloat(element.style.width)
    }));
    // 1.5 秒録音 → 100px/秒 で 150px 前後（録音開始・停止の遅れを考慮して幅を持たせる）
    expect(width).toBeGreaterThan(100);
    expect(width).toBeLessThan(260);
    // テンポ 120 では 1 拍が 0.5 秒 = 50px。置いた位置は拍の頭にそろう
    expect(left % 50).toBeCloseTo(0, 5);
  });

  test('再生するとプレイヘッドが進み、停止で先頭に戻る', async ({ page }) => {
    const errors = collectErrors(page);
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await expect(page.getByRole('button', { name: '一時停止' })).toBeVisible();
    await page.waitForTimeout(700);
    const left = await page.locator('.playhead').evaluate((element) => parseFloat(element.style.left));
    expect(left).toBeGreaterThan(20);
    await page.getByRole('button', { name: '停止', exact: true }).click();
    await expect(page.locator('.playhead')).toHaveCSS('left', '0px');
    expect(errors).toEqual([]);
  });

  test('最後まで再生すると自動で止まる', async ({ page }) => {
    await page.getByRole('button', { name: '再生', exact: true }).click();
    await expect(page.getByRole('button', { name: '再生', exact: true })).toBeVisible({ timeout: 8000 });
  });

  test('ズームするとクリップの位置と長さが変わり、元に戻せる', async ({ page }) => {
    const clip = page.locator('.audio-clip');
    const before = await clip.evaluate((element) => ({ left: parseFloat(element.style.left), width: parseFloat(element.style.width) }));
    await page.getByRole('button', { name: 'ズームイン（拡大）' }).click();
    await expect(page.locator('.zoom-display')).toHaveText('150%');
    const zoomed = await clip.evaluate((element) => ({ left: parseFloat(element.style.left), width: parseFloat(element.style.width) }));
    expect(zoomed.left).toBeCloseTo(before.left * 1.5, 0);
    expect(zoomed.width).toBeCloseTo(before.width * 1.5, 0);
    await page.getByRole('button', { name: 'ズームアウト（縮小）' }).click();
    const restored = await clip.evaluate((element) => ({ left: parseFloat(element.style.left), width: parseFloat(element.style.width) }));
    expect(restored.left).toBeCloseTo(before.left, 0);
    expect(restored.width).toBeCloseTo(before.width, 0);
  });

  test('クリップを別のトラックへ移動できる', async ({ page }) => {
    await page.getByRole('button', { name: /トラック追加/ }).click();
    await page.locator('.audio-clip').dragTo(page.locator('.track').nth(1), { targetPosition: { x: 500, y: 30 } });
    await expect(page.locator('.track').nth(1).locator('.audio-clip')).toHaveCount(1);
    await expect(page.locator('.track').nth(0).locator('.audio-clip')).toHaveCount(0);
  });

  test('元に戻す・やり直すができる', async ({ page }) => {
    await page.locator('.audio-clip').click();
    await page.getByRole('button', { name: '操作用の音を削除' }).click();
    await expect(page.locator('.audio-clip')).toHaveCount(0);
    await page.getByRole('button', { name: '元に戻す' }).click();
    await expect(page.locator('.audio-clip')).toHaveCount(1);
    await page.getByRole('button', { name: 'やり直す' }).click();
    await expect(page.locator('.audio-clip')).toHaveCount(0);
  });

  test('WAV ファイルに書き出せる', async ({ page }) => {
    const downloadPromise = page.waitForEvent('download');
    await chooseFileMenuItem(page, 'WAV ファイルに書き出す');
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/^exported-music-.*\.wav$/);
  });

  test('ファイルに保存して、リセット後に開き直せる', async ({ page }) => {
    page.on('dialog', (dialog) => dialog.accept());
    const downloadPromise = page.waitForEvent('download');
    await chooseFileMenuItem(page, 'ファイルに保存');
    const download = await downloadPromise;
    const filePath = await download.path();

    await chooseFileMenuItem(page, '新しく作る（リセット）');
    await expect(page.locator('.audio-clip')).toHaveCount(0);

    await page.locator('input[type="file"]').setInputFiles(filePath);
    await expect(page.locator('.audio-clip')).toHaveCount(1);
  });
});

test.describe('タブレット（タッチ操作）', () => {
  test.use({ hasTouch: true, isMobile: false, viewport: { width: 1180, height: 820 } });

  const touchDrag = async (page, from, to, steps = 8) => {
    const client = await page.context().newCDPSession(page);
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: from.x, y: from.y }] });
    for (let i = 1; i <= steps; i++) {
      const x = from.x + ((to.x - from.x) * i) / steps;
      const y = from.y + ((to.y - from.y) * i) / steps;
      await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y }] });
    }
    await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  };

  test('指で音素材をトラックに置き、スクロールが固まったままにならない', async ({ page }) => {
    await recordSound(page, 'タッチの音');
    await goto(page, '/daw');
    await waitForDawLoaded(page);
    const item = await page.locator('.sound-item', { hasText: 'タッチの音' }).boundingBox();
    const track = await page.locator('.track').first().boundingBox();
    // このアプリは .main-content の中でスクロールする
    const scrollPosition = () => page.evaluate(() => ({
      window: window.scrollY,
      main: document.querySelector('.main-content').scrollTop
    }));
    const scrollBefore = await scrollPosition();
    await touchDrag(page, { x: item.x + 60, y: item.y + item.height / 2 }, { x: track.x + 200, y: track.y + 40 });
    await expect(page.locator('.audio-clip')).toHaveCount(1);
    // ドラッグ中にページが先頭に飛んだり、スクロールできない状態のまま残ったりしない
    expect(await scrollPosition()).toEqual(scrollBefore);
    expect(await page.evaluate(() => document.body.classList.contains('dragging'))).toBe(false);
    expect(await page.evaluate(() => getComputedStyle(document.body).position)).toBe('static');
    await expect(page.locator('.mobile-drag-preview')).toHaveCount(0);
  });

  test('指でクリップを別のトラックに移動できる', async ({ page }) => {
    await recordSound(page, '移動する音');
    await goto(page, '/daw');
    await waitForDawLoaded(page);
    await dropSoundOnTrack(page, '移動する音', 0, 100);
    await page.getByRole('button', { name: /トラック追加/ }).click();
    const clip = await page.locator('.audio-clip').boundingBox();
    const secondTrack = await page.locator('.track').nth(1).boundingBox();
    await touchDrag(page, { x: clip.x + 20, y: clip.y + clip.height / 2 }, { x: clip.x + 320, y: secondTrack.y + 40 });
    await expect(page.locator('.track').nth(1).locator('.audio-clip')).toHaveCount(1);
  });

  test('「＋」ボタンで、選んだトラックの再生位置に音を置ける（ドラッグしなくてよい）', async ({ page }) => {
    await recordSound(page, 'ボタンで置く音');
    await goto(page, '/daw');
    await waitForDawLoaded(page);
    await page.locator('.sound-item', { hasText: 'ボタンで置く音' }).locator('.place-sound-btn').tap();
    await expect(page.locator('.audio-clip')).toHaveCount(1);
    await page.locator('.sound-item', { hasText: 'ボタンで置く音' }).locator('.place-sound-btn').tap();
    await expect(page.locator('.audio-clip')).toHaveCount(2);
    // 2 つ目は 1 つ目のすぐ後ろ（重ならない）
    const lefts = await page.locator('.audio-clip').evaluateAll((elements) => elements.map((element) => parseFloat(element.style.left)).sort((a, b) => a - b));
    expect(lefts[1]).toBeGreaterThan(lefts[0]);
  });
});
