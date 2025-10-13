import React, { useState, useEffect, useRef } from 'react';
import './CloudPage.css';

const CloudPage = () => {
  const [roomNumber, setRoomNumber] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSoundFromLibrary, setSelectedSoundFromLibrary] = useState(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [libraryTags, setLibraryTags] = useState([]);
  const [selectedLibraryTag, setSelectedLibraryTag] = useState('');
  const [soundLibrary, setSoundLibrary] = useState([]);
  const [filteredLibrarySounds, setFilteredLibrarySounds] = useState([]);
  const [uploadData, setUploadData] = useState({
    fileName: '',
    studentName: '',
    tags: []
  });
  const [newTag, setNewTag] = useState('');
  const [playingAudioId, setPlayingAudioId] = useState(null);
  const audioRefs = useRef({});

  const API_BASE_URL = '../api';

  // ローカルストレージから部屋番号を読み込み
  useEffect(() => {
    const savedRoomNumber = localStorage.getItem('sound-library-room');
    if (savedRoomNumber) {
      setRoomNumber(savedRoomNumber);
      joinRoom(savedRoomNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 音ライブラリーから音素材を読み込み
  useEffect(() => {
    const loadSoundLibrary = () => {
      const savedSounds = JSON.parse(localStorage.getItem('soundRecordings') || '[]');
      
      // audioDataからBlobを復元
      const soundsWithBlob = savedSounds.map(sound => {
        if (sound.audioData) {
          try {
            const blob = base64ToBlob(sound.audioData, 'audio/wav');
            return { ...sound, audioBlob: blob };
          } catch (error) {
            console.error('音声データの復元に失敗:', error);
            return sound;
          }
        }
        return sound;
      });
      
      setSoundLibrary(soundsWithBlob);
      setFilteredLibrarySounds(soundsWithBlob);
      
      // 全てのタグを取得
      const tags = [...new Set(soundsWithBlob.flatMap(sound => sound.tags))];
      setLibraryTags(tags);
    };

    loadSoundLibrary();
  }, []);

  // Base64 を Blob に変換する関数
  const base64ToBlob = (base64, mimeType) => {
    const byteCharacters = atob(base64.split(',')[1]);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  };

  // 音ライブラリーのフィルタリング
  useEffect(() => {
    let filtered = soundLibrary;
    
    if (selectedLibraryTag) {
      filtered = filtered.filter(sound => sound.tags.includes(selectedLibraryTag));
    }
    
    if (librarySearchQuery) {
      filtered = filtered.filter(sound => 
        sound.name.toLowerCase().includes(librarySearchQuery.toLowerCase()) ||
        sound.tags.some(tag => tag.toLowerCase().includes(librarySearchQuery.toLowerCase()))
      );
    }
    
    setFilteredLibrarySounds(filtered);
  }, [soundLibrary, selectedLibraryTag, librarySearchQuery]);

  // 部屋に入る
  const joinRoom = async (roomNum) => {
    setIsLoading(true);
    setError('');
    
    try {
      const response = await fetch(`${API_BASE_URL}/rooms.php`);
      const data = await response.json();
      
      if (data.success) {
        // roomNumを数値に変換して比較
        const room = data.data.find(r => r.room_number === parseInt(roomNum, 10));
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
    
    if (!selectedSoundFromLibrary || !currentRoom) {
      setError('音ライブラリーから音素材を選択してください');
      return;
    }

    setIsLoading(true);
    
    const formData = new FormData();
    formData.append('audio_file', selectedSoundFromLibrary.audioBlob, selectedSoundFromLibrary.name + '.wav');
    formData.append('room_id', currentRoom.id);
    formData.append('file_name', uploadData.fileName || selectedSoundFromLibrary.name);
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
        setSelectedSoundFromLibrary(null);
        setUploadData({ fileName: '', studentName: '', tags: [] });
        
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

  // ダウンロード（音ライブラリーに追加）
  const handleDownload = async (audioFile) => {
    setIsLoading(true);
    setError('');
    
    try {
      const userIdentifier = localStorage.getItem('user-identifier') || 
                            'user_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('user-identifier', userIdentifier);
      
      const downloadUrl = `${API_BASE_URL}/download.php?uid=${audioFile.uid}&user_id=${userIdentifier}`;
      
      // ファイルをダウンロードしてBlobとして取得
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error('ダウンロードに失敗しました');
      }
      
      const audioBlob = await response.blob();
      
      // Blob を Base64 に変換
      const base64Data = await blobToBase64(audioBlob);
      
      // 音ライブラリーに追加
      const newSound = {
        id: Date.now() + Math.random(),
        name: audioFile.file_name,
        audioData: base64Data,
        audioBlob: audioBlob,
        tags: audioFile.tags || [],
        createdAt: new Date().toISOString(),
        source: 'cloud-download'
      };
      
      // LocalStorageに保存
      const savedSounds = JSON.parse(localStorage.getItem('soundRecordings') || '[]');
      const updatedSounds = [...savedSounds, newSound];
      localStorage.setItem('soundRecordings', JSON.stringify(updatedSounds));
      
      // 音ライブラリーの状態を更新
      setSoundLibrary(prev => [...prev, newSound]);
      
      alert(`「${audioFile.file_name}」を音ライブラリーに追加しました！`);
      
    } catch (err) {
      setError('ダウンロードに失敗しました');
      console.error('Download error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // Blob を Base64 に変換する関数
  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
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

  // 音声ファイルを再生
  const playAudioFile = async (audioFile) => {
    try {
      // 既に再生中の音声を停止
      if (playingAudioId && audioRefs.current[playingAudioId]) {
        audioRefs.current[playingAudioId].pause();
        audioRefs.current[playingAudioId].currentTime = 0;
      }

      // 同じファイルの場合は停止
      if (playingAudioId === audioFile.id) {
        setPlayingAudioId(null);
        return;
      }

      // 音声ファイルをダウンロード
      const userIdentifier = localStorage.getItem('user-identifier') || 
                            'user_' + Math.random().toString(36).substr(2, 9);
      localStorage.setItem('user-identifier', userIdentifier);
      
      const downloadUrl = `${API_BASE_URL}/download.php?uid=${audioFile.uid}&user_id=${userIdentifier}`;
      
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error('音声ファイルの読み込みに失敗しました');
      }
      
      const audioBlob = await response.blob();
      const audioUrl = URL.createObjectURL(audioBlob);
      
      // Audio要素を作成して再生
      const audio = new Audio(audioUrl);
      audioRefs.current[audioFile.id] = audio;
      
      audio.addEventListener('ended', () => {
        setPlayingAudioId(null);
        URL.revokeObjectURL(audioUrl);
        delete audioRefs.current[audioFile.id];
      });
      
      audio.addEventListener('error', () => {
        setError('音声の再生に失敗しました');
        setPlayingAudioId(null);
        URL.revokeObjectURL(audioUrl);
        delete audioRefs.current[audioFile.id];
      });
      
      await audio.play();
      setPlayingAudioId(audioFile.id);
      
    } catch (err) {
      setError('音声の再生に失敗しました');
      console.error('Play audio error:', err);
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
          
          {/* 音ライブラリーからの選択 */}
          <div className="library-selection">
            <h4>音ライブラリーから選択</h4>
            
            {/* 音ライブラリーの検索・フィルター */}
            <div className="library-search">
              <input
                type="text"
                value={librarySearchQuery}
                onChange={(e) => setLibrarySearchQuery(e.target.value)}
                placeholder="音素材を検索..."
                className="search-input"
              />
              <div className="library-tag-filters">
                <button
                  type="button"
                  className={`tag-filter-btn ${selectedLibraryTag === '' ? 'active' : ''}`}
                  onClick={() => setSelectedLibraryTag('')}
                >
                  すべて
                </button>
                {libraryTags.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    className={`tag-filter-btn ${selectedLibraryTag === tag ? 'active' : ''}`}
                    onClick={() => setSelectedLibraryTag(tag)}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>

            {/* 音ライブラリーの一覧 */}
            <div className="library-sounds-list">
              {filteredLibrarySounds.length === 0 ? (
                <p className="no-sounds">音素材が見つかりません</p>
              ) : (
                filteredLibrarySounds.map(sound => (
                  <div 
                    key={sound.id} 
                    className={`library-sound-item ${selectedSoundFromLibrary?.id === sound.id ? 'selected' : ''}`}
                    onClick={() => setSelectedSoundFromLibrary(sound)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedSoundFromLibrary(sound);
                      }
                    }}
                    role="button"
                    tabIndex={0}
                    aria-label={`音素材「${sound.name}」を選択`}
                  >
                    <div className="sound-info">
                      <h5>{sound.name}</h5>
                      <div className="sound-tags">
                        {sound.tags.map(tag => (
                          <span key={tag} className="tag small">{tag}</span>
                        ))}
                      </div>
                    </div>
                    <audio 
                      controls 
                      src={sound.audioBlob ? URL.createObjectURL(sound.audioBlob) : null}
                      className="mini-audio-player"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <track kind="captions" label="音声説明" srcLang="ja" />
                      お使いのブラウザは音声再生に対応していません。
                    </audio>
                  </div>
                ))
              )}
            </div>
          </div>
          
          <div className="form-row">
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
              placeholder={selectedSoundFromLibrary?.name || "ファイル名を入力"}
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
                    onClick={() => playAudioFile(audioFile)} 
                    className="play-button"
                    title={playingAudioId === audioFile.id ? '停止' : '再生'}
                  >
                    {playingAudioId === audioFile.id ? '⏹️' : '▶️'}
                  </button>
                  <button 
                    onClick={() => handleDownload(audioFile)} 
                    className="download-button"
                    disabled={isLoading}
                  >
                    {isLoading ? '追加中...' : '音ライブラリーに追加'}
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
