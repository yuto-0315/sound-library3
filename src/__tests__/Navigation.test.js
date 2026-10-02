import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
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

const CurrentPath = () => <div data-testid="current-path">{useLocation().pathname}</div>;

describe('Navigation Component', () => {
  test('renders navigation structure correctly', () => {
    renderWithRouter(<Navigation />);

    // ナビゲーション要素が存在する
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-label', 'メインナビゲーション');

    // タイトルが表示される
    expect(screen.getByText('音楽づくりアプリ')).toBeInTheDocument();

    // ページへのリンクがリストで並んでいる（menubar はアプリのメニュー用の役割なので使わない）
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.queryByRole('menubar')).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem')).not.toBeInTheDocument();
  });

  test('displays all navigation links', () => {
    renderWithRouter(<Navigation />);

    expect(screen.getByRole('link', { name: /音あつめ/ })).toHaveAttribute('href', '/collection');
    expect(screen.getByRole('link', { name: /音ライブラリ/ })).toHaveAttribute('href', '/library');
    expect(screen.getByRole('link', { name: /音楽づくり/ })).toHaveAttribute('href', '/daw');
    expect(screen.getByRole('link', { name: /みんなで共有/ })).toHaveAttribute('href', '/cloud');
    expect(screen.getAllByRole('link')).toHaveLength(4);
  });

  test.each([
    ['/collection', /音あつめ/, '現在のページ: 音あつめページ'],
    ['/library', /音ライブラリ/, '現在のページ: 音ライブラリページ'],
    ['/daw', /音楽づくり/, '現在のページ: 音楽づくりページ'],
    ['/cloud', /みんなで共有/, '現在のページ: みんなで共有ページ']
  ])('%s では対応するリンクが「今のページ」になる', (path, linkName, announcement) => {
    renderWithRouter(<Navigation />, { initialEntries: [path] });

    const activeLink = screen.getByRole('link', { name: linkName });
    expect(activeLink).toHaveAttribute('aria-current', 'page');
    expect(activeLink).toHaveClass('active');
    // 今のページ以外は aria-current を持たない
    screen.getAllByRole('link')
      .filter((link) => link !== activeLink)
      .forEach((link) => expect(link).not.toHaveAttribute('aria-current'));
    expect(screen.getByText(announcement)).toBeInTheDocument();
  });

  test('handles root path correctly', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/'] });

    // ルートパスでは音あつめページがアクティブ
    const collectionLink = screen.getByRole('link', { name: /音あつめ/ });
    expect(collectionLink).toHaveAttribute('aria-current', 'page');
    expect(collectionLink).toHaveClass('active');
  });

  test('先生用ページではどのリンクも「今のページ」にならない', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/admin'] });
    screen.getAllByRole('link').forEach((link) => expect(link).not.toHaveAttribute('aria-current'));
    expect(screen.getByText('現在のページ: 先生用管理ページ')).toBeInTheDocument();
  });

  test('has proper accessibility attributes', () => {
    renderWithRouter(<Navigation />);

    // 各リンクに適切な説明が設定されている
    expect(screen.getByRole('link', { name: /音あつめ/ })).toHaveAccessibleDescription('音を録音したりファイルをアップロードするページ');
    expect(screen.getByRole('link', { name: /音ライブラリ/ })).toHaveAccessibleDescription('収集した音素材を管理・検索するページ');
    expect(screen.getByRole('link', { name: /音楽づくり/ })).toHaveAccessibleDescription('音素材を組み合わせて音楽を作成するページ');

    // スクリーンリーダー用の情報が存在する
    expect(screen.getByText(/現在のページ:/)).toBeInTheDocument();
  });

  test('すべてのリンクに Tab で移動できる', () => {
    renderWithRouter(<Navigation />, { initialEntries: ['/daw'] });
    screen.getAllByRole('link').forEach((link) => {
      expect(link).not.toHaveAttribute('tabindex');
    });
  });

  test('矢印キーやスペースキーではページが切り替わらない（以前は menubar の操作でページが変わっていた）', () => {
    render(
      <MemoryRouter initialEntries={['/collection']}>
        <Navigation />
        <Routes>
          <Route path="*" element={<CurrentPath />} />
        </Routes>
      </MemoryRouter>
    );
    const library = screen.getByRole('link', { name: /音ライブラリ/ });
    library.focus();
    fireEvent.keyDown(library, { key: 'ArrowRight' });
    fireEvent.keyDown(library, { key: ' ' });
    fireEvent.keyDown(library, { key: 'ArrowDown' });
    expect(library).toHaveFocus();
    expect(screen.getByTestId('current-path')).toHaveTextContent('/collection');

    // リンクを押せば移動する
    fireEvent.click(library);
    expect(screen.getByTestId('current-path')).toHaveTextContent('/library');
  });

  test('displays icons with accessible names', () => {
    renderWithRouter(<Navigation />);

    expect(screen.getByLabelText('音符')).toBeInTheDocument();
    expect(screen.getByLabelText('マイク')).toBeInTheDocument();
    expect(screen.getByLabelText('本')).toBeInTheDocument();
    expect(screen.getByLabelText('ピアノ')).toBeInTheDocument();
  });
});
