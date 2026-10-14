import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Minus, MousePointerClick, Plus, Trash2, Volume2, VolumeX } from 'lucide-react';
import Icon from '../Icon';
import { formatDuration, formatPosition, getMeasureLabelInterval } from '../../utils/timing';
import { buildWaveformPath, getEnvelope, getWaveformPointCount, resampleEnvelope } from '../../utils/waveform';
import { lockScrollForDrag, useTouchDrag } from '../../hooks/useTouchDrag';

export const CLIP_DRAG_PREFIX = 'existing-clip-';
export const DEFAULT_CLIP_WIDTH = 400;
// 短い音でも指でつかめるよう、表示の幅だけは最低これだけ取る（位置の計算は本当の長さで行う）
const MIN_CLIP_VISUAL_WIDTH = 20;

// トラックごとの色（白い文字とのコントラスト比 4.5:1 以上）
export const TRACK_COLORS = ['#2563eb', '#c2410c', '#15803d', '#7c3aed', '#be185d', '#0f766e', '#b45309', '#0e7490'];

export const trackColor = (index) => TRACK_COLORS[index % TRACK_COLORS.length];

const sameId = (a, b) => String(a) === String(b);

const isPlayable = (soundData) => !!(soundData && soundData.audioBlob instanceof Blob && soundData.audioBlob.size > 0);

// 実際の音の大きさの波形（デコードが終わるまでは表示しない）
const useWaveform = (soundData, widthPx, loadBuffer) => {
  const [peaks, setPeaks] = useState(null);
  const blob = soundData && soundData.audioBlob;
  const pointCount = getWaveformPointCount(widthPx);

  useEffect(() => {
    if (!blob || !loadBuffer || !isPlayable(soundData)) return undefined;
    let cancelled = false;
    loadBuffer(soundData)
      .then((buffer) => {
        if (!cancelled) setPeaks(resampleEnvelope(getEnvelope(buffer), pointCount));
      })
      .catch(() => {
        // デコードできない音は波形を出さない（再生時にエラーを知らせる）
      });
    return () => {
      cancelled = true;
    };
    // soundData は同じ Blob なら同じ音
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [blob, pointCount, loadBuffer]);

  return peaks;
};

const AudioClip = ({
  clip,
  trackId,
  color,
  selected,
  timing,
  loadBuffer,
  onSelect,
  onKeyDown,
  onDragStart,
  onDragEnd,
  onTouchDragOver,
  onTouchMoveClip,
  onTouchCancel
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const touchOffsetRef = useRef(0);
  const width = isFinite(clip.duration) && clip.duration > 0 ? clip.duration : DEFAULT_CLIP_WIDTH;
  const peaks = useWaveform(clip.soundData, width, loadBuffer);
  const waveformPath = useMemo(() => (peaks ? buildWaveformPath(peaks) : ''), [peaks]);

  // タッチ操作: クリップはどの方向に動かしてもドラッグになる（CSS で touch-action: none）
  const clipRef = useTouchDrag({
    onStart: ({ startX }) => {
      const element = clipRef.current;
      touchOffsetRef.current = element ? startX - element.getBoundingClientRect().left : 0;
      lockScrollForDrag();
      setIsDragging(true);
    },
    onMove: ({ x, y }) => {
      onTouchDragOver(x, y, clip.duration, touchOffsetRef.current);
    },
    onEnd: ({ x, y }) => {
      setIsDragging(false);
      onTouchMoveClip(clip, x, y, touchOffsetRef.current);
    },
    onCancel: () => {
      setIsDragging(false);
      onTouchCancel();
    }
  });

  const handleDragStart = (e) => {
    e.stopPropagation(); // イベントバブリングを防ぐ
    document.body.classList.add('dragging');
    e.dataTransfer.setData('text/plain', `${CLIP_DRAG_PREFIX}${clip.id}`);
    e.dataTransfer.effectAllowed = 'move';
    onDragStart(clip, trackId, e.clientX, e.currentTarget);
  };

  const name = clip.soundData.name || '不明な音素材';
  const hasAudio = isPlayable(clip.soundData);
  const seconds = width / timing.pixelsPerSecond;
  const label = `${name}、${formatPosition(clip.startTime, timing)}から${formatDuration(seconds)}${hasAudio ? '' : '（音声データがありません）'}`;

  return (
    <div
      ref={clipRef}
      className={`audio-clip ${selected ? 'selected' : ''} ${isDragging ? 'dragging' : ''} ${hasAudio ? '' : 'audio-clip-missing'}`}
      data-clip-id={clip.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={label}
      title={hasAudio ? name : `${name}（音声データがありません）`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      onClick={(event) => {
        event.stopPropagation();
        onSelect(clip.id, trackId);
      }}
      onKeyDown={(event) => onKeyDown(event, clip, trackId)}
      style={{
        left: clip.startTime,
        width,
        minWidth: MIN_CLIP_VISUAL_WIDTH,
        '--clip-color': color
      }}
    >
      <span className="clip-name">{name}</span>
      {waveformPath && (
        <svg className="clip-waveform" viewBox={`0 0 ${peaks.length} 100`} preserveAspectRatio="none" aria-hidden="true" focusable="false">
          <path d={waveformPath} />
        </svg>
      )}
    </div>
  );
};

const MemoizedAudioClip = React.memo(AudioClip);

const TrackRow = ({
  track,
  index,
  color,
  laneWidth,
  isSelected,
  selectedClipId,
  preview,
  canRemove,
  timing,
  loadBuffer,
  onSelectTrack,
  onToggleMute,
  onRemoveTrack,
  onSelectClip,
  onClipKeyDown,
  onDrop,
  onDragOver,
  onClipDragStart,
  onDragEnd,
  onTouchDragOver,
  onTouchMoveClip,
  onTouchCancel
}) => {
  const displayName = `トラック ${index + 1}`;

  const handleDrop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onDrop(e, track.id, e.clientX - rect.left);
  };

  return (
    <div className={`track-row ${isSelected ? 'selected' : ''} ${track.muted ? 'muted' : ''}`} style={{ '--track-color': color }}>
      <div className="track-header">
        <button
          type="button"
          className="track-select-btn"
          onClick={() => onSelectTrack(track.id)}
          aria-pressed={isSelected}
          title="＋ボタンで音を置くトラックにする"
        >
          <span className="track-color-dot" aria-hidden="true" />
          <span className="track-name">{displayName}</span>
        </button>
        <div className="track-actions">
          <button
            type="button"
            className={`track-mute-btn ${track.muted ? 'active' : ''}`}
            onClick={() => onToggleMute(track.id)}
            aria-pressed={!!track.muted}
            aria-label={`${displayName}をミュート`}
            title={track.muted ? 'ミュートを解除する（音を鳴らす）' : 'ミュートする（このトラックの音を鳴らさない）'}
          >
            <Icon icon={track.muted ? VolumeX : Volume2} />
          </button>
          <button
            type="button"
            className="remove-track-btn"
            onClick={() => onRemoveTrack(track.id)}
            disabled={!canRemove}
            title={canRemove ? `${displayName}を削除` : 'トラックは最低1つ必要です'}
            aria-label={`${displayName}を削除`}
          >
            <Icon icon={Trash2} />
          </button>
        </div>
      </div>

      {/* 何もない所を押すと、このトラックを選ぶ（キーボードでは左のトラック名のボタンで選ぶ） */}
      <div
        className="track"
        role="presentation"
        data-track-id={track.id}
        style={{ width: laneWidth }}
        onDrop={handleDrop}
        onDragOver={onDragOver}
        onClick={(event) => {
          if (event.target === event.currentTarget) onSelectTrack(track.id, { deselectClip: true });
        }}
      >
        {preview && (
          <div className="drag-preview" style={{ left: preview.left, width: preview.width }} />
        )}
        {track.clips.map((clip) => (
          clip && clip.soundData ? (
            <MemoizedAudioClip
              key={clip.id}
              clip={clip}
              trackId={track.id}
              color={color}
              selected={sameId(clip.id, selectedClipId)}
              timing={timing}
              loadBuffer={loadBuffer}
              onSelect={onSelectClip}
              onKeyDown={onClipKeyDown}
              onDragStart={onClipDragStart}
              onDragEnd={onDragEnd}
              onTouchDragOver={onTouchDragOver}
              onTouchMoveClip={onTouchMoveClip}
              onTouchCancel={onTouchCancel}
            />
          ) : null
        ))}
      </div>
    </div>
  );
};

const MemoizedTrackRow = React.memo(TrackRow);

// 上の目盛り（小節番号）。押した所・キーボードの矢印で再生位置を動かせる
const Ruler = React.memo(({ measureCount, measurePx, laneWidth, onSeek, onKeyDown, valueNow, valueMax, valueText, markerRef }) => {
  const interval = getMeasureLabelInterval(measurePx);
  const labels = [];
  for (let measure = 0; measure < measureCount; measure += interval) {
    labels.push(
      <span key={measure} className="ruler-measure" style={{ left: measure * measurePx }}>
        {measure + 1}
      </span>
    );
  }
  return (
    <div
      className="timeline"
      style={{ width: laneWidth }}
      role="slider"
      tabIndex={0}
      aria-label="再生位置（押した所から再生します）"
      aria-valuemin={0}
      aria-valuemax={valueMax}
      aria-valuenow={valueNow}
      aria-valuetext={valueText}
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        onSeek(event.clientX - rect.left);
      }}
      onKeyDown={onKeyDown}
    >
      {labels}
      <span className="ruler-playhead" ref={markerRef} aria-hidden="true" />
    </div>
  );
});

Ruler.displayName = 'Ruler';

// 再生中は親の再描画に関係なく、DAWPage が直接 style.left を動かす
export const Playhead = React.memo(React.forwardRef(({ position, isPlaying }, ref) => {
  const innerRef = useRef(null);
  const setRefs = (element) => {
    innerRef.current = element;
    if (typeof ref === 'function') ref(element);
    else if (ref) ref.current = element;
  };

  // 停止・一時停止・ズームのときは state の位置を反映する
  useLayoutEffect(() => {
    if (!isPlaying && innerRef.current) {
      const safePosition = isFinite(position) && position >= 0 ? position : 0;
      innerRef.current.style.left = `${safePosition}px`;
    }
  }, [position, isPlaying]);

  return <div className="playhead" ref={setRefs} aria-hidden="true" />;
}));

Playhead.displayName = 'Playhead';

const TimelineView = ({
  tracks,
  laneWidth,
  measureCount,
  timing,
  beatPx,
  measurePx,
  selectedClipId,
  selectedTrackId,
  dragPreview,
  currentTime,
  isPlaying,
  hasClips,
  playheadRef,
  rulerMarkerRef,
  timelineContainerRef,
  timelineRef,
  rulerProps,
  zoom,
  loadBuffer,
  onAddTrack,
  onSelectTrack,
  onToggleMute,
  onRemoveTrack,
  onSelectClip,
  onClipKeyDown,
  onDrop,
  onDragOver,
  onDragLeave,
  onClipDragStart,
  onDragEnd,
  onTouchDragOver,
  onTouchMoveClip,
  onTouchCancel
}) => (
  <div
    className="timeline-container"
    ref={timelineContainerRef}
    style={{
      '--beat-px': `${beatPx}px`,
      '--measure-px': `${measurePx}px`
    }}
  >
    <div className="timeline-content">
      <div className="timeline-ruler-row">
        {/* 左上: タイムラインの拡大・縮小 */}
        <div className="ruler-corner" role="group" aria-label="タイムラインの拡大・縮小">
          <button
            type="button"
            className="zoom-btn"
            onClick={() => zoom.onZoom(false)}
            disabled={!zoom.canZoomOut}
            title="ズームアウト（縮小）"
            aria-label="ズームアウト（縮小）"
          >
            <Icon icon={Minus} />
          </button>
          <span className="zoom-display">{zoom.percent}%</span>
          <button
            type="button"
            className="zoom-btn"
            onClick={() => zoom.onZoom(true)}
            disabled={!zoom.canZoomIn}
            title="ズームイン（拡大）"
            aria-label="ズームイン（拡大）"
          >
            <Icon icon={Plus} />
          </button>
        </div>
        <Ruler
          measureCount={measureCount}
          measurePx={measurePx}
          laneWidth={laneWidth}
          markerRef={rulerMarkerRef}
          {...rulerProps}
        />
      </div>

      <div className="tracks-area" ref={timelineRef} onDragLeave={onDragLeave}>
        {tracks.map((track, index) => (
          <MemoizedTrackRow
            key={track.id}
            track={track}
            index={index}
            color={trackColor(index)}
            laneWidth={laneWidth}
            isSelected={sameId(track.id, selectedTrackId)}
            selectedClipId={track.clips.some((clip) => clip && sameId(clip.id, selectedClipId)) ? selectedClipId : null}
            preview={dragPreview && sameId(dragPreview.trackId, track.id) ? dragPreview : null}
            canRemove={tracks.length > 1}
            timing={timing}
            loadBuffer={loadBuffer}
            onSelectTrack={onSelectTrack}
            onToggleMute={onToggleMute}
            onRemoveTrack={onRemoveTrack}
            onSelectClip={onSelectClip}
            onClipKeyDown={onClipKeyDown}
            onDrop={onDrop}
            onDragOver={onDragOver}
            onClipDragStart={onClipDragStart}
            onDragEnd={onDragEnd}
            onTouchDragOver={onTouchDragOver}
            onTouchMoveClip={onTouchMoveClip}
            onTouchCancel={onTouchCancel}
          />
        ))}

        <div className="track-add-row">
          <div className="track-add-cell">
            <button type="button" className="button-secondary track-add-btn" onClick={onAddTrack}>
              <Icon icon={Plus} /> トラック追加
            </button>
          </div>
        </div>

        <div className="playhead-layer" style={{ width: laneWidth }}>
          <Playhead ref={playheadRef} position={currentTime} isPlaying={isPlaying} />
        </div>

        {!hasClips && (
          <p className="timeline-empty-hint">
            <Icon icon={MousePointerClick} /> 左の音素材をトラックへドラッグするか、音素材の「＋」を押すと、ここに音が並びます
          </p>
        )}
      </div>
    </div>
  </div>
);

export default TimelineView;
