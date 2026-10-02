import React, { useEffect, useLayoutEffect, useRef } from 'react';
import { HashRouter as Router, Navigate, Routes, Route, useLocation } from 'react-router-dom';
import './App.css';
import Navigation from './components/Navigation';
import ErrorBoundary from './components/ErrorBoundary';
import SoundCollection from './pages/SoundCollection';
import SoundLibrary from './pages/SoundLibrary';
import DAWPage from './pages/DAWPage';
import CloudPage from './pages/CloudPage';
import AdminPage from './pages/AdminPage';
import { requestPersistentStorage } from './utils/indexedDB';

// 画面いっぱいを使い、ページ全体ではスクロールしないページ（音楽づくりはタイムラインの中でスクロールする）
const FILL_SCREEN_PATHS = ['/daw'];

const AppLayout = () => {
  const location = useLocation();
  const mainRef = useRef(null);

  // ページの中身は <main> の中でスクロールするので、ページを切り替えてもスクロール位置が残ってしまう
  // （音ライブラリを下までスクロールしてから音楽づくりを開くと、途中から表示されていた）
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [location.pathname]);

  const fillScreen = FILL_SCREEN_PATHS.includes(location.pathname);

  // スキップリンクは URL を変えずにフォーカスだけ移す。
  // （以前は index.html の <a href="#main-content"> で、HashRouter がこれをページの URL と解釈し、
  //   押すと何も表示されない画面になっていた）
  const skipToMain = (event) => {
    event.preventDefault();
    if (mainRef.current) mainRef.current.focus();
  };

  return (
    <div className="App">
      <a href="#main-content" className="skip-link" onClick={skipToMain}>メインコンテンツにスキップ</a>
      <header role="banner">
        <Navigation />
      </header>

      <main
        ref={mainRef}
        id="main-content"
        className={`main-content ${fillScreen ? 'main-content--fill' : ''}`}
        role="main"
        tabIndex="-1"
      >
        <ErrorBoundary resetKey={location.pathname}>
          <Routes>
            <Route path="/" element={<SoundCollection />} />
            <Route path="/collection" element={<SoundCollection />} />
            <Route path="/library" element={<SoundLibrary />} />
            <Route path="/daw" element={<DAWPage />} />
            <Route path="/cloud" element={<CloudPage />} />
            <Route path="/admin" element={<AdminPage />} />
            {/* 古いブックマークなど、無いページの URL では何も表示されなかったので、音あつめに戻す */}
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </ErrorBoundary>
      </main>
    </div>
  );
};

function App() {
  // 保存した音や楽曲がブラウザに自動削除されないよう依頼する
  // （Safari はしばらく開かなかったサイトのデータを消すことがある）
  useEffect(() => {
    requestPersistentStorage();
  }, []);

  return (
    <Router>
      <AppLayout />
    </Router>
  );
}

export default App;
