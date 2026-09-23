import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Globe, LoaderCircle, Play, Square, X } from 'lucide-react';
import './CloudPage.css';
import Icon from '../components/Icon';
import { addRecording, getAllRecordings, isQuotaExceededError } from '../utils/indexedDB';
import {
  blobToAudioDataUrl,
  dataUrlToBlob,
  getExtensionForMimeType,
  primeAudioElement,
  withDetectedMimeType
} from '../utils/audio';
import { fetchJson, findRoomByNumber, getUserIdentifier } from '../utils/api';
import { isEnterKey } from '../utils/keyboard';

const API_BASE_URL = '../api';

// ファイル名に使えない文字を除く
const toSafeFileName = (name) => (name || 'sound').replace(/[\\/:*?"<>|]/g, '_').trim() || 'sound';

const CloudPage = () => {
  const [roomNumber, setRoomNumber] = useState('');
  const [currentRoom, setCurrentRoom] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSoundFromLibrary, setSelectedSoundFromLibrary] = useState(null);
  const [librarySearchQuery, setLibrarySearchQuery] = useState('');
  const [selectedLibraryTag, setSelectedLibraryTag] = useState('');
  const [soundLibrary, setSoundLibrary] = useState([]);
  const [uploadData, setUploadData] = useState({
    fileName: '',
    studentName: '',
    tags: []
  });
  const [newTag, setNewTag] = useState('');
  const [playingAudioId, setPlayingAudioId] = useState(null);

  // 再生は 1 つの <audio> を使い回す（iOS はタップ中に一度再生した要素でないと再生を許可しない）
  const playerRef = useRef(null);
  const playRequestRef = useRef(0);

  const getPlayer = () => {
    if (!playerRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.playsInline = true;
      playerRef.current = { audio, url: null };
    }
    return playerRef.current;
  };

  const stopPlayback = useCallback(() => {
    playRequestRef.current += 1;
    const player = playerRef.current;
    if (player) {
      try {
        player.audio.pause();
      } catch (e) {
        // 無視
      }
      if (player.url) {
        URL.revokeObjectURL(player.url);
        player.url = null;
      }
    }
    setPlayingAudioId(null);
  }, []);

  // ページを離れたら再生を止める（止めないと別のページでも鳴り続ける）
  useEffect(() => () => {
    playRequestRef.current += 1;
    const player = playerRef.current;
    if (player) {
      try {
        player.audio.pause();
      } catch (e) {
        // 無視
      }
      if (player.url) URL.revokeObjectURL(player.url);
    }
  }, []);

  // 音声ファイル一覧を読み込み
  const loadAudioFiles = async (roomId, nameQuery = searchQuery) => {
    try {
      const params = new URLSearchParams({ room_id: roomId });
      if (nameQuery) params.append('name', nameQuery);

      const data = await fetchJson(`${API_BASE_URL}/audio.php?${params}`);
      if (data.success) {
        setAudioFiles(data.data || []);
      } else {
        setError(data.error || '音声ファイルの読み込みに失敗しました');
      }
    } catch (err) {
      setError('音声ファイルの読み込みに失敗しました');
      console.error('Load audio files error:', err);
    }
  };

  // 部屋に入る
  const joinRoom = async (roomNum) => {
    setIsLoading(true);
    setError('');

    try {
      const data = await fetchJson(`${API_BASE_URL}/rooms.php`);

      if (data.success) {
        const room = findRoomByNumber(data.data, roomNum);
        if (room) {
          setCurrentRoom(room);
          localStorage.setItem('sound-library-room', String(roomNum).trim());
          await loadAudioFiles(room.id);
        } else {
          setError('指定された部屋番号が見つかりません');
        }
      } else {
        setError(data.error || '部屋情報の取得に失敗しました');
      }
    } catch (err) {
      setError('サーバーに接続できませんでした');
      console.error('Room join error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // ローカルストレージから部屋番号を読み込み
  useEffect(() => {
    const savedRoomNumber = localStorage.getItem('sound-library-room');
    if (savedRoomNumber) {
      setRoomNumber(savedRoomNumber);
      joinRoom(savedRoomNumber);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 音ライブラリーから音素材を読み込み。
  // 音素材は IndexedDB に保存されている（以前はここだけ古い localStorage を見ていたため、
  // 録音した音が一覧に出ずアップロードできなかった）
  useEffect(() => {
    let cancelled = false;
    getAllRecordings()
      .then((sounds) => {
        if (!cancelled) setSoundLibrary(sounds);
      })
      .catch((err) => {
        console.error('音ライブラリの読み込みに失敗:', err);
        if (!cancelled) setError('音ライブラリを読み込めませんでした。ページを再読み込みしてください。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 全てのタグ
  const libraryTags = useMemo(
    () => [...new Set(soundLibrary.flatMap(sound => sound.tags || []))],
    [soundLibrary]
  );

  // 音ライブラリーのフィルタリング
  const filteredLibrarySounds = useMemo(() => {
    let filtered = soundLibrary;

    if (selectedLibraryTag) {
      filtered = filtered.filter(sound => (sound.tags || []).includes(selectedLibraryTag));
    }

    if (librarySearchQuery) {
      const query = librarySearchQuery.toLowerCase();
      filtered = filtered.filter(sound =>
        (sound.name || '').toLowerCase().includes(query) ||
        (sound.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [soundLibrary, selectedLibraryTag, librarySearchQuery]);

  // ファイルアップロード
  const handleUpload = async (e) => {
    e.preventDefault();

    if (!selectedSoundFromLibrary || !currentRoom) {
      setError('音ライブラリーから音素材を選択してください');
      return;
    }

    let audioBlob;
    try {
      // 中身に合った形式・拡張子で送る（以前は mp4 でも「.wav」として送っていたため、
      // 共有された音が iPad で再生できなかった）
      audioBlob = dataUrlToBlob(selectedSoundFromLibrary.audioData);
    } catch (err) {
      console.error('音声データの変換に失敗:', err);
      setError('この音素材の音声データが壊れているため、アップロードできません');
      return;
    }

    setIsLoading(true);
    setError('');

    const baseName = toSafeFileName(selectedSoundFromLibrary.name);
    const formData = new FormData();
    formData.append('audio_file', audioBlob, `${baseName}.${getExtensionForMimeType(audioBlob.type)}`);
    formData.append('room_id', currentRoom.id);
    formData.append('file_name', uploadData.fileName || selectedSoundFromLibrary.name);
    formData.append('student_name', uploadData.studentName);
    formData.append('tags', JSON.stringify(uploadData.tags));

    try {
      const data = await fetchJson(`${API_BASE_URL}/audio.php`, {
        method: 'POST',
        body: formData
      });

      if (data.success) {
        // フォームリセット
        setSelectedSoundFromLibrary(null);
        setUploadData({ fileName: '', studentName: '', tags: [] });

        // 一覧を再読み込み
        await loadAudioFiles(currentRoom.id);

        alert('アップロードが完了しました！');
      } else {
        setError(data.error || 'アップロードに失敗しました');
      }
    } catch (err) {
      setError(err.message || 'アップロードに失敗しました');
      console.error('Upload error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const buildDownloadUrl = (audioFile) => {
    const params = new URLSearchParams({ uid: audioFile.uid, user_id: getUserIdentifier() });
    return `${API_BASE_URL}/download.php?${params}`;
  };

  const fetchAudioBlob = async (audioFile) => {
    const response = await fetch(buildDownloadUrl(audioFile));
    if (!response.ok) {
      throw new Error('音声ファイルの読み込みに失敗しました');
    }
    // サーバーの Content-Type が間違っていても中身に合わせて直す
    return withDetectedMimeType(await response.blob());
  };

  // ダウンロード（音ライブラリーに追加）
  const handleDownload = async (audioFile) => {
    if (soundLibrary.some(sound => sound.cloudUid && sound.cloudUid === audioFile.uid)) {
      alert(`「${audioFile.file_name}」は既に音ライブラリーに追加されています`);
      return;
    }

    setIsLoading(true);
    setError('');

    try {
      const audioBlob = await fetchAudioBlob(audioFile);

      const newSound = {
        name: audioFile.file_name,
        audioData: await blobToAudioDataUrl(audioBlob),
        tags: audioFile.tags || [],
        createdAt: new Date().toISOString(),
        source: 'cloud-download',
        cloudUid: audioFile.uid
      };

      // IndexedDB に保存（以前は容量の小さい localStorage に保存していて、すぐ失敗していた）
      const id = await addRecording(newSound);
      setSoundLibrary(prev => [...prev, { ...newSound, id }]);

      alert(`「${audioFile.file_name}」を音ライブラリーに追加しました！`);
    } catch (err) {
      setError(isQuotaExceededError(err)
        ? '保存できる容量が足りません。音ライブラリで使わない音を削除してください。'
        : 'ダウンロードに失敗しました');
      console.error('Download error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // タグ追加
  const addTag = () => {
    const tag = newTag.trim();
    if (tag && !uploadData.tags.includes(tag)) {
      setUploadData(prev => ({
        ...prev,
        tags: [...prev.tags, tag]
      }));
    }
    setNewTag('');
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
    stopPlayback();
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
    // 同じファイルの場合は停止
    if (playingAudioId === audioFile.id) {
      stopPlayback();
      return;
    }
    stopPlayback();

    const player = getPlayer();
    const requestId = playRequestRef.current;
    // ダウンロードを待つとタップ操作の扱いが切れるので、先に要素の再生許可を取っておく
    primeAudioElement(player.audio);
    setPlayingAudioId(audioFile.id);

    try {
      const audioBlob = await fetchAudioBlob(audioFile);
      if (requestId !== playRequestRef.current) return; // 途中で別の操作をした

      const audioUrl = URL.createObjectURL(audioBlob);
      player.url = audioUrl;
      player.audio.onended = () => {
        if (requestId === playRequestRef.current) stopPlayback();
      };
      player.audio.onerror = () => {
        if (requestId !== playRequestRef.current) return;
        console.error('❌ CloudPage: Audio error:', player.audio.error);
        setError('この音声はこの端末では再生できませんでした');
        stopPlayback();
      };
      player.audio.src = audioUrl;
      await player.audio.play();
    } catch (err) {
      if (requestId !== playRequestRef.current) return;
      setError('音声の再生に失敗しました');
      console.error('Play audio error:', err);
      stopPlayback();
    }
  };

  if (!currentRoom) {
    return (
      <div className="cloud-page">
        <div className="room-join-container">
          <h2><Icon icon={Globe} /> クラウド音声共有</h2>
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
        <h2><Icon icon={Globe} /> クラウド音声共有</h2>
        <div className="room-info">
          <span>部屋: {currentRoom.room_number} - {currentRoom.room_name}</span>
          <button type="button" onClick={leaveRoom} className="leave-button">退室</button>
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
                        {(sound.tags || []).map(tag => (
                          <span key={tag} className="tag small">{tag}</span>
                        ))}
                      </div>
                    </div>
                    <audio 
                      controls 
                      src={sound.audioData || undefined}
                      className="mini-audio-player"
                      preload="metadata"
                      playsInline
                      onClick={(e) => e.stopPropagation()}
                      onError={(e) => {
                        console.error('CloudPage音声再生エラー:', e, 'sound:', sound.name);
                      }}
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
                onKeyDown={(e) => { if (isEnterKey(e)) { e.preventDefault(); addTag(); } }}
              />
              <button type="button" onClick={addTag} className="tag-add-button">追加</button>
            </div>
            
            <div className="tags-list">
              {uploadData.tags.map(tag => (
                <span key={tag} className="tag">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="tag-remove touch-target-expand" aria-label={`タグ「${tag}」を削除`}><Icon icon={X} size={12} /></button>
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
          <button type="button" onClick={handleSearch} className="search-button">検索</button>
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
                  
                  {(audioFile.tags || []).length > 0 && (
                    <div className="audio-tags">
                      {(audioFile.tags || []).map(tag => (
                        <span key={tag} className="audio-tag">{tag}</span>
                      ))}
                    </div>
                  )}
                </div>
                
                <div className="audio-actions">
                  <button 
                    type="button"
                    onClick={() => playAudioFile(audioFile)} 
                    className="play-button"
                    title={playingAudioId === audioFile.id ? '停止' : '再生'}
                    aria-label={`${audioFile.file_name}を${playingAudioId === audioFile.id ? '停止' : '再生'}`}
                  >
                    <Icon icon={playingAudioId === audioFile.id ? Square : Play} fill="currentColor" />
                  </button>
                  <button 
                    type="button"
                    onClick={() => handleDownload(audioFile)} 
                    className="download-button"
                    disabled={isLoading}
                  >
                    {isLoading ? <><Icon icon={LoaderCircle} className="icon-spin" /> 追加中...</> : '音ライブラリーに追加'}
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
