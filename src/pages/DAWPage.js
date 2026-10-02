import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import {
  CircleCheck,
  CircleHelp,
  Copy,
  FolderOpen,
  Headphones,
  History,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  RotateCcw,
  Save,
  Send,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react';
import './DAWPage.css';
import Icon from '../components/Icon';
import DawToolbar from '../components/daw/DawToolbar';
import FileMenu from '../components/daw/FileMenu';
import SoundPalette, { SOUND_DRAG_PREFIX } from '../components/daw/SoundPalette';
import TimelineView, { CLIP_DRAG_PREFIX } from '../components/daw/TimelineView';
import CloudSaveDialog from '../components/daw/CloudSaveDialog';
import HelpDialog from '../components/daw/HelpDialog';
import {
  addRecordings,
  backupAndClearProjectAutoSave,
  deleteSongData,
  getAllRecordings,
  getProjectAutoSave,
  getProjectAutoSaveBackup,
  getSongData,
  isQuotaExceededError,
  promoteImportedSongToAutoSave,
  saveProjectAutoSave,
  swapProjectAutoSaveWithBackup
} from '../utils/indexedDB';
import {
  blobToArrayBuffer,
  closeAudioContext,
  createAudioContext,
  dataUrlToBlob,
  decodeAudioData,
  disableSilentModePlayback,
  downloadBlob,
  enableSilentModePlayback,
  encodeWav,
  isDownloadSupported,
  unlockAudioContext
} from '../utils/audio';
import {
  DEFAULT_CLIP_WIDTH,
  DEFAULT_PIXELS_PER_SECOND,
  ZOOM_LEVELS,
  deserializeProject,
  findFreePosition,
  getNextZoomLevel,
  rescaleTracks,
  serializeProject
} from '../utils/project';
import {
  BPM_STEP,
  DEFAULT_BEATS_PER_MEASURE,
  DEFAULT_BPM,
  DEFAULT_SNAP_MODE,
  beatWidthPx,
  ceilToStep,
  clampBpm,
  convertUnits,
  describePosition,
  formatPosition,
  formatSeconds,
  getTimelineMeasureCount,
  measureWidthPx,
  normalizeBeatsPerMeasure,
  normalizeSnapMode,
  rescaleTracksForTempo,
  roundToStep,
  snapStepPx
} from '../utils/timing';
import { API_BASE_URL, fetchJson, findRoomByNumber, getSavedStudentProfile, saveStudentProfile } from '../utils/api';
import { normalizeRoomNumberInput } from '../utils/text';
import {
  clearTrackHighlights,
  findTrackAtPoint,
  highlightTrack,
  removeFloatingDragLabels,
  unlockScrollAfterDrag
} from '../hooks/useTouchDrag';

const AUTOSAVE_DELAY_MS = 500; // 操作が落ち着いてから保存する
const LEGACY_AUTOSAVE_KEY = 'dawProjectAutoSave'; // 旧バージョンの自動保存（localStorage）
const HISTORY_LIMIT = 100; // 「元に戻す」で戻れる回数
// テンポの −/+ を続けて押したときは、まとめて 1 回の「元に戻す」で戻せるようにする
const HISTORY_COALESCE_MS = 1500;
const TOAST_DURATION_MS = 3500;
const AUTO_SCROLL_EDGE_PX = 56; // ドラッグ中、この幅まで端に近づいたらタイムラインを動かす
const AUTO_SCROLL_STEP_PX = 18;

const createInitialTracks = () => [{
  id: Date.now(),
  name: 'トラック 1',
  clips: []
}];

const sameId = (a, b) => String(a) === String(b);

// 座標が取れなかった場合（一部のブラウザのドラッグイベントなど）に NaN の位置にしない
const toPosition = (value) => (typeof value === 'number' && isFinite(value) ? value : 0);

const isPlayableSound = (sound) =>
  !!(sound && sound.audioBlob instanceof Blob && sound.audioBlob.size > 0);

const createClipId = () => Date.now() + Math.random();

// 保存データ（Data URL）から再生用の Blob を作る。
// 以前の音素材と音声が同じなら、既存の Blob を使い回す（デコード済みの音も再利用される）。
const hydrateSounds = (records, previousSounds = []) => {
  const previousByAudio = new Map();
  previousSounds.forEach((sound) => {
    if (sound.audioData && sound.audioBlob) previousByAudio.set(sound.audioData, sound.audioBlob);
  });
  return records
    .map((record) => {
      if (!record.audioData) return { ...record, audioBlob: null };
      const reused = previousByAudio.get(record.audioData);
      if (reused) return { ...record, audioBlob: reused };
      try {
        return { ...record, audioBlob: dataUrlToBlob(record.audioData) };
      } catch (error) {
        console.error('音声データの復元に失敗:', record.name, error);
        return { ...record, audioBlob: null };
      }
    })
    .filter((sound) => {
      if (!isPlayableSound(sound)) {
        console.warn('再生できない音素材をスキップ:', sound.name);
        return false;
      }
      return true;
    });
};

// 自動保存から戻したクリップの音声が音ライブラリの音と同じなら、ライブラリの Blob を使う。
// （デコード結果は Blob ごとに覚えているので、同じ音を 2 回デコードしてメモリを 2 倍使っていた）
const shareLibraryBlobs = (tracks, librarySounds) => {
  const blobByAudio = new Map();
  librarySounds.forEach((sound) => {
    if (sound.audioData && sound.audioBlob) blobByAudio.set(sound.audioData, sound.audioBlob);
  });
  if (blobByAudio.size === 0) return tracks;
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => {
      const shared = clip.soundData && blobByAudio.get(clip.soundData.audioData);
      return shared && shared !== clip.soundData.audioBlob
        ? { ...clip, soundData: { ...clip.soundData, audioBlob: shared } }
        : clip;
    })
  }));
};

const readLegacyAutoSave = () => {
  try {
    const raw = localStorage.getItem(LEGACY_AUTOSAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (error) {
    console.warn('旧形式の自動保存データを読み込めませんでした:', error);
    return null;
  }
};

const removeLegacyAutoSave = () => {
  try {
    localStorage.removeItem(LEGACY_AUTOSAVE_KEY);
  } catch (error) {
    // 無視
  }
};

const timestampForFileName = () => new Date().toISOString().slice(0, 19).replace(/:/g, '-');

// iPad は電話・Siri・他のアプリに音を取られた（interrupted）あと、resume() の Promise が
// いつまでも終わらないことがある。待ち続けると「再生中」のまま音が出ないので打ち切る。
const RESUME_TIMEOUT_MS = 1500;
const withResumeTimeout = (promise) => Promise.race([
  promise,
  new Promise((resolve) => setTimeout(resolve, RESUME_TIMEOUT_MS))
]);

// メトロノームの音（短い「カチッ」。小節の頭は高い音）
const CLICK_SECONDS = 0.035;
const createClickBuffer = (ctx, frequency) => {
  const length = Math.max(1, Math.round(ctx.sampleRate * CLICK_SECONDS));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    const t = i / ctx.sampleRate;
    data[i] = Math.sin(2 * Math.PI * frequency * t) * Math.exp(-t * 110) * 0.55;
  }
  return buffer;
};

const isTextEntryTarget = (target) => {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable === true;
};

const DAWPage = () => {
  // ユニークID生成用のカウンター
  const trackIdCounterRef = useRef(1);
  // トラック名の番号管理用カウンター
  const trackNameCounterRef = useRef(1);

  const [tracks, setTracks] = useState(createInitialTracks);
  // 前回の作業内容を読み込み終わるまで自動保存しない。
  // （以前は読み込み完了前に「空のタイムライン」を自動保存してしまい、ページを移動するたびに
  //   作業内容が消えていた）
  const [isProjectLoaded, setIsProjectLoaded] = useState(false);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0); // 「もう一度読み込む」で増やす
  const [hasBackup, setHasBackup] = useState(false); // 「1つ前の作業に戻す」ができるか
  const [isRestoring, setIsRestoring] = useState(false); // 「1つ前の作業に戻す」の処理中
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | pending | saving | saved | error | disabled
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false); // 再生ボタンを押してから音を読み込んでいる間
  const [currentTime, setCurrentTime] = useState(0); // 停止中のプレイヘッド位置（ピクセル）
  const [error, setError] = useState(null);
  const [toast, setToast] = useState('');
  const [sounds, setSounds] = useState([]);
  const [soundDurations, setSoundDurations] = useState(() => new Map());
  const [selectedTag, setSelectedTag] = useState(''); // 選択されたタグ
  const [showSoundPanel, setShowSoundPanel] = useState(true);
  const [showHelp, setShowHelp] = useState(false);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [bpm, setBpm] = useState(DEFAULT_BPM);
  const [beatsPerMeasure, setBeatsPerMeasure] = useState(DEFAULT_BEATS_PER_MEASURE);
  const [snapMode, setSnapMode] = useState(DEFAULT_SNAP_MODE);
  const [metronome, setMetronome] = useState(false);
  const [selectedClipId, setSelectedClipId] = useState(null);
  const [selectedTrackId, setSelectedTrackId] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [isExporting, setIsExporting] = useState(false); // 音源出力中フラグ
  const [isCloudSaving, setIsCloudSaving] = useState(false);
  const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });

  // クラウド保存（先生に送る）用のstate
  const [showCloudSaveDialog, setShowCloudSaveDialog] = useState(false);
  const [cloudSaveData, setCloudSaveData] = useState({
    songTitle: '',
    studentName: '',
    groupNumber: '',
    roomNumber: ''
  });

  const timelineRef = useRef(null);
  const timelineContainerRef = useRef(null);
  const playheadRef = useRef(null);
  const rulerMarkerRef = useRef(null);
  const positionTextRef = useRef(null);
  const secondsTextRef = useRef(null);
  const projectFileInputRef = useRef(null);
  const animationFrameRef = useRef(null);
  const dragOverTimeoutRef = useRef(null);
  const toastTimerRef = useRef(null);
  const isMountedRef = useRef(true);
  const pendingFocusClipIdRef = useRef(null);

  // 音声再生
  const audioContextRef = useRef(null);
  const audioBufferCacheRef = useRef(new WeakMap()); // Blob → Promise<AudioBuffer>
  const activeSourcesRef = useRef(new Set());
  const playbackRef = useRef(null); // { startAt, offsetSec, endSec }
  const playbackSessionRef = useRef(0);
  const pendingSeekPxRef = useRef(null); // 再生中に位置を変えたとき、次の予約で使う位置
  const previewRef = useRef(null); // { source, onEnded }
  const clickBuffersRef = useRef(null);

  // ドラッグ（イベントの間で最新の値を共有するため state ではなく ref で持つ）
  const draggedClipRef = useRef(null);
  const dragOffsetRef = useRef(0);
  const draggedSoundWidthRef = useRef(DEFAULT_CLIP_WIDTH);
  const touchDragFrameRef = useRef({ id: null, args: null });

  // 自動保存
  const autoSaveRef = useRef({ saving: false, dirty: false, pending: false });
  // 最後に読み込んだ・保存した作業内容の時刻（別のタブで保存された新しい内容に気付くため）
  const lastKnownTimestampRef = useRef(0);
  // 保存済みの内容を画面に反映しただけのときは、もう一度保存しない（反映した tracks を覚えておく）
  const suppressAutoSaveTracksRef = useRef(null);
  // 旧形式（localStorage）の作業内容を移行し終えた・バックアップしたか。済むまで localStorage は消さない
  const legacyHandledRef = useRef(false);

  // 元に戻す・やり直す（その時点の tracks などをそのまま覚える。tracks は書き換えずに作り直しているので安い）
  const historyRef = useRef({ past: [], future: [] });

  // イベントハンドラや非同期処理から最新の値を読むための ref
  const tracksRef = useRef(tracks);
  const soundsRef = useRef(sounds);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const bpmRef = useRef(bpm);
  const beatsPerMeasureRef = useRef(beatsPerMeasure);
  const snapModeRef = useRef(snapMode);
  const metronomeRef = useRef(metronome);
  const currentTimeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const isProjectLoadedRef = useRef(isProjectLoaded);
  const selectedClipIdRef = useRef(selectedClipId);
  const selectedTrackIdRef = useRef(selectedTrackId);
  const isLockedRef = useRef(true);
  tracksRef.current = tracks;
  soundsRef.current = sounds;
  pixelsPerSecondRef.current = pixelsPerSecond;
  bpmRef.current = bpm;
  beatsPerMeasureRef.current = beatsPerMeasure;
  snapModeRef.current = snapMode;
  metronomeRef.current = metronome;
  isPlayingRef.current = isPlaying;
  isProjectLoadedRef.current = isProjectLoaded;
  selectedClipIdRef.current = selectedClipId;
  selectedTrackIdRef.current = selectedTrackId;
  isLockedRef.current = isInitialLoading || isRestoring || saveStatus === 'disabled';
  if (!isPlaying) currentTimeRef.current = currentTime;

  // ========== 拍とタイムラインの長さ ==========

  const timing = useMemo(() => ({ bpm, beatsPerMeasure, pixelsPerSecond }), [bpm, beatsPerMeasure, pixelsPerSecond]);
  const beatPx = beatWidthPx(bpm, pixelsPerSecond);
  const measurePx = measureWidthPx(bpm, beatsPerMeasure, pixelsPerSecond);
  const contentEndPx = useMemo(() => tracks.reduce((max, track) => (
    track.clips.reduce((trackMax, clip) => Math.max(trackMax, clip.startTime + clip.duration), max)
  ), 0), [tracks]);
  const contentEndPxRef = useRef(contentEndPx);
  contentEndPxRef.current = contentEndPx;
  const measureCount = getTimelineMeasureCount({ contentEndPx: Math.max(contentEndPx, currentTime), bpm, beatsPerMeasure, pixelsPerSecond });
  const laneWidth = measureCount * measurePx;
  const laneWidthRef = useRef(laneWidth);
  laneWidthRef.current = laneWidth;
  const hasClips = tracks.some((track) => track.clips.length > 0);

  // 置く位置をそろえる間隔（ピクセル）
  const getSnapStep = useCallback(() => snapStepPx({
    bpm: bpmRef.current,
    pixelsPerSecond: pixelsPerSecondRef.current,
    snapMode: snapModeRef.current
  }), []);

  const snapPosition = useCallback((position) => roundToStep(position, getSnapStep()), [getSnapStep]);

  // ========== お知らせ ==========

  const notify = useCallback((message) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setToast(message);
    toastTimerRef.current = setTimeout(() => {
      toastTimerRef.current = null;
      if (isMountedRef.current) setToast('');
    }, TOAST_DURATION_MS);
  }, []);

  useEffect(() => () => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
  }, []);

  const describe = useCallback((position) => formatPosition(position, {
    bpm: bpmRef.current,
    beatsPerMeasure: beatsPerMeasureRef.current,
    pixelsPerSecond: pixelsPerSecondRef.current
  }), []);

  // ========== 元に戻す・やり直す ==========

  const syncHistoryState = useCallback(() => {
    const { past, future } = historyRef.current;
    setHistoryState((prev) => (
      (prev.canUndo === (past.length > 0)) && (prev.canRedo === (future.length > 0))
        ? prev
        : { canUndo: past.length > 0, canRedo: future.length > 0 }
    ));
  }, []);

  const takeSnapshot = () => ({
    tracks: tracksRef.current,
    pixelsPerSecond: pixelsPerSecondRef.current,
    bpm: bpmRef.current,
    beatsPerMeasure: beatsPerMeasureRef.current
  });

  // 変更する直前に呼ぶ。coalesceKey が同じ操作を続けて行ったときは、最初の状態だけを覚える
  const recordHistory = useCallback((coalesceKey = null) => {
    const history = historyRef.current;
    const now = Date.now();
    const last = history.past[history.past.length - 1];
    if (coalesceKey && last && last.coalesceKey === coalesceKey && now - last.time < HISTORY_COALESCE_MS && history.future.length === 0) {
      last.time = now;
      return;
    }
    history.past.push({ ...takeSnapshot(), coalesceKey, time: now });
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    syncHistoryState();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [syncHistoryState]);

  const clearHistory = useCallback(() => {
    historyRef.current = { past: [], future: [] };
    syncHistoryState();
  }, [syncHistoryState]);

  const restoreSnapshot = (snapshot) => {
    // 覚えたときとズーム倍率が違えば、今の倍率に合わせる（クリップの位置はピクセルで持っている）
    const restoredTracks = rescaleTracks(snapshot.tracks, snapshot.pixelsPerSecond, pixelsPerSecondRef.current);
    bpmRef.current = snapshot.bpm;
    beatsPerMeasureRef.current = snapshot.beatsPerMeasure;
    tracksRef.current = restoredTracks;
    setBpm(snapshot.bpm);
    setBeatsPerMeasure(snapshot.beatsPerMeasure);
    setTracks(restoredTracks);
    // 選んでいた音や選んでいたトラックが無くなっていたら選ぶのをやめる
    const clipExists = restoredTracks.some((track) => track.clips.some((clip) => sameId(clip.id, selectedClipIdRef.current)));
    if (!clipExists) setSelectedClipId(null);
    if (!restoredTracks.some((track) => sameId(track.id, selectedTrackIdRef.current))) setSelectedTrackId(null);
  };

  const undo = useCallback(() => {
    const history = historyRef.current;
    if (history.past.length === 0 || isLockedRef.current) return;
    const previous = history.past.pop();
    history.future.push(takeSnapshot());
    restoreSnapshot(previous);
    syncHistoryState();
    notify('1つ前の操作を取り消しました');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, syncHistoryState]);

  const redo = useCallback(() => {
    const history = historyRef.current;
    if (history.future.length === 0 || isLockedRef.current) return;
    const next = history.future.pop();
    history.past.push(takeSnapshot());
    restoreSnapshot(next);
    syncHistoryState();
    notify('取り消した操作をやり直しました');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, syncHistoryState]);

  // ========== 音声 ==========

  // 音素材を AudioBuffer にデコードする（同じ Blob は 1 回だけデコードする）
  const getAudioBuffer = useCallback((soundData) => {
    const ctx = audioContextRef.current;
    if (!ctx) return Promise.reject(new Error('AudioContextが初期化されていません'));
    if (!isPlayableSound(soundData)) return Promise.reject(new Error('音声データがありません'));
    const cache = audioBufferCacheRef.current;
    const blob = soundData.audioBlob;
    if (!cache.has(blob)) {
      const promise = blobToArrayBuffer(blob).then((arrayBuffer) => decodeAudioData(ctx, arrayBuffer));
      promise.catch(() => cache.delete(blob)); // 失敗したら次回やり直す
      cache.set(blob, promise);
    }
    return cache.get(blob);
  }, []);

  // 音の長さを覚える（音素材の一覧に「0.6秒」のように表示する）
  const rememberDuration = useCallback((soundId, seconds) => {
    if (soundId === undefined || soundId === null || !(seconds > 0)) return;
    setSoundDurations((prev) => {
      if (prev.get(soundId) === seconds) return prev;
      const next = new Map(prev);
      next.set(soundId, seconds);
      return next;
    });
  }, []);

  // 音素材の長さ（ピクセル）
  const getClipWidth = useCallback(async (soundData) => {
    try {
      const buffer = await getAudioBuffer(soundData);
      if (buffer && isFinite(buffer.duration) && buffer.duration > 0) {
        if (isMountedRef.current) rememberDuration(soundData.id, buffer.duration);
        return buffer.duration * pixelsPerSecondRef.current;
      }
    } catch (error) {
      console.warn('音声の長さを取得できませんでした:', soundData && soundData.name, error);
    }
    return DEFAULT_CLIP_WIDTH;
  }, [getAudioBuffer, rememberDuration]);

  const stopAllSources = useCallback(() => {
    activeSourcesRef.current.forEach((source) => {
      source.onended = null;
      try {
        source.stop();
      } catch (error) {
        // 既に止まっている
      }
      try {
        source.disconnect();
      } catch (error) {
        // 無視
      }
    });
    activeSourcesRef.current.clear();
  }, []);

  const stopPreview = useCallback(() => {
    const preview = previewRef.current;
    previewRef.current = null;
    if (preview) {
      if (preview.source) {
        preview.source.onended = null;
        try {
          preview.source.stop();
        } catch (error) {
          // 既に止まっている
        }
      }
      if (preview.onEnded) preview.onEnded();
    }
    if (!isPlayingRef.current) disableSilentModePlayback();
  }, []);

  const cancelPlayheadAnimation = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
  };

  const getPlaybackPositionSeconds = () => {
    const info = playbackRef.current;
    const ctx = audioContextRef.current;
    if (!info || !ctx) return currentTimeRef.current / pixelsPerSecondRef.current;
    return info.offsetSec + Math.max(0, ctx.currentTime - info.startAt);
  };

  // 再生位置の表示。React の子要素にせず、いつもここで書き換える
  // （再生中は毎フレーム React を通さずに書き換えるため。React が管理する文字を直接書き換えると表示がずれる）
  const showPosition = (position) => {
    const text = describe(position);
    if (positionTextRef.current && positionTextRef.current.textContent !== text) {
      positionTextRef.current.textContent = text;
    }
    const seconds = formatSeconds(position / pixelsPerSecondRef.current);
    if (secondsTextRef.current && secondsTextRef.current.textContent !== seconds) {
      secondsTextRef.current.textContent = seconds;
    }
    if (rulerMarkerRef.current) rulerMarkerRef.current.style.left = `${position}px`;
  };

  // 停止中は state の位置を表示する
  useLayoutEffect(() => {
    if (!isPlaying) showPosition(currentTime);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentTime, isPlaying, bpm, beatsPerMeasure, pixelsPerSecond]);

  // 再生を止める（resetPosition: 先頭に戻すかどうか）
  const haltPlayback = (resetPosition) => {
    const positionSeconds = getPlaybackPositionSeconds();
    playbackSessionRef.current += 1; // 準備中の再生があれば取り消す
    pendingSeekPxRef.current = null;
    stopAllSources();
    cancelPlayheadAnimation();
    playbackRef.current = null;
    const position = resetPosition ? 0 : positionSeconds * pixelsPerSecondRef.current;
    currentTimeRef.current = position;
    isPlayingRef.current = false;
    setCurrentTime(position);
    setIsPlaying(false);
    setIsPreparing(false);
    if (!previewRef.current) disableSilentModePlayback();
  };

  // 再生中、プレイヘッドが見える範囲から出たらタイムラインをめくる
  const keepPlayheadVisible = (position) => {
    const container = timelineContainerRef.current;
    if (!container || !container.clientWidth) return;
    const corner = container.querySelector('.ruler-corner');
    const headerWidth = corner ? corner.offsetWidth : 0;
    const visibleStart = container.scrollLeft;
    const visibleWidth = container.clientWidth - headerWidth;
    if (visibleWidth <= 0) return;
    if (position > visibleStart + visibleWidth - 24 || position < visibleStart) {
      container.scrollLeft = Math.max(0, position - 24);
    }
  };

  // プレイヘッドは React の再描画を通さずに直接動かす。
  // （毎フレーム state を更新すると画面全体が 60 回/秒描き直され、iPad では操作が重くなる）
  const startPlayheadAnimation = () => {
    cancelPlayheadAnimation();
    const tick = () => {
      const info = playbackRef.current;
      const ctx = audioContextRef.current;
      if (!info || !ctx) return;
      const seconds = info.offsetSec + Math.max(0, ctx.currentTime - info.startAt);
      if (seconds >= info.endSec) {
        haltPlayback(true); // 最後まで再生したら先頭に戻る
        return;
      }
      const position = seconds * pixelsPerSecondRef.current;
      currentTimeRef.current = position;
      if (playheadRef.current) playheadRef.current.style.left = `${position}px`;
      showPosition(position);
      keepPlayheadVisible(position);
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const getClickBuffers = (ctx) => {
    if (!clickBuffersRef.current || clickBuffersRef.current.ctx !== ctx) {
      clickBuffersRef.current = {
        ctx,
        accent: createClickBuffer(ctx, 1760),
        normal: createClickBuffer(ctx, 1175)
      };
    }
    return clickBuffersRef.current;
  };

  // メトロノームの音を、再生する範囲の拍ごとに予約する
  const scheduleMetronome = (ctx, startAt, offsetSec, endSec) => {
    let clicks;
    try {
      clicks = getClickBuffers(ctx);
    } catch (clickError) {
      console.warn('メトロノームの音を作れませんでした:', clickError);
      return;
    }
    const beatSeconds = 60 / bpmRef.current;
    const perMeasure = beatsPerMeasureRef.current;
    for (let index = Math.ceil(offsetSec / beatSeconds - 1e-6); index * beatSeconds < endSec - 1e-6; index++) {
      const source = ctx.createBufferSource();
      source.buffer = index % perMeasure === 0 ? clicks.accent : clicks.normal;
      source.connect(ctx.destination);
      source.onended = () => activeSourcesRef.current.delete(source);
      source.start(startAt + (index * beatSeconds - offsetSec));
      activeSourcesRef.current.add(source);
    }
  };

  // 再生する範囲を決め、音を読み込んで AudioContext の時計で予約する
  const prepareAndSchedule = (ctx, requestedOffsetSec, session, resumePromise) => {
    const pps = pixelsPerSecondRef.current;
    // ミュートしたトラックの音は鳴らさない
    const allClips = tracksRef.current.filter((track) => !track.muted).flatMap((track) => track.clips);
    const lastClipEndSec = allClips.reduce(
      (max, clip) => Math.max(max, (clip.startTime + clip.duration) / pps),
      0
    );
    // 最後の音より後ろで再生を押したら、先頭から再生する
    const offsetSec = lastClipEndSec > 0 && requestedOffsetSec >= lastClipEndSec - 1e-6 && !metronomeRef.current
      ? 0
      : Math.max(0, requestedOffsetSec);
    let endSec;
    if (lastClipEndSec > offsetSec) {
      // メトロノームを鳴らすときは小節の終わりまで
      const measureSeconds = (60 / bpmRef.current) * beatsPerMeasureRef.current;
      endSec = metronomeRef.current ? ceilToStep(lastClipEndSec, measureSeconds) : lastClipEndSec;
    } else if (metronomeRef.current) {
      endSec = laneWidthRef.current / pps; // 音が無くてもメトロノームだけ鳴らして練習できる
    } else {
      endSec = 0;
    }

    if (endSec <= offsetSec) {
      setError(null);
      notify(allClips.length === 0
        ? 'まだ音が置かれていません。音素材をトラックに置いてから再生しましょう。'
        : '再生できる音がありません（ミュートしていないトラックに音を置きましょう）。');
      haltPlayback(false);
      return;
    }

    const clipsToPlay = allClips.filter((clip) =>
      isFinite(clip.startTime) && isFinite(clip.duration) && clip.duration > 0 &&
      (clip.startTime + clip.duration) / pps > offsetSec
    );

    setIsPreparing(true);
    const decodeJobs = clipsToPlay.map((clip) =>
      getAudioBuffer(clip.soundData).then(
        (buffer) => ({ clip, buffer }),
        (decodeError) => {
          console.error('クリップの音声を読み込めませんでした:', clip.soundData && clip.soundData.name, decodeError);
          return { clip, buffer: null };
        }
      )
    );

    Promise.all([withResumeTimeout(resumePromise), Promise.all(decodeJobs)])
      .then(([, results]) => {
        if (session !== playbackSessionRef.current || !isMountedRef.current) return;

        if (ctx.state && ctx.state !== 'running') {
          setError('音を再生できませんでした。もう一度「再生」ボタンを押してください。');
          haltPlayback(false);
          return;
        }

        // すべての音を AudioContext の時計で予約する（setTimeout より正確で、ずれない）
        const startAt = ctx.currentTime + 0.05;
        let failedCount = 0;
        results.forEach(({ clip, buffer }) => {
          if (!buffer) {
            failedCount++;
            return;
          }
          const clipStartSec = clip.startTime / pps;
          const offsetInClip = Math.max(0, offsetSec - clipStartSec);
          if (offsetInClip >= buffer.duration) return;
          const source = ctx.createBufferSource();
          source.buffer = buffer;
          source.connect(ctx.destination);
          source.onended = () => activeSourcesRef.current.delete(source);
          source.start(startAt + Math.max(0, clipStartSec - offsetSec), offsetInClip);
          activeSourcesRef.current.add(source);
        });
        if (metronomeRef.current) scheduleMetronome(ctx, startAt, offsetSec, endSec);

        playbackRef.current = { startAt, offsetSec, endSec };
        currentTimeRef.current = offsetSec * pps;
        setIsPreparing(false);
        startPlayheadAnimation();

        if (failedCount > 0) {
          setError(`${failedCount}個のクリップの音を読み込めなかったため、その音は鳴らさずに再生しています。`);
        }
      })
      .catch((playError) => {
        console.error('再生エラー:', playError);
        if (session !== playbackSessionRef.current || !isMountedRef.current) return;
        setError('音声の再生に失敗しました。ブラウザで音声が有効になっているか確認してください。');
        haltPlayback(false);
      });
  };

  const play = () => {
    const ctx = audioContextRef.current;
    if (!ctx) {
      setError('このブラウザでは音声を再生できません。');
      return;
    }

    // 先に試聴を止める（stopPreview は再生中でなければ消音モード対策を解除するので、有効にする前に呼ぶ）
    stopPreview();
    stopAllSources();
    // ここまで await を挟まないこと。iOS はタップの処理中でないと音を出す許可をくれない。
    enableSilentModePlayback();
    const resumePromise = unlockAudioContext(ctx);

    const session = playbackSessionRef.current + 1;
    playbackSessionRef.current = session;
    const offsetSec = Math.max(0, currentTimeRef.current / pixelsPerSecondRef.current);

    setError(null);
    isPlayingRef.current = true;
    setIsPlaying(true);
    prepareAndSchedule(ctx, offsetSec, session, resumePromise);
  };

  // 再生中に音を動かしたり消したりしたら、今の位置から予約し直す（以前は再生を押した時の音のまま鳴っていた）
  const reschedulePlayback = () => {
    const ctx = audioContextRef.current;
    if (!isPlayingRef.current || !ctx) return;
    const pps = pixelsPerSecondRef.current;
    const offsetSec = pendingSeekPxRef.current !== null
      ? pendingSeekPxRef.current / pps
      : getPlaybackPositionSeconds();
    pendingSeekPxRef.current = null;
    playbackSessionRef.current += 1;
    const session = playbackSessionRef.current;
    stopAllSources();
    cancelPlayheadAnimation();
    playbackRef.current = null;
    currentTimeRef.current = offsetSec * pps;
    if (playheadRef.current) playheadRef.current.style.left = `${offsetSec * pps}px`;
    showPosition(offsetSec * pps);
    prepareAndSchedule(ctx, offsetSec, session, Promise.resolve());
  };
  const reschedulePlaybackRef = useRef(reschedulePlayback);
  reschedulePlaybackRef.current = reschedulePlayback;

  const pause = () => haltPlayback(false);
  const stop = () => haltPlayback(true);

  // effect やショートカットキーから最新の関数を呼ぶため
  const haltPlaybackRef = useRef(haltPlayback);
  haltPlaybackRef.current = haltPlayback;
  const togglePlaybackRef = useRef(null);
  togglePlaybackRef.current = () => (isPlayingRef.current ? pause() : play());

  useEffect(() => {
    if (isPlayingRef.current) reschedulePlaybackRef.current();
  }, [tracks, bpm, beatsPerMeasure, metronome]);

  // 音素材パネルの ▶️（試聴）
  const playPreview = useCallback((sound, onEnded) => {
    const ctx = audioContextRef.current;
    if (!ctx || !isPlayableSound(sound)) {
      if (onEnded) onEnded();
      return;
    }
    // 前の試聴を止めてから消音モード対策を有効にする（逆にすると止めた時点で解除されてしまう）
    stopPreview();
    enableSilentModePlayback();
    const resumePromise = unlockAudioContext(ctx);

    const preview = { source: null, onEnded };
    previewRef.current = preview;

    Promise.all([withResumeTimeout(resumePromise), getAudioBuffer(sound)])
      .then(([, buffer]) => {
        if (previewRef.current !== preview) return;
        if (ctx.state && ctx.state !== 'running') {
          stopPreview();
          if (isMountedRef.current) setError('音を再生できませんでした。もう一度試聴ボタンを押してください。');
          return;
        }
        if (buffer && isFinite(buffer.duration)) rememberDuration(sound.id, buffer.duration);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.onended = () => {
          if (previewRef.current === preview) stopPreview();
        };
        source.start(0);
        preview.source = source;
      })
      .catch((previewError) => {
        console.error('試聴エラー:', previewError);
        if (previewRef.current !== preview) return;
        stopPreview();
        if (isMountedRef.current) setError(`「${sound.name}」を再生できませんでした。`);
      });
  }, [getAudioBuffer, rememberDuration, stopPreview]);

  // Web Audio API の初期化と後片付け
  useEffect(() => {
    isMountedRef.current = true;
    const ctx = createAudioContext();
    audioContextRef.current = ctx;
    if (!ctx) {
      setError('このブラウザは音声の再生に対応していません。');
    }

    // iPad は他のアプリに切り替えると AudioContext を止めるので、タップのたびに再開を試みる
    const resumeOnGesture = () => {
      if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') {
        unlockAudioContext(ctx);
      }
    };
    document.addEventListener('touchend', resumeOnGesture, { passive: true });
    document.addEventListener('click', resumeOnGesture);

    const activeSources = activeSourcesRef.current;
    return () => {
      isMountedRef.current = false;
      document.removeEventListener('touchend', resumeOnGesture, { passive: true });
      document.removeEventListener('click', resumeOnGesture);
      playbackSessionRef.current += 1;
      activeSources.forEach((source) => {
        source.onended = null;
        try {
          source.stop();
        } catch (error) {
          // 既に止まっている
        }
      });
      activeSources.clear();
      if (previewRef.current && previewRef.current.source) {
        try {
          previewRef.current.source.stop();
        } catch (error) {
          // 既に止まっている
        }
      }
      previewRef.current = null;
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      audioContextRef.current = null;
      closeAudioContext(ctx);
      disableSilentModePlayback();
    };
  }, []);

  // ========== 音素材 ==========

  // 音素材ライブラリにまだ無い音を追加する（同じ音声は二重に追加しない）
  const addMissingSoundsToLibrary = useCallback(async (candidates, source, library = soundsRef.current) => {
    const knownAudio = new Set(library.map((sound) => sound.audioData));
    const usedNames = new Set(library.map((sound) => sound.name));
    const now = new Date().toISOString();
    const records = [];
    const blobs = [];

    // 先に Blob に復元できるか確かめ、再生できない（壊れた）音声は保存しない。
    // 保存してしまうと一覧には出ないため、読み込むたびに見えない音素材が増えていく
    const withAudio = candidates.filter((sound) => sound && sound.audioData);
    const playable = hydrateSounds(withAudio, withAudio);
    playable.forEach((sound) => {
      if (knownAudio.has(sound.audioData)) return;
      knownAudio.add(sound.audioData);
      const baseName = sound.name || '音素材';
      let name = baseName;
      let counter = 1;
      while (usedNames.has(name)) {
        name = `${baseName} (${counter})`;
        counter++;
      }
      usedNames.add(name);
      records.push({
        name,
        tags: Array.isArray(sound.tags) ? sound.tags : [],
        audioData: sound.audioData,
        createdAt: sound.createdAt || now,
        source,
        importedAt: now
      });
      blobs.push(sound.audioBlob);
    });

    if (records.length === 0) return 0;

    // ID は IndexedDB に採番させる（以前は既存の音素材と ID が重なり、上書きして消していた）
    const ids = await addRecordings(records);
    const added = hydrateSounds(
      records.map((record, index) => ({ ...record, id: ids[index] })),
      records.map((record, index) => ({ audioData: record.audioData, audioBlob: blobs[index] }))
    );
    if (isMountedRef.current) {
      setSounds((prev) => {
        const next = [...prev, ...added];
        soundsRef.current = next;
        return next;
      });
    }
    return records.length;
  }, []);

  const refreshSounds = useCallback(async () => {
    try {
      const saved = await getAllRecordings();
      if (!isMountedRef.current) return;
      setSounds((prev) => {
        const next = hydrateSounds(saved, prev);
        soundsRef.current = next;
        return next;
      });
    } catch (loadError) {
      console.error('音素材の再読み込みに失敗:', loadError);
    }
  }, []);

  // 全てのタグ
  const allTags = useMemo(
    () => [...new Set(sounds.flatMap((sound) => sound.tags || []))],
    [sounds]
  );

  // タグによるフィルタリング
  const filteredSounds = useMemo(
    () => (selectedTag ? sounds.filter((sound) => (sound.tags || []).includes(selectedTag)) : sounds),
    [sounds, selectedTag]
  );

  // 選択中のタグが無くなったら「すべて」に戻す
  useEffect(() => {
    if (selectedTag && !allTags.includes(selectedTag)) setSelectedTag('');
  }, [allTags, selectedTag]);

  // 音素材の一覧に表示する長さ（保存されている長さか、デコードして分かった長さ）
  const durationsForPalette = useMemo(() => {
    const result = new Map();
    sounds.forEach((sound) => {
      const seconds = soundDurations.get(sound.id) || sound.duration;
      if (seconds > 0) result.set(sound.id, seconds);
    });
    return result;
  }, [sounds, soundDurations]);

  // ========== プロジェクトの読み込みと自動保存 ==========

  const applyProject = useCallback((project) => {
    const restoredTracks = project.tracks.length > 0 ? project.tracks : createInitialTracks();
    const nextBpm = clampBpm(project.bpm === undefined ? DEFAULT_BPM : project.bpm);
    const nextBeats = normalizeBeatsPerMeasure(project.beatsPerMeasure);
    const nextSnap = normalizeSnapMode(project.snapMode);
    const nextMetronome = project.metronome === true;
    setPixelsPerSecond(project.pixelsPerSecond);
    setBpm(nextBpm);
    setBeatsPerMeasure(nextBeats);
    setSnapMode(nextSnap);
    setMetronome(nextMetronome);
    setTracks(restoredTracks);
    tracksRef.current = restoredTracks;
    pixelsPerSecondRef.current = project.pixelsPerSecond;
    bpmRef.current = nextBpm;
    beatsPerMeasureRef.current = nextBeats;
    snapModeRef.current = nextSnap;
    metronomeRef.current = nextMetronome;
    trackNameCounterRef.current = project.trackNameCounter || Math.max(1, restoredTracks.length);
    trackIdCounterRef.current = project.trackIdCounter || 1;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    setSelectedClipId(null);
    setSelectedTrackId(null);
    // 別の作業内容に入れ替わったので、元に戻す履歴は使えない
    historyRef.current = { past: [], future: [] };
    setHistoryState({ canUndo: false, canRedo: false });
  }, []);

  // インポート楽曲と自動保存データの読み込み
  useEffect(() => {
    let cancelled = false;

    const loadInitialData = async () => {
      let loadSucceeded = false;
      try {
        // 音素材が読めない状態で読み込みを続けると、旧形式の作業内容の音を補えず失われるので、
        // 音素材の読み込みに失敗したら全体を失敗として扱う（「もう一度読み込む」でやり直せる）
        const librarySounds = hydrateSounds(await getAllRecordings());
        if (cancelled) return;
        soundsRef.current = librarySounds;
        setSounds(librarySounds);

        // 先生ページから渡された楽曲
        let imported = false;
        const songData = await getSongData();
        if (cancelled) return;
        if (songData) {
          // 旧形式（localStorage）にだけ作業内容がある場合も「今の作業内容」として扱う
          const legacyForBackup = readLegacyAutoSave();
          const current = (await getProjectAutoSave()) || legacyForBackup;
          if (cancelled) return;
          const hasWork = !!current && Array.isArray(current.tracks) &&
            current.tracks.some((track) => Array.isArray(track.clips) && track.clips.length > 0);
          // 今の作業内容を黙って置き換えない（共用の iPad や先生の端末で作業が消えるのを防ぐ）
          const accepted = !hasWork || window.confirm(
            '先生が指定した楽曲を開きます。\n\n今の作業内容はこの楽曲に置き換わります（1つ前の作業内容としてバックアップされます）。よろしいですか？'
          );
          if (accepted) {
            // バックアップ・自動保存への書き込み・渡された楽曲の削除を 1 つのトランザクションで行う
            imported = await promoteImportedSongToAutoSave(legacyForBackup);
            if (imported) legacyHandledRef.current = true; // 旧形式の作業内容もバックアップ済み
          } else {
            await deleteSongData();
          }
          if (cancelled) return;
        }

        const autoSaved = await getProjectAutoSave();
        if (cancelled) return;
        let project = null;
        if (autoSaved) {
          project = deserializeProject(autoSaved);
          lastKnownTimestampRef.current = autoSaved.timestamp || 0;
        } else {
          // 旧バージョン（localStorage）の自動保存からの移行
          const legacy = readLegacyAutoSave();
          if (legacy && Array.isArray(legacy.tracks)) {
            const byName = new Map(librarySounds.map((sound) => [sound.name, sound]));
            project = deserializeProject(legacy, { findSoundByName: (name) => byName.get(name) });
          }
        }
        if (project) applyProject({ ...project, tracks: shareLibraryBlobs(project.tracks, librarySounds) });
        legacyHandledRef.current = true; // 旧形式の作業内容は読み込んだ（または新しい保存がある）

        if (imported && project) {
          let addedCount = 0;
          try {
            // 使われている音素材を音ライブラリーに追加
            addedCount = await addMissingSoundsToLibrary(project.usedSounds, 'cloud-import', librarySounds);
          } catch (addError) {
            console.error('音素材の保存に失敗:', addError);
          }
          if (cancelled) return;
          alert(`先生が指定した楽曲を読み込みました!\n使用されている${addedCount}個の音素材を音ライブラリーに追加しました。`);
        }
        loadSucceeded = true;

        try {
          setHasBackup(!!(await getProjectAutoSaveBackup()));
        } catch (backupError) {
          // バックアップの有無が分からなくても作業は続けられる
        }
      } catch (loadError) {
        console.error('プロジェクトデータの読み込みに失敗:', loadError);
      }

      if (cancelled) return;
      setIsInitialLoading(false);
      if (loadSucceeded) {
        setIsProjectLoaded(true);
        setSaveStatus('idle');
      } else {
        // 読めなかったデータを空の状態で上書きしないよう、自動保存は止めたままにする
        setSaveStatus('disabled');
        setError('前回の作業内容を読み込めませんでした。「もう一度読み込む」を押してください。（読み込めるまで自動保存は止めています）');
      }
    };

    loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [addMissingSoundsToLibrary, applyProject, loadAttempt]);

  const retryInitialLoad = () => {
    // 自動保存が止まっている間の変更は保存されていないので、消えることを確認する
    const hasUnsavedEdits = tracksRef.current.some((track) => track.clips.length > 0) || tracksRef.current.length > 1;
    if (hasUnsavedEdits && !window.confirm('読み込み直すと、今の画面で行った変更は消えます。よろしいですか？')) {
      return;
    }
    setError(null);
    setSaveStatus('idle');
    setIsInitialLoading(true);
    setLoadAttempt((attempt) => attempt + 1);
  };

  const serializeCurrentProject = (options, extra = {}) => serializeProject({
    tracks: tracksRef.current,
    pixelsPerSecond: pixelsPerSecondRef.current,
    trackNameCounter: trackNameCounterRef.current,
    trackIdCounter: trackIdCounterRef.current,
    bpm: bpmRef.current,
    beatsPerMeasure: beatsPerMeasureRef.current,
    snapMode: snapModeRef.current,
    metronome: metronomeRef.current,
    ...extra
  }, options);
  const serializeCurrentProjectRef = useRef(serializeCurrentProject);
  serializeCurrentProjectRef.current = serializeCurrentProject;

  const flushAutoSave = useCallback(() => {
    const state = autoSaveRef.current;
    if (!isProjectLoadedRef.current) return Promise.resolve();
    if (state.saving) {
      state.dirty = true;
      return state.promise;
    }
    state.pending = false;
    state.saving = true;
    if (isMountedRef.current) setSaveStatus('saving');

    const data = serializeCurrentProjectRef.current({ includeSounds: 'used' });

    state.promise = saveProjectAutoSave(data)
      .then(() => {
        lastKnownTimestampRef.current = data.timestamp;
        if (legacyHandledRef.current) removeLegacyAutoSave();
        if (isMountedRef.current) setSaveStatus('saved');
        return true;
      })
      .catch((saveError) => {
        console.error('プロジェクトの自動保存に失敗:', saveError);
        // 保存できていない変更が残っているので、ページを離れるときや次の変更でもう一度保存する
        state.pending = true;
        if (isMountedRef.current) {
          setSaveStatus('error');
          setError(isQuotaExceededError(saveError)
            ? '保存できる容量が足りないため、自動保存できませんでした。音ライブラリで使わない音を削除するか、「ファイル」→「ファイルに保存」で保存してください。'
            : '自動保存に失敗しました。「ファイル」→「ファイルに保存」で保存しておくと安心です。');
        }
        return false;
      })
      .finally(() => {
        state.saving = false;
        if (state.dirty) {
          state.dirty = false;
          flushAutoSave();
        }
      });
    return state.promise;
  }, []);

  // 保存待ちの変更をすべて保存し終えるまで待つ。すべて保存できたら true。
  // （置き換え前にバックアップするとき、保存に失敗した古い版をバックアップしないため）
  const saveAllPendingChanges = async () => {
    if (!isProjectLoadedRef.current) return true;
    let ok = await flushAutoSave();
    while (autoSaveRef.current.saving) {
      // eslint-disable-next-line no-await-in-loop
      ok = await autoSaveRef.current.promise;
    }
    return ok !== false && !autoSaveRef.current.pending;
  };

  // タイムラインデータの自動保存（変更が落ち着いてから保存）
  useEffect(() => {
    if (!isProjectLoaded) return undefined;
    const suppressedTracks = suppressAutoSaveTracksRef.current;
    suppressAutoSaveTracksRef.current = null;
    if (suppressedTracks && suppressedTracks === tracks) {
      return undefined; // 保存済みの内容を反映しただけ
    }
    autoSaveRef.current.pending = true;
    setSaveStatus((status) => (status === 'saving' ? status : 'pending'));
    const timer = setTimeout(() => {
      flushAutoSave();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tracks, pixelsPerSecond, bpm, beatsPerMeasure, snapMode, metronome, isProjectLoaded, flushAutoSave]);

  // ページを離れる・アプリを切り替えるときは、待たずにすぐ保存する
  useEffect(() => {
    const flushIfPending = () => {
      if (autoSaveRef.current.pending) flushAutoSave();
    };
    const handleVisibilityChange = () => {
      if (document.hidden) {
        flushIfPending();
        // iPad はバックグラウンドで音を止めるので、再生位置がずれないよう一時停止する
        if (isPlayingRef.current) haltPlaybackRef.current(false);
      } else {
        // 他のタブで録音した音と、他のタブで保存された新しい作業内容を反映する
        refreshSounds();
        reloadIfChangedElsewhereRef.current();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('pagehide', flushIfPending);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('pagehide', flushIfPending);
      // 音あつめページなどへ移動した直後の変更も保存する
      flushIfPending();
    };
  }, [flushAutoSave, refreshSounds]);

  // 同じ端末の別のタブ（先生ページから「音楽づくりで開く」を何度も押した場合など）で保存された、
  // より新しい作業内容があれば読み込み直す。読み直さないと、古いタブが次の編集で新しい内容を上書きしてしまう。
  const canReplaceWithStored = (tracksBefore) => {
    const state = autoSaveRef.current;
    return isProjectLoadedRef.current && !state.pending && !state.saving && !state.dirty &&
      !isPlayingRef.current && !draggedClipRef.current && tracksRef.current === tracksBefore;
  };
  const reloadIfChangedElsewhere = async () => {
    const tracksBefore = tracksRef.current;
    if (!canReplaceWithStored(tracksBefore)) return;
    try {
      const stored = await getProjectAutoSave();
      // 読み込みを待っている間に、このタブで編集していたら置き換えない
      if (!stored || !isMountedRef.current || !canReplaceWithStored(tracksBefore)) return;
      if ((stored.timestamp || 0) > lastKnownTimestampRef.current) {
        lastKnownTimestampRef.current = stored.timestamp || 0;
        const project = deserializeProject(stored);
        applyProject({ ...project, tracks: shareLibraryBlobs(project.tracks, soundsRef.current) });
        suppressAutoSaveTracksRef.current = tracksRef.current;
      }
    } catch (reloadError) {
      console.warn('他のタブで保存された作業内容を確認できませんでした:', reloadError);
    }
  };
  const reloadIfChangedElsewhereRef = useRef(reloadIfChangedElsewhere);
  reloadIfChangedElsewhereRef.current = reloadIfChangedElsewhere;

  // ========== 選ぶ・置く・動かす ==========

  // ＋ボタンで音を置くトラック（選んでいなければ一番上のトラック）
  const targetTrack = tracks.find((track) => sameId(track.id, selectedTrackId)) || tracks[0];
  const targetTrackIndex = Math.max(0, tracks.indexOf(targetTrack));
  const targetTrackLabel = `トラック ${targetTrackIndex + 1}`;

  const findClip = (clipId) => {
    for (const track of tracksRef.current) {
      const clip = track.clips.find((item) => sameId(item.id, clipId));
      if (clip) return { clip, track };
    }
    return null;
  };

  const trackLabel = (trackId) => {
    const index = tracksRef.current.findIndex((track) => sameId(track.id, trackId));
    return `トラック ${index + 1}`;
  };

  // 置いた音が見える所までタイムラインを動かす
  const scrollPositionIntoView = (position, width = 0) => {
    const container = timelineContainerRef.current;
    if (!container || !container.clientWidth) return;
    const corner = container.querySelector('.ruler-corner');
    const headerWidth = corner ? corner.offsetWidth : 0;
    const visibleWidth = container.clientWidth - headerWidth;
    if (visibleWidth <= 0) return;
    if (position < container.scrollLeft || position + Math.min(width, visibleWidth) > container.scrollLeft + visibleWidth) {
      container.scrollLeft = Math.max(0, position - 40);
    }
  };

  const selectClip = useCallback((clipId, trackId) => {
    setSelectedClipId(clipId);
    if (trackId !== undefined) setSelectedTrackId(trackId);
  }, []);

  const selectTrack = useCallback((trackId, { deselectClip = false } = {}) => {
    setSelectedTrackId(trackId);
    if (deselectClip) setSelectedClipId(null);
  }, []);

  // 新しい音素材をトラックに置く（direction: 'forward' なら、重なるとき後ろの空きへ）
  const placeSoundOnTrack = useCallback(async (sound, trackId, timePosition, { direction = 'nearest', advancePlayhead = false } = {}) => {
    const width = await getClipWidth(sound);
    if (!isMountedRef.current) return null;
    const target = tracksRef.current.find((track) => sameId(track.id, trackId));
    if (!target) return null;
    const step = getSnapStep();
    const startTime = findFreePosition(target.clips, Math.max(0, toPosition(timePosition)), width, { step, direction });
    const clip = {
      id: createClipId(), // より確実にユニークなIDを生成
      soundData: sound,
      startTime,
      duration: width,
      trackId: target.id
    };
    recordHistory();
    setTracks((prev) => prev.map((track) => (
      sameId(track.id, trackId) ? { ...track, clips: [...track.clips, clip] } : track
    )));
    setSelectedClipId(clip.id);
    setSelectedTrackId(target.id);
    if (advancePlayhead && !isPlayingRef.current) {
      // 続けて＋を押すと、音が順番に並ぶ
      const next = ceilToStep(startTime + width, step);
      currentTimeRef.current = next;
      setCurrentTime(next);
    }
    notify(`「${sound.name}」を${trackLabel(target.id)}の${describe(startTime)}に置きました`);
    scrollPositionIntoView(startTime, width);
    return clip;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getClipWidth, getSnapStep, notify, recordHistory, describe]);

  // ＋ボタン: 選んでいるトラックの再生位置に置く
  const placeSoundAtPlayhead = useCallback((sound) => {
    if (isLockedRef.current) return;
    const list = tracksRef.current;
    const track = list.find((item) => sameId(item.id, selectedTrackIdRef.current)) || list[0];
    if (!track) return;
    const position = isPlayingRef.current ? getPlaybackPositionSeconds() * pixelsPerSecondRef.current : currentTimeRef.current;
    placeSoundOnTrack(sound, track.id, position, { direction: 'forward', advancePlayhead: true }).catch((placeError) => {
      console.error('配置エラー:', placeError);
      setError('音素材の配置に失敗しました。再度お試しください。');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placeSoundOnTrack]);

  // 配置済みのクリップを移動する（別のトラックへの移動も含む）
  const moveClipToTrack = useCallback((clip, targetTrackId, rawStartTime, { direction = 'nearest' } = {}) => {
    const target = tracksRef.current.find((track) => sameId(track.id, targetTrackId));
    if (!target) return;
    const startTime = findFreePosition(target.clips, Math.max(0, toPosition(rawStartTime)), clip.duration, {
      excludeClipId: clip.id,
      step: getSnapStep(),
      direction
    });
    const current = findClip(clip.id);
    if (current && sameId(current.track.id, target.id) && current.clip.startTime === startTime) return;
    recordHistory();
    const { originalTrackId, ...clipData } = clip;
    const moved = { ...clipData, startTime, trackId: target.id };
    setTracks((prev) => prev.map((track) => {
      const remaining = track.clips.filter((c) => c.id !== clip.id);
      if (track.id === target.id) return { ...track, clips: [...remaining, moved] };
      return remaining.length !== track.clips.length ? { ...track, clips: remaining } : track;
    }));
    setSelectedClipId(clip.id);
    setSelectedTrackId(target.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSnapStep, recordHistory]);

  const findSoundById = (soundId) =>
    soundsRef.current.find((sound) => sameId(sound.id, soundId)) || null;

  const addTrack = () => {
    // より確実にユニークなIDを生成
    trackIdCounterRef.current += 1;
    const uniqueId = Date.now() + trackIdCounterRef.current;

    // トラック名の番号を増加（削除されても番号は戻らない）
    trackNameCounterRef.current += 1;
    const newTrack = {
      id: uniqueId,
      name: `トラック ${trackNameCounterRef.current}`,
      clips: []
    };
    recordHistory();
    setTracks((prevTracks) => [...prevTracks, newTrack]);
    setSelectedTrackId(uniqueId);
  };

  const removeTrack = useCallback((trackId) => {
    const track = tracksRef.current.find((t) => t.id === trackId);
    if (!track || tracksRef.current.length <= 1) return;
    if (track.clips.length > 0 && !window.confirm('このトラックには音が置かれています。トラックごと削除しますか？')) {
      return;
    }
    recordHistory();
    setTracks((prevTracks) => (
      prevTracks.length > 1 ? prevTracks.filter((t) => t.id !== trackId) : prevTracks
    ));
    if (track.clips.some((clip) => sameId(clip.id, selectedClipIdRef.current))) setSelectedClipId(null);
  }, [recordHistory]);

  const toggleMute = useCallback((trackId) => {
    recordHistory();
    setTracks((prev) => prev.map((track) => (
      sameId(track.id, trackId) ? { ...track, muted: !track.muted } : track
    )));
  }, [recordHistory]);

  const removeClip = useCallback((trackId, clipId) => {
    const found = findClip(clipId);
    recordHistory();
    setTracks((prevTracks) => prevTracks.map((track) => (
      sameId(track.id, trackId)
        ? { ...track, clips: track.clips.filter((clip) => !sameId(clip.id, clipId)) }
        : track
    )));
    if (sameId(selectedClipIdRef.current, clipId)) setSelectedClipId(null);
    if (found) notify(`「${found.clip.soundData.name}」を削除しました（「元に戻す」で戻せます）`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [notify, recordHistory]);

  // 選んだ音のすぐ後ろ（次の拍）に同じ音を置く。続けて押すと同じ音をくり返せる
  const duplicateClip = useCallback((clipId) => {
    const found = findClip(clipId);
    if (!found) return;
    const { clip, track } = found;
    const step = getSnapStep();
    const startTime = findFreePosition(track.clips, ceilToStep(clip.startTime + clip.duration, step), clip.duration, {
      step,
      direction: 'forward'
    });
    const copy = { ...clip, id: createClipId(), startTime, trackId: track.id };
    recordHistory();
    setTracks((prev) => prev.map((item) => (
      sameId(item.id, track.id) ? { ...item, clips: [...item.clips, copy] } : item
    )));
    setSelectedClipId(copy.id);
    notify(`「${clip.soundData.name}」を${describe(startTime)}に複製しました`);
    scrollPositionIntoView(startTime, clip.duration);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [getSnapStep, notify, recordHistory, describe]);

  // キーボードで選んだ音を動かす（← → は拍ごと、↑ ↓ はとなりのトラックへ）
  const nudgeClip = (clipId, steps) => {
    const found = findClip(clipId);
    if (!found) return;
    const step = snapModeRef.current === 'off' ? pixelsPerSecondRef.current * 0.1 : getSnapStep();
    const desired = Math.max(0, roundToStep(found.clip.startTime, step) + steps * step);
    pendingFocusClipIdRef.current = clipId;
    moveClipToTrack(found.clip, found.track.id, desired, { direction: steps > 0 ? 'forward' : 'nearest' });
  };

  const moveClipToNeighborTrack = (clipId, offset) => {
    const found = findClip(clipId);
    if (!found) return;
    const list = tracksRef.current;
    const index = list.indexOf(found.track) + offset;
    if (index < 0 || index >= list.length) return;
    pendingFocusClipIdRef.current = clipId;
    moveClipToTrack(found.clip, list[index].id, found.clip.startTime);
  };

  const handleClipKeyDown = (event, clip, trackId) => {
    switch (event.key) {
      case 'Enter':
      case ' ':
        event.preventDefault();
        event.stopPropagation();
        selectClip(clip.id, trackId);
        break;
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        event.stopPropagation();
        removeClip(trackId, clip.id);
        break;
      case 'ArrowLeft':
      case 'ArrowRight':
        event.preventDefault();
        event.stopPropagation();
        selectClip(clip.id, trackId);
        nudgeClip(clip.id, event.key === 'ArrowRight' ? 1 : -1);
        break;
      case 'ArrowUp':
      case 'ArrowDown':
        event.preventDefault();
        event.stopPropagation();
        selectClip(clip.id, trackId);
        moveClipToNeighborTrack(clip.id, event.key === 'ArrowDown' ? 1 : -1);
        break;
      case 'Escape':
        setSelectedClipId(null);
        break;
      default:
        break;
    }
  };
  const handleClipKeyDownRef = useRef(handleClipKeyDown);
  handleClipKeyDownRef.current = handleClipKeyDown;
  const stableClipKeyDown = useCallback((event, clip, trackId) => handleClipKeyDownRef.current(event, clip, trackId), []);

  // 別のトラックに動かすと要素が作り直されるので、キーボードで動かしたあとはフォーカスを戻す
  useEffect(() => {
    const clipId = pendingFocusClipIdRef.current;
    if (clipId === null || !timelineRef.current) return;
    pendingFocusClipIdRef.current = null;
    const element = Array.from(timelineRef.current.querySelectorAll('.audio-clip'))
      .find((item) => item.dataset.clipId === String(clipId));
    if (element && document.activeElement !== element) element.focus();
  }, [tracks]);

  // ========== 再生位置を動かす（上の目盛り） ==========

  const seekTo = useCallback((rawPosition) => {
    const target = Math.max(0, Math.min(laneWidthRef.current, roundToStep(toPosition(rawPosition), getSnapStep())));
    if (isPlayingRef.current) {
      pendingSeekPxRef.current = target;
      reschedulePlaybackRef.current();
    } else {
      currentTimeRef.current = target;
      setCurrentTime(target);
    }
  }, [getSnapStep]);

  const handleRulerKeyDown = useCallback((event) => {
    const beat = beatWidthPx(bpmRef.current, pixelsPerSecondRef.current);
    const measure = beat * beatsPerMeasureRef.current;
    const current = isPlayingRef.current ? getPlaybackPositionSeconds() * pixelsPerSecondRef.current : currentTimeRef.current;
    let next = null;
    if (event.key === 'ArrowRight' || event.key === 'ArrowUp') next = roundToStep(current, beat) + beat;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowDown') next = roundToStep(current, beat) - beat;
    // 1 小節分だけ動かす（動かした先は拍の頭にそろう）
    if (event.key === 'PageDown') next = current + measure;
    if (event.key === 'PageUp') next = current - measure;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = contentEndPxRef.current;
    if (next === null) return;
    event.preventDefault();
    seekTo(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seekTo]);

  // ========== テンポ・拍子・合わせ方・メトロノーム ==========

  const changeTempo = (nextBpm) => {
    const previous = bpmRef.current;
    const next = clampBpm(nextBpm);
    if (next === previous || isLockedRef.current) return;
    const position = isPlayingRef.current ? getPlaybackPositionSeconds() * pixelsPerSecondRef.current : currentTimeRef.current;
    recordHistory('tempo');
    bpmRef.current = next;
    setBpm(next);
    // 並べた音は同じ拍の上に残す（音の長さは変えない）
    const pps = pixelsPerSecondRef.current;
    const rescaled = rescaleTracksForTempo(tracksRef.current, previous, next, pps);
    tracksRef.current = rescaled;
    setTracks(rescaled);
    // 再生位置も同じ拍の上に
    const nextPosition = convertUnits(position, beatWidthPx(previous, pps), beatWidthPx(next, pps));
    if (isPlayingRef.current) {
      pendingSeekPxRef.current = nextPosition;
    } else {
      currentTimeRef.current = nextPosition;
      setCurrentTime(nextPosition);
    }
  };

  const changeBeatsPerMeasure = (value) => {
    const next = normalizeBeatsPerMeasure(value);
    if (next === beatsPerMeasureRef.current) return;
    recordHistory();
    beatsPerMeasureRef.current = next;
    setBeatsPerMeasure(next);
  };

  const changeSnapMode = (value) => {
    const next = normalizeSnapMode(value);
    snapModeRef.current = next;
    setSnapMode(next);
  };

  const toggleMetronome = () => {
    metronomeRef.current = !metronomeRef.current;
    setMetronome(metronomeRef.current);
  };

  // ズームイン/ズームアウト機能
  const handleZoom = (zoomIn) => {
    const current = pixelsPerSecondRef.current;
    const next = getNextZoomLevel(current, zoomIn);
    if (next === current) return;
    pixelsPerSecondRef.current = next;
    setPixelsPerSecond(next);
    // クリップは秒ではなくピクセルで位置を持っているので、同じ比率で伸縮させる
    const rescaled = rescaleTracks(tracksRef.current, current, next);
    tracksRef.current = rescaled;
    setTracks(rescaled);
    if (!isPlayingRef.current) {
      const position = convertUnits(currentTimeRef.current, current, next);
      currentTimeRef.current = position;
      setCurrentTime(position);
    }
  };

  // ========== ショートカットキー ==========

  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.defaultPrevented || isLockedRef.current) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      const target = event.target;
      if (isTextEntryTarget(target)) return;
      const withModifier = event.metaKey || event.ctrlKey;
      const key = event.key;
      if (withModifier && (key === 'z' || key === 'Z')) {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (withModifier && (key === 'y' || key === 'Y')) {
        event.preventDefault();
        redo();
        return;
      }
      if ((key === 'Delete' || key === 'Backspace') && selectedClipIdRef.current !== null && !withModifier) {
        const found = findClip(selectedClipIdRef.current);
        if (found) {
          event.preventDefault();
          removeClip(found.track.id, found.clip.id);
        }
        return;
      }
      // スペースキーで再生・一時停止（ボタンなどにフォーカスがあるときは、そのボタンを押す動作を優先）
      if (key === ' ' && !withModifier) {
        const interactive = target && target.closest && target.closest('button, a, [role="button"], [role="slider"], summary');
        if (!interactive) {
          event.preventDefault();
          togglePlaybackRef.current();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [redo, removeClip, undo]);

  // ========== ドラッグ＆ドロップ ==========

  // ドラッグ状態の完全なクリーンアップ
  const cleanupDragState = useCallback(() => {
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
      dragOverTimeoutRef.current = null;
    }
    if (touchDragFrameRef.current.id !== null) {
      cancelAnimationFrame(touchDragFrameRef.current.id);
      touchDragFrameRef.current.id = null;
    }
    draggedClipRef.current = null;
    dragOffsetRef.current = 0;
    draggedSoundWidthRef.current = DEFAULT_CLIP_WIDTH;
    setDragPreview(null);
    clearTrackHighlights();
    removeFloatingDragLabels();
    unlockScrollAfterDrag();
  }, []);

  // ドラッグ中に指やカーソルがタイムラインの端に近づいたら、タイムラインを動かす
  const autoScrollTimeline = useCallback((clientX) => {
    const container = timelineContainerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    if (!(rect.width > 0)) return;
    const corner = container.querySelector('.ruler-corner');
    const headerWidth = corner ? corner.offsetWidth : 0;
    if (clientX > rect.right - AUTO_SCROLL_EDGE_PX) {
      container.scrollLeft += AUTO_SCROLL_STEP_PX;
    } else if (clientX < rect.left + headerWidth + AUTO_SCROLL_EDGE_PX && container.scrollLeft > 0) {
      container.scrollLeft = Math.max(0, container.scrollLeft - AUTO_SCROLL_STEP_PX);
    }
  }, []);

  // 配置予定位置（青い影）を表示する
  const showDragPreview = useCallback((trackElement, clientX, width, offset) => {
    if (!trackElement || !trackElement.dataset || !trackElement.dataset.trackId) {
      return;
    }
    const trackRect = trackElement.getBoundingClientRect();
    const left = Math.max(0, snapPosition(toPosition(clientX - trackRect.left - offset)));
    highlightTrack(trackElement);
    setDragPreview((prev) => {
      const next = {
        left,
        width: isFinite(width) && width > 0 ? width : DEFAULT_CLIP_WIDTH,
        trackId: trackElement.dataset.trackId
      };
      return prev && prev.left === next.left && prev.width === next.width && prev.trackId === next.trackId ? prev : next;
    });
  }, [snapPosition]);

  // ドラッグ開始時に音声の長さを計算しておく（ドロップ時・プレビュー表示に使う）
  const handleSoundDragStart = useCallback((sound) => (
    getClipWidth(sound).then((width) => {
      draggedSoundWidthRef.current = width;
      return width;
    })
  ), [getClipWidth]);

  const handleDrop = useCallback(async (e, trackId, timePosition) => {
    e.preventDefault();
    setDragPreview(null);
    clearTrackHighlights();
    if (isLockedRef.current) {
      cleanupDragState();
      return;
    }

    try {
      // 既存のクリップの移動
      const movingClip = draggedClipRef.current;
      if (movingClip) {
        moveClipToTrack(movingClip, trackId, timePosition - dragOffsetRef.current);
        cleanupDragState();
        return;
      }

      // 新しい音素材の配置（ドラッグで受け取るのは ID だけにして、データは手元のものを使う）
      const payload = e.dataTransfer ? e.dataTransfer.getData('text/plain') : '';
      if (payload && payload.startsWith(CLIP_DRAG_PREFIX)) {
        cleanupDragState();
        return;
      }
      const sound = payload && payload.startsWith(SOUND_DRAG_PREFIX)
        ? findSoundById(payload.slice(SOUND_DRAG_PREFIX.length))
        : null;
      cleanupDragState();

      if (!sound) {
        setError('音素材が見つかりません。再度お試しください。');
        return;
      }
      await placeSoundOnTrack(sound, trackId, timePosition);
    } catch (dropError) {
      console.error('ドロップエラー:', dropError);
      setError('音素材の配置に失敗しました。再度お試しください。');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleanupDragState, moveClipToTrack, placeSoundOnTrack]);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();

    // ドラッグされているのが既存クリップか新しい音素材かで処理を分ける
    const movingClip = draggedClipRef.current;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = movingClip ? 'move' : 'copy';
    }

    const clientX = e.clientX;
    autoScrollTimeline(clientX);

    // スロットリング - 16ms（60FPS）間隔で実行を制限
    if (dragOverTimeoutRef.current) {
      return;
    }

    const trackElement = e.currentTarget;
    dragOverTimeoutRef.current = setTimeout(() => {
      dragOverTimeoutRef.current = null;
      const clip = draggedClipRef.current;
      showDragPreview(
        trackElement,
        clientX,
        clip ? clip.duration : draggedSoundWidthRef.current,
        clip ? dragOffsetRef.current : 0
      );
    }, 16);
  }, [autoScrollTimeline, showDragPreview]);

  // トラックの外に出たら影を消す（以前は影が残り、そこに置けるように見えていた）
  const handleDragLeave = useCallback((e) => {
    const area = e.currentTarget;
    const next = e.relatedTarget;
    if (next && area.contains(next)) return;
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
      dragOverTimeoutRef.current = null;
    }
    setDragPreview(null);
    clearTrackHighlights();
  }, []);

  // クリップのドラッグ開始（マウス / iPad の長押しドラッグ）
  const handleClipDragStart = useCallback((clip, originalTrackId, mouseX, clipElement) => {
    const clipRect = clipElement.getBoundingClientRect();
    draggedClipRef.current = { ...clip, originalTrackId };
    dragOffsetRef.current = toPosition(mouseX - clipRect.left);
  }, []);

  // ドラッグ終了時のクリーンアップ。
  // 以前はタイムラインの外で離すとクリップを確認なしで削除していたが、目盛りの上などで
  // 手を離しただけで消えてしまうため、今は元の位置に戻すだけにしている（削除は選んでから「削除」で行う）。
  const handleDragEnd = useCallback(() => {
    cleanupDragState();
  }, [cleanupDragState]);

  // タッチ操作: 指がトラックの上を動いている。
  // touchmove ごとに描き直すと古い iPad でカクつくので、1 フレームに 1 回にまとめる。
  const handleTouchDragOver = useCallback((x, y, width, offset) => {
    const frame = touchDragFrameRef.current;
    frame.args = [x, y, width, offset];
    if (frame.id !== null) return;
    frame.id = requestAnimationFrame(() => {
      frame.id = null;
      const [px, py, pWidth, pOffset] = frame.args;
      autoScrollTimeline(px);
      const target = findTrackAtPoint(px, py);
      if (!target) {
        clearTrackHighlights();
        setDragPreview(null);
        return;
      }
      showDragPreview(target.element, px, pWidth === null ? draggedSoundWidthRef.current : pWidth, pOffset);
    });
  }, [autoScrollTimeline, showDragPreview]);

  // タッチ操作: 音素材をトラックの上で離した
  const handleTouchDropSound = useCallback((sound, x, y) => {
    const target = findTrackAtPoint(x, y);
    cleanupDragState();
    if (!target || isLockedRef.current) return;
    placeSoundOnTrack(sound, target.trackId, target.timePosition).catch((dropError) => {
      console.error('ドロップエラー:', dropError);
      setError('音素材の配置に失敗しました。再度お試しください。');
    });
  }, [cleanupDragState, placeSoundOnTrack]);

  // タッチ操作: クリップをトラックの上で離した
  const handleTouchMoveClip = useCallback((clip, x, y, offset) => {
    const target = findTrackAtPoint(x, y);
    cleanupDragState();
    if (!target || isLockedRef.current) return;
    moveClipToTrack(clip, target.trackId, target.timePosition - offset);
  }, [cleanupDragState, moveClipToTrack]);

  // どこでドラッグが終わっても表示を元に戻す
  useEffect(() => {
    const handleGlobalDragEnd = () => cleanupDragState();
    document.addEventListener('dragend', handleGlobalDragEnd);
    document.addEventListener('drop', handleGlobalDragEnd);
    return () => {
      document.removeEventListener('dragend', handleGlobalDragEnd);
      document.removeEventListener('drop', handleGlobalDragEnd);
      cleanupDragState();
    };
  }, [cleanupDragState]);

  // ========== 保存・読み込み ==========

  // プロジェクト保存機能（音素材ライブラリも含めたバックアップファイル）
  const saveProject = () => {
    if (!isDownloadSupported()) {
      setError('この端末のブラウザはファイルの保存に対応していません（iPad は iPadOS 13 以降が必要です）。');
      return;
    }
    try {
      const projectData = serializeCurrentProject({ includeSounds: 'all' }, { sounds: soundsRef.current });
      const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
      downloadBlob(blob, `music-project-${timestampForFileName()}.json`);
      notify('ファイルに保存しました（「ダウンロード」フォルダなどに入ります）');
    } catch (saveError) {
      console.error('プロジェクト保存エラー:', saveError);
      setError(saveError.code === 'DOWNLOAD_UNSUPPORTED'
        ? saveError.message
        : 'プロジェクトの保存に失敗しました。');
    }
  };

  // プロジェクト読み込み機能
  const loadProject = (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    // ファイル選択をリセット（同じファイルを選び直せるように）
    input.value = '';
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const projectData = JSON.parse(e.target.result);

        // バージョンチェック
        if (!projectData || !projectData.version) {
          throw new Error('不正なプロジェクトファイルです');
        }

        const project = deserializeProject(projectData);
        const hasWork = tracksRef.current.some((track) => track.clips.length > 0);
        if (hasWork && !window.confirm('プロジェクトファイルを読み込むと、今の作業内容は置き換わります（1つ前の作業内容としてバックアップされます）。よろしいですか？')) {
          return;
        }
        // 今の作業内容（読み込めなかった保存データも含む）をバックアップしてから置き換える
        try {
          if (!(await saveAllPendingChanges())) {
            setError('今の作業内容を保存できなかったため、読み込みを中止しました。「ファイル」→「ファイルに保存」で保存してから、もう一度お試しください。');
            return;
          }
          setHasBackup(await backupAndClearProjectAutoSave(readLegacyAutoSave()));
          legacyHandledRef.current = true;
        } catch (backupError) {
          console.error('作業内容のバックアップに失敗:', backupError);
          setError('保存されている作業内容を守るため、読み込みを中止しました。「もう一度読み込む」を押すか、ページを再読み込みしてください。');
          return;
        }
        haltPlayback(true);
        applyProject({ ...project, tracks: shareLibraryBlobs(project.tracks, soundsRef.current) });
        setIsProjectLoaded(true);
        setSaveStatus((status) => (status === 'disabled' ? 'idle' : status));
        setError(null);
        notify('ファイルを開きました');

        // 音素材をライブラリに保存（保存しないと再読み込みで消えてしまう）
        try {
          await addMissingSoundsToLibrary([...project.sounds, ...project.usedSounds], 'project-file');
        } catch (addError) {
          console.error('音素材の保存に失敗:', addError);
          if (isMountedRef.current) setError('プロジェクトは読み込みましたが、音素材をライブラリに保存できませんでした。');
        }
      } catch (loadError) {
        console.error('プロジェクト読み込みエラー:', loadError);
        setError('プロジェクトファイルの読み込みに失敗しました。ファイルが正しいか確認してください。');
      }
    };
    reader.onerror = () => {
      setError('プロジェクトファイルの読み込みに失敗しました。');
    };
    reader.readAsText(file);
  };

  // 先生に送る（クラウド保存）
  const openCloudSaveDialog = () => {
    // ローカルストレージから部屋番号と、前回入力した名前・班を取得
    let savedRoom = '';
    try {
      savedRoom = localStorage.getItem('sound-library-room') || '';
    } catch (storageError) {
      // 無視
    }
    const profile = getSavedStudentProfile();
    setError(null);
    setCloudSaveData((prev) => ({
      ...prev,
      roomNumber: savedRoom || prev.roomNumber || '',
      studentName: prev.studentName || profile.studentName,
      groupNumber: prev.groupNumber || profile.groupNumber,
      songTitle: prev.songTitle || `曲_${new Date().toLocaleDateString('ja-JP')}`
    }));
    setShowCloudSaveDialog(true);
  };

  const saveToCloud = async () => {
    if (isCloudSaving) return;
    if (!cloudSaveData.songTitle.trim()) {
      setError('曲のタイトルを入力してください');
      return;
    }
    const roomNumber = normalizeRoomNumberInput(cloudSaveData.roomNumber);
    if (!roomNumber) {
      setError('部屋番号を入力してください');
      return;
    }

    setIsCloudSaving(true);
    setError(null);
    try {
      // 部屋番号で部屋を探す（以前は部屋の一覧を丸ごと読み込んでいた。一覧は先生だけが見られる）
      const roomsData = await fetchJson(`${API_BASE_URL}/rooms.php?${new URLSearchParams({ room_number: roomNumber })}`);
      if (!roomsData.success) {
        setError(roomsData.error || '部屋情報の取得に失敗しました');
        return;
      }

      const targetRoom = findRoomByNumber(roomsData.data, roomNumber);
      if (!targetRoom) {
        setError(`部屋 ${roomNumber} が見つかりません。先生に部屋番号を確かめてください。`);
        return;
      }

      // 使っている音だけを 1 回ずつ送る（以前は音素材ライブラリ全部＋クリップごとの重複を送っていて、
      // サーバーの上限を超えて保存に失敗することがあった）
      const projectData = serializeCurrentProject({ includeSounds: 'used' });

      const result = await fetchJson(`${API_BASE_URL}/songs.php`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          room_id: targetRoom.id,
          // サーバーは部屋の ID と部屋番号の両方を確かめる
          room_number: roomNumber,
          student_name: cloudSaveData.studentName.trim(),
          group_number: cloudSaveData.groupNumber.trim(),
          song_title: cloudSaveData.songTitle.trim(),
          song_data: projectData
        })
      });

      if (result.success) {
        try {
          localStorage.setItem('sound-library-room', roomNumber);
        } catch (storageError) {
          // 無視
        }
        saveStudentProfile({ studentName: cloudSaveData.studentName, groupNumber: cloudSaveData.groupNumber });
        setShowCloudSaveDialog(false);
        setCloudSaveData((prev) => ({ ...prev, songTitle: '' }));
        notify(`「${cloudSaveData.songTitle.trim()}」を先生に送りました！`);
      } else {
        setError(result.error || '先生に送れませんでした');
      }
    } catch (cloudError) {
      console.error('クラウド保存エラー:', cloudError);
      setError(cloudError.message || '先生に送れませんでした');
    } finally {
      if (isMountedRef.current) setIsCloudSaving(false);
    }
  };

  // 音源出力機能（WAV）
  const exportAudio = async () => {
    if (!isDownloadSupported()) {
      // 重い合成処理をしてから保存できないと分かるのを避ける
      setError('この端末のブラウザはファイルの保存に対応していません（iPad は iPadOS 13 以降が必要です）。');
      return;
    }
    const ctx = audioContextRef.current;
    if (!ctx) {
      setError('AudioContextが初期化されていません。');
      return;
    }

    // ミュートしたトラックの音は書き出さない
    const clips = tracks.filter((track) => !track.muted).flatMap((track) => track.clips)
      .filter((clip) => isPlayableSound(clip.soundData));
    if (clips.length === 0) {
      setError('出力する音声がありません。音素材を配置してください。');
      return;
    }

    setIsExporting(true);
    try {
      const pps = pixelsPerSecond;
      const sampleRate = ctx.sampleRate;
      const decoded = await Promise.all(clips.map((clip) =>
        getAudioBuffer(clip.soundData).then(
          (buffer) => ({ clip, buffer }),
          () => ({ clip, buffer: null })
        )
      ));

      const endSeconds = decoded.reduce((max, { clip, buffer }) => (
        buffer ? Math.max(max, clip.startTime / pps + buffer.duration) : max
      ), 0);
      if (endSeconds <= 0) {
        throw new Error('デコードできる音声がありません');
      }

      const length = Math.ceil(endSeconds * sampleRate);
      const left = new Float32Array(length);
      const right = new Float32Array(length);
      decoded.forEach(({ clip, buffer }) => {
        if (!buffer) return;
        const offset = Math.max(0, Math.floor((clip.startTime / pps) * sampleRate));
        const sourceLeft = buffer.getChannelData(0);
        // モノラル音源は両チャンネルに同じ音を入れる
        const sourceRight = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
        const count = Math.min(sourceLeft.length, length - offset);
        for (let i = 0; i < count; i++) {
          left[offset + i] += sourceLeft[i];
          right[offset + i] += sourceRight[i];
        }
      });

      downloadBlob(encodeWav([left, right], sampleRate), `exported-music-${timestampForFileName()}.wav`);
      notify('WAV ファイルに書き出しました');
    } catch (exportError) {
      console.error('音源出力エラー:', exportError);
      setError(exportError.code === 'DOWNLOAD_UNSUPPORTED'
        ? exportError.message
        : '音源の出力に失敗しました。');
    } finally {
      if (isMountedRef.current) setIsExporting(false);
    }
  };

  // プロジェクトをリセット（自動保存データは 1 つ前の作業内容としてバックアップに移す）
  const resetProject = async () => {
    haltPlayback(true);
    try {
      // 旧形式（localStorage）にしか作業内容が無い場合は、それをバックアップする
      setHasBackup(await backupAndClearProjectAutoSave(readLegacyAutoSave()));
      legacyHandledRef.current = true;
    } catch (resetError) {
      console.error('自動保存データのクリアに失敗:', resetError);
      if (!isProjectLoadedRef.current) {
        // 読み込めなかった作業内容を、バックアップもできないまま消してしまわない
        setError('保存されている作業内容を守るため、リセットを中止しました。「もう一度読み込む」を押すか、ページを再読み込みしてください。');
        return;
      }
    }
    removeLegacyAutoSave();

    // 初期状態にリセット（テンポなどの設定は残す）
    const initialTracks = createInitialTracks();
    setTracks(initialTracks);
    tracksRef.current = initialTracks;
    setPixelsPerSecond(DEFAULT_PIXELS_PER_SECOND);
    pixelsPerSecondRef.current = DEFAULT_PIXELS_PER_SECOND;
    trackNameCounterRef.current = 1;
    trackIdCounterRef.current = 1;
    setSelectedClipId(null);
    setSelectedTrackId(null);
    clearHistory();
    setError(null);
    setSaveStatus('idle');
    setIsProjectLoaded(true);
    notify('新しい曲を作り始めます（前の作業内容は「1つ前の作業に戻す」で戻せます）');
  };

  // 1 つ前の作業に戻す（リセットや先生の楽曲で置き換える前の作業内容）。もう一度押すと戻せる。
  const restorePreviousWork = async () => {
    if (!window.confirm('1つ前の作業内容に戻します。\n\n今の作業内容は入れ替わりで保存されるので、もう一度押すと元に戻せます。よろしいですか？')) {
      return;
    }
    haltPlayback(false);
    // 入れ替えている間の編集は保存されずに消えてしまうので、操作できないようにする
    setIsRestoring(true);
    try {
      // 今の画面の内容を保存してから入れ替える（保存できなければ、古い版をバックアップしないよう中止）
      if (!(await saveAllPendingChanges())) {
        setError('今の作業内容を保存できなかったため、1つ前の作業に戻すのを中止しました。');
        return;
      }
      const restored = await swapProjectAutoSaveWithBackup();
      if (!isMountedRef.current) return;
      if (!restored) {
        setHasBackup(false);
        setError('戻せる作業内容がありません。');
        return;
      }
      lastKnownTimestampRef.current = restored.timestamp || 0;
      // 戻した内容はもう一度保存しておく（入れ替えの最中に予約されていた保存があっても、最後に書かれるように）
      const project = deserializeProject(restored);
      applyProject({ ...project, tracks: shareLibraryBlobs(project.tracks, soundsRef.current) });
      setError(null);
      notify('1つ前の作業内容に戻しました');
    } catch (restoreError) {
      console.error('1つ前の作業内容に戻せませんでした:', restoreError);
      if (isMountedRef.current) setError('1つ前の作業内容に戻せませんでした。');
    } finally {
      if (isMountedRef.current) setIsRestoring(false);
    }
  };

  const confirmReset = () => {
    if (window.confirm('新しい曲を作りますか？（リセット）\n\n今の作業内容は消えます（1つ前の作業内容としてバックアップされ、「1つ前の作業に戻す」で戻せます）。')) {
      resetProject();
    }
  };

  const saveStatusView = {
    pending: { icon: Save, text: '保存待ち...' },
    saving: { icon: LoaderCircle, text: '保存中...', className: 'icon-spin' },
    saved: { icon: CircleCheck, text: '保存済み' },
    error: { icon: TriangleAlert, text: '自動保存に失敗' },
    disabled: { icon: TriangleAlert, text: '自動保存停止中' }
  }[saveStatus];

  const fileMenuItems = [
    {
      id: 'daw-file-save',
      icon: Save,
      label: 'ファイルに保存',
      description: '音素材も入れて、この端末にファイルとして保存します',
      onSelect: saveProject
    },
    {
      id: 'daw-file-open',
      icon: FolderOpen,
      label: 'ファイルを開く',
      description: '保存したファイル（.json）から続きを作ります',
      onSelect: () => {
        if (projectFileInputRef.current) projectFileInputRef.current.click();
      }
    },
    {
      id: 'daw-file-export',
      icon: Headphones,
      label: isExporting ? '書き出し中...' : 'WAV ファイルに書き出す',
      description: 'できた音楽を、ほかのアプリでも聞ける音声ファイルにします',
      disabled: isExporting,
      onSelect: exportAudio
    },
    {
      id: 'daw-file-reset',
      icon: RotateCcw,
      label: '新しく作る（リセット）',
      description: '今の作業内容は 1 つ前の作業として残ります',
      danger: true,
      onSelect: confirmReset
    },
    hasBackup && isProjectLoaded ? {
      id: 'daw-file-restore',
      icon: History,
      label: '1つ前の作業に戻す',
      description: 'リセットやファイルを開く前の作業内容と入れ替えます',
      onSelect: restorePreviousWork
    } : null
  ];

  const selected = useMemo(() => {
    if (selectedClipId === null) return null;
    for (let index = 0; index < tracks.length; index++) {
      const clip = tracks[index].clips.find((item) => sameId(item.id, selectedClipId));
      if (clip) return { clip, track: tracks[index], index };
    }
    return null;
  }, [tracks, selectedClipId]);

  const locked = isInitialLoading || isRestoring || saveStatus === 'disabled';
  const position = describePosition(currentTime, timing);
  const totalBeats = Math.round(laneWidth / beatPx);
  const currentBeatIndex = Math.max(0, Math.floor(currentTime / beatPx + 1e-6));
  const rulerProps = useMemo(() => ({
    onSeek: seekTo,
    onKeyDown: handleRulerKeyDown,
    valueNow: currentBeatIndex,
    valueMax: totalBeats,
    valueText: `${position.measure}小節 ${position.beat}拍`
  }), [seekTo, handleRulerKeyDown, currentBeatIndex, totalBeats, position.measure, position.beat]);
  const zoomIndex = ZOOM_LEVELS.indexOf(pixelsPerSecond);

  return (
    <div className="daw-page">
      <h2 className="sr-only">音楽づくりページ</h2>

      {error && (
        <div className="error-message daw-error" role="alert">
          <span>{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="メッセージを閉じる"><Icon icon={X} /></button>
        </div>
      )}

      {/* 読み込み中に置いたクリップは読み込み完了時に上書きされて消えてしまうので、操作できないようにする */}
      <div
        className={`daw-controls ${isInitialLoading || isRestoring ? 'is-loading' : ''}`}
        aria-busy={isInitialLoading || isRestoring}
        {...(isInitialLoading || isRestoring ? { inert: '' } : {})}
      >
        <DawToolbar
          isPlaying={isPlaying}
          isPreparing={isPreparing}
          onPlay={play}
          onPause={pause}
          onStop={stop}
          positionRef={positionTextRef}
          secondsRef={secondsTextRef}
          canUndo={historyState.canUndo && !locked}
          canRedo={historyState.canRedo && !locked}
          onUndo={undo}
          onRedo={redo}
          bpm={bpm}
          onTempoStep={(direction) => changeTempo(bpm + direction * BPM_STEP)}
          beatsPerMeasure={beatsPerMeasure}
          onBeatsPerMeasureChange={changeBeatsPerMeasure}
          snapMode={snapMode}
          onSnapModeChange={changeSnapMode}
          metronome={metronome}
          onToggleMetronome={toggleMetronome}
        />

        <div className="daw-subbar">
          <button
            type="button"
            className="button-secondary daw-toolbar-button daw-panel-toggle"
            onClick={() => setShowSoundPanel(!showSoundPanel)}
            aria-expanded={showSoundPanel}
            title={showSoundPanel ? '音素材を隠す' : '音素材を表示'}
          >
            <Icon icon={showSoundPanel ? PanelLeftClose : PanelLeftOpen} />
            <span className="daw-button-label">{showSoundPanel ? '音素材を隠す' : '音素材を表示'}</span>
          </button>

          {selected ? (
            <div className="daw-selection" role="group" aria-label={`選んでいる音: ${selected.clip.soundData.name}`}>
              <span className="daw-selection-name">
                <strong>{selected.clip.soundData.name}</strong>
                <span>トラック {selected.index + 1}・{formatPosition(selected.clip.startTime, timing)}</span>
              </span>
              <button
                type="button"
                className="button-secondary daw-toolbar-button"
                onClick={() => playPreview(selected.clip.soundData)}
                aria-label={`${selected.clip.soundData.name}をきく`}
              >
                <Icon icon={Play} /> <span className="daw-button-label">きく</span>
              </button>
              <button
                type="button"
                className="button-secondary daw-toolbar-button"
                onClick={() => duplicateClip(selected.clip.id)}
                aria-label={`${selected.clip.soundData.name}を複製`}
                title="すぐ後ろに同じ音を置く"
              >
                <Icon icon={Copy} /> <span className="daw-button-label">複製</span>
              </button>
              <button
                type="button"
                className="button-danger daw-toolbar-button"
                onClick={() => removeClip(selected.track.id, selected.clip.id)}
                aria-label={`${selected.clip.soundData.name}を削除`}
              >
                <Icon icon={Trash2} /> <span className="daw-button-label">削除</span>
              </button>
              <button
                type="button"
                className="button-ghost daw-toolbar-button"
                onClick={() => setSelectedClipId(null)}
                aria-label="選ぶのをやめる"
              >
                <Icon icon={X} />
              </button>
            </div>
          ) : (
            <p className="daw-hint">置いた音をタップすると、きく・複製・削除ができます</p>
          )}

          <div className="daw-subbar-end">
            {saveStatusView && (
              <span className={`autosave-status autosave-status-${saveStatus}`}>
                <Icon icon={saveStatusView.icon} className={saveStatusView.className} /> {saveStatusView.text}
              </span>
            )}
            {saveStatus === 'disabled' && (
              <button type="button" className="button-secondary retry-load-btn daw-toolbar-button" onClick={retryInitialLoad}>
                <Icon icon={RotateCcw} /> もう一度読み込む
              </button>
            )}
            <button type="button" className="button-primary daw-toolbar-button" onClick={openCloudSaveDialog}>
              <Icon icon={Send} /> <span className="daw-button-label">先生に送る</span>
            </button>
            <FileMenu items={fileMenuItems} />
            <button
              type="button"
              className="button-ghost daw-toolbar-button daw-help-button"
              onClick={() => setShowHelp(true)}
              aria-label="使い方"
              title="使い方"
            >
              <Icon icon={CircleHelp} size={24} />
            </button>
          </div>
        </div>
      </div>

      {/* 読み込み中と、読み込みに失敗して自動保存が止まっている間は、保存されない編集をさせない */}
      <div
        className={`daw-main-area ${locked ? 'is-loading' : ''} ${showSoundPanel ? '' : 'panel-hidden'}`}
        aria-busy={isInitialLoading || isRestoring}
        {...(locked ? { inert: '' } : {})}
      >
        <SoundPalette
          isOpen={showSoundPanel}
          onClose={() => setShowSoundPanel(false)}
          hasSounds={sounds.length > 0}
          sounds={filteredSounds}
          allTags={allTags}
          selectedTag={selectedTag}
          onSelectTag={setSelectedTag}
          durations={durationsForPalette}
          placeTargetLabel={targetTrackLabel}
          onDragStart={handleSoundDragStart}
          onPreview={playPreview}
          onStopPreview={stopPreview}
          onTouchDragOver={handleTouchDragOver}
          onTouchDrop={handleTouchDropSound}
          onTouchCancel={cleanupDragState}
          onPlace={placeSoundAtPlayhead}
        />

        <section className="daw-workspace" aria-label="タイムライン">
          {isInitialLoading && (
            <div className="daw-loading" role="status">前回の作業内容を読み込んでいます...</div>
          )}
          <TimelineView
            tracks={tracks}
            laneWidth={laneWidth}
            measureCount={measureCount}
            timing={timing}
            beatPx={beatPx}
            measurePx={measurePx}
            selectedClipId={selectedClipId}
            selectedTrackId={targetTrack ? targetTrack.id : null}
            dragPreview={dragPreview}
            currentTime={currentTime}
            isPlaying={isPlaying}
            hasClips={hasClips}
            playheadRef={playheadRef}
            rulerMarkerRef={rulerMarkerRef}
            timelineContainerRef={timelineContainerRef}
            timelineRef={timelineRef}
            rulerProps={rulerProps}
            zoom={{
              percent: Math.round(pixelsPerSecond / DEFAULT_PIXELS_PER_SECOND * 100),
              onZoom: handleZoom,
              canZoomIn: zoomIndex !== ZOOM_LEVELS.length - 1,
              canZoomOut: zoomIndex !== 0
            }}
            loadBuffer={getAudioBuffer}
            onAddTrack={addTrack}
            onSelectTrack={selectTrack}
            onToggleMute={toggleMute}
            onRemoveTrack={removeTrack}
            onSelectClip={selectClip}
            onClipKeyDown={stableClipKeyDown}
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClipDragStart={handleClipDragStart}
            onDragEnd={handleDragEnd}
            onTouchDragOver={handleTouchDragOver}
            onTouchMoveClip={handleTouchMoveClip}
            onTouchCancel={cleanupDragState}
          />
        </section>
      </div>

      {/* 「ファイル」→「ファイルを開く」で使う（見えないが、iPad でも押せるよう display: none にはしない） */}
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".json,application/json"
        onChange={loadProject}
        className="daw-file-input"
        tabIndex={-1}
        aria-hidden="true"
      />

      <div className={`daw-toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">
        {toast && <><Icon icon={CircleCheck} /> {toast}</>}
      </div>

      {showCloudSaveDialog && (
        <CloudSaveDialog
          values={cloudSaveData}
          onChange={setCloudSaveData}
          onSubmit={saveToCloud}
          onClose={() => {
            if (!isCloudSaving) setShowCloudSaveDialog(false);
          }}
          isSaving={isCloudSaving}
          error={error}
        />
      )}

      {showHelp && <HelpDialog onClose={() => setShowHelp(false)} />}
    </div>
  );
};

export default DAWPage;
