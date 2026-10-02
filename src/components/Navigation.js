import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Globe, Library, Mic, Music, Piano } from 'lucide-react';
import Icon from './Icon';
import './Navigation.css';

const NAV_ITEMS = [
  {
    path: '/collection',
    activePaths: ['/', '/collection'],
    icon: Mic,
    label: '音あつめ',
    descriptionId: 'collection-desc',
    description: '音を録音したりファイルをアップロードするページ'
  },
  {
    path: '/library',
    activePaths: ['/library'],
    icon: Library,
    label: '音ライブラリ',
    descriptionId: 'library-desc',
    description: '収集した音素材を管理・検索するページ'
  },
  {
    path: '/daw',
    activePaths: ['/daw'],
    icon: Piano,
    label: '音楽づくり',
    descriptionId: 'daw-desc',
    description: '音素材を組み合わせて音楽を作成するページ'
  },
  {
    path: '/cloud',
    activePaths: ['/cloud'],
    icon: Globe,
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

// サイト内のページ移動は、ふつうのリンクの並びにする。
// （以前は role="menubar" で、矢印キーで項目を移動し、スペースキーでページが切り替わっていた。
//   menubar はアプリのメニュー用の役割で、読み上げでも「メニューバー」と案内されて分かりにくい）
const Navigation = () => {
  const location = useLocation();
  const activeIndex = NAV_ITEMS.findIndex((item) => item.activePaths.includes(location.pathname));

  return (
    <nav className="navigation" role="navigation" aria-label="メインナビゲーション">
      <div className="nav-container">
        <h1 className="nav-title" id="app-title">
          <Icon icon={Music} label="音符" /> <span className="nav-title-text">音楽づくりアプリ</span>
        </h1>

        {/* 現在のページを視覚的に分からない場合のためのスクリーンリーダー用情報 */}
        <div className="sr-only" aria-live="polite" aria-atomic="true">
          現在のページ: {PAGE_TITLES[location.pathname] || 'ホームページ'}
        </div>

        <ul className="nav-links">
          {NAV_ITEMS.map((item, index) => {
            const isActive = index === activeIndex;
            return (
              <li key={item.path}>
                {/* アイコンは飾り（名前は文字で分かる）。説明はリンクの外に置き、aria-describedby で結び付ける
                    （リンクの中に置くと名前の一部になり、読み上げで 2 回読まれていた） */}
                <Link
                  to={item.path}
                  className={`nav-link ${isActive ? 'active' : ''}`}
                  aria-current={isActive ? 'page' : undefined}
                  aria-describedby={item.descriptionId}
                >
                  <Icon icon={item.icon} size={22} />
                  <span className="nav-link-label">{item.label}</span>
                </Link>
                <span id={item.descriptionId} className="sr-only">
                  {item.description}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
};

export default Navigation;
