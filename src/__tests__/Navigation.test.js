import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { BrowserRouter, MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Navigation from '../components/Navigation';

// テスト用のヘルパー関数
const renderWithRouter = (component, { initialEntries = ['/'] } = {}) => {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      {component}
    </MemoryRouter>
  );
};

describe('Navigation Component', () => {
  test('renders navigation structure correctly', () => {
    renderWithRouter(<Navigation />);
    
    // ナビゲーション要素が存在する
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-label', 'メインナビゲーション');
    
    // タイトルが表示される
    expect(screen.getByText('音楽づくりアプリ')).toBeInTheDocument();
    
    // メニューバーが存在する
    expect(screen.getByRole('menubar')).toBeInTheDocument();
  });

  test('displays all navigation links', () => {
    renderWithRouter(<Navigation />);
    
    // 全てのナビゲーションリンクが表示される
    expect(screen.getByRole('menuitem', { name: /音あつめ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /音ライブラリ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /音楽づくり/ })).toBeInTheDocument();
  });

  test('shows correct active state for collection page', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/collection'] });
    
    // 音あつめページがアクティブ状態
    const collectionLink = screen.getByRole('menuitem', { name: /音あつめ/ });
    expect(collectionLink).toHaveAttribute('aria-current', 'page');
    expect(collectionLink).toHaveClass('active');
    
    // 現在のページ情報が表示される
    expect(screen.getByText('現在のページ: 音あつめページ')).toBeInTheDocument();
  });

  test('shows correct active state for library page', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/library'] });
    
    // 音ライブラリページがアクティブ状態
    const libraryLink = screen.getByRole('menuitem', { name: /音ライブラリ/ });
    expect(libraryLink).toHaveAttribute('aria-current', 'page');
    expect(libraryLink).toHaveClass('active');
    
    // 現在のページ情報が表示される
    expect(screen.getByText('現在のページ: 音ライブラリページ')).toBeInTheDocument();
  });

  test('shows correct active state for daw page', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/daw'] });
    
    // 音楽づくりページがアクティブ状態
    const dawLink = screen.getByRole('menuitem', { name: /音楽づくり/ });
    expect(dawLink).toHaveAttribute('aria-current', 'page');
    expect(dawLink).toHaveClass('active');
    
    // 現在のページ情報が表示される
    expect(screen.getByText('現在のページ: 音楽づくりページ')).toBeInTheDocument();
  });

  test('handles root path correctly', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/'] });
    
    // ルートパスでは音あつめページがアクティブ
    const collectionLink = screen.getByRole('menuitem', { name: /音あつめ/ });
    expect(collectionLink).toHaveAttribute('aria-current', 'page');
    expect(collectionLink).toHaveClass('active');
  });

  test('has proper accessibility attributes', () => {
    renderWithRouter(<Navigation />);
    
    // アクセシビリティ属性が正しく設定されている
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-label', 'メインナビゲーション');
    
    // 各リンクに適切な説明が設定されている
    expect(screen.getByText('音を録音したりファイルをアップロードするページ')).toBeInTheDocument();
    expect(screen.getByText('収集した音素材を管理・検索するページ')).toBeInTheDocument();
    expect(screen.getByText('音素材を組み合わせて音楽を作成するページ')).toBeInTheDocument();
    
    // スクリーンリーダー用の情報が存在する
    expect(screen.getByText(/現在のページ:/)).toBeInTheDocument();
  });

  test('has proper role attributes for menu items', () => {
    renderWithRouter(<Navigation />);
    
    // 全てのメニューアイテムが正しいroleを持つ
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems).toHaveLength(3);
    
    menuItems.forEach(item => {
      expect(item).toHaveAttribute('role', 'menuitem');
    });
  });

  test('displays emoji icons correctly', () => {
    renderWithRouter(<Navigation />);
    
    // 絵文字が正しく表示される
    expect(screen.getByLabelText('音符')).toBeInTheDocument();
    expect(screen.getByLabelText('マイク')).toBeInTheDocument();
    expect(screen.getByLabelText('本')).toBeInTheDocument();
    expect(screen.getByLabelText('ピアノ')).toBeInTheDocument();
  });
});
