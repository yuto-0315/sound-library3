import React, { useState, useEffect } from 'react';
import './AdminPage.css';

const AdminPage = () => {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [songs, setSongs] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState('rooms');
  
  // 新規部屋作成用
  const [newRoom, setNewRoom] = useState({
    room_number: '',
    room_name: '',
    teacher_name: ''
  });

  const API_BASE_URL = '/api';

  useEffect(() => {
    loadRooms();
  }, []);

  // 部屋一覧を読み込み
  const loadRooms = async () => {
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/rooms.php`);
      const data = await response.json();
      
      if (data.success) {
        setRooms(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('部屋一覧の読み込みに失敗しました');
      console.error('Load rooms error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 新しい部屋を作成
  const createRoom = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    
    try {
      const response = await fetch(`${API_BASE_URL}/rooms.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newRoom)
      });
      
      const data = await response.json();
      
      if (data.success) {
        setNewRoom({ room_number: '', room_name: '', teacher_name: '' });
        await loadRooms();
        alert('部屋を作成しました！');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('部屋の作成に失敗しました');
      console.error('Create room error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 部屋削除
  const deleteRoom = async (roomId) => {
    if (!window.confirm('この部屋を削除しますか？関連するすべてのデータが削除されます。')) {
      return;
    }
    
    setIsLoading(true);
    try {
      const response = await fetch(`${API_BASE_URL}/rooms.php?id=${roomId}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        await loadRooms();
        if (selectedRoom && selectedRoom.id === roomId) {
          setSelectedRoom(null);
          setAudioFiles([]);
          setSongs([]);
        }
        alert('部屋を削除しました');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('部屋の削除に失敗しました');
      console.error('Delete room error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 部屋選択
  const selectRoom = async (room) => {
    setSelectedRoom(room);
    setIsLoading(true);
    
    try {
      // 音声ファイル読み込み
      const audioResponse = await fetch(`${API_BASE_URL}/audio.php?room_id=${room.id}`);
      const audioData = await audioResponse.json();
      
      if (audioData.success) {
        setAudioFiles(audioData.data);
      }
      
      // 楽曲データ読み込み
      const songsResponse = await fetch(`${API_BASE_URL}/songs.php?room_id=${room.id}`);
      const songsData = await songsResponse.json();
      
      if (songsData.success) {
        setSongs(songsData.data);
      }
    } catch (err) {
      setError('部屋データの読み込みに失敗しました');
      console.error('Load room data error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 音声ファイル削除
  const deleteAudioFile = async (uid) => {
    if (!window.confirm('この音声ファイルを削除しますか？')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE_URL}/audio.php?uid=${uid}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setAudioFiles(prev => prev.filter(file => file.uid !== uid));
        alert('音声ファイルを削除しました');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('音声ファイルの削除に失敗しました');
      console.error('Delete audio error:', err);
    }
  };

  // 楽曲削除
  const deleteSong = async (uid) => {
    if (!window.confirm('この楽曲を削除しますか？')) {
      return;
    }
    
    try {
      const response = await fetch(`${API_BASE_URL}/songs.php?uid=${uid}`, {
        method: 'DELETE'
      });
      
      const data = await response.json();
      
      if (data.success) {
        setSongs(prev => prev.filter(song => song.uid !== uid));
        alert('楽曲を削除しました');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('楽曲の削除に失敗しました');
      console.error('Delete song error:', err);
    }
  };

  // 楽曲再現（DAWページで開く）
  const openSongInDAW = (song) => {
    // 楽曲データをローカルストレージに保存
    localStorage.setItem('daw-import-song', JSON.stringify(song.song_data));
    
    // DAWページを新しいタブで開く
    window.open('#/daw', '_blank');
  };

  return (
    <div className="admin-page">
      <header className="admin-header">
        <h1>🏫 先生用管理ページ</h1>
      </header>

      <nav className="admin-nav">
        <button 
          className={`nav-tab ${activeTab === 'rooms' ? 'active' : ''}`}
          onClick={() => setActiveTab('rooms')}
        >
          部屋管理
        </button>
        {selectedRoom && (
          <>
            <button 
              className={`nav-tab ${activeTab === 'audio' ? 'active' : ''}`}
              onClick={() => setActiveTab('audio')}
            >
              音声ファイル ({audioFiles.length})
            </button>
            <button 
              className={`nav-tab ${activeTab === 'songs' ? 'active' : ''}`}
              onClick={() => setActiveTab('songs')}
            >
              生徒の楽曲 ({songs.length})
            </button>
          </>
        )}
      </nav>

      {error && <div className="error-message">{error}</div>}

      {activeTab === 'rooms' && (
        <div className="rooms-section">
          {/* 新規部屋作成 */}
          <section className="create-room-section">
            <h2>新しい部屋を作成</h2>
            <form onSubmit={createRoom} className="create-room-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="room-number">部屋番号 *</label>
                  <input
                    id="room-number"
                    type="number"
                    value={newRoom.room_number}
                    onChange={(e) => setNewRoom(prev => ({...prev, room_number: e.target.value}))}
                    placeholder="例: 101"
                    required
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="room-name">部屋名</label>
                  <input
                    id="room-name"
                    type="text"
                    value={newRoom.room_name}
                    onChange={(e) => setNewRoom(prev => ({...prev, room_name: e.target.value}))}
                    placeholder="例: 1年1組"
                  />
                </div>
                
                <div className="form-group">
                  <label htmlFor="teacher-name">先生名</label>
                  <input
                    id="teacher-name"
                    type="text"
                    value={newRoom.teacher_name}
                    onChange={(e) => setNewRoom(prev => ({...prev, teacher_name: e.target.value}))}
                    placeholder="あなたの名前"
                  />
                </div>
              </div>
              
              <button type="submit" disabled={isLoading} className="create-button">
                {isLoading ? '作成中...' : '部屋を作成'}
              </button>
            </form>
          </section>

          {/* 部屋一覧 */}
          <section className="rooms-list-section">
            <h2>部屋一覧 ({rooms.length}件)</h2>
            
            {rooms.length === 0 ? (
              <p className="no-data">部屋がありません</p>
            ) : (
              <div className="rooms-grid">
                {rooms.map(room => (
                  <div key={room.id} className="room-card">
                    <div className="room-info">
                      <h3>部屋 {room.room_number}</h3>
                      <p>{room.room_name}</p>
                      {room.teacher_name && <p>担当: {room.teacher_name}</p>}
                      <p className="room-date">
                        作成日: {new Date(room.created_at).toLocaleDateString('ja-JP')}
                      </p>
                    </div>
                    
                    <div className="room-actions">
                      <button 
                        onClick={() => selectRoom(room)}
                        className="select-button"
                      >
                        管理
                      </button>
                      <button 
                        onClick={() => deleteRoom(room.id)}
                        className="delete-button"
                      >
                        削除
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {activeTab === 'audio' && selectedRoom && (
        <section className="audio-section">
          <h2>
            {selectedRoom.room_name} (部屋{selectedRoom.room_number}) の音声ファイル
          </h2>
          
          {audioFiles.length === 0 ? (
            <p className="no-data">音声ファイルがありません</p>
          ) : (
            <div className="audio-list">
              {audioFiles.map(audioFile => (
                <div key={audioFile.id} className="audio-item">
                  <div className="audio-info">
                    <h4>{audioFile.file_name}</h4>
                    <div className="audio-details">
                      {audioFile.student_name && <span>作成者: {audioFile.student_name}</span>}
                      <span>ファイルサイズ: {Math.round(audioFile.file_size / 1024)}KB</span>
                      <span>ダウンロード数: {audioFile.download_count}</span>
                      <span>アップロード日: {new Date(audioFile.upload_date).toLocaleDateString('ja-JP')}</span>
                    </div>
                    
                    {audioFile.tags.length > 0 && (
                      <div className="tags">
                        {audioFile.tags.map(tag => (
                          <span key={tag} className="tag">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  
                  <div className="audio-actions">
                    <audio controls src={`/api/download.php?uid=${audioFile.uid}`}>
                      <track kind="captions" label="音声キャプション" />
                      お使いのブラウザは音声の再生に対応していません
                    </audio>
                    <button 
                      onClick={() => deleteAudioFile(audioFile.uid)}
                      className="delete-button"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {activeTab === 'songs' && selectedRoom && (
        <section className="songs-section">
          <h2>
            {selectedRoom.room_name} (部屋{selectedRoom.room_number}) の生徒作品
          </h2>
          
          {songs.length === 0 ? (
            <p className="no-data">楽曲がありません</p>
          ) : (
            <div className="songs-list">
              {songs.map(song => (
                <div key={song.id} className="song-item">
                  <div className="song-info">
                    <h4>{song.song_title}</h4>
                    <div className="song-details">
                      {song.student_name && <span>作成者: {song.student_name}</span>}
                      {song.group_number && <span>班番号: {song.group_number}</span>}
                      <span>作成日: {new Date(song.created_at).toLocaleDateString('ja-JP')}</span>
                      <span>更新日: {new Date(song.updated_at).toLocaleDateString('ja-JP')}</span>
                    </div>
                  </div>
                  
                  <div className="song-actions">
                    <button 
                      onClick={() => openSongInDAW(song)}
                      className="play-button"
                    >
                      DAWで開く
                    </button>
                    <button 
                      onClick={() => deleteSong(song.uid)}
                      className="delete-button"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isLoading && (
        <div className="loading-overlay">
          <div className="loading-spinner">読み込み中...</div>
        </div>
      )}
    </div>
  );
};

export default AdminPage;
