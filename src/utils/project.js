// DAW プロジェクト（タイムライン）の保存形式
//
// v1: 各クリップの soundData.audioData に音声を丸ごと埋め込む。
//     同じ音を 10 回並べると音声データも 10 回分保存され、容量超過の原因になっていた。
// v2: 音声データは assets に 1 回だけ保存し、クリップは audioRef で参照する。
//
// 読み込みは v1 / v2 の両方に対応する（先生ページに保存済みの過去の楽曲も開ける）。
// テンポ（bpm）・拍子（beatsPerMeasure）・音の合わせ方（snapMode）・メトロノームは v2 に後から加えた。
// これらが無い楽曲は既定値（120・4 拍子・拍に合わせる・メトロノームなし）で開く。
import { dataUrlToBlob, normalizeAudioDataUrl } from './audio';
import { toTagList, toText } from './text';
import {
  DEFAULT_BPM,
  ceilToStep,
  clampBpm,
  floorToStep,
  normalizeBeatsPerMeasure,
  convertUnits,
  normalizeSnapMode,
  roundToStep
} from './timing';

export const PROJECT_VERSION = '2.0';
export const DEFAULT_PIXELS_PER_SECOND = 100;
export const DEFAULT_CLIP_WIDTH = 400;

// Blob や blob: URL は保存できない / 保存しても意味がないので除く
const soundMetadata = (sound) => {
  const { audioBlob, url, audioData, ...metadata } = sound || {};
  return metadata;
};

const isFiniteNumber = (value) => typeof value === 'number' && isFinite(value);

// options.includeSounds:
//   'used' … タイムラインで使っている音だけ（クラウド保存・自動保存）
//   'all'  … 音素材ライブラリもすべて含める（プロジェクトファイルのバックアップ用）
export const serializeProject = (
  {
    tracks,
    sounds = [],
    pixelsPerSecond,
    trackNameCounter,
    trackIdCounter,
    bpm = DEFAULT_BPM,
    beatsPerMeasure,
    snapMode,
    metronome = false
  },
  { includeSounds = 'used' } = {}
) => {
  const assets = {};
  const assetIdByAudio = new Map();
  const registerAudio = (audioData) => {
    if (!audioData) return null;
    let assetId = assetIdByAudio.get(audioData);
    if (!assetId) {
      assetId = `a${assetIdByAudio.size + 1}`;
      assetIdByAudio.set(audioData, assetId);
      assets[assetId] = audioData;
    }
    return assetId;
  };

  const serializedTracks = (tracks || []).map((track) => ({
    ...track,
    clips: (track.clips || [])
      .filter((clip) => clip && clip.soundData)
      .map((clip) => {
        const { soundData, originalTrackId, ...rest } = clip;
        return {
          ...rest,
          audioRef: registerAudio(soundData.audioData),
          soundData: soundMetadata(soundData)
        };
      })
  }));

  const serializedSounds = includeSounds === 'all'
    ? (sounds || [])
      .filter((sound) => sound && sound.audioData)
      .map((sound) => ({ ...soundMetadata(sound), audioRef: registerAudio(sound.audioData) }))
    : [];

  return {
    version: PROJECT_VERSION,
    pixelsPerSecond,
    bpm: clampBpm(bpm),
    beatsPerMeasure: normalizeBeatsPerMeasure(beatsPerMeasure),
    snapMode: normalizeSnapMode(snapMode),
    metronome: metronome === true,
    tracks: serializedTracks,
    sounds: serializedSounds,
    assets,
    timestamp: Date.now(),
    trackNameCounter,
    trackIdCounter
  };
};

// 同じ音声データの音素材は同じオブジェクト（同じ Blob）を共有させる。
// 再生時のデコード結果を Blob 単位でキャッシュしているため、共有させると一度のデコードで済む。
const createSoundHydrator = () => {
  const cache = new Map();
  return (metadata, audioData) => {
    if (!audioData) {
      return { ...metadata, audioBlob: null };
    }
    if (!cache.has(audioData)) {
      let audioBlob = null;
      try {
        audioBlob = dataUrlToBlob(audioData);
      } catch (error) {
        console.error('音声データの復元に失敗:', metadata && metadata.name, error);
      }
      cache.set(audioData, audioBlob);
    }
    return { ...metadata, audioData, audioBlob: cache.get(audioData) };
  };
};

// options.findSoundByName: 音声データが含まれていないクリップ（旧形式の自動保存）を
//                          音素材ライブラリから名前で補うための関数
export const deserializeProject = (data, { findSoundByName } = {}) => {
  if (!data || typeof data !== 'object' || !Array.isArray(data.tracks)) {
    throw new Error('不正なプロジェクトデータです');
  }

  const assets = data.assets && typeof data.assets === 'object' ? data.assets : {};
  const hydrate = createSoundHydrator();

  const resolveAudioData = (entry, metadata) => {
    let audioData = (entry.audioRef && assets[entry.audioRef]) ||
      (entry.soundData && entry.soundData.audioData) ||
      entry.audioData ||
      null;
    if (!audioData && findSoundByName && metadata && metadata.name) {
      const found = findSoundByName(metadata.name);
      audioData = found && found.audioData ? found.audioData : null;
    }
    return audioData ? normalizeAudioDataUrl(audioData) : null;
  };

  let droppedClipCount = 0;
  let missingAudioCount = 0;
  const usedSounds = new Map();
  const usedTrackIds = new Set();
  let generatedId = Date.now();

  const tracks = data.tracks
    .filter((track) => track && typeof track === 'object')
    .map((track) => {
      let trackId = isFiniteNumber(track.id) || (typeof track.id === 'string' && track.id) ? track.id : null;
      if (trackId === null || usedTrackIds.has(String(trackId))) {
        trackId = generatedId++;
      }
      usedTrackIds.add(String(trackId));

      const clips = (Array.isArray(track.clips) ? track.clips : []).reduce((result, clip) => {
        // 名前が文字列でない（オブジェクトなど）クリップは表示できず画面が止まるので除外する
        if (!clip || !clip.soundData || !toText(clip.soundData.name)) {
          droppedClipCount++;
          return result;
        }
        const metadata = {
          ...soundMetadata(clip.soundData),
          name: toText(clip.soundData.name),
          tags: toTagList(clip.soundData.tags)
        };
        const audioData = resolveAudioData(clip, metadata);
        const soundData = hydrate(metadata, audioData);
        if (!soundData.audioBlob) {
          missingAudioCount++;
        } else if (!usedSounds.has(audioData)) {
          usedSounds.set(audioData, soundData);
        }
        const { audioRef, originalTrackId, ...rest } = clip;
        result.push({
          ...rest,
          id: isFiniteNumber(clip.id) || typeof clip.id === 'string' ? clip.id : generatedId++ + Math.random(),
          trackId,
          startTime: isFiniteNumber(clip.startTime) && clip.startTime >= 0 ? clip.startTime : 0,
          duration: isFiniteNumber(clip.duration) && clip.duration > 0 ? clip.duration : DEFAULT_CLIP_WIDTH,
          soundData
        });
        return result;
      }, []);

      return { ...track, id: trackId, name: toText(track.name) || 'トラック', muted: track.muted === true, clips };
    });

  // ライブラリ用の音素材は Blob にしない（使う側で必要な分だけ復元する）。
  // 古い形式の楽曲は生徒のライブラリ全体を含むことがあり、全部復元すると古い iPad でメモリが足りなくなる
  const sounds = (Array.isArray(data.sounds) ? data.sounds : [])
    .filter((sound) => sound && toText(sound.name))
    .map((sound) => {
      const metadata = { ...soundMetadata(sound), name: toText(sound.name), tags: toTagList(sound.tags) };
      delete metadata.audioRef;
      return { ...metadata, audioData: resolveAudioData(sound, metadata) };
    })
    .filter((sound) => sound.audioData);

  return {
    pixelsPerSecond: isFiniteNumber(data.pixelsPerSecond) && data.pixelsPerSecond > 0
      ? data.pixelsPerSecond
      : DEFAULT_PIXELS_PER_SECOND,
    bpm: data.bpm === undefined ? DEFAULT_BPM : clampBpm(data.bpm),
    beatsPerMeasure: normalizeBeatsPerMeasure(data.beatsPerMeasure),
    snapMode: normalizeSnapMode(data.snapMode),
    metronome: data.metronome === true,
    tracks,
    sounds,
    usedSounds: Array.from(usedSounds.values()),
    trackNameCounter: isFiniteNumber(data.trackNameCounter) ? data.trackNameCounter : null,
    trackIdCounter: isFiniteNumber(data.trackIdCounter) ? data.trackIdCounter : null,
    droppedClipCount,
    missingAudioCount
  };
};

export const ZOOM_LEVELS = [25, 50, 67, 100, 150, 200, 300, 400];

// 現在の倍率（ピクセル/秒）から、1 段階拡大・縮小した倍率を返す
export const getNextZoomLevel = (current, zoomIn, levels = ZOOM_LEVELS) => {
  let index = levels.indexOf(current);
  if (index === -1) {
    // 一覧に無い倍率（古い保存データなど）は最も近い段階として扱う
    index = levels.reduce((best, level, i) => (
      Math.abs(level - current) < Math.abs(levels[best] - current) ? i : best
    ), 0);
  }
  const nextIndex = zoomIn ? Math.min(index + 1, levels.length - 1) : Math.max(index - 1, 0);
  return levels[nextIndex];
};

// クリップの位置と長さはピクセル単位なので、ズーム倍率（1 秒あたりのピクセル数）を変えたら合わせる。
// 音声を再デコードしないので、クリップが多くても一瞬で終わる。
// 秒に直して丸めてから掛け直すので、拡大・縮小を何度くり返しても誤差がたまらない。
export const rescaleTracks = (tracks, fromPixelsPerSecond, toPixelsPerSecond) => {
  if (fromPixelsPerSecond === toPixelsPerSecond) return tracks;
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({
      ...clip,
      startTime: convertUnits(clip.startTime, fromPixelsPerSecond, toPixelsPerSecond),
      duration: convertUnits(clip.duration, fromPixelsPerSecond, toPixelsPerSecond)
    }))
  }));
};

// 浮動小数点の誤差で「ぴったり隣り合ったクリップ」を重なりと判定しないための余裕
const OVERLAP_EPSILON = 1e-6;

// トラック上でクリップ同士が重ならない開始位置を探す。
// options.step: 位置を合わせる間隔（ピクセル）。0 なら合わせない。
//   拍に合わせるときは、ずらした先も拍の上にする（以前は前の音の終わりにぴったり付け、拍からずれていた）
// options.direction: 'nearest'（前後で一番近い所）か 'forward'（後ろだけ。＋ボタンで順に並べるとき）
// options.excludeClipId: 移動中の自分自身とは重なりを判定しない
export const findFreePosition = (trackClips, desiredStart, duration, { excludeClipId = null, step = 0, direction = 'nearest' } = {}) => {
  const others = (trackClips || []).filter((clip) => clip.id !== excludeClipId);
  const overlaps = (start) => others.some((clip) => (
    start < clip.startTime + clip.duration - OVERLAP_EPSILON &&
    start + duration > clip.startTime + OVERLAP_EPSILON
  ));
  const desired = Math.max(0, step > 0 ? roundToStep(desiredStart, step) : desiredStart);
  if (!overlaps(desired)) return desired;

  // 候補: 0 秒地点・各クリップの直後・各クリップの直前
  const candidates = [0];
  others.forEach((clip) => {
    const end = clip.startTime + clip.duration;
    const before = clip.startTime - duration;
    candidates.push(step > 0 ? ceilToStep(end, step) : end);
    candidates.push(step > 0 ? floorToStep(before, step) : before);
  });

  let best = null;
  candidates.forEach((candidate) => {
    if (candidate < 0 || overlaps(candidate)) return;
    if (direction === 'forward' && candidate < desired) return;
    if (best === null || Math.abs(candidate - desired) < Math.abs(best - desired)) {
      best = candidate;
    }
  });

  if (best === null) {
    // 念のため: 一番後ろのクリップの直後に置く
    const lastEnd = others.reduce((max, clip) => Math.max(max, clip.startTime + clip.duration), 0);
    best = step > 0 ? ceilToStep(lastEnd, step) : lastEnd;
  }
  return best;
};
