import React, { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from 'react';
import './DAWPage.css';
import {
  addRecordings,
  deleteProjectAutoSave,
  deleteSongData,
  getAllRecordings,
  getProjectAutoSave,
  getSongData,
  isQuotaExceededError,
  saveProjectAutoSave
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
  unlockAudioContext
} from '../utils/audio';
import {
  DEFAULT_CLIP_WIDTH,
  DEFAULT_PIXELS_PER_SECOND,
  deserializeProject,
  findNonOverlappingPosition,
  getNextZoomLevel,
  rescaleTracks,
  serializeProject
} from '../utils/project';
import { fetchJson, findRoomByNumber } from '../utils/api';
import {
  clearTrackHighlights,
  createFloatingDragLabel,
  findTrackAtPoint,
  highlightTrack,
  lockScrollForDrag,
  removeFloatingDragLabels,
  unlockScrollAfterDrag,
  useTouchDrag
} from '../hooks/useTouchDrag';

// DAWの定数（時間ベースのタイムライン）
const TIME_MODE_TOTAL_SECONDS = 90; // 表示する総秒数
const AUTOSAVE_DELAY_MS = 500; // 操作が落ち着いてから保存する
const LEGACY_AUTOSAVE_KEY = 'dawProjectAutoSave'; // 旧バージョンの自動保存（localStorage）
const SOUND_DRAG_PREFIX = 'sound-id:';
const CLIP_DRAG_PREFIX = 'existing-clip-';

const createInitialTracks = () => [{
  id: Date.now(),
  name: 'トラック 1',
  clips: []
}];

const sameId = (a, b) => String(a) === String(b);

const isPlayableSound = (sound) =>
  !!(sound && sound.audioBlob instanceof Blob && sound.audioBlob.size > 0);

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
  const [saveStatus, setSaveStatus] = useState('idle'); // idle | pending | saving | saved | error
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0); // 停止中のプレイヘッド位置（ピクセル）
  const [trackHeight] = useState(80);
  const [error, setError] = useState(null);
  const [sounds, setSounds] = useState([]);
  const [selectedTag, setSelectedTag] = useState(''); // 選択されたタグ
  const [instructionsExpanded, setInstructionsExpanded] = useState(false); // 使い方の折りたたみ状態
  const [showSoundPanel, setShowSoundPanel] = useState(true);
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND);
  const [dragPreview, setDragPreview] = useState(null);
  const [isExporting, setIsExporting] = useState(false); // 音源出力中フラグ
  const [isCloudSaving, setIsCloudSaving] = useState(false);

  // クラウド保存用のstate
  const [showCloudSaveDialog, setShowCloudSaveDialog] = useState(false);
  const [cloudSaveData, setCloudSaveData] = useState({
    songTitle: '',
    studentName: '',
    groupNumber: '',
    roomNumber: ''
  });

  const timelineRef = useRef(null);
  const trackHeadersRef = useRef(null);
  const timelineContainerRef = useRef(null);
  const playheadRef = useRef(null);
  const animationFrameRef = useRef(null);
  const dragOverTimeoutRef = useRef(null);
  const isScrollingSyncRef = useRef(false); // スクロール同期中フラグ
  const isMountedRef = useRef(true);

  // 音声再生
  const audioContextRef = useRef(null);
  const audioBufferCacheRef = useRef(new WeakMap()); // Blob → Promise<AudioBuffer>
  const activeSourcesRef = useRef(new Set());
  const playbackRef = useRef(null); // { startAt, offsetSec, endSec }
  const playbackSessionRef = useRef(0);
  const previewRef = useRef(null); // { source, onEnded }

  // ドラッグ（イベントの間で最新の値を共有するため state ではなく ref で持つ）
  const draggedClipRef = useRef(null);
  const dragOffsetRef = useRef(0);
  const draggedSoundWidthRef = useRef(DEFAULT_CLIP_WIDTH);

  // 自動保存
  const autoSaveRef = useRef({ saving: false, dirty: false, pending: false });

  // イベントハンドラや非同期処理から最新の値を読むための ref
  const tracksRef = useRef(tracks);
  const soundsRef = useRef(sounds);
  const pixelsPerSecondRef = useRef(pixelsPerSecond);
  const currentTimeRef = useRef(currentTime);
  const isPlayingRef = useRef(isPlaying);
  const isProjectLoadedRef = useRef(isProjectLoaded);
  tracksRef.current = tracks;
  soundsRef.current = sounds;
  pixelsPerSecondRef.current = pixelsPerSecond;
  isPlayingRef.current = isPlaying;
  isProjectLoadedRef.current = isProjectLoaded;
  if (!isPlaying) currentTimeRef.current = currentTime;

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

  // 音素材の長さ（ピクセル）
  const getClipWidth = useCallback(async (soundData) => {
    try {
      const buffer = await getAudioBuffer(soundData);
      if (buffer && isFinite(buffer.duration) && buffer.duration > 0) {
        return buffer.duration * pixelsPerSecondRef.current;
      }
    } catch (error) {
      console.warn('音声の長さを取得できませんでした:', soundData && soundData.name, error);
    }
    return DEFAULT_CLIP_WIDTH;
  }, [getAudioBuffer]);

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

  // 再生を止める（resetPosition: 先頭に戻すかどうか）
  const haltPlayback = (resetPosition) => {
    const positionSeconds = getPlaybackPositionSeconds();
    playbackSessionRef.current += 1; // 準備中の再生があれば取り消す
    stopAllSources();
    cancelPlayheadAnimation();
    playbackRef.current = null;
    const position = resetPosition ? 0 : positionSeconds * pixelsPerSecondRef.current;
    currentTimeRef.current = position;
    isPlayingRef.current = false;
    setCurrentTime(position);
    setIsPlaying(false);
    if (!previewRef.current) disableSilentModePlayback();
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
      animationFrameRef.current = requestAnimationFrame(tick);
    };
    animationFrameRef.current = requestAnimationFrame(tick);
  };

  const play = () => {
    const ctx = audioContextRef.current;
    if (!ctx) {
      setError('このブラウザでは音声を再生できません。');
      return;
    }

    // ここまで await を挟まないこと。iOS はタップの処理中でないと音を出す許可をくれない。
    enableSilentModePlayback();
    const resumePromise = unlockAudioContext(ctx);
    stopPreview();
    stopAllSources();

    const session = playbackSessionRef.current + 1;
    playbackSessionRef.current = session;
    const pps = pixelsPerSecondRef.current;
    const offsetSec = Math.max(0, currentTimeRef.current / pps);
    const allClips = tracksRef.current.flatMap((track) => track.clips);
    const lastClipEndSec = allClips.reduce(
      (max, clip) => Math.max(max, (clip.startTime + clip.duration) / pps),
      0
    );
    const endSec = lastClipEndSec > offsetSec ? lastClipEndSec : TIME_MODE_TOTAL_SECONDS;
    const clipsToPlay = allClips.filter((clip) =>
      isFinite(clip.startTime) && isFinite(clip.duration) && clip.duration > 0 &&
      (clip.startTime + clip.duration) / pps > offsetSec
    );

    setError(null);
    isPlayingRef.current = true;
    setIsPlaying(true);

    const decodeJobs = clipsToPlay.map((clip) =>
      getAudioBuffer(clip.soundData).then(
        (buffer) => ({ clip, buffer }),
        (decodeError) => {
          console.error('クリップの音声を読み込めませんでした:', clip.soundData && clip.soundData.name, decodeError);
          return { clip, buffer: null };
        }
      )
    );

    Promise.all([resumePromise, Promise.all(decodeJobs)])
      .then(([, results]) => {
        if (session !== playbackSessionRef.current || !isMountedRef.current) return;

        if (ctx.state && ctx.state !== 'running') {
          setError('音を再生できませんでした。もう一度 ▶️ を押してください。');
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

        playbackRef.current = { startAt, offsetSec, endSec };
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

  const pause = () => haltPlayback(false);
  const stop = () => haltPlayback(true);

  // effect の中から最新の haltPlayback を呼ぶため
  const haltPlaybackRef = useRef(haltPlayback);
  haltPlaybackRef.current = haltPlayback;

  // 音素材パネルの ▶️（試聴）
  const playPreview = useCallback((sound, onEnded) => {
    const ctx = audioContextRef.current;
    if (!ctx || !isPlayableSound(sound)) {
      if (onEnded) onEnded();
      return;
    }
    enableSilentModePlayback();
    const resumePromise = unlockAudioContext(ctx);
    stopPreview();

    const preview = { source: null, onEnded };
    previewRef.current = preview;

    Promise.all([resumePromise, getAudioBuffer(sound)])
      .then(([, buffer]) => {
        if (previewRef.current !== preview) return;
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
  }, [getAudioBuffer, stopPreview]);

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

    candidates.forEach((sound) => {
      if (!sound || !sound.audioData || knownAudio.has(sound.audioData)) return;
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

  // ========== プロジェクトの読み込みと自動保存 ==========

  const applyProject = useCallback((project) => {
    const restoredTracks = project.tracks.length > 0 ? project.tracks : createInitialTracks();
    setPixelsPerSecond(project.pixelsPerSecond);
    setTracks(restoredTracks);
    tracksRef.current = restoredTracks;
    pixelsPerSecondRef.current = project.pixelsPerSecond;
    trackNameCounterRef.current = project.trackNameCounter || Math.max(1, restoredTracks.length);
    trackIdCounterRef.current = project.trackIdCounter || 1;
    currentTimeRef.current = 0;
    setCurrentTime(0);
  }, []);

  // インポート楽曲と自動保存データの読み込み
  useEffect(() => {
    let cancelled = false;

    const loadInitialData = async () => {
      let librarySounds = [];
      try {
        librarySounds = hydrateSounds(await getAllRecordings());
      } catch (loadError) {
        console.error('音素材の読み込みに失敗:', loadError);
        if (!cancelled) setError('音素材を読み込めませんでした。ページを再読み込みしてください。');
      }
      if (cancelled) return;
      soundsRef.current = librarySounds;
      setSounds(librarySounds);

      let loadSucceeded = false;
      try {
        // まず先生ページから渡された楽曲をチェック
        const songData = await getSongData();
        if (cancelled) return;

        if (songData) {
          const project = deserializeProject(songData);
          applyProject(project);
          let addedCount = 0;
          try {
            // 使われている音素材を音ライブラリーに追加
            addedCount = await addMissingSoundsToLibrary(project.usedSounds, 'cloud-import', librarySounds);
          } catch (addError) {
            console.error('音素材の保存に失敗:', addError);
          }
          try {
            // 読み込み済みの楽曲は消しておく（消せなくても次回もう一度読み込まれるだけ）
            await deleteSongData();
          } catch (deleteError) {
            console.warn('インポート済み楽曲の削除に失敗:', deleteError);
          }
          if (cancelled) return;
          loadSucceeded = true;
          alert(`先生が指定した楽曲を読み込みました!\n使用されている${addedCount}個の音素材を音ライブラリーに追加しました。`);
        } else {
          // インポート楽曲がない場合は自動保存データを読み込む
          const autoSaved = await getProjectAutoSave();
          if (cancelled) return;
          if (autoSaved) {
            applyProject(deserializeProject(autoSaved));
          } else {
            // 旧バージョン（localStorage）の自動保存からの移行
            const legacy = readLegacyAutoSave();
            if (legacy && Array.isArray(legacy.tracks)) {
              const byName = new Map(librarySounds.map((sound) => [sound.name, sound]));
              applyProject(deserializeProject(legacy, { findSoundByName: (name) => byName.get(name) }));
            }
          }
          loadSucceeded = true;
        }
      } catch (loadError) {
        console.error('プロジェクトデータの読み込みに失敗:', loadError);
        if (!cancelled) {
          // 読めなかったデータを空の状態で上書きしないよう、自動保存は止めたままにする
          setError('前回の作業内容を読み込めませんでした。ページを再読み込みしてください。（このままでは自動保存されません。やり直す場合は「リセット」を押してください）');
        }
      }

      if (cancelled) return;
      setIsInitialLoading(false);
      if (loadSucceeded) setIsProjectLoaded(true);
    };

    loadInitialData();
    return () => {
      cancelled = true;
    };
  }, [addMissingSoundsToLibrary, applyProject]);

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

    const data = serializeProject({
      tracks: tracksRef.current,
      pixelsPerSecond: pixelsPerSecondRef.current,
      trackNameCounter: trackNameCounterRef.current,
      trackIdCounter: trackIdCounterRef.current
    }, { includeSounds: 'used' });

    state.promise = saveProjectAutoSave(data)
      .then(() => {
        removeLegacyAutoSave();
        if (isMountedRef.current) setSaveStatus('saved');
      })
      .catch((saveError) => {
        console.error('プロジェクトの自動保存に失敗:', saveError);
        if (isMountedRef.current) {
          setSaveStatus('error');
          setError(isQuotaExceededError(saveError)
            ? '保存できる容量が足りないため、自動保存できませんでした。音ライブラリで使わない音を削除するか、「プロジェクト保存」でファイルに保存してください。'
            : '自動保存に失敗しました。「プロジェクト保存」でファイルに保存しておくと安心です。');
        }
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

  // タイムラインデータの自動保存（変更が落ち着いてから保存）
  useEffect(() => {
    if (!isProjectLoaded) return undefined;
    autoSaveRef.current.pending = true;
    setSaveStatus((status) => (status === 'saving' ? status : 'pending'));
    const timer = setTimeout(() => {
      flushAutoSave();
    }, AUTOSAVE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [tracks, pixelsPerSecond, isProjectLoaded, flushAutoSave]);

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
        // 他のタブで録音した音を反映する
        refreshSounds();
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

  // ========== スクロール ==========

  // トラックヘッダーとタイムラインコンテナのスクロール同期
  useEffect(() => {
    const trackHeaders = trackHeadersRef.current;
    const timelineContainer = timelineContainerRef.current;

    if (!trackHeaders || !timelineContainer) {
      return undefined;
    }

    const syncScroll = (from, to) => () => {
      if (isScrollingSyncRef.current) {
        return;
      }
      isScrollingSyncRef.current = true;
      to.scrollTop = from.scrollTop;
      // 次のフレームでフラグをリセット
      requestAnimationFrame(() => {
        isScrollingSyncRef.current = false;
      });
    };

    const handleTrackHeadersScroll = syncScroll(trackHeaders, timelineContainer);
    const handleTimelineContainerScroll = syncScroll(timelineContainer, trackHeaders);
    trackHeaders.addEventListener('scroll', handleTrackHeadersScroll);
    timelineContainer.addEventListener('scroll', handleTimelineContainerScroll);

    return () => {
      trackHeaders.removeEventListener('scroll', handleTrackHeadersScroll);
      timelineContainer.removeEventListener('scroll', handleTimelineContainerScroll);
    };
  }, []);

  // ========== 編集 ==========

  // スナップ処理（0.1秒単位でスナップ）
  const snapPosition = useCallback((position) => {
    const interval = pixelsPerSecondRef.current * 0.1;
    return interval > 0 ? Math.round(position / interval) * interval : position;
  }, []);

  // ズームイン/ズームアウト機能
  const handleZoom = (zoomIn) => {
    const current = pixelsPerSecondRef.current;
    const next = getNextZoomLevel(current, zoomIn);
    if (next === current) return;
    const ratio = next / current;

    pixelsPerSecondRef.current = next;
    setPixelsPerSecond(next);
    // クリップは秒ではなくピクセルで位置を持っているので、同じ比率で伸縮させる
    setTracks((prev) => rescaleTracks(prev, ratio));
    if (!isPlayingRef.current) {
      currentTimeRef.current *= ratio;
      setCurrentTime((time) => time * ratio);
    }
  };

  // 新しい音素材をトラックに置く
  const placeSoundOnTrack = useCallback(async (sound, trackId, timePosition) => {
    const width = await getClipWidth(sound);
    if (!isMountedRef.current) return;
    setTracks((prev) => prev.map((track) => {
      if (!sameId(track.id, trackId)) return track;
      const snapped = Math.max(0, snapPosition(timePosition));
      const startTime = findNonOverlappingPosition(track.clips, snapped, width, null, snapPosition);
      return {
        ...track,
        clips: [...track.clips, {
          id: Date.now() + Math.random(), // より確実にユニークなIDを生成
          soundData: sound,
          startTime,
          duration: width,
          trackId: track.id
        }]
      };
    }));
  }, [getClipWidth, snapPosition]);

  // 配置済みのクリップを移動する（別のトラックへの移動も含む）
  const moveClipToTrack = useCallback((clip, targetTrackId, rawStartTime) => {
    setTracks((prev) => {
      const target = prev.find((track) => sameId(track.id, targetTrackId));
      if (!target) return prev;
      const snapped = Math.max(0, snapPosition(rawStartTime));
      const startTime = findNonOverlappingPosition(target.clips, snapped, clip.duration, clip.id, snapPosition);
      const { originalTrackId, ...clipData } = clip;
      const moved = { ...clipData, startTime, trackId: target.id };
      return prev.map((track) => {
        const remaining = track.clips.filter((c) => c.id !== clip.id);
        if (track.id === target.id) return { ...track, clips: [...remaining, moved] };
        return remaining.length !== track.clips.length ? { ...track, clips: remaining } : track;
      });
    });
  }, [snapPosition]);

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
    setTracks((prevTracks) => [...prevTracks, newTrack]);
  };

  const removeTrack = (trackId) => {
    const track = tracksRef.current.find((t) => t.id === trackId);
    if (!track || tracksRef.current.length <= 1) return;
    if (track.clips.length > 0 && !window.confirm('このトラックには音が置かれています。トラックごと削除しますか？')) {
      return;
    }
    setTracks((prevTracks) => (
      prevTracks.length > 1 ? prevTracks.filter((t) => t.id !== trackId) : prevTracks
    ));
  };

  const removeClip = (trackId, clipId) => {
    setTracks((prevTracks) => prevTracks.map((track) => (
      track.id === trackId
        ? { ...track, clips: track.clips.filter((clip) => clip.id !== clipId) }
        : track
    )));
  };

  // ========== ドラッグ＆ドロップ ==========

  // ドラッグ状態の完全なクリーンアップ
  const cleanupDragState = useCallback(() => {
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
      dragOverTimeoutRef.current = null;
    }
    draggedClipRef.current = null;
    dragOffsetRef.current = 0;
    draggedSoundWidthRef.current = DEFAULT_CLIP_WIDTH;
    setDragPreview(null);
    clearTrackHighlights();
    removeFloatingDragLabels();
    unlockScrollAfterDrag();
  }, []);

  // 配置予定位置（青い影）を表示する
  const showDragPreview = useCallback((trackElement, clientX, width, offset) => {
    if (!trackElement || !timelineRef.current || !trackElement.dataset || !trackElement.dataset.trackId) {
      return;
    }
    const trackRect = trackElement.getBoundingClientRect();
    const tracksAreaRect = timelineRef.current.getBoundingClientRect();
    const left = Math.max(0, snapPosition(clientX - trackRect.left - offset));
    highlightTrack(trackElement);
    setDragPreview({
      left,
      top: trackRect.top - tracksAreaRect.top + 10,
      width: isFinite(width) && width > 0 ? width : DEFAULT_CLIP_WIDTH,
      trackId: trackElement.dataset.trackId
    });
  }, [snapPosition]);

  // ドラッグ開始時に音声の長さを計算しておく（ドロップ時・プレビュー表示に使う）
  const handleSoundDragStart = useCallback((sound) => (
    getClipWidth(sound).then((width) => {
      draggedSoundWidthRef.current = width;
      return width;
    })
  ), [getClipWidth]);

  const handleDrop = async (e, trackId, timePosition) => {
    e.preventDefault();
    setDragPreview(null);
    clearTrackHighlights();

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
  };

  const handleDragOver = (e) => {
    e.preventDefault();

    // ドラッグされているのが既存クリップか新しい音素材かで処理を分ける
    const movingClip = draggedClipRef.current;
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = movingClip ? 'move' : 'copy';
    }

    // スロットリング - 16ms（60FPS）間隔で実行を制限
    if (dragOverTimeoutRef.current) {
      return;
    }

    const clientX = e.clientX;
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
  };

  // クリップのドラッグ開始（マウス / iPad の長押しドラッグ）
  const handleClipDragStart = (clip, originalTrackId, mouseX, clipElement) => {
    const clipRect = clipElement.getBoundingClientRect();
    draggedClipRef.current = { ...clip, originalTrackId };
    dragOffsetRef.current = mouseX - clipRect.left;
  };

  // ドラッグ終了時のクリーンアップ
  const handleDragEnd = (e) => {
    const movingClip = draggedClipRef.current;
    // タイムラインの外にドロップされた場合はクリップを削除する
    // （Firefox は dragend の座標が 0,0 になるので、その場合は削除しない）
    if (movingClip && timelineRef.current && e && (e.clientX !== 0 || e.clientY !== 0)) {
      const timelineRect = timelineRef.current.getBoundingClientRect();
      const outside = e.clientX < timelineRect.left || e.clientX > timelineRect.right ||
        e.clientY < timelineRect.top || e.clientY > timelineRect.bottom;
      if (outside) {
        removeClip(movingClip.originalTrackId, movingClip.id);
      }
    }
    cleanupDragState();
  };

  // タッチ操作: 指がトラックの上を動いている
  const handleTouchDragOver = useCallback((x, y, width, offset) => {
    const target = findTrackAtPoint(x, y);
    if (!target) {
      clearTrackHighlights();
      setDragPreview(null);
      return;
    }
    showDragPreview(target.element, x, width === null ? draggedSoundWidthRef.current : width, offset);
  }, [showDragPreview]);

  // タッチ操作: 音素材をトラックの上で離した
  const handleTouchDropSound = useCallback((sound, x, y) => {
    const target = findTrackAtPoint(x, y);
    cleanupDragState();
    if (!target) return;
    placeSoundOnTrack(sound, target.trackId, target.timePosition).catch((dropError) => {
      console.error('ドロップエラー:', dropError);
      setError('音素材の配置に失敗しました。再度お試しください。');
    });
  }, [cleanupDragState, placeSoundOnTrack]);

  // タッチ操作: クリップをトラックの上で離した
  const handleTouchMoveClip = useCallback((clip, x, y, offset) => {
    const target = findTrackAtPoint(x, y);
    cleanupDragState();
    if (!target) return;
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
    try {
      const projectData = serializeProject({
        tracks,
        sounds,
        pixelsPerSecond,
        trackNameCounter: trackNameCounterRef.current,
        trackIdCounter: trackIdCounterRef.current
      }, { includeSounds: 'all' });
      const blob = new Blob([JSON.stringify(projectData)], { type: 'application/json' });
      downloadBlob(blob, `music-project-${timestampForFileName()}.json`);
    } catch (saveError) {
      console.error('プロジェクト保存エラー:', saveError);
      setError('プロジェクトの保存に失敗しました。');
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
        haltPlayback(true);
        applyProject(project);
        setIsProjectLoaded(true);
        setError(null);

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

  // クラウド保存機能
  const openCloudSaveDialog = () => {
    // ローカルストレージから部屋番号を取得
    const savedRoom = localStorage.getItem('sound-library-room');
    setError(null);
    setCloudSaveData((prev) => ({
      ...prev,
      roomNumber: savedRoom || prev.roomNumber || '',
      songTitle: `楽曲_${new Date().toLocaleDateString('ja-JP')}`
    }));
    setShowCloudSaveDialog(true);
  };

  const saveToCloud = async () => {
    if (isCloudSaving) return;
    if (!cloudSaveData.songTitle.trim()) {
      setError('楽曲タイトルを入力してください');
      return;
    }
    if (!String(cloudSaveData.roomNumber).trim()) {
      setError('部屋番号を入力してください');
      return;
    }

    setIsCloudSaving(true);
    setError(null);
    try {
      // 部屋IDを取得
      const roomsData = await fetchJson('/api/rooms.php');
      if (!roomsData.success) {
        setError('部屋情報の取得に失敗しました');
        return;
      }

      const targetRoom = findRoomByNumber(roomsData.data, cloudSaveData.roomNumber);
      if (!targetRoom) {
        setError('指定された部屋番号が見つかりません');
        return;
      }

      // 使っている音だけを 1 回ずつ送る（以前は音素材ライブラリ全部＋クリップごとの重複を送っていて、
      // サーバーの上限を超えて保存に失敗することがあった）
      const projectData = serializeProject({
        tracks,
        pixelsPerSecond,
        trackNameCounter: trackNameCounterRef.current,
        trackIdCounter: trackIdCounterRef.current
      }, { includeSounds: 'used' });

      const result = await fetchJson('/api/songs.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          room_id: targetRoom.id,
          student_name: cloudSaveData.studentName,
          group_number: cloudSaveData.groupNumber,
          song_title: cloudSaveData.songTitle,
          song_data: projectData
        })
      });

      if (result.success) {
        try {
          localStorage.setItem('sound-library-room', String(cloudSaveData.roomNumber).trim());
        } catch (storageError) {
          // 無視
        }
        setShowCloudSaveDialog(false);
        setCloudSaveData((prev) => ({ ...prev, songTitle: '' }));
        alert('楽曲をクラウドに保存しました！');
      } else {
        setError(result.error || 'クラウド保存に失敗しました');
      }
    } catch (cloudError) {
      console.error('クラウド保存エラー:', cloudError);
      setError(cloudError.message || 'クラウド保存に失敗しました');
    } finally {
      if (isMountedRef.current) setIsCloudSaving(false);
    }
  };

  // 音源出力機能（WAV）
  const exportAudio = async () => {
    const ctx = audioContextRef.current;
    if (!ctx) {
      setError('AudioContextが初期化されていません。');
      return;
    }

    const clips = tracks.flatMap((track) => track.clips).filter((clip) => isPlayableSound(clip.soundData));
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
    } catch (exportError) {
      console.error('音源出力エラー:', exportError);
      setError('音源の出力に失敗しました。');
    } finally {
      if (isMountedRef.current) setIsExporting(false);
    }
  };

  // プロジェクトをリセット（自動保存データもクリア）
  const resetProject = async () => {
    haltPlayback(true);
    try {
      await deleteProjectAutoSave();
    } catch (resetError) {
      console.error('自動保存データのクリアに失敗:', resetError);
    }
    removeLegacyAutoSave();

    // 初期状態にリセット
    const initialTracks = createInitialTracks();
    setTracks(initialTracks);
    tracksRef.current = initialTracks;
    setPixelsPerSecond(DEFAULT_PIXELS_PER_SECOND);
    pixelsPerSecondRef.current = DEFAULT_PIXELS_PER_SECOND;
    trackNameCounterRef.current = 1;
    trackIdCounterRef.current = 1;
    setError(null);
    setIsProjectLoaded(true);
    alert('✅ プロジェクトをリセットしました');
  };

  const saveStatusLabel = {
    pending: '💾 保存待ち...',
    saving: '💾 保存中...',
    saved: '✅ 自動保存しました',
    error: '⚠️ 自動保存に失敗'
  }[saveStatus];

  return (
    <div className="daw-page">
      <h2>🎹 音楽づくりページ</h2>
      <p>音素材をドラッグ&ドロップして音楽を作りましょう！</p>

      {error && (
        <div className="error-message" role="alert">
          <span>⚠️ {error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="メッセージを閉じる">×</button>
        </div>
      )}

      {isInitialLoading && (
        <div className="daw-loading" role="status">前回の作業内容を読み込んでいます...</div>
      )}

      <div className="daw-controls card">
        {/* 上段：音素材表示切り替え、保存関連機能 */}
        <div className="top-controls-row">
          <div className="left-controls">
            <button
              type="button"
              className="button-secondary"
              onClick={() => setShowSoundPanel(!showSoundPanel)}
            >
              {showSoundPanel ? '🎵 音素材を隠す' : '🎵 音素材を表示'}
            </button>
            {saveStatusLabel && (
              <span className={`autosave-status autosave-status-${saveStatus}`} role="status">
                {saveStatusLabel}
              </span>
            )}
          </div>

          <div className="right-controls">
            <div className="project-controls">
              <button type="button" className="button-secondary" onClick={saveProject}>
                💾 プロジェクト保存
              </button>
              <button type="button" className="button-secondary" onClick={openCloudSaveDialog}>
                🌐 クラウド保存
              </button>
              <label className="button-secondary file-input-label">
                📁 プロジェクト読み込み
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={loadProject}
                  style={{ display: 'none' }}
                />
              </label>
              <button
                type="button"
                className="button-warning"
                onClick={() => {
                  if (window.confirm('🗑️ プロジェクトをリセットしますか？\n\n現在の作業内容がすべて削除されます。')) {
                    resetProject();
                  }
                }}
                title="プロジェクトをリセット（自動保存データもクリア）"
              >
                🗑️ リセット
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={exportAudio}
                disabled={isExporting}
              >
                {isExporting ? '🔄 出力中...' : '🎧 音源出力'}
              </button>
            </div>
          </div>
        </div>

        {/* 下段：再生コントロール、ズームコントロール */}
        <div className="bottom-controls-row">
          <div className="transport-controls">
            <button
              type="button"
              className={`transport-btn play-btn ${isPlaying ? 'playing' : ''}`}
              onClick={isPlaying ? pause : play}
              aria-label={isPlaying ? '一時停止' : '再生'}
            >
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            <button type="button" className="transport-btn stop-btn" onClick={stop} aria-label="停止">
              ⏹️
            </button>
          </div>

          <div className="timing-controls">
            <div className="zoom-control">
              <span>🔍 タイムライン拡大/縮小:</span>
              <button
                type="button"
                className="zoom-btn"
                onClick={() => handleZoom(false)}
                title="ズームアウト（縮小）"
                aria-label="ズームアウト（縮小）"
              >
                －
              </button>
              <span className="zoom-display">
                {Math.round(pixelsPerSecond / DEFAULT_PIXELS_PER_SECOND * 100)}%
              </span>
              <button
                type="button"
                className="zoom-btn"
                onClick={() => handleZoom(true)}
                title="ズームイン（拡大）"
                aria-label="ズームイン（拡大）"
              >
                ＋
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="daw-main-area">
        <div className={`sound-panel ${!showSoundPanel ? 'panel-hidden' : ''}`}>
          <div className="sound-panel-header">
            <h3>🎵 音素材</h3>
            <button
              type="button"
              className="sound-panel-close"
              onClick={() => setShowSoundPanel(false)}
              title="音素材パネルを閉じる"
              aria-label="音素材パネルを閉じる"
            >
              ✕
            </button>
          </div>

          {/* タグフィルター */}
          {allTags.length > 0 && (
            <div className="sound-panel-filters">
              <div className="tag-filter-label">🏷️ タグで絞り込み:</div>
              <div className="tag-filters-compact">
                <button
                  type="button"
                  className={`tag-filter-btn-compact ${selectedTag === '' ? 'active' : ''}`}
                  onClick={() => setSelectedTag('')}
                  title="すべての音素材を表示"
                >
                  すべて
                </button>
                {allTags.map((tag) => (
                  <button
                    type="button"
                    key={tag}
                    className={`tag-filter-btn-compact ${selectedTag === tag ? 'active' : ''}`}
                    onClick={() => setSelectedTag(tag)}
                    title={`${tag}でフィルター`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="sound-list">
            {sounds.length > 0 ? (
              filteredSounds.length > 0 ? (
                filteredSounds.map((sound) => (
                  <MemoizedSoundItem
                    key={sound.id}
                    sound={sound}
                    onDragStart={handleSoundDragStart}
                    onPreview={playPreview}
                    onStopPreview={stopPreview}
                    onTouchDragOver={handleTouchDragOver}
                    onTouchDrop={handleTouchDropSound}
                    onTouchCancel={cleanupDragState}
                  />
                ))
              ) : (
                <div className="no-sounds">
                  <p>選択したタグの音素材がありません</p>
                  <button
                    type="button"
                    className="reset-filter-btn"
                    onClick={() => setSelectedTag('')}
                  >
                    フィルターをリセット
                  </button>
                </div>
              )
            ) : (
              <div className="no-sounds">
                <p>音素材がありません</p>
                <p>「音あつめ」ページで音を録音してください</p>
              </div>
            )}
          </div>
        </div>

        <div className={`daw-workspace ${!showSoundPanel ? 'panel-hidden' : ''}`}>
          <div className="track-headers" ref={trackHeadersRef}>
            <div className="timeline-header-spacer">
              タイムライン
            </div>
            {tracks.map((track, index) => (
              <TrackHeader
                key={track.id}
                track={track}
                trackIndex={index}
                onRemove={removeTrack}
                canRemove={tracks.length > 1}
                trackHeight={trackHeight}
              />
            ))}
            <div className="track-add-button-container" style={{ height: trackHeight }}>
              <button type="button" className="button-primary track-add-btn" onClick={addTrack}>
                ➕ トラック追加
              </button>
            </div>
          </div>

          <div className="timeline-container" ref={timelineContainerRef}>
            <Timeline pixelsPerSecond={pixelsPerSecond} />
            <div
              className="tracks-area"
              ref={timelineRef}
              style={{
                minWidth: TIME_MODE_TOTAL_SECONDS * pixelsPerSecond
              }}
            >
              <Playhead ref={playheadRef} position={currentTime} isPlaying={isPlaying} />
              {dragPreview && (
                <div
                  className="drag-preview"
                  style={{
                    left: dragPreview.left,
                    top: dragPreview.top,
                    width: dragPreview.width
                  }}
                />
              )}
              {tracks.map((track) => (
                <Track
                  key={track.id}
                  track={track}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onRemoveClip={removeClip}
                  onClipDragStart={handleClipDragStart}
                  onDragEnd={handleDragEnd}
                  onTouchDragOver={handleTouchDragOver}
                  onTouchMoveClip={handleTouchMoveClip}
                  onTouchCancel={cleanupDragState}
                  trackHeight={trackHeight}
                  pixelsPerSecond={pixelsPerSecond}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="instructions-collapsible">
        <div className="instructions-summary" role="button" tabIndex={0} onClick={() => setInstructionsExpanded((prev) => !prev)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setInstructionsExpanded((prev) => !prev); }}>
          <span className="instructions-title">📖 使い方</span>
          <button type="button" className="instructions-toggle" aria-expanded={instructionsExpanded} aria-controls="instructions-body">
            {instructionsExpanded ? '折りたたむ' : '表示'}
          </button>
        </div>
        {instructionsExpanded && (
          <div id="instructions-body">
            <InstructionsSection />
          </div>
        )}
      </div>

      {/* クラウド保存ダイアログ */}
      {showCloudSaveDialog && (
        <>
          <button
            type="button"
            className="modal-overlay"
            onClick={() => setShowCloudSaveDialog(false)}
            aria-label="ダイアログを閉じる"
            tabIndex={0}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, border: 'none', padding: 0, margin: 0 }}
          />
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', zIndex: 1001 }}
          >
            <div className="modal-header">
              <h3>🌐 楽曲をクラウドに保存</h3>
              <button
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCloudSaveDialog(false)}
                aria-label="ダイアログを閉じる"
              >
                ×
              </button>
            </div>

            <div className="modal-body">
              {/* ダイアログの後ろに隠れて見えないので、エラーはダイアログ内にも出す */}
              {error && <div className="error-message" role="alert">{error}</div>}

              <div className="form-group">
                <label htmlFor="cloud-song-title">楽曲タイトル *</label>
                <input
                  id="cloud-song-title"
                  type="text"
                  value={cloudSaveData.songTitle}
                  onChange={(e) => setCloudSaveData((prev) => ({ ...prev, songTitle: e.target.value }))}
                  placeholder="楽曲のタイトルを入力"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-room-number">部屋番号 *</label>
                <input
                  id="cloud-room-number"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={cloudSaveData.roomNumber}
                  onChange={(e) => setCloudSaveData((prev) => ({ ...prev, roomNumber: e.target.value }))}
                  placeholder="例: 101"
                  required
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-student-name">あなたの名前</label>
                <input
                  id="cloud-student-name"
                  type="text"
                  value={cloudSaveData.studentName}
                  onChange={(e) => setCloudSaveData((prev) => ({ ...prev, studentName: e.target.value }))}
                  placeholder="名前を入力（任意）"
                />
              </div>

              <div className="form-group">
                <label htmlFor="cloud-group-number">班番号</label>
                <input
                  id="cloud-group-number"
                  type="text"
                  value={cloudSaveData.groupNumber}
                  onChange={(e) => setCloudSaveData((prev) => ({ ...prev, groupNumber: e.target.value }))}
                  placeholder="班番号を入力（任意）"
                />
              </div>
            </div>

            <div className="modal-footer">
              <button
                type="button"
                className="button-secondary"
                onClick={() => setShowCloudSaveDialog(false)}
              >
                キャンセル
              </button>
              <button
                type="button"
                className="button-primary"
                onClick={saveToCloud}
                disabled={isCloudSaving || !cloudSaveData.songTitle.trim() || !String(cloudSaveData.roomNumber).trim()}
              >
                {isCloudSaving ? '保存中...' : 'クラウドに保存'}
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const SoundItem = ({ sound, onDragStart, onPreview, onStopPreview, onTouchDragOver, onTouchDrop, onTouchCancel }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const floatingLabelRef = useRef(null);

  // マウスオーバー時に音声の長さを事前計算（デコード結果はキャッシュされる）
  const handleMouseEnter = () => {
    if (onDragStart) onDragStart(sound).catch(() => {});
  };

  const handleDragStart = (e) => {
    document.body.classList.add('dragging');

    // カスタムドラッグイメージを設定（テキストとして表示）
    const dragImage = document.createElement('div');
    dragImage.textContent = sound.name;
    dragImage.style.cssText = `
      position: absolute;
      top: -1000px;
      background: rgba(0, 123, 255, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
    `;
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

  // タッチ操作: 横に動かす、または左端のつまみを持って動かすとドラッグ開始。
  // 縦に動かしたときは音素材リストのスクロールになる。
  const itemRef = useTouchDrag({
    shouldStart: (dx, dy, target) =>
      !!(target && target.closest && target.closest('.sound-drag-handle')) || dx > dy,
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

  return (
    <div
      ref={itemRef}
      className={`sound-item ${isDragging ? 'dragging' : ''}`}
      draggable="true"
      onDragStart={handleDragStart}
      onMouseEnter={handleMouseEnter}
    >
      <div className="sound-info">
        <span className="sound-drag-handle" aria-hidden="true" title="ここを持ってドラッグ">⋮⋮</span>
        <h4>{sound.name}</h4>
        <div className="sound-tags">
          {(sound.tags || []).map((tag, index) => (
            <span key={index} className="sound-tag">{tag}</span>
          ))}
        </div>
        <div className="sound-actions">
          <button
            type="button"
            className="play-sound-btn"
            onClick={isPlaying ? stopSound : playSound}
            aria-label={isPlaying ? `${sound.name}を停止` : `${sound.name}を試聴`}
          >
            {isPlaying ? '⏹️' : '▶️'}
          </button>
        </div>
      </div>
    </div>
  );
};

// SoundItemをメモ化して不要な再レンダリングを防ぐ（コールバックはすべて安定した関数）
const MemoizedSoundItem = React.memo(SoundItem);

const TrackHeader = ({ track, onRemove, canRemove, trackHeight, trackIndex }) => {
  // トラック名を表示番号で構成
  const displayName = `トラック ${trackIndex + 1}`;

  return (
    <div className="track-header" style={{ height: trackHeight }}>
      <div className="track-info">
        <h4>{displayName}</h4>
        <div className="track-actions">
          <button
            type="button"
            className="remove-track-btn"
            onClick={() => onRemove(track.id)}
            disabled={!canRemove}
            title={canRemove ? `${displayName}を削除` : 'トラックは最低1つ必要です'}
            aria-label={`${displayName}を削除`}
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
};

const Timeline = React.memo(({ pixelsPerSecond }) => {
  // 秒数ベースのタイムライン表示
  const totalSeconds = TIME_MODE_TOTAL_SECONDS;

  return (
    <div className="timeline" style={{ minWidth: totalSeconds * pixelsPerSecond }}>
      {Array.from({ length: totalSeconds + 1 }, (_, second) => (
        <div
          key={second}
          className="time-mark"
          style={{
            position: 'absolute',
            left: second * pixelsPerSecond,
            width: pixelsPerSecond,
            height: '100%'
          }}
        >
          {second % 5 === 0 && (
            <div className="time-main">
              {second}s
            </div>
          )}
        </div>
      ))}
    </div>
  );
});

Timeline.displayName = 'Timeline';

const TrackGrid = React.memo(({ pixelsPerSecond }) => (
  <div className="track-grid">
    {/* 1秒ごとの主要な境界線 */}
    {Array.from({ length: TIME_MODE_TOTAL_SECONDS }, (_, index) => (
      <div
        key={`time-main-${index}`}
        className={`beat-line beat-line-main ${index === 0 ? 'first-beat' : ''} ${index % 5 === 0 ? 'measure-start' : ''}`}
        style={{ left: index * pixelsPerSecond }}
      />
    ))}
    {/* 0.5秒ごとの副次的な境界線 */}
    {Array.from({ length: TIME_MODE_TOTAL_SECONDS }, (_, index) => (
      <div
        key={`time-sub-${index}`}
        className="beat-line beat-line-sub"
        style={{ left: (index + 0.5) * pixelsPerSecond }}
      />
    ))}
  </div>
));

TrackGrid.displayName = 'TrackGrid';

const Track = ({
  track, onDrop, onDragOver, onRemoveClip, onClipDragStart, onDragEnd,
  onTouchDragOver, onTouchMoveClip, onTouchCancel, trackHeight, pixelsPerSecond
}) => {
  const handleDrop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const timePosition = e.clientX - rect.left;
    onDrop(e, track.id, timePosition);
  };

  return (
    <div
      className="track"
      style={{ height: trackHeight }}
      data-track-id={track.id}
      onDrop={handleDrop}
      onDragOver={onDragOver}
    >
      <TrackGrid pixelsPerSecond={pixelsPerSecond} />

      {track.clips.map((clip) => (
        <AudioClip
          key={clip.id}
          clip={clip}
          trackId={track.id}
          onRemove={() => onRemoveClip(track.id, clip.id)}
          onDragStart={onClipDragStart}
          onDragEnd={onDragEnd}
          onTouchDragOver={onTouchDragOver}
          onTouchMoveClip={onTouchMoveClip}
          onTouchCancel={onTouchCancel}
        />
      ))}
    </div>
  );
};

// クリップ ID から毎回同じ形の波形を作る（以前は描画のたびにランダムで形が変わっていた）
const createWaveform = (seed, points = 20) => {
  let value = 0;
  const text = String(seed);
  for (let i = 0; i < text.length; i++) {
    value = (value * 31 + text.charCodeAt(i)) % 2147483647;
  }
  const data = [];
  for (let i = 0; i < points; i++) {
    value = (value * 48271) % 2147483647;
    data.push((value / 2147483647) * 0.8 + 0.2); // 0.2-1.0の間の値
  }
  return data;
};

const AudioClip = ({ clip, trackId, onRemove, onDragStart, onDragEnd, onTouchDragOver, onTouchMoveClip, onTouchCancel }) => {
  const [isDragging, setIsDragging] = useState(false);
  const touchOffsetRef = useRef(0);
  const clipId = clip ? clip.id : null;
  const waveformData = useMemo(() => createWaveform(clipId), [clipId]);

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

  // clip.soundData の安全性をチェック（Hooksの後で）
  if (!clip || !clip.soundData) {
    return null; // 無効なクリップは表示しない
  }

  const handleDragStart = (e) => {
    e.stopPropagation(); // イベントバブリングを防ぐ
    document.body.classList.add('dragging');

    // ドラッグデータに既存クリップの情報を設定
    e.dataTransfer.setData('text/plain', `${CLIP_DRAG_PREFIX}${clip.id}`);
    e.dataTransfer.effectAllowed = 'move';

    // onDragStartコールバックを呼び出し（マウス位置とクリップ要素を渡す）
    onDragStart(clip, trackId, e.clientX, e.currentTarget);
  };

  const hasAudio = isPlayableSound(clip.soundData);

  return (
    <div
      ref={clipRef}
      className={`audio-clip ${isDragging ? 'dragging' : ''} ${hasAudio ? '' : 'audio-clip-missing'}`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={onDragEnd}
      title={hasAudio ? clip.soundData.name : `${clip.soundData.name}（音声データがありません）`}
      style={{
        left: clip.startTime,
        width: isFinite(clip.duration) && clip.duration > 0 ? clip.duration : DEFAULT_CLIP_WIDTH
      }}
    >
      <div className="clip-header">
        <span className="clip-name">{clip.soundData.name || '不明な音素材'}</span>
        <button
          type="button"
          className="remove-clip-btn"
          onClick={onRemove}
          title="クリップを削除"
          aria-label={`${clip.soundData.name || 'クリップ'}を削除`}
        >
          ×
        </button>
      </div>
      <div className="clip-waveform">
        <svg className="waveform-svg" width="100%" height="30" aria-hidden="true">
          {waveformData.map((height, index) => (
            <rect
              key={index}
              x={`${(index / waveformData.length) * 100}%`}
              y={`${(1 - height) * 15}`}
              width={`${80 / waveformData.length}%`}
              height={`${height * 30}`}
              fill="rgba(255, 255, 255, 0.8)"
            />
          ))}
        </svg>
      </div>
    </div>
  );
};

// 使い方セクション - メモ化して再レンダリングを防ぐ
const InstructionsSection = React.memo(() => {
  return (
    <div className="instructions card">
      <h3>📖 使い方</h3>
      <ul>
        <li><strong>🖥️ PC:</strong> 左側の音素材パネルから音素材をトラックにドラッグ&ドロップして配置</li>
        <li><strong>📱 タブレット:</strong> 音素材の左にある「⋮⋮」を持って、トラックまで指を動かして配置（音素材を横にスライドしても配置できます）</li>
        <li>配置済みの音素材もドラッグして別の場所・別のトラックに移動できます</li>
        <li>ドラッグ中は配置予定位置に青い影が表示されます</li>
        <li><strong>🔍 ズーム機能:</strong> ＋／－ボタンでタイムラインの表示倍率を変更できます</li>
        <li>タイムラインは秒数ベースで、0.1秒単位で音素材を配置できます</li>
        <li>音素材パネルの▶️ボタンで個別に音を確認できます</li>
        <li>▶️ボタンで再生、⏸️ボタンで一時停止、⏹️ボタンで停止（最後まで再生すると先頭に戻ります）</li>
        <li>トラックを追加して複数の音を重ねることができます</li>
        <li><strong>💾 プロジェクト保存:</strong> 編集中のデータと音素材をJSONファイルとして保存</li>
        <li><strong>📁 プロジェクト読み込み:</strong> 保存したプロジェクトファイルを読み込んで編集を再開</li>
        <li><strong>🎧 音源出力:</strong> 完成した楽曲をWAVファイルとして出力</li>
        <li><strong>🗑️ リセット:</strong> 現在のプロジェクトをリセットして新しく始める</li>
      </ul>
      <div className="auto-save-info">
        <h4>💾 自動保存機能</h4>
        <ul>
          <li><strong>自動保存:</strong> トラックとズーム倍率の変更は自動的に保存されます（左上に保存状況が表示されます）</li>
          <li><strong>他ページとの連携:</strong> 「音あつめ」ページで録音した音は自動的に反映されます</li>
          <li><strong>復元機能:</strong> ページをリロードしても作業内容が自動的に復元されます</li>
          <li><strong>安心して移動:</strong> 他のページに移動しても作業内容は保持されます</li>
        </ul>
      </div>
      <div className="mobile-tips">
        <h4>📱 タブレット利用のコツ</h4>
        <ul>
          <li>音素材リストを上下に動かすとスクロール、横に動かすとドラッグになります</li>
          <li>ドラッグ中は画面がスクロールしないよう制御されます</li>
          <li>青くハイライトされたトラックで指を離すと音素材が配置されます</li>
          <li>音が出ないときは、iPadの音量と消音モードを確認してください</li>
          <li>横画面表示にするとより使いやすくなります</li>
        </ul>
      </div>
    </div>
  );
});

InstructionsSection.displayName = 'InstructionsSection';

// 再生中は親の再描画に関係なく、DAWPage が直接 style.left を動かす
const Playhead = React.memo(React.forwardRef(({ position, isPlaying }, ref) => {
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

  return <div className="playhead" ref={setRefs} />;
}));

Playhead.displayName = 'Playhead';

export default DAWPage;
