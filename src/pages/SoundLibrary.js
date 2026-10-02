import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Link } from 'react-router-dom';
import {
  Calendar,
  Check,
  Clock,
  Inbox,
  Library,
  Pencil,
  Piano,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Square,
  Tag,
  Tags,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react';
import './SoundLibrary.css';
import Icon from '../components/Icon';
import Modal from '../components/Modal';
import { useAudioPreview } from '../hooks/useAudioPreview';
import { getAllRecordings, deleteRecording, addTagToRecording, removeTagFromRecording, updateRecording } from '../utils/indexedDB';
import { dataUrlToBlob, measureAudioDuration } from '../utils/audio';
import { formatDuration } from '../utils/timing';
import { matchesSearch } from '../utils/text';
import { isEnterKey } from '../utils/keyboard';

// 「タグごと」は仕様の「タグごとにソートする機能」。タグの見出しごとに音をまとめて並べる
const SORT_OPTIONS = [
  { value: 'newest', label: '新しい順' },
  { value: 'oldest', label: '古い順' },
  { value: 'name', label: '名前順' },
  { value: 'tag', label: 'タグごと' }
];
const SORT_STORAGE_KEY = 'sound-library-sort-order';
const UNTAGGED_TITLE = 'タグなし';

const compareBy = {
  newest: (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')),
  oldest: (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')),
  name: (a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'ja')
};

// 選んだならべかたは次に開いたときも使う（プライベートブラウズなどで保存できなくても並べ替えはできる）
const readSortOrder = () => {
  try {
    const saved = localStorage.getItem(SORT_STORAGE_KEY);
    return SORT_OPTIONS.some((option) => option.value === saved) ? saved : 'newest';
  } catch (error) {
    return 'newest';
  }
};

const saveSortOrder = (value) => {
  try {
    localStorage.setItem(SORT_STORAGE_KEY, value);
  } catch (error) {
    // 保存できなくても、この画面では選んだ順に並ぶ
  }
};

const SoundLibrary = () => {
  const [sounds, setSounds] = useState([]);
  const [selectedTag, setSelectedTag] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [sortOrder, setSortOrder] = useState(readSortOrder);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const soundsRef = useRef(sounds);
  soundsRef.current = sounds;
  const isMountedRef = useRef(true);
  const preview = useAudioPreview({
    onError: () => setActionError('この音はこの端末では再生できませんでした。')
  });

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadSounds = useCallback(async () => {
    try {
      setIsLoading(true);
      setLoadError('');
      // IndexedDBから音素材を読み込み (localStorageからの自動移行も含む)。
      // 再生には Data URL をそのまま使うので、ここで Blob に変換する必要はない。
      const records = await getAllRecordings();
      if (isMountedRef.current) setSounds(records);
    } catch (error) {
      console.error('音素材の読み込みに失敗:', error);
      // 「音素材がありません」と表示すると、データが消えたと誤解させてしまうので区別する
      if (isMountedRef.current) setLoadError('音素材を読み込めませんでした。ページを再読み込みしてください。');
    } finally {
      if (isMountedRef.current) setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSounds();
  }, [loadSounds]);

  // 変更した 1 件だけを差し替える（全件を再読み込みすると音が多いときに iPad が重くなる）
  const replaceSound = useCallback((updated) => {
    setSounds(prev => prev.map(sound => (sound.id === updated.id ? updated : sound)));
  }, []);

  // 長さが保存されていない（以前に録音した）音の長さを、1 つずつ調べて保存する
  const measuringRef = useRef({ running: false, done: new Set() });
  useEffect(() => {
    const state = measuringRef.current;
    if (state.running) return;
    const nextMissing = () => soundsRef.current.find((sound) => (
      !(sound.duration > 0) && sound.audioData && !state.done.has(sound.id)
    ));
    if (!nextMissing()) return;
    state.running = true;
    (async () => {
      let sound = nextMissing();
      while (sound && isMountedRef.current) {
        state.done.add(sound.id);
        let duration = null;
        try {
          // eslint-disable-next-line no-await-in-loop
          duration = await measureAudioDuration(dataUrlToBlob(sound.audioData));
        } catch (error) {
          duration = null;
        }
        if (duration && isMountedRef.current) {
          try {
            // eslint-disable-next-line no-await-in-loop
            const updated = await updateRecording(sound.id, { duration });
            if (isMountedRef.current) replaceSound(updated);
          } catch (error) {
            // 削除された・保存できないときは表示しないだけ
          }
        }
        sound = nextMissing();
      }
      state.running = false;
    })();
  }, [sounds, replaceSound]);

  // 全てのタグ
  const allTags = useMemo(
    () => [...new Set(sounds.flatMap(sound => sound.tags || []))],
    [sounds]
  );

  // フィルタリングと並べ替え
  const filteredSounds = useMemo(() => {
    let filtered = sounds;
    if (selectedTag) {
      filtered = filtered.filter(sound => (sound.tags || []).includes(selectedTag));
    }
    if (searchQuery.trim()) {
      // ひらがな・カタカナ、全角・半角を区別せずに探す
      filtered = filtered.filter(sound => matchesSearch(searchQuery, sound.name, sound.tags || []));
    }
    // 「タグごと」のときは、それぞれのタグの中で新しい順に並べる
    return [...filtered].sort(compareBy[sortOrder] || compareBy.newest);
  }, [sounds, selectedTag, searchQuery, sortOrder]);

  // 「タグごと」: タグの見出しごとにまとめる。タグが 2 つある音は両方に出し、タグの無い音は最後にまとめる
  const soundGroups = useMemo(() => {
    if (sortOrder !== 'tag') return null;
    const tagNames = selectedTag ? [selectedTag] : [...allTags].sort((a, b) => a.localeCompare(b, 'ja'));
    const groups = tagNames
      .map((tag) => ({
        key: `tag:${tag}`,
        title: tag,
        sounds: filteredSounds.filter((sound) => (sound.tags || []).includes(tag))
      }))
      .filter((group) => group.sounds.length > 0);
    const untagged = filteredSounds.filter((sound) => !(sound.tags || []).length);
    if (untagged.length > 0) groups.push({ key: 'untagged', title: UNTAGGED_TITLE, sounds: untagged });
    return groups;
  }, [sortOrder, selectedTag, allTags, filteredSounds]);

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

  const changeSortOrder = (value) => {
    setSortOrder(value);
    saveSortOrder(value);
  };

  const deleteSound = async (sound) => {
    setDeleteTarget(null);
    setActionError('');
    try {
      if (preview.playingId === sound.id) preview.stop();
      await deleteRecording(sound.id);
      setSounds(prev => prev.filter(item => item.id !== sound.id));
    } catch (error) {
      console.error('削除エラー:', error);
      setActionError('音素材の削除に失敗しました。');
    }
  };

  const handleAddTag = async (soundId, tag) => {
    setActionError('');
    try {
      replaceSound(await addTagToRecording(soundId, tag));
    } catch (error) {
      console.error('タグ追加エラー:', error);
      setActionError('タグの追加に失敗しました。');
    }
  };

  const handleRemoveTag = async (soundId, tag) => {
    setActionError('');
    try {
      replaceSound(await removeTagFromRecording(soundId, tag));
    } catch (error) {
      console.error('タグ削除エラー:', error);
      setActionError('タグの削除に失敗しました。');
    }
  };

  // 名前を変える（音楽づくりのタイムラインに置いた音は、置いたときの名前のまま残る）
  const handleRename = async (soundId, name) => {
    setActionError('');
    try {
      replaceSound(await updateRecording(soundId, { name }));
      return true;
    } catch (error) {
      console.error('名前の変更エラー:', error);
      setActionError('名前を変えられませんでした。');
      return false;
    }
  };

  if (isLoading) {
    return (
      <div className="sound-library page-container">
        <header className="page-header">
          <h2><Icon icon={Library} /> 音ライブラリ</h2>
        </header>
        <div className="loading" role="status">読み込み中...</div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sound-library page-container">
        <header className="page-header">
          <h2><Icon icon={Library} /> 音ライブラリ</h2>
        </header>
        <div className="error-message" role="alert">{loadError}</div>
        <button type="button" className="button-secondary" onClick={loadSounds}>
          <Icon icon={RefreshCw} /> もう一度読み込む
        </button>
      </div>
    );
  }

  const isFiltered = !!(selectedTag || searchQuery.trim());

  // idPrefix: 「タグごと」では同じ音が 2 か所に出るので、入力欄の id が重ならないようにする
  const renderCard = (sound, idPrefix = '') => (
    <LibrarySoundCard
      key={sound.id}
      idPrefix={idPrefix}
      sound={sound}
      allTags={allTags}
      isPlaying={preview.playingId === sound.id}
      onTogglePlay={() => preview.toggle(sound.id, sound.audioData)}
      onDelete={() => setDeleteTarget(sound)}
      onAddTag={handleAddTag}
      onRemoveTag={handleRemoveTag}
      onRename={handleRename}
    />
  );

  return (
    <div className="sound-library page-container">
      <header className="page-header library-header">
        <div>
          <h2><Icon icon={Library} /> 音ライブラリ</h2>
          <p>
            集めた音を聞いたり、名前やタグを直したりできます。
            {/* 以前は各カードに「DAWページにドラッグ&ドロップできます」とあったが、別のページなのでできなかった */}
            <span className="library-daw-hint">
              <Icon icon={Piano} /> 曲を作るときは <Link to="/daw">音楽づくり</Link> ページの「音素材」から使います。
            </span>
          </p>
        </div>
        <p className="library-count" aria-live="polite">
          {isFiltered ? `${filteredSounds.length} こ見つかりました（全部で ${sounds.length} こ）` : `全部で ${sounds.length} こ`}
        </p>
      </header>

      <section className="library-controls card" aria-label="音を探す・ならべかえる">
        <div className="library-controls-row">
          <div className="library-search">
            <label htmlFor="library-search" className="field-label"><Icon icon={Search} /> 音を探す</label>
            <input
              id="library-search"
              type="search"
              placeholder="音の名前やタグで検索..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="text-field search-input"
              enterKeyHint="search"
            />
          </div>
          <div className="library-sort">
            <label htmlFor="library-sort" className="field-label">ならべかた</label>
            <select
              id="library-sort"
              className="text-field library-sort-select"
              value={sortOrder}
              onChange={(e) => changeSortOrder(e.target.value)}
            >
              {SORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        </div>

        {allTags.length > 0 && (
          <div className="filter-section" role="group" aria-labelledby="library-tags-label">
            <span id="library-tags-label" className="field-label"><Icon icon={Tags} /> タグで絞り込み</span>
            <div className="chip-list tag-filters">
              <button type="button" className="chip" aria-pressed={selectedTag === ''} onClick={() => setSelectedTag('')}>
                すべて
              </button>
              {allTags.map(tag => (
                <button
                  type="button"
                  key={tag}
                  className="chip"
                  aria-pressed={selectedTag === tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}

        {isFiltered && (
          <button type="button" onClick={clearFilters} className="button-ghost clear-filters-btn">
            <Icon icon={RotateCcw} /> フィルターをクリア
          </button>
        )}
      </section>

      {actionError && (
        <div className="error-message library-error" role="alert">
          <span>{actionError}</span>
          <button type="button" onClick={() => setActionError('')} aria-label="メッセージを閉じる"><Icon icon={X} /></button>
        </div>
      )}

      {filteredSounds.length === 0 ? (
        <div className="no-sounds empty-state">
          {sounds.length === 0 ? (
            <>
              <p><Icon icon={Inbox} /> まだ音素材がありません</p>
              <p>音あつめページから音を録音してみましょう！</p>
              <Link to="/collection" className="button-primary">音あつめへ</Link>
            </>
          ) : (
            <>
              <p><Icon icon={Search} /> 検索条件に合う音が見つかりませんでした</p>
              <p>別のキーワードやタグで試してみてください</p>
            </>
          )}
        </div>
      ) : soundGroups ? (
        <div className="sound-groups">
          {soundGroups.map((group) => {
            // タグの文字をそのまま id に使うと空白で壊れるので、エンコードしておく
            const groupId = `library-group-${encodeURIComponent(group.key)}`;
            return (
              <section key={group.key} className="sound-group" aria-labelledby={groupId}>
                <h3 id={groupId} className="sound-group-title">
                  <Icon icon={Tag} /> {group.title}{' '}
                  <span className="sound-group-count">{group.sounds.length} こ</span>
                </h3>
                <ul className="sounds-grid">
                  {group.sounds.map((sound) => renderCard(sound, `${groupId}-`))}
                </ul>
              </section>
            );
          })}
        </div>
      ) : (
        <>
          <h3 className="sr-only">音の一覧</h3>
          <ul className="sounds-grid">
            {filteredSounds.map((sound) => renderCard(sound))}
          </ul>
        </>
      )}

      {deleteTarget && (
        <Modal titleId="library-delete-title" onClose={() => setDeleteTarget(null)}>
          <div className="modal-header">
            <h3 id="library-delete-title"><Icon icon={TriangleAlert} /> 削除の確認</h3>
          </div>
          <div className="modal-body">
            <p>「{deleteTarget.name}」を削除しますか？</p>
            <p className="field-help">音楽づくりのタイムラインに置いた音は消えません。</p>
          </div>
          <div className="modal-footer">
            {/* うっかり消さないよう、先にフォーカスが当たるのは「キャンセル」 */}
            <button type="button" className="button-secondary" onClick={() => setDeleteTarget(null)}>
              キャンセル
            </button>
            <button type="button" className="button-danger" onClick={() => deleteSound(deleteTarget)}>
              <Icon icon={Trash2} /> 削除する
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

const LibrarySoundCard = ({ idPrefix = '', sound, allTags, isPlaying, onTogglePlay, onDelete, onAddTag, onRemoveTag, onRename }) => {
  const [showTagEditor, setShowTagEditor] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [newTag, setNewTag] = useState('');
  const [nameDraft, setNameDraft] = useState(sound.name);
  const renameInputRef = useRef(null);
  const renameButtonRef = useRef(null);

  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleAddTag = (value = newTag) => {
    const tag = value.trim();
    if (tag) {
      onAddTag(sound.id, tag);
      if (value === newTag) setNewTag('');
    }
  };

  const handleKeyDown = (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      handleAddTag();
    }
  };

  const startRename = () => {
    setNameDraft(sound.name);
    setIsRenaming(true);
  };

  const finishRename = () => {
    setIsRenaming(false);
    // 名前の欄が消えるので、フォーカスを「名前」ボタンに戻す
    setTimeout(() => {
      if (renameButtonRef.current) renameButtonRef.current.focus();
    }, 0);
  };

  const submitRename = async (event) => {
    event.preventDefault();
    const name = nameDraft.trim();
    if (!name || name === sound.name) {
      finishRename();
      return;
    }
    if (await onRename(sound.id, name)) finishRename();
  };

  const date = new Date(sound.createdAt);
  const dateText = isNaN(date.getTime()) ? '' : date.toLocaleDateString('ja-JP');
  const durationText = formatDuration(sound.duration);
  const tags = sound.tags || [];
  const suggestions = allTags.filter((tag) => !tags.includes(tag)).slice(0, 8);

  return (
    <li className="library-sound-card">
      <div className="library-card-main">
        <button
          type="button"
          className={`library-play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={onTogglePlay}
          aria-label={isPlaying ? `${sound.name}を止める` : `${sound.name}をきく`}
        >
          <Icon icon={isPlaying ? Square : Play} fill="currentColor" size={24} />
        </button>

        <div className="library-card-body">
          {isRenaming ? (
            <form className="rename-form" onSubmit={submitRename}>
              <label htmlFor={`${idPrefix}rename-${sound.id}`} className="sr-only">「{sound.name}」の新しい名前</label>
              <input
                ref={renameInputRef}
                id={`${idPrefix}rename-${sound.id}`}
                className="text-field rename-input"
                type="text"
                maxLength={50}
                value={nameDraft}
                enterKeyHint="done"
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') finishRename();
                }}
              />
              <div className="rename-actions">
                <button type="submit" className="button-primary" disabled={!nameDraft.trim()}>
                  <Icon icon={Check} /> 決定
                </button>
                <button type="button" className="button-secondary" onClick={finishRename}>
                  やめる
                </button>
              </div>
            </form>
          ) : (
            <h4>{sound.name}</h4>
          )}

          <p className="sound-meta">
            {dateText && <span><Icon icon={Calendar} /> {dateText}</span>}
            {durationText && <span><Icon icon={Clock} /> {durationText}</span>}
          </p>

          {tags.length > 0 && (
            <ul className="sound-tags" aria-label="タグ">
              {tags.map(tag => (
                <li key={tag} className="tag-label">
                  {tag}
                  {showTagEditor && (
                    <button
                      type="button"
                      className="tag-remove-btn"
                      onClick={() => onRemoveTag(sound.id, tag)}
                      title="タグを削除"
                      aria-label={`タグ「${tag}」を削除`}
                    >
                      <Icon icon={X} size={14} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {showTagEditor && (
        <div className="tag-editor">
          <div className="tag-editor-row">
            <label htmlFor={`${idPrefix}new-tag-${sound.id}`} className="sr-only">「{sound.name}」に付けるタグ</label>
            <input
              id={`${idPrefix}new-tag-${sound.id}`}
              type="text"
              value={newTag}
              maxLength={30}
              onChange={(e) => setNewTag(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="新しいタグを入力..."
              className="text-field tag-input"
              enterKeyHint="enter"
            />
            <button type="button" onClick={() => handleAddTag()} className="button-secondary add-tag-btn" disabled={!newTag.trim()}>
              <Icon icon={Plus} /> 追加
            </button>
          </div>
          {suggestions.length > 0 && (
            <div className="tag-editor-suggestions" role="group" aria-label="ほかの音に付いているタグ">
              {suggestions.map((tag) => (
                <button key={tag} type="button" className="chip chip-suggestion" onClick={() => handleAddTag(tag)}>
                  <Icon icon={Plus} /> {tag}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="sound-actions">
        <button
          ref={renameButtonRef}
          type="button"
          className="card-action-btn"
          onClick={startRename}
          disabled={isRenaming}
          title="名前を変える"
          aria-label={`${sound.name}の名前を変える`}
        >
          <Icon icon={Pencil} /> <span aria-hidden="true">名前</span>
        </button>
        <button
          type="button"
          className={`card-action-btn ${showTagEditor ? 'active' : ''}`}
          onClick={() => setShowTagEditor(!showTagEditor)}
          title="タグを編集"
          aria-label={`${sound.name}のタグを編集`}
          aria-expanded={showTagEditor}
        >
          <Icon icon={Tag} /> <span aria-hidden="true">タグ</span>
        </button>
        <button
          type="button"
          className="card-action-btn danger"
          onClick={onDelete}
          title="削除"
          aria-label={`${sound.name}を削除`}
        >
          <Icon icon={Trash2} /> <span aria-hidden="true">削除</span>
        </button>
      </div>
    </li>
  );
};

export default SoundLibrary;
