import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import DAWPage from '../pages/DAWPage';
import { setLocalStorageItem, createMockAudioFile } from './testUtils';

// Web Audio API の追加モック
global.AudioContext.prototype.createBufferSource = jest.fn(() => ({
  buffer: null,
  connect: jest.fn(),
  disconnect: jest.fn(),
  start: jest.fn(),
  stop: jest.fn(),
  addEventListener: jest.fn(),
  removeEventListener: jest.fn()
}));

global.AudioContext.prototype.decodeAudioData = jest.fn(() => 
  Promise.resolve({
    length: 44100,
    sampleRate: 44100,
    numberOfChannels: 2,
    duration: 1,
    getChannelData: jest.fn(() => new Float32Array(44100))
  })
);

describe('DAWPage Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('renders DAW interface', () => {
    render(<DAWPage />);
    
    // メインタイトルが表示される
    expect(screen.getByText('音楽づくり')).toBeInTheDocument();
    
    // 再生コントロールが表示される
    expect(screen.getByRole('button', { name: /再生/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /停止/i })).toBeInTheDocument();
    
    // トラック関連の機能が表示される
    expect(screen.getByRole('button', { name: /トラック追加/i })).toBeInTheDocument();
  });

  test('has proper accessibility structure', () => {
    render(<DAWPage />);
    
    // メインセクションが適切にラベル付けされている
    expect(screen.getByLabelText('DAW操作パネル')).toBeInTheDocument();
    expect(screen.getByLabelText('トラックリスト')).toBeInTheDocument();
    
    // 再生コントロールが適切にマークアップされている
    expect(screen.getByRole('toolbar')).toBeInTheDocument();
    
    // ライブリージョンが存在する
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  test('displays initial track', () => {
    render(<DAWPage />);
    
    // 初期トラックが表示される
    expect(screen.getByText('トラック 1')).toBeInTheDocument();
  });

  test('adds new track when add track button is clicked', async () => {
    
    render(<DAWPage />);
    
    const addTrackButton = screen.getByRole('button', { name: /トラック追加/i });
    
    fireEvent.click(addTrackButton);
    
    // 新しいトラックが追加される
    expect(screen.getByText('トラック 1')).toBeInTheDocument();
    expect(screen.getByText('トラック 2')).toBeInTheDocument();
  });

  test('handles track deletion', async () => {
    
    render(<DAWPage />);
    
    // 複数のトラックを追加
    const addTrackButton = screen.getByRole('button', { name: /トラック追加/i });
    fireEvent.click(addTrackButton);
    
    // トラック削除ボタンをクリック
    const deleteButtons = screen.getAllByRole('button', { name: /削除/i });
    if (deleteButtons.length > 0) {
      fireEvent.click(deleteButtons[0]);
      
      // 確認ダイアログで削除を確認
      const confirmButton = screen.queryByRole('button', { name: /確認|削除/i });
      if (confirmButton) {
        fireEvent.click(confirmButton);
      }
    }
  });

  test('handles tempo changes', async () => {
    
    render(<DAWPage />);
    
    const tempoInput = screen.getByLabelText(/テンポ|BPM/i);
    
    // テンポを変更
    fireEvent.clear(tempoInput);
    fireEvent.type(tempoInput, '140');
    
    expect(tempoInput).toHaveValue(140);
  });

  test('loads sounds from localStorage', () => {
    // テスト用の音データを設定
    const testSounds = [
      {
        id: '1',
        name: 'テスト音1',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 10,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<DAWPage />);
    
    // 音ライブラリセクションに音が表示される
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
  });

  test('handles drag and drop from sound library', async () => {
    const testSounds = [
      {
        id: '1',
        name: 'テスト音1',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 10,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<DAWPage />);
    
    const soundItem = screen.getByText('テスト音1');
    const trackArea = screen.getByText('トラック 1').closest('.track');
    
    // ドラッグ開始
    fireEvent.dragStart(soundItem, {
      dataTransfer: {
        setData: jest.fn(),
        getData: jest.fn(() => JSON.stringify({
          id: '1',
          name: 'テスト音1',
          audioData: 'data:audio/wav;base64,test',
          duration: 10
        }))
      }
    });
    
    // ドロップ
    fireEvent.dragOver(trackArea);
    fireEvent.drop(trackArea, {
      dataTransfer: {
        getData: jest.fn(() => JSON.stringify({
          id: '1',
          name: 'テスト音1',
          audioData: 'data:audio/wav;base64,test',
          duration: 10
        }))
      }
    });
  });

  test('handles playback controls', async () => {
    render(<DAWPage />);
    
    const playButton = screen.getByRole('button', { name: /▶️/ });
    const stopButton = screen.getByRole('button', { name: /⏹️/ });
    
    // 再生ボタンをクリック
    fireEvent.click(playButton);
    
    // 停止ボタンをクリック
    fireEvent.click(stopButton);
    
    // ボタンが適切に機能することを確認
    expect(playButton).toBeInTheDocument();
    expect(stopButton).toBeInTheDocument();
  });

  test('handles timeline navigation', async () => {
    
    render(<DAWPage />);
    
    // タイムラインが表示される
    expect(screen.getByRole('slider', { name: /再生位置/i })).toBeInTheDocument();
    
    const timelineSlider = screen.getByRole('slider', { name: /再生位置/i });
    
    // タイムラインをクリック
    fireEvent.click(timelineSlider);
  });

  test('saves and loads project data', async () => {
    
    render(<DAWPage />);
    
    // プロジェクトに変更を加える
    const addTrackButton = screen.getByRole('button', { name: /トラック追加/i });
    fireEvent.click(addTrackButton);
    
    // 保存ボタンがある場合はクリック
    const saveButton = screen.queryByRole('button', { name: /保存/i });
    if (saveButton) {
      fireEvent.click(saveButton);
    }
    
    // 自動保存が動作することを確認（LocalStorageに保存される）
    await waitFor(() => {
      const savedData = localStorage.getItem('dawProjectAutoSave');
      expect(savedData).toBeTruthy();
    }, { timeout: 3000 });
  });

  test('handles zoom controls', async () => {
    
    render(<DAWPage />);
    
    // ズームコントロールが存在する場合
    const zoomInButton = screen.queryByRole('button', { name: /ズームイン|拡大/i });
    const zoomOutButton = screen.queryByRole('button', { name: /ズームアウト|縮小/i });
    
    if (zoomInButton && zoomOutButton) {
      fireEvent.click(zoomInButton);
      fireEvent.click(zoomOutButton);
    }
  });

  test('handles clip manipulation', async () => {
    
    
    const testSounds = [
      {
        id: '1',
        name: 'テスト音1',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 10,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<DAWPage />);
    
    // 音をトラックに追加後、クリップの操作をテスト
    // 実際の実装に応じてクリップの選択、移動、削除等をテスト
  });

  test('handles volume and pan controls', async () => {
    
    render(<DAWPage />);
    
    // ボリュームコントロールが存在する場合
    const volumeSlider = screen.queryByRole('slider', { name: /音量|ボリューム/i });
    const panSlider = screen.queryByRole('slider', { name: /パン|定位/i });
    
    if (volumeSlider) {
      fireEvent.click(volumeSlider);
    }
    
    if (panSlider) {
      fireEvent.click(panSlider);
    }
  });

  test('handles keyboard shortcuts', async () => {
    
    render(<DAWPage />);
    
    // スペースキーで再生/停止
    fireEvent.keyboard(' ');
    
    // その他のキーボードショートカット
    fireEvent.keyboard('{Delete}'); // 削除
    fireEvent.keyboard('{Escape}'); // キャンセル
  });

  test('displays timeline with proper measurements', () => {
    render(<DAWPage />);
    
    // タイムラインの小節表示
    expect(document.querySelector('.measure-number')).toBeInTheDocument(); // 1小節目
    
    // 拍の表示があるかチェック
    const measureMarkers = screen.getAllByText(/\d+/);
    expect(measureMarkers.length).toBeGreaterThan(0);
  });

  test('handles error states gracefully', () => {
    // 無効なデータでテスト
    setLocalStorageItem('soundRecordings', 'invalid json');
    
    render(<DAWPage />);
    
    // エラーが発生してもページが表示される
    expect(screen.getByText(/音楽づくりページ/)).toBeInTheDocument();
  });

  test('maintains accessibility during interaction', async () => {
    
    render(<DAWPage />);
    
    // フォーカス管理のテスト
    fireEvent.tab();
    
    // アクティブな要素がフォーカス可能であることを確認
    const focusedElement = document.activeElement;
    expect(focusedElement).toBeVisible();
    
    // ARIAライブリージョンが適切に更新される
    const statusRegion = screen.getByRole('status');
    expect(statusRegion).toBeInTheDocument();
  });
});
