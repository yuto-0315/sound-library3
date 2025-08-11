import React from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import '@testing-library/jest-dom';
import Navigation from '../components/Navigation';

describe('Navigation Component - Basic Tests', () => {
  const renderWithRouter = (component) => {
    return render(
      <MemoryRouter>
        {component}
      </MemoryRouter>
    );
  };

  test('renders navigation links', () => {
    renderWithRouter(<Navigation />);
    
    // ナビゲーションリンクが表示される（role指定で特定）
    expect(screen.getByRole('menuitem', { name: /音あつめ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /音ライブラリ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /音楽づくり/ })).toBeInTheDocument();
  });

  test('has proper navigation structure', () => {
    renderWithRouter(<Navigation />);
    
    // ナビゲーション要素が存在する
    expect(screen.getByRole('navigation')).toBeInTheDocument();
    
    // メニューバーが存在する
    expect(screen.getByRole('menubar')).toBeInTheDocument();
  });

  test('displays app title', () => {
    renderWithRouter(<Navigation />);
    
    // アプリのタイトルが表示される
    expect(screen.getByText(/音楽づくりアプリ/)).toBeInTheDocument();
  });
});
