import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('ページの切り替え', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    window.location.hash = '';
    jest.restoreAllMocks();
  });

  test('ページを切り替えるとスクロール位置が先頭に戻る（以前は前のページの位置のまま表示されていた）', () => {
    render(<App />);
    const main = screen.getByRole('main');
    main.scrollTop = 400;
    fireEvent.click(screen.getByRole('link', { name: /音ライブラリ/ }));
    expect(main.scrollTop).toBe(0);
  });

  test('スキップリンクを押しても画面が消えず、メインの内容にフォーカスが移る', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('link', { name: 'メインコンテンツにスキップ' }));
    expect(screen.getByRole('main')).toHaveFocus();
    // 以前は URL が #main-content に変わり、どのページにも当てはまらず何も表示されなかった
    expect(window.location.hash).not.toBe('#main-content');
    expect(screen.getByRole('heading', { level: 2, name: /音あつめ/ })).toBeInTheDocument();
  });

  test('存在しないページの URL では音あつめページを表示する', () => {
    window.location.hash = '#/sound-library';
    render(<App />);
    expect(screen.getByRole('heading', { level: 2, name: /音あつめ/ })).toBeInTheDocument();
  });

  test('音楽づくりページだけは画面いっぱいを使う（ページ全体はスクロールしない）', () => {
    render(<App />);
    const main = screen.getByRole('main');
    expect(main).not.toHaveClass('main-content--fill');
    fireEvent.click(screen.getByRole('link', { name: /音楽づくり/ }));
    expect(main).toHaveClass('main-content--fill');
  });
});
