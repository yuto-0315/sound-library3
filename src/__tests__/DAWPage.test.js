// 音楽づくり（DAW）ページの基本動作。
// （以前のこのファイルはアプリに無い機能（テンポ/BPM、音量・パンのスライダー、キーボード
//   ショートカット、再生位置スライダー）や存在しない API（fireEvent.tab など）を前提にしており、
//   通っていたテストも中身の検証が無いものだったため書き直した。
//   保存・再生・ドラッグの詳しい回帰テストは DAWPage.persistence / DAWPage.interaction にある）
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import '@testing-library/jest-dom';
import DAWPage from '../pages/DAWPage';
import { addRecording, saveProjectAutoSave } from '../utils/indexedDB';
import { serializeProject } from '../utils/project';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, createMockAudioContext, makeDataUrl } from '../test-utils/audioFixtures';

const drumAudio = makeDataUrl('mp4', 'audio/mp4', 84);

const renderDAW = async () => {
  const utils = render(<DAWPage />);
  await waitFor(() => expect(screen.queryByText('前回の作業内容を読み込んでいます...')).not.toBeInTheDocument());
  return utils;
};

describe('DAWPage Component', () => {
  let audioContext;

  beforeEach(() => {
    installFakeIndexedDB();
    installMemoryLocalStorage();
    audioContext = createMockAudioContext();
    window.AudioContext = jest.fn(() => audioContext);
    global.FileReader = TestFileReader;
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders DAW interface', async () => {
    await renderDAW();
    expect(screen.getByRole('heading', { level: 2, name: /音楽づくりページ/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /トラック追加/ })).toBeInTheDocument();
  });

  test('has proper accessibility structure', async () => {
    await renderDAW();
    // アイコンだけのボタンにも読み上げ用の名前がある
    ['再生', '停止', 'ズームイン（拡大）', 'ズームアウト（縮小）', '音素材パネルを閉じる', 'トラック 1を削除'].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(screen.getByRole('status')).toHaveTextContent(/保存/); // 自動保存の状況
  });

  test('displays initial track', async () => {
    await renderDAW();
    expect(screen.getByText('トラック 1')).toBeInTheDocument();
    expect(document.querySelectorAll('.track')).toHaveLength(1);
  });

  test('adds new track when add track button is clicked', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(screen.getByText('トラック 1')).toBeInTheDocument();
    expect(screen.getByText('トラック 2')).toBeInTheDocument();
    expect(document.querySelectorAll('.track')).toHaveLength(2);
  });

  test('handles track deletion', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    fireEvent.click(screen.getByRole('button', { name: 'トラック 2を削除' }));
    expect(document.querySelectorAll('.track')).toHaveLength(1);
    // 最後の 1 つは消せない
    expect(screen.getByRole('button', { name: 'トラック 1を削除' })).toBeDisabled();
  });

  test('loads sounds from IndexedDB', async () => {
    await addRecording({ name: 'テスト音1', tags: ['test'], audioData: drumAudio });
    await renderDAW();
    const panel = document.querySelector('.sound-panel');
    expect(await within(panel).findByText('テスト音1')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'test' })).toBeInTheDocument(); // タグの絞り込み
  });

  test('handles drag and drop from sound library', async () => {
    const id = await addRecording({ name: 'テスト音1', tags: [], audioData: drumAudio });
    await renderDAW();
    await within(document.querySelector('.sound-panel')).findByText('テスト音1');
    const dataTransfer = { getData: () => `sound-id:${id}`, setData: jest.fn(), dropEffect: 'copy' };
    fireEvent.drop(document.querySelector('.track'), { dataTransfer });
    await waitFor(() => expect(document.querySelectorAll('.audio-clip')).toHaveLength(1));
  });

  test('handles playback controls', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
  });

  test('saves and loads project data', async () => {
    await saveProjectAutoSave(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 50, duration: 100, trackId: 1, soundData: { name: '保存した音', audioData: drumAudio } }] }],
      pixelsPerSecond: 100
    }));
    await renderDAW();
    await waitFor(() => expect(document.querySelectorAll('.audio-clip')).toHaveLength(1));
    expect(screen.getByText('保存した音', { selector: '.clip-name' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /プロジェクト保存/ })).toBeInTheDocument();
    expect(screen.getByText(/プロジェクト読み込み/)).toBeInTheDocument();
  });

  test('handles zoom controls', async () => {
    await renderDAW();
    expect(screen.getByText('100%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン（拡大）' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'ズームアウト（縮小）' }));
    fireEvent.click(screen.getByRole('button', { name: 'ズームアウト（縮小）' }));
    expect(screen.getByText('67%')).toBeInTheDocument();
  });

  test('handles clip manipulation', async () => {
    await saveProjectAutoSave(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, trackId: 1, soundData: { name: 'テスト音1', audioData: drumAudio } }] }],
      pixelsPerSecond: 100
    }));
    await renderDAW();
    await waitFor(() => expect(document.querySelectorAll('.audio-clip')).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'テスト音1を削除' }));
    expect(document.querySelectorAll('.audio-clip')).toHaveLength(0);
  });

  test('displays timeline with proper measurements', async () => {
    await renderDAW();
    const timeline = document.querySelector('.timeline');
    // 5 秒ごとに目盛りの数字を表示する（0s〜90s）
    ['0s', '5s', '45s', '90s'].forEach((label) => {
      expect(within(timeline).getByText(label)).toBeInTheDocument();
    });
    expect(within(timeline).queryByText('3s')).not.toBeInTheDocument();
  });

  test('handles error states gracefully', async () => {
    window.localStorage.getItem.mockImplementation((key) => (key === 'dawProjectAutoSave' ? 'invalid json' : null));
    await renderDAW();
    expect(screen.getByRole('heading', { name: /音楽づくりページ/ })).toBeInTheDocument();
    expect(document.querySelectorAll('.track')).toHaveLength(1);
  });

  test('maintains accessibility during interaction', async () => {
    await renderDAW();
    const playButton = screen.getByRole('button', { name: '再生' });
    playButton.focus();
    expect(playButton).toHaveFocus();
    fireEvent.click(playButton);
    // 再生中はボタンの名前が「一時停止」に変わる
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
  });

  test('使い方を開いたり閉じたりできる', async () => {
    await renderDAW();
    const toggle = screen.getByRole('button', { name: '表示' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(screen.getByRole('button', { name: '折りたたむ' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText(/自動保存機能/)).toBeInTheDocument();
  });
});
