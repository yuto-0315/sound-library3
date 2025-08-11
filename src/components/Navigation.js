import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import './Navigation.css';

const Navigation = () => {
  const location = useLocation();
  
  const isActive = (path) => {
    return location.pathname === path;
  };

  // ページタイトルの取得
  const getPageTitle = () => {
    switch (location.pathname) {
      case '/':
      case '/collection':
        return '音あつめページ';
      case '/library':
        return '音ライブラリページ';
      case '/daw':
        return '音楽づくりページ';
      default:
        return 'ホームページ';
    }
  };

  return (
    <nav className="navigation" role="navigation" aria-label="メインナビゲーション">
      <div className="nav-container">
        <h1 className="nav-title" id="app-title">
          <span role="img" aria-label="音符">🎵</span> 音楽づくりアプリ
        </h1>
        
        {/* 現在のページを視覚的に分からない場合のためのスクリーンリーダー用情報 */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          現在のページ: {getPageTitle()}
        </div>
        
        <ul className="nav-links" role="menubar">
          <li role="none">
            <Link 
              to="/collection" 
              className={`nav-link ${isActive('/collection') || isActive('/') ? 'active' : ''}`}
              role="menuitem"
              aria-current={isActive('/collection') || isActive('/') ? 'page' : undefined}
              aria-describedby="collection-desc"
            >
              <span role="img" aria-label="マイク">🎤</span> 音あつめ
              <span id="collection-desc" className="sr-only">
                音を録音したりファイルをアップロードするページ
              </span>
            </Link>
          </li>
          
          <li role="none">
            <Link 
              to="/library" 
              className={`nav-link ${isActive('/library') ? 'active' : ''}`}
              role="menuitem"
              aria-current={isActive('/library') ? 'page' : undefined}
              aria-describedby="library-desc"
            >
              <span role="img" aria-label="本">📚</span> 音ライブラリ
              <span id="library-desc" className="sr-only">
                収集した音素材を管理・検索するページ
              </span>
            </Link>
          </li>
          
          <li role="none">
            <Link 
              to="/daw" 
              className={`nav-link ${isActive('/daw') ? 'active' : ''}`}
              role="menuitem"
              aria-current={isActive('/daw') ? 'page' : undefined}
              aria-describedby="daw-desc"
            >
              <span role="img" aria-label="ピアノ">🎹</span> 音楽づくり
              <span id="daw-desc" className="sr-only">
                音素材を組み合わせて音楽を作成するページ
              </span>
            </Link>
          </li>
        </ul>
      </div>
    </nav>
  );
};

export default Navigation;
