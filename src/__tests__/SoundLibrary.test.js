// 音ライブラリページの基本動作。
// データ保存まわりの詳しい回帰テストは SoundLibrary.data.test.js にある
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

const tagFilters = () => document.querySelector('.tag-filters');

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
    expect(screen.getByRole('searchbox', { name: /音を探す/ })).toHaveAttribute('placeholder', '音の名前やタグで検索...');
    expect(screen.getByRole('combobox', { name: 'ならべかた' })).toHaveValue('newest');
  });

  test('読み込み中の表示を出してから一覧を表示する', async () => {
    render(<MemoryRouter><SoundLibrary /></MemoryRouter>);
    expect(screen.getByText('読み込み中...')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('読み込み中...')).not.toBeInTheDocument());
  });

  test('has proper accessibility structure', async () => {
    await seedSounds();
    await renderLibrary();
    expect(screen.getByRole('group', { name: /タグで絞り込み/ })).toBeInTheDocument();
    // 選ばれているタグは aria-pressed で伝える（色だけに頼らない）
    expect(screen.getByRole('button', { name: 'すべて' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(tagFilters()).getByRole('button', { name: 'music' })).toHaveAttribute('aria-pressed', 'false');
  });

  test('displays empty state when no sounds', async () => {
    await renderLibrary();
    expect(screen.getByText(/まだ音素材がありません/)).toBeInTheDocument();
    expect(screen.getByText(/音あつめページから音を録音してみましょう/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: '音あつめへ' })).toHaveAttribute('href', '/collection');
  });

  test('loads sounds from IndexedDB', async () => {
    await seedSounds();
    await renderLibrary();
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    expect(screen.getAllByText('test').length).toBeGreaterThan(0);
    expect(screen.getByText('全部で 2 こ')).toBeInTheDocument();
  });

  test('handles search functionality', async () => {
    await seedSounds();
    await renderLibrary();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'テスト音1' } });
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
    expect(screen.queryByText('テスト音2')).not.toBeInTheDocument();
    expect(screen.getByText('1 こ見つかりました（全部で 2 こ）')).toBeInTheDocument();
  });

  test('ひらがな・カタカナ、全角・半角を区別せずに探せる', async () => {
    await addRecording({ name: 'あめの音', tags: [], audioData: makeDataUrl('wav', 'audio/wav') });
    await addRecording({ name: 'ドアのしまる音', tags: ['ガッコウ'], audioData: makeDataUrl('wav', 'audio/wav') });
    await renderLibrary();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'アメ' } });
    expect(screen.getByText('あめの音')).toBeInTheDocument();
    expect(screen.queryByText('ドアのしまる音')).not.toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ﾄﾞｱ' } });
    expect(screen.getByText('ドアのしまる音')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'がっこう' } });
    expect(screen.getByText('ドアのしまる音')).toBeInTheDocument();
  });

  test('handles tag filtering', async () => {
    await seedSounds();
    await renderLibrary();
    fireEvent.click(within(tagFilters()).getByRole('button', { name: 'melody' }));
    expect(screen.queryByText('テスト音1')).not.toBeInTheDocument();
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    // もう一度押すと絞り込みをやめる
    fireEvent.click(within(tagFilters()).getByRole('button', { name: /melody/ }));
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
    fireEvent.click(within(tagFilters()).getByRole('button', { name: 'melody' }));
    fireEvent.click(screen.getByRole('button', { name: 'すべて' }));
    expect(screen.getByText('テスト音1')).toBeInTheDocument();
  });

  test('大きな ▶ ボタンで、保存されている Data URL を 1 つの <audio> で再生する', async () => {
    const audio = { play: jest.fn(() => Promise.resolve()), pause: jest.fn(), src: '' };
    global.Audio = jest.fn(() => audio);
    await seedSounds();
    await renderLibrary();
    // 一覧に <audio controls> を並べない（小さくて押しにくく、たくさんあると重い）
    expect(document.querySelectorAll('audio')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'テスト音2をきく' }));
    expect(audio.src).toMatch(/^data:audio\/mp4;base64,/);
    expect(screen.getByRole('button', { name: 'テスト音2を止める' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'テスト音1をきく' }));
    expect(audio.src).toMatch(/^data:audio\/wav;base64,/);
    expect(screen.getByRole('button', { name: 'テスト音2をきく' })).toBeInTheDocument();
    expect(global.Audio).toHaveBeenCalledTimes(1);
  });

  test('handles sound deletion', async () => {
    await seedSounds();
    await renderLibrary();
    fireEvent.click(screen.getByRole('button', { name: 'テスト音1を削除' }));
    const dialog = screen.getByRole('dialog', { name: '削除の確認' });
    expect(within(dialog).getByText('「テスト音1」を削除しますか？')).toBeInTheDocument();
    // うっかり消さないよう、最初にフォーカスが当たるのは「キャンセル」
    expect(within(dialog).getByRole('button', { name: 'キャンセル' })).toHaveFocus();
    fireEvent.click(within(dialog).getByRole('button', { name: /削除する/ }));
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
    fireEvent.click(within(tagFilters()).getByRole('button', { name: 'music' }));
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'テスト' } });
    expect(screen.getByText('テスト音2')).toBeInTheDocument();
    expect(screen.queryByText('別の音')).not.toBeInTheDocument();
    expect(screen.queryByText('テスト音1')).not.toBeInTheDocument();
  });
});
