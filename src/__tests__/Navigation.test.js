import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
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
    expect(menuItems).toHaveLength(4); // 音あつめ・音ライブラリ・音楽づくり・みんなで共有
    
    menuItems.forEach(item => {
      expect(item).toHaveAttribute('role', 'menuitem');
    });
  });

  test('Tab で止まるのは 1 項目だけで、今のページの項目に止まる（roving tabindex）', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/daw'] });
    const menuItems = screen.getAllByRole('menuitem');
    expect(menuItems.map((item) => item.getAttribute('tabindex'))).toEqual(['-1', '-1', '0', '-1']);
  });

  test('矢印キー・Home・End でメニュー項目を移動できる', () => {
    renderWithRouter(<Navigation />);
    const menuItems = screen.getAllByRole('menuitem');
    menuItems[0].focus();
    fireEvent.keyDown(menuItems[0], { key: 'ArrowRight' });
    expect(menuItems[1]).toHaveFocus();
    expect(menuItems[1]).toHaveAttribute('tabindex', '0');
    expect(menuItems[0]).toHaveAttribute('tabindex', '-1');
    fireEvent.keyDown(menuItems[1], { key: 'ArrowLeft' });
    expect(menuItems[0]).toHaveFocus();
    fireEvent.keyDown(menuItems[0], { key: 'ArrowLeft' });
    expect(menuItems[3]).toHaveFocus(); // 端から反対側へ回る
    fireEvent.keyDown(menuItems[3], { key: 'Home' });
    expect(menuItems[0]).toHaveFocus();
    fireEvent.keyDown(menuItems[0], { key: 'End' });
    expect(menuItems[3]).toHaveFocus();
  });

  test('スペースキーでもページを開ける', () => {
    renderWithRouter(<Navigation />);
    const library = screen.getByRole('menuitem', { name: /音ライブラリ/ });
    const click = jest.fn();
    library.addEventListener('click', click);
    fireEvent.keyDown(library, { key: ' ' });
    expect(click).toHaveBeenCalled();
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
