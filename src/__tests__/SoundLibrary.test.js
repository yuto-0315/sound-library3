import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import SoundLibrary from '../pages/SoundLibrary';
import { setLocalStorageItem } from './testUtils';

describe('SoundLibrary Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    localStorage.clear();
  });

  test('renders sound library interface', () => {
    render(<SoundLibrary />);
    
    // メインタイトルが表示される（絵文字を含むテキスト）
    expect(screen.getByText(/音ライブラリ/)).toBeInTheDocument();
    
    // 検索とフィルタ機能が表示される
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  test('has proper accessibility structure', () => {
    render(<SoundLibrary />);
    
    // 基本的な要素が存在することを確認
    expect(screen.getByRole('textbox')).toBeInTheDocument();
    expect(screen.getByText(/音を探す/)).toBeInTheDocument();
  });

  test('displays empty state when no sounds', () => {
    render(<SoundLibrary />);
    
    // 音がない場合のメッセージ
    expect(screen.getByText(/まだ音素材がありません/)).toBeInTheDocument();
    expect(screen.getByText(/音あつめページから音を録音してみましょう/)).toBeInTheDocument();
  });

  test('loads sounds from localStorage', () => {
    // テスト用の音データを設定
    const testSounds = [
      {
        id: '1',
        name: 'テスト音1',
        audioData: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmciD0qD0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnkpBSl+zPLaizsIGGS57O2iUhELTKXh8bllHgo2jdXzzn0vBSF0xe/eizEIHG/A8OWcTQ0QU6ri8LJjGghCm+HwwXUmBS6Czf',
        tags: ['test', 'sample'],
        duration: 10,
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'テスト音2',
        audioData: 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmciD0qD0fPTgjMGHm7A7+OZSA0PVqzn77BdGAg+ltryxnkpBSl+zPLaizsIGGS57O2iUhELTKXh8bllHgo2jdXzzn0vBSF0xe/eizEIHG/A8OWcTQ0QU6ri8LJjGghCm+HwwXUmBS6Czf',
        tags: ['music', 'melody'],
        duration: 15,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    // 音リストが表示される
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    
    // タグが表示される
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('sample')).toBeInTheDocument();
    expect(screen.getByText('music')).toBeInTheDocument();
    expect(screen.getByText('melody')).toBeInTheDocument();
  });

  test('handles search functionality', async () => {
    const user = userEvent.setup();
    
    const testSounds = [
      {
        id: '1',
        name: 'ピアノ音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['piano', 'instrument'],
        duration: 10,
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'ドラム音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['drum', 'percussion'],
        duration: 5,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    const searchInput = screen.getByRole('textbox');
    
    // ピアノで検索
    await user.type(searchInput, 'ピアノ');
    
    // ピアノ音のみ表示される
    expect(screen.getByText('ピアノ音')).toBeInTheDocument();
    expect(screen.queryByText('ドラム音')).not.toBeInTheDocument();
    
    // 検索をクリア
    await user.clear(searchInput);
    
    // 全ての音が再表示される
    expect(screen.getByText('ピアノ音')).toBeInTheDocument();
    expect(screen.getByText('ドラム音')).toBeInTheDocument();
  });

  test('handles tag filtering', async () => {
    const user = userEvent.setup();
    
    const testSounds = [
      {
        id: '1',
        name: 'ピアノ音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['piano', 'instrument'],
        duration: 10,
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'ドラム音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['drum', 'percussion'],
        duration: 5,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    const tagSelect = screen.getByLabelText('タグでフィルタ');
    
    // pianoタグでフィルタ
    await user.selectOptions(tagSelect, 'piano');
    
    // ピアノ音のみ表示される
    expect(screen.getByText('ピアノ音')).toBeInTheDocument();
    expect(screen.queryByText('ドラム音')).not.toBeInTheDocument();
    
    // フィルタをリセット
    await user.selectOptions(tagSelect, '');
    
    // 全ての音が再表示される
    expect(screen.getByText('ピアノ音')).toBeInTheDocument();
    expect(screen.getByText('ドラム音')).toBeInTheDocument();
  });

  test('plays audio when play button is clicked', async () => {
    const user = userEvent.setup();
    
    const testSounds = [
      {
        id: '1',
        name: 'テスト音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 10,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    const playButton = screen.getByRole('button', { name: /再生/i });
    
    await user.click(playButton);
    
    // Audio.playが呼ばれることを確認
    expect(global.Audio).toHaveBeenCalled();
  });

  test('handles sound deletion', async () => {
    const user = userEvent.setup();
    
    const testSounds = [
      {
        id: '1',
        name: 'テスト音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 10,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    const deleteButton = screen.getByRole('button', { name: /削除/i });
    
    await user.click(deleteButton);
    
    // 確認ダイアログが表示される（実装によっては）
    // 音が削除される
    await waitFor(() => {
      expect(screen.queryByText('テスト音')).not.toBeInTheDocument();
    });
  });

  test('displays sound metadata correctly', () => {
    const testDate = new Date('2023-01-01T12:00:00Z');
    const testSounds = [
      {
        id: '1',
        name: 'テスト音',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test', 'example'],
        duration: 123,
        createdAt: testDate.toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    // 音の詳細情報が表示される
    expect(screen.getByText('テスト音')).toBeInTheDocument();
    expect(screen.getByText('test')).toBeInTheDocument();
    expect(screen.getByText('example')).toBeInTheDocument();
    
    // 時間が適切に表示される
    expect(screen.getByText(/2:03/)).toBeInTheDocument(); // 123秒 = 2分3秒
  });

  test('handles keyboard navigation', async () => {
    const user = userEvent.setup();
    
    const testSounds = [
      {
        id: '1',
        name: 'テスト音1',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 10,
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'テスト音2',
        audioData: 'data:audio/wav;base64,test',
        tags: ['test'],
        duration: 15,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    // Tabキーでナビゲーション
    await user.tab();
    expect(screen.getByLabelText('音を検索')).toHaveFocus();
    
    await user.tab();
    expect(screen.getByLabelText('タグでフィルタ')).toHaveFocus();
  });

  test('handles combined search and filter', async () => {
    const user = userEvent.setup();
    
    const testSounds = [
      {
        id: '1',
        name: 'ピアノ メロディ',
        audioData: 'data:audio/wav;base64,test',
        tags: ['piano', 'melody'],
        duration: 10,
        createdAt: new Date().toISOString()
      },
      {
        id: '2',
        name: 'ピアノ コード',
        audioData: 'data:audio/wav;base64,test',
        tags: ['piano', 'chord'],
        duration: 15,
        createdAt: new Date().toISOString()
      },
      {
        id: '3',
        name: 'ドラム ビート',
        audioData: 'data:audio/wav;base64,test',
        tags: ['drum', 'rhythm'],
        duration: 8,
        createdAt: new Date().toISOString()
      }
    ];
    
    setLocalStorageItem('soundRecordings', testSounds);
    
    render(<SoundLibrary />);
    
    const searchInput = screen.getByLabelText('音を検索');
    const tagSelect = screen.getByLabelText('タグでフィルタ');
    
    // ピアノタグでフィルタ
    await user.selectOptions(tagSelect, 'piano');
    
    // メロディで検索
    await user.type(searchInput, 'メロディ');
    
    // ピアノメロディのみ表示される
    expect(screen.getByText('ピアノ メロディ')).toBeInTheDocument();
    expect(screen.queryByText('ピアノ コード')).not.toBeInTheDocument();
    expect(screen.queryByText('ドラム ビート')).not.toBeInTheDocument();
  });
});
