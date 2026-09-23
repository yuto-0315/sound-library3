// 音ライブラリページの基本動作。
// （以前のこのファイルは localStorage からの読み込みや、インストールされていない
//   user-event v14 の API を前提にしており、一度も通っていなかったため書き直した。
//   データ保存まわりの詳しい回帰テストは SoundLibrary.data.test.js にある）
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import SoundLibrary from '../pages/SoundLibrary';
import { addRecording } from '../utils/indexedDB';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { makeDataUrl } from '../test-utils/audioFixtures';

const renderLibrary = async () => {
  const utils = render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
  await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());
  return utils;
};

const seedSounds = async () => {
  await addRecording({ name: 'テスト音1', tags: ['test', 'sample'], audioData: makeDataUrl('wav', 'audio/wav'), createdAt: '2026-03-01T00:00:00Z' });
  await addRecording({ name: 'テスト音2', tags: ['music', 'melody'], audioData: makeDataUrl('mp4', 'audio/mp4'), createdAt: '2026-03-02T00:00:00Z' });
};

describe('SoundLibrary Component', () => {
  beforeEach(() => {
    installFakeIndexedDB();
    installMemoryLocalStorage();
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders sound library interface', async () => {
    await renderLibrary();
    expect(screen.getByRole('heading', { level: 2, name: /音ライブラリ/ })).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveAttribute('placeholder', '音の名前やタグで検索...');
  });

  test('読み込み中の表示を出してから一覧を表示する', async () => {
    render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());
  });

  test('has proper accessibility structure', async () => {
    await renderLibrary();
    expect(screen.getByRole('heading', { name: /音を探す/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /タグで絞り込み/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'すべて' })).toBeInTheDocument();
  });

  test('displays empty state when no sounds', async () => {
    await renderLibrary();
    expect(screen.getByText(/まだ音素材がありません/)).toBeInTheDocument();
    expect(screen.getByText(/音あつめページから音を録音してみましょう/)).toBeInTheDocument();
  });

  test('loads sounds from IndexedDB', async () => {
    await seedSounds();
    await renderLibrary();
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    expect(screen.getAllByText('test').length).toBeGreaterThan(0);
  });

  test('handles search functionality', async () => {
    await seedSounds();
    await renderLibrary();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'テスト音1' } });
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
    expect(screen.queryByText('テスト音2')).not.toBeInTheDocument();
  });

  test('handles tag filtering', async () => {
    await seedSounds();
    await renderLibrary();
    fireEvent.click(within(document.querySelector('.tag-filters')).getByRole('button', { name: 'melody' }));
    expect(screen.queryByText('テスト音1')).not.toBeInTheDocument();
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
  });

  test('音声プレーヤーで再生できる（Data URL を渡す）', async () => {
    await seedSounds();
    await renderLibrary();
    const players = document.querySelectorAll('audio.sound-player');
    expect(players).toHaveLength(2);
    players.forEach((player) => {
      expect(player).toHaveAttribute('controls');
      expect(player.getAttribute('src')).toMatch(/^data:audio\/(wav|mp4);base64,/);
    });
  });

  test('handles sound deletion', async () => {
    await seedSounds();
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'テスト音1を削除' }));
    expect(screen.getByText('「テスト音1」を削除しますか？')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '削除する' }));
    await waitFor(() => expect(screen.queryByText('テスト音1')).not.toBeInTheDocument());
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
  });

  test('displays sound metadata correctly', async () => {
    await seedSounds();
    await renderLibrary();
    const card = screen.getByText('テスト音1').closest('.library-sound-card');
    expect(within(card).getByText(new Date('2026-03-01T00:00:00Z').toLocaleDateString('ja-JP'))).toBeInTheDocument();
    expect(within(card).getByText('sample')).toBeInTheDocument();
  });

  test('handles keyboard navigation（操作はすべてボタンなのでキーボードで使える）', async () => {
    await seedSounds();
    await renderLibrary();
    const editButton = screen.getByRole('button', { name: 'テスト音1のタグを編集' });
    editButton.focus();
    expect(editButton).toHaveFocus();
    fireEvent.click(editButton);
    expect(editButton).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByPlaceholderText('新しいタグを入力...')).toBeInTheDocument();
  });

  test('handles combined search and filter', async () => {
    await seedSounds();
    await addRecording({ name: '別の音', tags: ['music'], audioData: makeDataUrl('wav', 'audio/wav') });
    await renderLibrary();
    fireEvent.click(within(document.querySelector('.tag-filters')).getByRole('button', { name: 'music' }));
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'テスト' } });
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    expect(screen.queryByText('別の音')).not.toBeInTheDocument();
    expect(screen.queryByText('テスト音1')).not.toBeInTheDocument();
  });
});
