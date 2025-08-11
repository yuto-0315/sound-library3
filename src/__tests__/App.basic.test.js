import React from 'react';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import App from '../App';

describe('App Component - Basic Tests', () => {
  test('renders the app without crashing', () => {
    render(<App />);
    
    // アプリのタイトルが表示される
    expect(screen.getByText(/音楽づくりアプリ/)).toBeInTheDocument();
  });

  test('contains main navigation elements', () => {
    render(<App />);
    
    // ナビゲーション要素が表示される（role指定で特定）
    expect(screen.getByRole('menuitem', { name: /音あつめ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /音ライブラリ/ })).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /音楽づくり/ })).toBeInTheDocument();
  });

  test('has basic accessibility structure', () => {
    render(<App />);
    
    // main要素が存在する
    expect(screen.getByRole('main')).toBeInTheDocument();
    
    // navigation要素が存在する
    expect(screen.getByRole('navigation')).toBeInTheDocument();
  });
});
