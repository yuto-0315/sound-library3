# Jest ユニットテスト ドキュメント

このプロジェクトでは、Jestと@testing-library/reactを使用してReactコンポーネントのユニットテストを実装しています。

## テスト構成

### テストファイル構造
```
src/__tests__/
├── testUtils.js                 # テスト用ユーティリティ関数
├── setupTests.js              # Jest設定ファイル
├── accessibility.test.js      # アクセシビリティテスト（既存）
├── App.test.js                # Appコンポーネントのテスト
├── Navigation.test.js         # Navigationコンポーネントのテスト
├── SoundCollection.test.js    # SoundCollectionページのテスト
├── SoundLibrary.test.js       # SoundLibraryページのテスト
├── DAWPage.test.js           # DAWPageのテスト
├── useAccessibility.test.js   # カスタムフックのテスト
├── App.basic.test.js         # 基本的なAppテスト
├── Navigation.basic.test.js  # 基本的なNavigationテスト
└── SoundCollection.basic.test.js # 基本的なSoundCollectionテスト
```

## テストスクリプト

### 利用可能なテストコマンド

```bash
# 全テストの実行
npm test

# ウォッチモードを無効にしてテスト実行
npm run test:ci

# カバレッジレポート付きでテスト実行
npm run test:coverage

# ユニットテストのみ実行
npm run test:unit

# アクセシビリティテストのみ実行
npm run test:accessibility

# コンポーネントテストのみ実行
npm run test:components

# カスタムフックテストのみ実行
npm run test:hooks

# 基本テストのみ実行
npm test -- --testPathPattern="basic.test.js" --watchAll=false
```

## テストカテゴリ

### 1. コンポーネントテスト

#### App.test.js
- アプリの基本構造テスト
- ルーティング機能の確認
- アクセシビリティ属性の検証

#### Navigation.test.js
- ナビゲーションリンクの表示確認
- アクティブ状態の管理テスト
- キーボードナビゲーション

#### SoundCollection.test.js
- 録音機能のUIテスト
- ファイルアップロード機能
- Web Audio API モック使用

#### SoundLibrary.test.js
- 音素材の表示とフィルタリング
- 検索機能のテスト
- LocalStorage連携

#### DAWPage.test.js
- トラック管理機能
- 音楽制作インターフェース
- ドラッグ&ドロップ機能

### 2. カスタムフックテスト

#### useAccessibility.test.js
- useFocus フック
- useAnnouncement フック
- useKeyboardNavigation フック
- useErrorMessages フック

### 3. アクセシビリティテスト

#### accessibility.test.js
- WAI-ARIA準拠チェック
- キーボードナビゲーション
- スクリーンリーダー対応
- 色コントラスト確認

## テスト環境設定

### setupTests.js の機能
- Web Audio API のモック
- MediaRecorder API のモック
- getUserMedia API のモック
- ファイル処理 API のモック
- LocalStorage のモック

### testUtils.js のユーティリティ関数
- `renderWithRouter()` - React Router対応レンダリング
- `createMockAudioFile()` - 音声ファイルモック生成
- `simulateMediaRecorderEvent()` - MediaRecorderイベント模擬
- `createKeyboardEvent()` - キーボードイベント生成
- `createDragEvent()` - ドラッグ&ドロップイベント生成

## カバレッジ設定

Jest設定でカバレッジ閾値を設定：
- ブランチ: 70%
- 関数: 70%
- 行: 70%
- ステートメント: 70%

## モック設定

### Web Audio API
```javascript
global.AudioContext = jest.fn().mockImplementation(() => ({
  createMediaStreamSource: jest.fn(),
  createAnalyser: jest.fn(),
  // ... その他のメソッド
}));
```

### MediaRecorder API
```javascript
global.MediaRecorder = jest.fn().mockImplementation(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  addEventListener: jest.fn(),
  // ... その他のメソッド
}));
```

## テスト実行時の注意点

### 1. React Router警告の抑制
テスト実行時にReact Routerの将来バージョンに関する警告が表示されますが、テストの実行には影響しません。

### 2. 非同期処理のテスト
音声録音や再生などの非同期処理は適切にモック化し、`waitFor`を使用してテストします。

### 3. LocalStorageの管理
各テストでLocalStorageをクリアし、テスト間の影響を防ぎます。

## ベストプラクティス

### 1. テストの構造
```javascript
describe('コンポーネント名', () => {
  beforeEach(() => {
    // 各テスト前のセットアップ
  });

  test('具体的な動作の説明', () => {
    // テストの実装
  });
});
```

### 2. アサーション
```javascript
// DOM要素の存在確認
expect(screen.getByText('テキスト')).toBeInTheDocument();

// アクセシビリティ属性の確認
expect(element).toHaveAttribute('aria-label', '説明');

// 状態変化の確認
await waitFor(() => {
  expect(mockFunction).toHaveBeenCalled();
});
```

### 3. ユーザーインタラクション
```javascript
const user = userEvent.setup();
await user.click(button);
await user.type(input, 'テキスト');
```

## トラブルシューティング

### 1. 複数要素の検出エラー
同じテキストを持つ複数の要素がある場合は、より具体的なクエリを使用：
```javascript
// ❌ 複数の要素がマッチする
screen.getByText('音あつめ')

// ✅ ロールで絞り込む
screen.getByRole('menuitem', { name: /音あつめ/ })

// ✅ 最初の要素を取得
screen.getAllByText('音あつめ')[0]
```

### 2. 非同期処理のタイムアウト
長時間の処理は適切にタイムアウトを設定：
```javascript
await waitFor(() => {
  expect(element).toBeInTheDocument();
}, { timeout: 3000 });
```

### 3. モックの設定
各テストでモックをリセット：
```javascript
beforeEach(() => {
  jest.clearAllMocks();
});
```
