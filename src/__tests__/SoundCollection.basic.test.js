import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import SoundCollection from '../pages/SoundCollection';

describe('SoundCollection Component - Basic Tests', () => {
  test('renders sound collection page', () => {
    render(<SoundCollection />);
    
    // ページタイトルが表示される
    expect(screen.getByText(/音あつめページ/)).toBeInTheDocument();
  });

  test('has recording functionality', () => {
    render(<SoundCollection />);
    
    // 録音ボタンが表示される
    expect(screen.getByRole('button', { name: /録音開始/ })).toBeInTheDocument();
  });

  test('has file upload functionality', () => {
    render(<SoundCollection />);
    
    // ファイル選択ボタンが表示される
    expect(screen.getByRole('button', { name: /ファイルを選択/ })).toBeInTheDocument();
  });

  test('displays empty state message', () => {
    render(<SoundCollection />);
    
    // 初期状態のメッセージが表示される
    expect(screen.getByText(/まだ録音した音がありません/)).toBeInTheDocument();
  });
});
