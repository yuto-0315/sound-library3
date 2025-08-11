import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SoundCollection from '../pages/SoundCollection';

// MediaRecorder APIのモック
global.MediaRecorder = jest.fn().mockImplementation(() => ({
  start: jest.fn(),
  stop: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn(),
  state: 'inactive',
  stream: {
    getTracks: jest.fn(() => [
      { stop: jest.fn() }
    ])
  }
}));

// getUserMedia APIのモック
Object.defineProperty(navigator, 'mediaDevices', {
  writable: true,
  value: {
    getUserMedia: jest.fn(() => 
      Promise.resolve({
        getTracks: jest.fn(() => [
          { stop: jest.fn() }
        ])
      })
    )
  }
});

// URL.createObjectURL, URL.revokeObjectURLのモック
global.URL.createObjectURL = jest.fn(() => 'blob:mock-url');
global.URL.revokeObjectURL = jest.fn();

// File reader APIのモック
global.FileReader = jest.fn().mockImplementation(() => ({
  readAsArrayBuffer: jest.fn(),
  result: new ArrayBuffer(8),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
}));

describe('SoundCollection Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test('renders sound collection interface', () => {
    render(<SoundCollection />);
    
    // メインタイトルが表示される
    expect(screen.getByText('音あつめ')).toBeInTheDocument();
    
    // 録音ボタンが表示される
    expect(screen.getByRole('button', { name: /録音開始/i })).toBeInTheDocument();
    
    // ファイルアップロードセクションが表示される
    expect(screen.getByText('ファイルから音を追加')).toBeInTheDocument();
    expect(screen.getByLabelText('音声ファイルを選択')).toBeInTheDocument();
  });

  test('has proper accessibility structure', () => {
    render(<SoundCollection />);
    
    // メインランドマークが存在する
    expect(screen.getByRole('main')).toBeInTheDocument();
    
    // セクションが適切にラベル付けされている
    expect(screen.getByLabelText('録音機能')).toBeInTheDocument();
    expect(screen.getByLabelText('ファイルアップロード')).toBeInTheDocument();
    expect(screen.getByLabelText('録音済み音声リスト')).toBeInTheDocument();
    
    // アクセシビリティ用のライブリージョンが存在する
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  test('displays recording controls correctly', () => {
    render(<SoundCollection />);
    
    const recordButton = screen.getByRole('button', { name: /録音開始/i });
    
    // 録音ボタンの初期状態
    expect(recordButton).toBeInTheDocument();
    expect(recordButton).not.toBeDisabled();
    
    // キーボードショートカットの表示
    expect(screen.getByText('スペースキー: 録音開始/停止')).toBeInTheDocument();
  });

  test('handles file input correctly', () => {
    render(<SoundCollection />);
    
    const fileInput = screen.getByLabelText('音声ファイルを選択');
    
    // ファイル入力の属性確認
    expect(fileInput).toHaveAttribute('type', 'file');
    expect(fileInput).toHaveAttribute('accept', 'audio/*');
    expect(fileInput).toHaveAttribute('multiple');
  });

  test('displays empty state message when no recordings', () => {
    render(<SoundCollection />);
    
    // 録音がない場合のメッセージ
    expect(screen.getByText('まだ音が保存されていません。録音またはファイルをアップロードしてください。')).toBeInTheDocument();
  });

  test('handles keyboard shortcuts', async () => {
    const user = userEvent.setup();
    render(<SoundCollection />);
    
    const recordButton = screen.getByRole('button', { name: /録音開始/i });
    
    // スペースキーで録音開始
    await user.keyboard(' ');
    
    // MediaRecorderが呼び出されることを期待
    await waitFor(() => {
      expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalled();
    });
  });

  test('shows error messages when microphone access fails', async () => {
    // getUserMediaを失敗するようにモック
    navigator.mediaDevices.getUserMedia.mockRejectedValueOnce(
      new Error('Permission denied')
    );
    
    const user = userEvent.setup();
    render(<SoundCollection />);
    
    const recordButton = screen.getByRole('button', { name: /録音開始/i });
    
    await user.click(recordButton);
    
    // エラーメッセージが表示される
    await waitFor(() => {
      expect(screen.getByText(/マイクにアクセスできませんでした/)).toBeInTheDocument();
    });
  });

  test('handles file upload', async () => {
    const user = userEvent.setup();
    render(<SoundCollection />);
    
    const fileInput = screen.getByLabelText('音声ファイルを選択');
    
    // ファイルをアップロード
    const file = new File(['audio content'], 'test.mp3', { type: 'audio/mp3' });
    await user.upload(fileInput, file);
    
    // ファイルが選択されたことを確認
    expect(fileInput.files[0]).toBe(file);
    expect(fileInput.files).toHaveLength(1);
  });

  test('displays recording instructions', () => {
    render(<SoundCollection />);
    
    // 使用方法の説明が表示される
    expect(screen.getByText('録音ボタンを押すか、スペースキーで録音を開始できます。')).toBeInTheDocument();
    expect(screen.getByText('録音中は再度ボタンを押すかスペースキーで停止します。')).toBeInTheDocument();
    expect(screen.getByText('音声ファイル（MP3、WAV、M4A等）をドラッグ＆ドロップまたは選択してアップロードできます。')).toBeInTheDocument();
  });

  test('handles component cleanup on unmount', () => {
    const { unmount } = render(<SoundCollection />);
    
    // コンポーネントがアンマウントされる
    unmount();
    
    // URL.revokeObjectURLが呼ばれることを期待（実際の録音がある場合）
    // この場合は録音がないので呼ばれない
    expect(global.URL.revokeObjectURL).not.toHaveBeenCalled();
  });

  test('has proper ARIA live regions', () => {
    render(<SoundCollection />);
    
    // ライブリージョンが適切に設定されている
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toHaveAttribute('aria-live', 'polite');
    expect(statusRegion).toHaveAttribute('aria-atomic', 'true');
    
    const alertRegion = screen.getByRole('alert');
    expect(alertRegion).toHaveAttribute('aria-live', 'assertive');
    expect(alertRegion).toHaveAttribute('aria-atomic', 'true');
  });

  test('handles drag and drop for file upload', () => {
    render(<SoundCollection />);
    
    const dropArea = screen.getByText('ここに音声ファイルをドラッグ＆ドロップ').closest('div');
    
    // ドラッグオーバー時のスタイリング
    fireEvent.dragOver(dropArea);
    expect(dropArea).toHaveClass('drag-over');
    
    // ドラッグリーブ時のスタイリング
    fireEvent.dragLeave(dropArea);
    expect(dropArea).not.toHaveClass('drag-over');
  });

  test('validates file types on upload', async () => {
    const user = userEvent.setup();
    render(<SoundCollection />);
    
    const fileInput = screen.getByLabelText('音声ファイルを選択');
    
    // 無効なファイルタイプをアップロード
    const invalidFile = new File(['content'], 'test.txt', { type: 'text/plain' });
    await user.upload(fileInput, invalidFile);
    
    // エラーメッセージが表示される
    await waitFor(() => {
      expect(screen.getByText(/サポートされていないファイル形式です/)).toBeInTheDocument();
    });
  });
});
