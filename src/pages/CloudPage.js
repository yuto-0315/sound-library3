import React, { useState, useEffect } from 'react';
import './CloudPage.css';

const CloudPage = () => {
  const [roomNumber, setRoomNumber] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTags, setSelectedTags] = useState([]);
  const [uploadFile, setUploadFile] = useState(null);
  const [uploadData, setUploadData] = useState({
    fileName: '',
    studentName: '',
    tags: []
  });
  const [newTag, setNewTag] = useState('');

  const API_BASE_URL = '/api'; // XAMPPの場合のベースURL

  // ローカルストレージから部屋番号を読み込み
  useEffect(() => {
    const savedRoomNumber = localStorage.getItem('sound-library-room');
    if (savedRoomNumber) {
      setRoomNumber(savedRoomNumber);
      joinRoom(savedRoomNumber);
    }
  }, []);

  // 部屋に入る
  const joinRoom = async (roomNum) => {
    setIsLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/rooms.php`);
      const data = await response.json();
      
      if (data.success) {
        const room = data.data.find(r => r.room_number == roomNum);
        if (room) {
          setCurrentRoom(room);
          localStorage.setItem('sound-library-room', roomNum);
          await loadAudioFiles(room.id);
        } else {
          setError('指定された部屋番号が見つかりません');
        }
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('サーバーに接続できませんでした');
      console.error('Room join error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 音声ファイル一覧を読み込み
  const loadAudioFiles = async (roomId) => {
    try {
      const params = new URLSearchParams({ room_id: roomId });
      if (searchQuery) params.append('name', searchQuery);
      
      const response = await fetch(`${API_BASE_URL}/audio.php?${params}`);
      const data = await response.json();
      
      if (data.success) {
        setAudioFiles(data.data);
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('音声ファイルの読み込みに失敗しました');
      console.error('Load audio files error:', err);
    }
  };

  // ファイルアップロード
  const handleUpload = async (e) => {
    e.preventDefault();
    
    if (!uploadFile || !currentRoom) {
      setError('ファイルを選択してください');
      return;
    }

    setIsLoading(true);
    
    const formData = new FormData();
    formData.append('audio_file', uploadFile);
    formData.append('room_id', currentRoom.id);
    formData.append('file_name', uploadData.fileName || uploadFile.name);
    formData.append('student_name', uploadData.studentName);
    formData.append('tags', JSON.stringify(uploadData.tags));

    try {
      const response = await fetch(`${API_BASE_URL}/audio.php`, {
        method: 'POST',
        body: formData
      });
      
      const data = await response.json();
      
      if (data.success) {
        // フォームリセット
        setUploadFile(null);
        setUploadData({ fileName: '', studentName: '', tags: [] });
        document.getElementById('file-input').value = '';
        
        // 一覧を再読み込み
        await loadAudioFiles(currentRoom.id);
        
        alert('アップロードが完了しました！');
      } else {
        setError(data.error);
      }
    } catch (err) {
      setError('アップロードに失敗しました');
      console.error('Upload error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ダウンロード
  const handleDownload = async (audioFile) => {
    const userIdentifier = localStorage.getItem('user-identifier') || 
                          'user_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('user-identifier', userIdentifier);
    
    const downloadUrl = `${API_BASE_URL}/download.php?uid=${audioFile.uid}&user_id=${userIdentifier}`;
    window.open(downloadUrl, '_blank');
  };

  // タグ追加
  const addTag = () => {
    if (newTag && !uploadData.tags.includes(newTag)) {
      setUploadData(prev => ({
        ...prev,
        tags: [...prev.tags, newTag]
      }));
      setNewTag('');
    }
  };

  // タグ削除
  const removeTag = (tagToRemove) => {
    setUploadData(prev => ({
      ...prev,
      tags: prev.tags.filter(tag => tag !== tagToRemove)
    }));
  };

  // 部屋から出る
  const leaveRoom = () => {
    setCurrentRoom(null);
    setAudioFiles([]);
    setRoomNumber('');
    localStorage.removeItem('sound-library-room');
  };

  // 検索
  const handleSearch = () => {
    if (currentRoom) {
      loadAudioFiles(currentRoom.id);
    }
  };

  if (!currentRoom) {
    return (
      <div className="cloud-page">
        <div className="room-join-container">
          <h2>🌐 クラウド音声共有</h2>
          <p>部屋番号を入力して音声を共有しましょう</p>
          
          <form onSubmit={(e) => { e.preventDefault(); joinRoom(roomNumber); }} 
                className="room-join-form">
            <div className="form-group">
              <label htmlFor="room-number">部屋番号:</label>
              <input
                id="room-number"
                type="number"
                value={roomNumber}
                onChange={(e) => setRoomNumber(e.target.value)}
                placeholder="例: 101"
                required
                className="room-input"
              />
            </div>
            
            <button 
              type="submit" 
              disabled={isLoading}
              className="join-button"
            >
              {isLoading ? '接続中...' : '部屋に入る'}
            </button>
          </form>
          
          {error && <div className="error-message">{error}</div>}
        </div>
      </div>
    );
  }

  return (
    <div className="cloud-page">
      <header className="cloud-header">
        <h2>🌐 クラウド音声共有</h2>
        <div className="room-info">
          <span>部屋: {currentRoom.room_number} - {currentRoom.room_name}</span>
          <button onClick={leaveRoom} className="leave-button">退室</button>
        </div>
      </header>

      {/* アップロードセクション */}
      <section className="upload-section">
        <h3>音声をアップロード</h3>
        <form onSubmit={handleUpload} className="upload-form">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="file-input">音声ファイル:</label>
              <input
                id="file-input"
                type="file"
                accept="audio/*"
                onChange={(e) => setUploadFile(e.target.files[0])}
                required
              />
            </div>
            
            <div className="form-group">
              <label htmlFor="student-name">名前:</label>
              <input
                id="student-name"
                type="text"
                value={uploadData.studentName}
                onChange={(e) => setUploadData(prev => ({...prev, studentName: e.target.value}))}
                placeholder="あなたの名前"
                className="text-input"
              />
            </div>
          </div>

          <div className="form-group">
            <label htmlFor="file-name">ファイル名:</label>
            <input
              id="file-name"
              type="text"
              value={uploadData.fileName}
              onChange={(e) => setUploadData(prev => ({...prev, fileName: e.target.value}))}
              placeholder={uploadFile?.name || "ファイル名を入力"}
              className="text-input"
            />
          </div>

          <div className="form-group">
            <label htmlFor="tag-input">タグ:</label>
            <div className="tag-input-container">
              <input
                id="tag-input"
                type="text"
                value={newTag}
                onChange={(e) => setNewTag(e.target.value)}
                placeholder="タグを追加"
                className="tag-input"
                onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), addTag())}
              />
              <button type="button" onClick={addTag} className="tag-add-button">追加</button>
            </div>
            
            <div className="tags-list">
              {uploadData.tags.map(tag => (
                <span key={tag} className="tag">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="tag-remove">×</button>
                </span>
              ))}
            </div>
          </div>

          <button type="submit" disabled={isLoading} className="upload-button">
            {isLoading ? 'アップロード中...' : 'アップロード'}
          </button>
        </form>
      </section>

      {/* 検索・フィルターセクション */}
      <section className="search-section">
        <div className="search-controls">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="ファイル名で検索"
            className="search-input"
          />
          <button onClick={handleSearch} className="search-button">検索</button>
        </div>
      </section>

      {/* 音声ファイル一覧 */}
      <section className="audio-list-section">
        <h3>共有された音声ファイル ({audioFiles.length}件)</h3>
        
        {audioFiles.length === 0 ? (
          <p className="no-files">まだ音声ファイルがありません</p>
        ) : (
          <div className="audio-list">
            {audioFiles.map(audioFile => (
              <div key={audioFile.id} className="audio-item">
                <div className="audio-info">
                  <h4>{audioFile.file_name}</h4>
                  <div className="audio-details">
                    {audioFile.student_name && <span>作成者: {audioFile.student_name}</span>}
                    <span>サイズ: {Math.round(audioFile.file_size / 1024)}KB</span>
                    <span>ダウンロード数: {audioFile.download_count}</span>
                    <span>アップロード日: {new Date(audioFile.upload_date).toLocaleDateString('ja-JP')}</span>
                  </div>
                  
                  {audioFile.tags.length > 0 && (
                    <div className="audio-tags">
                      {audioFile.tags.map(tag => (
                        <span key={tag} className="audio-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="audio-actions">
                  <button 
                    onClick={() => handleDownload(audioFile)} 
                    className="download-button"
                  >
                    ダウンロード
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {error && <div className="error-message">{error}</div>}
    </div>
  );
};

export default CloudPage;
