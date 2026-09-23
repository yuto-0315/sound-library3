import React, { useEffect } from 'react';
import { HashRouter as Router, Routes, Route, useLocation } from 'react-router-dom';
import './App.css';
import Navigation from './components/Navigation';
import ErrorBoundary from './components/ErrorBoundary';
import SoundCollection from './pages/SoundCollection';
import SoundLibrary from './pages/SoundLibrary';
import DAWPage from './pages/DAWPage';
import CloudPage from './pages/CloudPage';
import AdminPage from './pages/AdminPage';
import { requestPersistentStorage } from './utils/indexedDB';

const AppRoutes = () => {
  const location = useLocation();
  return (
    <ErrorBoundary resetKey={location.pathname}>
      <Routes>
        <Route path="/" element={<SoundCollection />} />
        <Route path="/collection" element={<SoundCollection />} />
        <Route path="/library" element={<SoundLibrary />} />
        <Route path="/daw" element={<DAWPage />} />
        <Route path="/cloud" element={<CloudPage />} />
        <Route path="/admin" element={<AdminPage />} />
      </Routes>
    </ErrorBoundary>
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
      <div className="App">
        <header role="banner">
          <Navigation />
        </header>

        <main
          id="main-content"
          className="main-content"
          role="main"
          tabIndex="-1"
        >
          <AppRoutes />
        </main>
      </div>
    </Router>
  );
}

export default App;
