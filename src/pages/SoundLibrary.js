import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, Inbox, Library, Piano, Plus, RefreshCw, RotateCcw, Search, Tag, Tags, Trash2, TriangleAlert, X } from 'lucide-react';
import './SoundLibrary.css';
import Icon from '../components/Icon';
import { getAllRecordings, deleteRecording, addTagToRecording, removeTagFromRecording } from '../utils/indexedDB';
import { isEnterKey } from '../utils/keyboard';

const SoundLibrary = () => {
  const [sounds, setSounds] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');

  const loadSounds = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError('');
      // IndexedDBから音素材を読み込み (localStorageからの自動移行も含む)。
      // <audio> には Data URL をそのまま渡すので、ここで Blob に変換する必要はない。
      setSounds(await getAllRecordings());
    } catch (error) {
      console.error('音素材の読み込みに失敗:', error);
      // 「音素材がありません」と表示すると、データが消えたと誤解させてしまうので区別する
      setLoadError('音素材を読み込めませんでした。ページを再読み込みしてください。');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSounds();
  }, [loadSounds]);

  // 全てのタグ
  const allTags = useMemo(
    () => [...new Set(sounds.flatMap(sound => sound.tags || []))],
    [sounds]
  );

  // フィルタリング処理
  const filteredSounds = useMemo(() => {
    let filtered = sounds;

    if (selectedTag) {
      filtered = filtered.filter(sound => (sound.tags || []).includes(selectedTag));
    }

    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(sound =>
        (sound.name || '').toLowerCase().includes(query) ||
        (sound.tags || []).some(tag => tag.toLowerCase().includes(query))
      );
    }

    return filtered;
  }, [sounds, selectedTag, searchQuery]);

  // 選択中のタグが無くなったら「すべて」に戻す
  useEffect(() => {
    if (selectedTag && !allTags.includes(selectedTag)) {
      setSelectedTag('');
    }
  }, [allTags, selectedTag]);

  const clearFilters = () => {
    setSelectedTag('');
    setSearchQuery('');
  };

  // 変更した 1 件だけを差し替える（全件を再読み込みすると音が多いときに iPad が重くなる）
  const replaceSound = (updated) => {
    setSounds(prev => prev.map(sound => (sound.id === updated.id ? updated : sound)));
  };

  const deleteSound = async (soundId) => {
    try {
      await deleteRecording(soundId);
      setSounds(prev => prev.filter(sound => sound.id !== soundId));
    } catch (error) {
      console.error('削除エラー:', error);
      alert('音素材の削除に失敗しました。');
    }
  };

  const handleAddTag = async (soundId, tag) => {
    try {
      replaceSound(await addTagToRecording(soundId, tag));
    } catch (error) {
      console.error('タグ追加エラー:', error);
      alert('タグの追加に失敗しました。');
    }
  };

  const handleRemoveTag = async (soundId, tag) => {
    try {
      replaceSound(await removeTagFromRecording(soundId, tag));
    } catch (error) {
      console.error('タグ削除エラー:', error);
      alert('タグの削除に失敗しました。');
    }
  };

  if (isLoading) {
    return (
      <div className="sound-library">
        <h2><Icon icon={Library} /> 音ライブラリ</h2>
        <div className="loading">読み込み中...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sound-library">
        <h2><Icon icon={Library} /> 音ライブラリ</h2>
        <div className="error-message" role="alert">{loadError}</div>
        <button type="button" className="clear-filters-btn" onClick={loadSounds}>
          <Icon icon={RefreshCw} /> もう一度読み込む
        </button>
      </div>
    );
  }

  return (
    <div className="sound-library">
      <h2><Icon icon={Library} /> 音ライブラリ</h2>
      <p>集めた音素材を見たり、整理したりできます</p>

      <div className="library-controls card">
        <div className="search-section">
          <h3><Icon icon={Search} /> 音を探す</h3>
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
          <h3><Icon icon={Tags} /> タグで絞り込み</h3>
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
              <Icon icon={RotateCcw} /> フィルターをクリア
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
                <p><Icon icon={Inbox} /> まだ音素材がありません</p>
                <p>音あつめページから音を録音してみましょう！</p>
              </div>
            ) : (
              <div>
                <p><Icon icon={Search} /> 検索条件に合う音が見つかりませんでした</p>
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
              onAddTag={handleAddTag}
              onRemoveTag={handleRemoveTag}
            />
          ))
        )}
      </div>
    </div>
  );
};

const LibrarySoundCard = ({ sound, onDelete, onAddTag, onRemoveTag }) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [newTag, setNewTag] = useState('');

  const handleDelete = () => {
    onDelete(sound.id);
    setShowDeleteConfirm(false);
  };

  const handleAddTag = () => {
    if (newTag.trim()) {
      onAddTag(sound.id, newTag.trim());
      setNewTag('');
    }
  };

  const handleRemoveTag = (tag) => {
    onRemoveTag(sound.id, tag);
  };

  const handleKeyDown = (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      handleAddTag();
    }
  };

  return (
    <div className="library-sound-card">
      <div className="sound-header">
        <h4>{sound.name}</h4>
        <div className="sound-actions">
          <button 
            type="button"
            className="tag-edit-btn"
            onClick={() => setShowTagEditor(!showTagEditor)}
            title="タグを編集"
            aria-label={`${sound.name}のタグを編集`}
            aria-expanded={showTagEditor}
          >
            <Icon icon={Tag} />
          </button>
          <button 
            type="button"
            className="delete-btn"
            onClick={() => setShowDeleteConfirm(true)}
            title="削除"
            aria-label={`${sound.name}を削除`}
          >
            <Icon icon={Trash2} />
          </button>
        </div>
      </div>
      
      <div className="sound-meta">
        <p className="sound-date">
          <Icon icon={Calendar} /> {new Date(sound.createdAt).toLocaleDateString('ja-JP')}
        </p>
        {(sound.tags || []).length > 0 && (
          <div className="sound-tags">
            {(sound.tags || []).map(tag => (
              <span key={tag} className="tag small">
                {tag}
                {showTagEditor && (
                  <button 
                    type="button"
                    className="tag-remove-btn touch-target-expand"
                    onClick={() => handleRemoveTag(tag)}
                    title="タグを削除"
                    aria-label={`タグ「${tag}」を削除`}
                  >
                    <Icon icon={X} size={12} />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {showTagEditor && (
        <div className="tag-editor">
          <input
            type="text"
            value={newTag}
            onChange={(e) => setNewTag(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="新しいタグを入力..."
            className="tag-input"
          />
          <button type="button" onClick={handleAddTag} className="add-tag-btn">
            <Icon icon={Plus} /> 追加
          </button>
        </div>
      )}

      <audio 
        controls 
        src={sound.audioData || undefined}
        className="sound-player"
        preload="none"
        playsInline
        onError={(e) => {
          console.error('音声の読み込みエラー:', e, 'sound:', sound.name);
        }}
      >
        <track kind="captions" label="音声説明" srcLang="ja" />
        お使いのブラウザは音声再生に対応していません。
      </audio>
      
      {/* 以前は「DAWページにドラッグ&ドロップできます」と表示していたが、別のページなのでできなかった */}
      <p className="drag-hint">
        <Icon icon={Piano} /> <Link to="/daw">音楽づくり</Link>ページの「音素材」から使えます
      </p>

      {showDeleteConfirm && (
        <div className="delete-confirm-overlay">
          <div className="delete-confirm-dialog">
            <h4><Icon icon={TriangleAlert} /> 削除の確認</h4>
            <p>「{sound.name}」を削除しますか？</p>
            <div className="delete-confirm-actions">
              <button type="button" onClick={handleDelete} className="confirm-delete-btn">
                削除する
              </button>
              <button 
                type="button"
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
