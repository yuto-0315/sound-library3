import React, { useRef, useState } from 'react';
import { GripVertical, Music, Play, Plus, Square, Tags, X } from 'lucide-react';
import Icon from '../Icon';
import { formatDuration } from '../../utils/timing';
import { createFloatingDragLabel, lockScrollForDrag, useTouchDrag } from '../../hooks/useTouchDrag';

export const SOUND_DRAG_PREFIX = 'sound-id:';

const SoundItem = ({
  sound,
  duration,
  placeTargetLabel,
  onDragStart,
  onPreview,
  onStopPreview,
  onTouchDragOver,
  onTouchDrop,
  onTouchCancel,
  onPlace
}) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const floatingLabelRef = useRef(null);

  // マウスオーバー時に音声の長さを事前計算（デコード結果はキャッシュされる）
  const handleMouseEnter = () => {
    if (onDragStart) onDragStart(sound).catch(() => {});
  };

  const handleDragStart = (e) => {
    document.body.classList.add('dragging');

    // ドラッグ中に指やカーソルに付いてくる名前（音声データは渡さない）
    const dragImage = document.createElement('div');
    dragImage.className = 'daw-drag-image';
    dragImage.textContent = sound.name;
    document.body.appendChild(dragImage);
    if (e.dataTransfer.setDragImage) {
      e.dataTransfer.setDragImage(dragImage, dragImage.offsetWidth / 2, dragImage.offsetHeight / 2);
    }
    setTimeout(() => {
      if (dragImage.parentNode) dragImage.parentNode.removeChild(dragImage);
    }, 0);

    // ID方式: 音素材のIDだけを渡す（音声データそのものは渡さない）
    e.dataTransfer.setData('text/plain', `${SOUND_DRAG_PREFIX}${sound.id}`);
    e.dataTransfer.effectAllowed = 'copy';

    if (onDragStart) onDragStart(sound).catch(() => {});
  };

  const finishTouchDrag = () => {
    if (floatingLabelRef.current) {
      floatingLabelRef.current.remove();
      floatingLabelRef.current = null;
    }
    setIsDragging(false);
  };

  // タッチ操作: 左端のつまみを持って動かすか、タイムラインの方向へ動かすとドラッグ開始。
  // それ以外の方向はリストのスクロールになる。
  // （横長の画面ではリストが縦並びでタイムラインは右 → 横で開始。
  //   リストが横並びになる狭い画面ではタイムラインは下 → 縦で開始）
  const itemRef = useTouchDrag({
    shouldStart: (dx, dy, target) => {
      if (target && target.closest && target.closest('.sound-drag-handle')) return true;
      const list = itemRef.current && itemRef.current.closest('.sound-list');
      const isRowLayout = !!list && window.getComputedStyle(list).flexDirection === 'row';
      return isRowLayout ? dy > dx : dx > dy;
    },
    onStart: ({ x, y }) => {
      if (onStopPreview && isPlaying) onStopPreview();
      lockScrollForDrag();
      floatingLabelRef.current = createFloatingDragLabel(sound.name, x, y);
      setIsDragging(true);
      if (onDragStart) onDragStart(sound).catch(() => {});
    },
    onMove: ({ x, y }) => {
      if (floatingLabelRef.current) floatingLabelRef.current.move(x, y);
      onTouchDragOver(x, y, null, 0);
    },
    onEnd: ({ x, y }) => {
      finishTouchDrag();
      onTouchDrop(sound, x, y);
    },
    onCancel: () => {
      finishTouchDrag();
      onTouchCancel();
    }
  });

  const playSound = () => {
    if (isPlaying || isDragging) return;
    setIsPlaying(true);
    onPreview(sound, () => setIsPlaying(false));
  };

  const stopSound = () => {
    onStopPreview();
    setIsPlaying(false);
  };

  const tags = sound.tags || [];
  const durationText = formatDuration(duration);

  return (
    <li
      ref={itemRef}
      className={`sound-item ${isDragging ? 'dragging' : ''}`}
      draggable="true"
      onDragStart={handleDragStart}
      onMouseEnter={handleMouseEnter}
    >
      <span className="sound-drag-handle" aria-hidden="true" title="ここを持ってドラッグ"><Icon icon={GripVertical} /></span>
      <div className="sound-info">
        <h4 className="sound-name">{sound.name}</h4>
        <div className="sound-meta">
          {durationText && <span className="sound-duration">{durationText}</span>}
          {tags.slice(0, 2).map((tag) => (
            <span key={tag} className="sound-tag">{tag}</span>
          ))}
          {tags.length > 2 && <span className="sound-tag">+{tags.length - 2}</span>}
        </div>
      </div>
      <div className="sound-actions">
        <button
          type="button"
          className="play-sound-btn"
          onClick={isPlaying ? stopSound : playSound}
          aria-label={isPlaying ? `${sound.name}を停止` : `${sound.name}を試聴`}
          title={isPlaying ? '止める' : 'きいてみる'}
        >
          <Icon icon={isPlaying ? Square : Play} fill="currentColor" />
        </button>
        <button
          type="button"
          className="place-sound-btn"
          onClick={() => onPlace(sound)}
          aria-label={`${sound.name}を${placeTargetLabel}に置く`}
          title={`${placeTargetLabel}の再生位置に置く`}
        >
          <Icon icon={Plus} />
        </button>
      </div>
    </li>
  );
};

// SoundItemをメモ化して不要な再レンダリングを防ぐ（コールバックはすべて安定した関数）
const MemoizedSoundItem = React.memo(SoundItem);

const SoundPalette = ({
  isOpen,
  onClose,
  hasSounds,
  sounds,
  allTags,
  selectedTag,
  onSelectTag,
  durations,
  placeTargetLabel,
  onDragStart,
  onPreview,
  onStopPreview,
  onTouchDragOver,
  onTouchDrop,
  onTouchCancel,
  onPlace
}) => (
  // 閉じているときは hidden にして、中のボタンに Tab で移動しないようにする
  <aside className="sound-panel" aria-labelledby="sound-panel-title" hidden={!isOpen}>
    <div className="sound-panel-header">
      <h3 id="sound-panel-title"><Icon icon={Music} /> 音素材</h3>
      <button
        type="button"
        className="sound-panel-close"
        onClick={onClose}
        title="音素材パネルを閉じる"
        aria-label="音素材パネルを閉じる"
      >
        <Icon icon={X} />
      </button>
    </div>

    {allTags.length > 0 && (
      <div className="sound-panel-filters" role="group" aria-labelledby="sound-panel-tags-label">
        <span className="tag-filter-label" id="sound-panel-tags-label"><Icon icon={Tags} /> タグ</span>
        <div className="tag-filters-compact">
          <button
            type="button"
            className="chip chip-small"
            aria-pressed={selectedTag === ''}
            onClick={() => onSelectTag('')}
          >
            すべて
          </button>
          {allTags.map((tag) => (
            <button
              type="button"
              key={tag}
              className="chip chip-small"
              aria-pressed={selectedTag === tag}
              onClick={() => onSelectTag(selectedTag === tag ? '' : tag)}
            >
              {tag}
            </button>
          ))}
        </div>
      </div>
    )}

    {hasSounds ? (
      sounds.length > 0 ? (
        <ul className="sound-list" aria-label="音素材の一覧">
          {sounds.map((sound) => (
            <MemoizedSoundItem
              key={sound.id}
              sound={sound}
              duration={durations.get(sound.id)}
              placeTargetLabel={placeTargetLabel}
              onDragStart={onDragStart}
              onPreview={onPreview}
              onStopPreview={onStopPreview}
              onTouchDragOver={onTouchDragOver}
              onTouchDrop={onTouchDrop}
              onTouchCancel={onTouchCancel}
              onPlace={onPlace}
            />
          ))}
        </ul>
      ) : (
        <div className="no-sounds">
          <p>選択したタグの音素材がありません</p>
          <button type="button" className="button-secondary reset-filter-btn" onClick={() => onSelectTag('')}>
            フィルターをリセット
          </button>
        </div>
      )
    ) : (
      <div className="no-sounds">
        <p>音素材がありません</p>
        <p>
          {/* Router の外（テストなど）でも動くよう、ふつうのリンクにする（HashRouter なので # 付き） */}
          <a href="#/collection">「音あつめ」ページ</a>で音を録音してください
        </p>
      </div>
    )}
  </aside>
);

export default SoundPalette;
