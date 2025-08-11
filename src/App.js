import React from 'react';
import { HashRouter as Router, Routes, Route } from 'react-router-dom';
import './App.css';
import Navigation from './components/Navigation';
import SoundCollection from './pages/SoundCollection';
import SoundLibrary from './pages/SoundLibrary';
import DAWPage from './pages/DAWPage';
import CloudPage from './pages/CloudPage';
import AdminPage from './pages/AdminPage';

function App() {
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
          <Routes>
            <Route path="/" element={<SoundCollection />} />
            <Route path="/collection" element={<SoundCollection />} />
            <Route path="/library" element={<SoundLibrary />} />
            <Route path="/daw" element={<DAWPage />} />
            <Route path="/cloud" element={<CloudPage />} />
            <Route path="/admin" element={<AdminPage />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

export default App;
