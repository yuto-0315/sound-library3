// 音あつめページの基本動作。
// （以前のこのファイルはアプリに無い機能（スペースキーでの録音、ファイルのドラッグ＆ドロップ枠、
//   複数ファイル選択）や、インストールされていない user-event v14 の API を前提にしており、
//   一度も通っていなかったため書き直した。録音・保存の詳しい回帰テストは
//   SoundCollection.recording.test.js にある）
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import SoundCollection from '../pages/SoundCollection';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, makeAudioBytes } from '../test-utils/audioFixtures';
import { takeUnsavedDraft } from '../utils/unsavedDraft';

describe('SoundCollection Component', () => {
  beforeEach(() => {
    takeUnsavedDraft(); // 前のテストで残った「保存前の録音」を捨てる
    installFakeIndexedDB();
    installMemoryLocalStorage();
    window.confirm = jest.fn(() => true);
    global.FileReader = TestFileReader;
    URL.createObjectURL.mockImplementation(() => 'blob:mock-url');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('renders sound collection interface', () => {
    render(<SoundCollection />);
    expect(screen.getByRole('heading', { level: 2, name: /音あつめページ/ })).toBeInTheDocument();
    expect(screen.getByText(/身の回りにある音を録音したり/)).toBeInTheDocument();
  });

  test('has proper accessibility structure', () => {
    render(<SoundCollection />);
    expect(screen.getByRole('region', { name: /音を録音する/ })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: /音ファイルをアップロード/ })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: '録音操作' })).toBeInTheDocument();
  });

  test('displays recording controls correctly', () => {
    render(<SoundCollection />);
    const recordButton = screen.getByRole('button', { name: /録音開始/ });
    expect(recordButton).toHaveAttribute('type', 'button');
    expect(recordButton).toHaveAttribute('aria-describedby', 'record-instructions');
    expect(screen.queryByRole('button', { name: /録音停止/ })).not.toBeInTheDocument();
  });

  test('handles file input correctly', () => {
    render(<SoundCollection />);
    const input = screen.getByLabelText('音声ファイルを選択');
    expect(input).toHaveAttribute('type', 'file');
    expect(input).toHaveAttribute('accept', 'audio/*');
    expect(input).not.toHaveAttribute('multiple'); // 1 回に 1 つずつ名前を付けて保存する
  });

  test('displays empty state message when no recordings', () => {
    render(<SoundCollection />);
    expect(screen.getByText('まだ録音した音がありません。上の録音ボタンから始めましょう！')).toBeInTheDocument();
  });

  test('shows error messages when microphone access fails', async () => {
    navigator.mediaDevices.getUserMedia.mockImplementation(() => Promise.reject(Object.assign(new Error('x'), { name: 'NotFoundError' })));
    global.MediaRecorder = function MediaRecorder() {};
    render(<SoundCollection />);
    fireEvent.click(screen.getByRole('button', { name: /録音開始/ }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('マイクが見つかりません'));
  });

  test('handles file upload', async () => {
    render(<SoundCollection />);
    fireEvent.change(screen.getByLabelText('音声ファイルを選択'), {
      target: { files: [new File([makeAudioBytes('wav', 20)], 'かえるの声.wav', { type: 'audio/wav' })] }
    });
    expect(await screen.findByRole('dialog', { name: /音に名前をつけよう/ })).toBeInTheDocument();
    expect(screen.getByLabelText(/音の名前/)).toHaveValue('かえるの声');
  });

  test('displays recording instructions', () => {
    render(<SoundCollection />);
    expect(screen.getByText('iPhone/iPadをお使いの方へ：')).toBeInTheDocument();
    expect(screen.getByText(/「設定」アプリ →「Safari」→「マイク」/)).toBeInTheDocument();
  });

  test('handles component cleanup on unmount', () => {
    const { unmount } = render(<SoundCollection />);
    expect(() => unmount()).not.toThrow();
  });

  test('has proper ARIA live regions', () => {
    render(<SoundCollection />);
    expect(screen.getByRole('alert')).toBeInTheDocument(); // エラー表示用（空のときは非表示）
    expect(document.querySelector('[aria-live="polite"]')).toBeInTheDocument(); // お知らせ用
  });

  test('validates file types on upload', async () => {
    render(<SoundCollection />);
    fireEvent.change(screen.getByLabelText('音声ファイルを選択'), {
      target: { files: [new File(['<html></html>'], 'page.html', { type: 'text/html' })] }
    });
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('音声ファイルを選択してください'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
