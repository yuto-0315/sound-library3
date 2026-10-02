import React from 'react';
import { LoaderCircle, Minus, Pause, Play, Plus, Redo2, Square, Undo2 } from 'lucide-react';
import Icon from '../Icon';
import MetronomeIcon from '../icons/MetronomeIcon';
import { BEATS_PER_MEASURE_OPTIONS, MAX_BPM, MIN_BPM, SNAP_MODES } from '../../utils/timing';

// 音楽づくりページの上のバー: 再生・位置・元に戻す・テンポ・拍子・合わせ方・メトロノーム
// （ズームはタイムラインの左上にある）
const DawToolbar = ({
  isPlaying,
  isPreparing,
  onPlay,
  onPause,
  onStop,
  positionRef,
  secondsRef,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  bpm,
  onTempoStep,
  beatsPerMeasure,
  onBeatsPerMeasureChange,
  snapMode,
  onSnapModeChange,
  metronome,
  onToggleMetronome
}) => (
  <div className="daw-toolbar">
    <div className="daw-toolbar-group daw-transport" role="group" aria-label="再生">
      <button
        type="button"
        className={`transport-btn play-btn ${isPlaying ? 'playing' : ''}`}
        onClick={isPlaying ? onPause : onPlay}
        aria-label={isPlaying ? '一時停止' : '再生'}
        title={isPlaying ? '一時停止（スペースキー）' : '再生（スペースキー）'}
      >
        {isPlaying && isPreparing
          ? <Icon icon={LoaderCircle} className="icon-spin" size={28} />
          : <Icon icon={isPlaying ? Pause : Play} fill="currentColor" size={28} />}
      </button>
      <button type="button" className="transport-btn stop-btn" onClick={onStop} aria-label="停止" title="停止して先頭に戻る">
        <Icon icon={Square} fill="currentColor" size={22} />
      </button>
      {/* 中の文字は DAWPage が直接書き換える（再生中は毎フレーム変わるので React を通さない）。
          読み上げは上の目盛り（スライダー）の値で伝える */}
      <div className="daw-position" aria-hidden="true">
        <span className="daw-position-beat" ref={positionRef} />
        <span className="daw-position-seconds" ref={secondsRef} />
      </div>
    </div>

    <div className="daw-toolbar-group" role="group" aria-label="元に戻す・やり直す">
      <button
        type="button"
        className="daw-icon-button"
        onClick={onUndo}
        disabled={!canUndo}
        aria-label="元に戻す"
        title="元に戻す（⌘Z / Ctrl+Z）"
      >
        <Icon icon={Undo2} size={22} />
        <span className="daw-button-label">元に戻す</span>
      </button>
      <button
        type="button"
        className="daw-icon-button"
        onClick={onRedo}
        disabled={!canRedo}
        aria-label="やり直す"
        title="やり直す（⇧⌘Z / Ctrl+Y）"
      >
        <Icon icon={Redo2} size={22} />
        <span className="daw-button-label">やり直す</span>
      </button>
    </div>

    <div className="daw-toolbar-group daw-rhythm" role="group" aria-label="テンポと拍子">
      <div className="daw-tempo">
        <span className="daw-control-label" id="daw-tempo-label">テンポ</span>
        <button
          type="button"
          className="daw-step-button"
          onClick={() => onTempoStep(-1)}
          disabled={bpm <= MIN_BPM}
          aria-label="テンポを遅くする"
        >
          <Icon icon={Minus} />
        </button>
        <output className="daw-tempo-value" aria-labelledby="daw-tempo-label" aria-live="polite">
          <span aria-hidden="true">♩=</span>{bpm}
        </output>
        <button
          type="button"
          className="daw-step-button"
          onClick={() => onTempoStep(1)}
          disabled={bpm >= MAX_BPM}
          aria-label="テンポを速くする"
        >
          <Icon icon={Plus} />
        </button>
      </div>

      <label className="daw-select-label">
        <span className="daw-control-label">拍子</span>
        <select
          className="daw-select"
          value={beatsPerMeasure}
          onChange={(event) => onBeatsPerMeasureChange(Number(event.target.value))}
        >
          {BEATS_PER_MEASURE_OPTIONS.map((beats) => (
            <option key={beats} value={beats}>{beats}拍子</option>
          ))}
        </select>
      </label>

      <label className="daw-select-label">
        <span className="daw-control-label">置き方</span>
        <select
          className="daw-select"
          value={snapMode}
          onChange={(event) => onSnapModeChange(event.target.value)}
        >
          {SNAP_MODES.map((mode) => (
            <option key={mode.value} value={mode.value}>{mode.label}</option>
          ))}
        </select>
      </label>

      <button
        type="button"
        className={`daw-icon-button daw-metronome ${metronome ? 'active' : ''}`}
        onClick={onToggleMetronome}
        aria-pressed={metronome}
        title="再生中に拍の音（カチ、カチ）を鳴らす"
      >
        <Icon icon={MetronomeIcon} size={22} />
        <span className="daw-button-label">メトロノーム</span>
      </button>
    </div>

  </div>
);

export default DawToolbar;
