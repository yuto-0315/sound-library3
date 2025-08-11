import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

describe('App Component', () => {
  test('renders without crashing', () => {
    render(<App />);
    const banners = screen.getAllByRole('banner');
    expect(banners[0]).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  test('has correct page structure', () => {
    render(<App />);
    
    // ヘッダーとメインコンテンツが存在する（複数ある場合は最初の要素をチェック）
    const banners = screen.getAllByRole('banner');
    expect(banners[0]).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    
    // メインコンテンツがフォーカス可能
    const mainContent = screen.getByRole('main');
    expect(mainContent).toHaveAttribute('tabIndex', '-1');
    expect(mainContent).toHaveAttribute('id', 'main-content');
  });

  test('displays navigation component', () => {
    render(<App />);
    
    // ナビゲーションコンポーネントが表示されている
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByText('音楽づくりアプリ')).toBeInTheDocument();
  });

  test('renders default route (SoundCollection)', () => {
    render(<App />);
    
    // デフォルトルートでSoundCollectionページが表示される
    expect(screen.getByText('音あつめ')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /録音開始/i })).toBeInTheDocument();
  });

  test('has proper accessibility attributes', () => {
    render(<App />);
    
    // セマンティックなHTML構造
    const banners = screen.getAllByRole('banner');
    expect(banners[0]).toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
