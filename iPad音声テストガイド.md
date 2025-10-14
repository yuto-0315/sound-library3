# iPad音声再生問題 - クイックテストガイド

## 🔍 テスト前の準備

### 1. Safariのデベロッパーコンソールを開く
- **iPad側:** 設定 > Safari > 詳細 > Webインスペクタ を ON
- **Mac側:** Safari > 開発 > [あなたのiPad] > [タブ名]
- コンソールタブを表示

### 2. ページを開く
ページを開いた時に以下が表示されることを確認:

```
=== Device Information ===
iOS Device: true
Safari: true
AudioContext initialized. State: suspended または running
```

---

## ✅ テスト1: プレビュー再生

### 手順
1. 画面をどこかタップ（AudioContextを起動）
2. 左側の音素材で▶️ボタンをクリック

### 期待される結果
コンソールに以下が表示され、音が再生される:
```
✓ AudioContext resumed successfully
🎵 Using Data URL for preview: [音素材名]
✓ Preview audio loaded: [音素材名]
✓ Preview audio can play: [音素材名]
✓ Preview playback started: [音素材名]
```

### ❌ エラーの場合
以下のようなログを確認:
```
❌ Preview playback error: NotAllowedError
```
→ もう一度画面をタップしてからテスト

---

## ✅ テスト2: タイムライン再生

### 手順
1. 音素材をタイムラインにドラッグ&ドロップ
2. 再生ボタン（▶️）をクリック

### 期待される結果
コンソールに以下が表示され、音が再生される:
```
=== Play Button Clicked ===
Using Data URL for clip: [クリップID]
✓ Audio loaded successfully for clip: [クリップID]
✓ Audio can play for clip: [クリップID]
✓ Playback started successfully for clip: [クリップID]
```

### ❌ エラーの場合
```
❌ 音声再生エラー: [エラー名]
Audio state at error: { readyState: 0, ... }
```

**readyState の意味:**
- `0` = データなし → 音声がロードされていない
- `1` = メタデータのみ → ロード中
- `2以上` = 再生可能 → 正常

---

## 🔧 よくある問題と解決策

### 問題1: "Using Blob URL" と表示される
**原因:** Data URLが使えない（古いデータ）
**解決:** 
1. 音素材を削除
2. 「音あつめ」ページで再録音

### 問題2: readyState が 0 のまま
**原因:** 音声データが壊れている
**解決:** 
1. ブラウザをリロード
2. それでも直らない場合は音素材を再録音

### 問題3: NotAllowedError
**原因:** ユーザー操作前に再生しようとした
**解決:** 
1. ページを開いた後、必ず画面をタップ
2. AudioContext State が "running" になっていることを確認

### 問題4: 音が出ない（エラーなし）
**確認事項:**
1. iPadの音量設定
2. サイレントモード（本体横のスイッチ）
3. 他のアプリで音が出るか確認
4. コンソールに "✓ Playback started" が表示されているか

---

## 📊 成功判定

以下がすべて満たされていれば、修正は成功です:

- [x] デバイス情報が正しく表示される
- [x] "Using Data URL" と表示される（Blob URLではない）
- [x] "✓ Audio loaded successfully" が表示される
- [x] "✓ Playback started successfully" が表示される
- [x] 実際に音が聞こえる

---

## 🆘 それでも解決しない場合

### 収集すべき情報
1. デバイス情報のログ全体（User Agent含む）
2. エラーメッセージ全体
3. Audio state の詳細（readyState, networkState, errorCode）
4. 使用しているiOSバージョン

### 報告テンプレート
```
デバイス: iPad [モデル名]
iOS: [バージョン]
Safari: [バージョン]

エラー内容:
[コンソールのエラーログをコピー]

再現手順:
1. ...
2. ...

期待する動作:
...

実際の動作:
...
```
