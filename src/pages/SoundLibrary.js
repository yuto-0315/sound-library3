import React, { useState, useEffect } from 'react';
import './SoundLibrary.css';

const SoundLibrary = () => {
  const [sounds, setSounds] = useState([]);
  const [filteredSounds, setFilteredSounds] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [allTags, setAllTags] = useState([]);

  useEffect(() => {
    // LocalStorageから音素材を読み込み
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
    
    setSounds(soundsWithBlob);
    setFilteredSounds(soundsWithBlob);
    
    // 全てのタグを取得
    const tags = [...new Set(soundsWithBlob.flatMap(sound => sound.tags))];
    setAllTags(tags);
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

  useEffect(() => {
    // フィルタリング処理
    let filtered = sounds;
    
    if (selectedTag) {
      filtered = filtered.filter(sound => sound.tags.includes(selectedTag));
    }
    
    if (searchQuery) {
      filtered = filtered.filter(sound => 
        sound.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        sound.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
      );
    }
    
    setFilteredSounds(filtered);
  }, [sounds, selectedTag, searchQuery]);

  const clearFilters = () => {
    setSelectedTag('');
    setSearchQuery('');
  };

  const deleteSound = (soundId) => {
    const updatedSounds = sounds.filter(sound => sound.id !== soundId);
    setSounds(updatedSounds);
    localStorage.setItem('soundRecordings', JSON.stringify(updatedSounds));
    
    // タグリストも更新
    const tags = [...new Set(updatedSounds.flatMap(sound => sound.tags))];
    setAllTags(tags);
  };

  return (
    <div className="sound-library">
      <h2>📚 音ライブラリ</h2>
      <p>集めた音素材を見たり、整理したりできます</p>

      <div className="library-controls card">
        <div className="search-section">
          <h3>🔍 音を探す</h3>
          <div className="search-controls">
            <input
              type="text"
              placeholder="音の名前やタグで検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="search-input"
            />
          </div>
        </div>

        <div className="filter-section">
          <h3>🏷️ タグで絞り込み</h3>
          <div className="tag-filters">
            <button
              className={`tag-filter-btn ${selectedTag === '' ? 'active' : ''}`}
              onClick={() => setSelectedTag('')}
            >
              すべて
            </button>
            {allTags.map(tag => (
              <button
                key={tag}
                className={`tag-filter-btn ${selectedTag === tag ? 'active' : ''}`}
                onClick={() => setSelectedTag(tag)}
              >
                {tag}
              </button>
            ))}
          </div>
          
          {(selectedTag || searchQuery) && (
            <button onClick={clearFilters} className="clear-filters-btn">
              🗑️ フィルターをクリア
            </button>
          )}
        </div>
      </div>

      <div className="library-stats">
        <div className="stats-card">
          <span className="stats-number">{sounds.length}</span>
          <span className="stats-label">総音素材数</span>
        </div>
        <div className="stats-card">
          <span className="stats-number">{filteredSounds.length}</span>
          <span className="stats-label">表示中</span>
        </div>
        <div className="stats-card">
          <span className="stats-number">{allTags.length}</span>
          <span className="stats-label">タグ数</span>
        </div>
      </div>

      <div className="sounds-grid">
        {filteredSounds.length === 0 ? (
          <div className="no-sounds">
            {sounds.length === 0 ? (
              <div>
                <p>📭 まだ音素材がありません</p>
                <p>音あつめページから音を録音してみましょう！</p>
              </div>
            ) : (
              <div>
                <p>🔍 検索条件に合う音が見つかりませんでした</p>
                <p>別のキーワードやタグで試してみてください</p>
              </div>
            )}
          </div>
        ) : (
          filteredSounds.map(sound => (
            <LibrarySoundCard 
              key={sound.id} 
              sound={sound} 
              onDelete={deleteSound}
            />
          ))
        )}
      </div>
    </div>
  );
};

const LibrarySoundCard = ({ sound, onDelete }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [audioUrl, setAudioUrl] = useState(null);

  // コンポーネントマウント時にBlob URLを作成
  useEffect(() => {
    if (sound.audioBlob) {
      const url = URL.createObjectURL(sound.audioBlob);
      setAudioUrl(url);
      
      // クリーンアップ関数
      return () => {
        if (url) {
          URL.revokeObjectURL(url);
        }
      };
    }
  }, [sound.audioBlob]);

  const handleDelete = () => {
    onDelete(sound.id);
    setShowDeleteConfirm(false);
  };

  const dragStart = (e) => {
    e.dataTransfer.setData('application/json', JSON.stringify(sound));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const dragEnd = (e) => {
    // DAWPageのクリーンアップ関数を呼び出す
    if (window.cleanupDragStateCallback) {
      window.cleanupDragStateCallback();
    }
  };

  return (
    <div 
      className="library-sound-card"
      draggable
      onDragStart={dragStart}
      onDragEnd={dragEnd}
    >
      <div className="sound-header">
        <h4>{sound.name}</h4>
        <div className="sound-actions">
          <button 
            className="delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            title="削除"
          >
            🗑️
          </button>
        </div>
      </div>
      
      <div className="sound-meta">
        <p className="sound-date">
          📅 {new Date(sound.createdAt).toLocaleDateString('ja-JP')}
        </p>
        {sound.tags.length > 0 && (
          <div className="sound-tags">
            {sound.tags.map(tag => (
              <span key={tag} className="tag small">{tag}</span>
            ))}
          </div>
        )}
      </div>

      <audio 
        controls 
        src={audioUrl} 
        className="sound-player"
        onError={(e) => {
          console.error('音声の読み込みエラー:', e, 'sound:', sound.name);
        }}
      >
        <track kind="captions" label="音声説明" srcLang="ja" />
        お使いのブラウザは音声再生に対応していません。
      </audio>
      
      <div className="drag-hint">
        🎵 DAWページにドラッグ&ドロップできます
      </div>

      {showDeleteConfirm && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <h4>⚠️ 削除の確認</h4>
            <p>「{sound.name}」を削除しますか？</p>
            <div className="delete-confirm-actions">
              <button onClick={handleDelete} className="confirm-delete-btn">
                削除する
              </button>
              <button 
                onClick={() => setShowDeleteConfirm(false)}
                className="cancel-delete-btn"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default SoundLibrary;
