import React, { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Globe, Library, Mic, Music, Piano } from 'lucide-react';
import Icon from './Icon';
import './Navigation.css';

const NAV_ITEMS = [
  {
    path: '/collection',
    activePaths: ['/', '/collection'],
    icon: Mic,
    iconLabel: 'マイク',
    label: '音あつめ',
    descriptionId: 'collection-desc',
    description: '音を録音したりファイルをアップロードするページ'
  },
  {
    path: '/library',
    activePaths: ['/library'],
    icon: Library,
    iconLabel: '本',
    label: '音ライブラリ',
    descriptionId: 'library-desc',
    description: '収集した音素材を管理・検索するページ'
  },
  {
    path: '/daw',
    activePaths: ['/daw'],
    icon: Piano,
    iconLabel: 'ピアノ',
    label: '音楽づくり',
    descriptionId: 'daw-desc',
    description: '音素材を組み合わせて音楽を作成するページ'
  },
  {
    path: '/cloud',
    activePaths: ['/cloud'],
    icon: Globe,
    iconLabel: 'クラウド',
    label: 'みんなで共有',
    descriptionId: 'cloud-desc',
    description: '音声をアップロードしてクラスのみんなと共有するページ'
  }
];

const PAGE_TITLES = {
  '/': '音あつめページ',
  '/collection': '音あつめページ',
  '/library': '音ライブラリページ',
  '/daw': '音楽づくりページ',
  '/cloud': 'みんなで共有ページ',
  '/admin': '先生用管理ページ'
};

const Navigation = () => {
  const location = useLocation();
  const linkRefs = useRef([]);
  const activeIndex = NAV_ITEMS.findIndex((item) => item.activePaths.includes(location.pathname));
  // menubar は Tab で 1 回だけ止まり、中の移動は矢印キーで行う（roving tabindex）
  const [focusIndex, setFocusIndex] = useState(null);
  const tabStopIndex = focusIndex !== null ? focusIndex : Math.max(activeIndex, 0);

  const focusItem = (index) => {
    const nextIndex = (index + NAV_ITEMS.length) % NAV_ITEMS.length;
    setFocusIndex(nextIndex);
    if (linkRefs.current[nextIndex]) linkRefs.current[nextIndex].focus();
  };

  const handleKeyDown = (event, index) => {
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        focusItem(index + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        focusItem(index - 1);
        break;
      case 'Home':
        event.preventDefault();
        focusItem(0);
        break;
      case 'End':
        event.preventDefault();
        focusItem(NAV_ITEMS.length - 1);
        break;
      case ' ':
        // メニュー項目はスペースキーでも開けるようにする（リンクの標準動作は Enter のみ）
        event.preventDefault();
        event.currentTarget.click();
        break;
      default:
        break;
    }
  };

  return (
    <nav className="navigation" role="navigation" aria-label="メインナビゲーション">
      <div className="nav-container">
        <h1 className="nav-title" id="app-title">
          <Icon icon={Music} label="音符" /> 音楽づくりアプリ
        </h1>

        {/* 現在のページを視覚的に分からない場合のためのスクリーンリーダー用情報 */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          現在のページ: {PAGE_TITLES[location.pathname] || 'ホームページ'}
        </div>

        <ul className="nav-links" role="menubar">
          {NAV_ITEMS.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <li role="none" key={item.path}>
                <Link
                  ref={(element) => { linkRefs.current[index] = element; }}
                  to={item.path}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                  role="menuitem"
                  tabIndex={index === tabStopIndex ? 0 : -1}
                  aria-current={isActive ? 'page' : undefined}
                  aria-describedby={item.descriptionId}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  onFocus={() => setFocusIndex(index)}
                >
                  <Icon icon={item.icon} label={item.iconLabel} /> {item.label}
                  <span id={item.descriptionId} className="sr-only">
                    {item.description}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
};

export default Navigation;
