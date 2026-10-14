// 音楽づくり（DAW）ページの基本動作。
// 保存・再生・ドラッグの詳しい回帰テストは DAWPage.persistence / DAWPage.interaction、
// テンポ・拍・元に戻す・選んだ音の操作などは DAWPage.music にある。
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

const seedOneClip = (name = 'テスト音1') => saveProjectAutoSave(serializeProject({
  tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 0, duration: 100, trackId: 1, soundData: { name, audioData: drumAudio } }] }],
  pixelsPerSecond: 100
}));

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

  // 画面を片付けてから、アンマウント時の保存が終わるのを待つ（次のテストが差し替えた
  // localStorage や IndexedDB に前のテストの保存処理が書き込まないように）
  afterEach(async () => {
    cleanup();
    await new Promise((resolve) => setTimeout(resolve, 30));
    jest.restoreAllMocks();
  });

  test('renders DAW interface', async () => {
    await renderDAW();
    expect(screen.getByRole('heading', { level: 2, name: /音楽づくりページ/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '停止' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /トラック追加/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '先生に送る' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ファイル/ })).toHaveAttribute('aria-expanded', 'false');
  });

  test('has proper accessibility structure', async () => {
    await renderDAW();
    // アイコンだけのボタンにも読み上げ用の名前がある
    [
      '再生', '停止', '元に戻す', 'やり直す', 'テンポを遅くする', 'テンポを速くする',
      'ズームイン（拡大）', 'ズームアウト（縮小）', '音素材パネルを閉じる', 'トラック 1を削除', 'トラック 1をミュート', '使い方'
    ].forEach((name) => {
      expect(screen.getByRole('button', { name })).toBeInTheDocument();
    });
    expect(screen.getByRole('combobox', { name: '拍子' })).toHaveValue('4');
    expect(screen.getByRole('combobox', { name: '置き方' })).toHaveValue('beat');
    expect(screen.getByRole('slider', { name: /再生位置/ })).toHaveAttribute('aria-valuetext', '1小節 1拍');
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(document.querySelector('.autosave-status')).toHaveTextContent(/保存/); // 自動保存の状況
  });

  test('displays initial track', async () => {
    await renderDAW();
    expect(screen.getByRole('button', { name: 'トラック 1' })).toHaveAttribute('aria-pressed', 'true');
    expect(document.querySelectorAll('.track')).toHaveLength(1);
  });

  test('adds new track when add track button is clicked', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(screen.getByRole('button', { name: 'トラック 1' })).toBeInTheDocument();
    // 追加したトラックが「＋で音を置くトラック」になる
    expect(screen.getByRole('button', { name: 'トラック 2' })).toHaveAttribute('aria-pressed', 'true');
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
    expect(within(panel).getByRole('button', { name: 'test' })).toHaveAttribute('aria-pressed', 'false'); // タグの絞り込み
    expect(within(panel).getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
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
    await seedOneClip();
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
  });

  test('音が無いときに再生を押すと、無音を鳴らし続けずに案内する', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    expect(screen.getByText(/まだ音が置かれていません/)).toBeInTheDocument();
  });

  test('saves and loads project data', async () => {
    await saveProjectAutoSave(serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [{ id: 1, startTime: 50, duration: 100, trackId: 1, soundData: { name: '保存した音', audioData: drumAudio } }] }],
      pixelsPerSecond: 100
    }));
    await renderDAW();
    await waitFor(() => expect(document.querySelectorAll('.audio-clip')).toHaveLength(1));
    expect(screen.getByText('保存した音', { selector: '.clip-name' })).toBeInTheDocument();
    // 保存・読み込みは「ファイル」の中にまとめた
    fireEvent.click(screen.getByRole('button', { name: /ファイル/ }));
    expect(screen.getByRole('button', { name: 'ファイルに保存' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ファイルを開く' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'WAV ファイルに書き出す' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /リセット/ })).toBeInTheDocument();
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
    await seedOneClip();
    await renderDAW();
    await waitFor(() => expect(document.querySelectorAll('.audio-clip')).toHaveLength(1));
    // 置いた音をタップして選ぶと、削除ボタンが出る
    fireEvent.click(document.querySelector('.audio-clip'));
    fireEvent.click(screen.getByRole('button', { name: 'テスト音1を削除' }));
    expect(document.querySelectorAll('.audio-clip')).toHaveLength(0);
  });

  test('displays timeline with proper measurements', async () => {
    await renderDAW();
    const timeline = document.querySelector('.timeline');
    // 小節の番号を表示する（120 BPM・4 拍子・100% では 1 小節 = 200px）
    ['1', '2', '3', '24'].forEach((label) => {
      expect(within(timeline).getByText(label)).toBeInTheDocument();
    });
    const measure2 = within(timeline).getByText('2');
    expect(measure2.style.left).toBe('200px');
    expect(document.querySelector('.timeline-container').style.getPropertyValue('--beat-px')).toBe('50px');
    expect(document.querySelector('.timeline-container').style.getPropertyValue('--measure-px')).toBe('200px');
  });

  test('handles error states gracefully', async () => {
    window.localStorage.getItem.mockImplementation((key) => (key === 'dawProjectAutoSave' ? 'invalid json' : null));
    await renderDAW();
    expect(screen.getByRole('heading', { name: /音楽づくりページ/ })).toBeInTheDocument();
    expect(document.querySelectorAll('.track')).toHaveLength(1);
  });

  test('maintains accessibility during interaction', async () => {
    await seedOneClip();
    await renderDAW();
    const playButton = screen.getByRole('button', { name: '再生' });
    playButton.focus();
    expect(playButton).toHaveFocus();
    fireEvent.click(playButton);
    // 再生中はボタンの名前が「一時停止」に変わる
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
  });

  test('使い方はダイアログで開き、Esc で閉じるとボタンにフォーカスが戻る', async () => {
    await renderDAW();
    const help = screen.getByRole('button', { name: '使い方' });
    help.focus();
    fireEvent.click(help);
    const dialog = screen.getByRole('dialog', { name: /使い方/ });
    expect(within(dialog).getByText(/自動保存機能/)).toBeInTheDocument();
    expect(dialog).toContainElement(document.activeElement);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(help).toHaveFocus();
  });
});
