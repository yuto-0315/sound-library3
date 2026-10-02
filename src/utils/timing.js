// 音楽づくりページの「拍」と「小節」の計算
//
// クリップの位置と長さはピクセルで持っている（pixelsPerSecond 倍した秒数）。
// 拍の幅は テンポ（BPM）とズーム倍率から求める: 1 拍 = 60 / BPM 秒。

export const DEFAULT_BPM = 120;
export const MIN_BPM = 40;
export const MAX_BPM = 200;
export const BPM_STEP = 5;

export const BEATS_PER_MEASURE_OPTIONS = [2, 3, 4];
export const DEFAULT_BEATS_PER_MEASURE = 4;

// 置いた音を何に合わせるか
export const SNAP_MODES = [
  { value: 'beat', label: '拍に合わせる' },
  { value: 'half', label: '半拍に合わせる' },
  { value: 'off', label: '合わせない' }
];
export const DEFAULT_SNAP_MODE = 'beat';
// 「合わせない」ときの細かさ（秒）
export const FREE_SNAP_SECONDS = 0.05;

// タイムラインの長さ（小節）: 最低でもこの長さを表示し、音の後ろにも余白を残す
export const MIN_TIMELINE_MEASURES = 24;
export const EXTRA_TIMELINE_MEASURES = 8;

const EPSILON = 1e-6;

export const clampBpm = (value) => {
  const number = Math.round(Number(value));
  if (!isFinite(number)) return DEFAULT_BPM;
  return Math.min(MAX_BPM, Math.max(MIN_BPM, number));
};

export const normalizeBeatsPerMeasure = (value) => (
  BEATS_PER_MEASURE_OPTIONS.includes(Number(value)) ? Number(value) : DEFAULT_BEATS_PER_MEASURE
);

export const normalizeSnapMode = (value) => (
  SNAP_MODES.some((mode) => mode.value === value) ? value : DEFAULT_SNAP_MODE
);

export const secondsPerBeat = (bpm) => 60 / clampBpm(bpm);

export const beatWidthPx = (bpm, pixelsPerSecond) => secondsPerBeat(bpm) * pixelsPerSecond;

export const measureWidthPx = (bpm, beatsPerMeasure, pixelsPerSecond) => (
  beatWidthPx(bpm, pixelsPerSecond) * normalizeBeatsPerMeasure(beatsPerMeasure)
);

// 位置を合わせる間隔（ピクセル）
export const snapStepPx = ({ bpm, pixelsPerSecond, snapMode }) => {
  if (snapMode === 'off') return FREE_SNAP_SECONDS * pixelsPerSecond;
  const beat = beatWidthPx(bpm, pixelsPerSecond);
  return snapMode === 'half' ? beat / 2 : beat;
};

export const roundToStep = (position, step) => (step > 0 ? Math.round(position / step) * step : position);

// 次の目盛り（ちょうど目盛りの上ならそのまま）
export const ceilToStep = (position, step) => (step > 0 ? Math.ceil(position / step - EPSILON) * step : position);

// 前の目盛り（ちょうど目盛りの上ならそのまま）
export const floorToStep = (position, step) => (step > 0 ? Math.floor(position / step + EPSILON) * step : position);

// 位置（ピクセル）を「何小節目の何拍目」で表す（どちらも 1 から数える）
export const describePosition = (position, { bpm, beatsPerMeasure, pixelsPerSecond }) => {
  const beats = Math.max(0, position) / beatWidthPx(bpm, pixelsPerSecond);
  const beatIndex = Math.floor(beats + EPSILON);
  const perMeasure = normalizeBeatsPerMeasure(beatsPerMeasure);
  return {
    measure: Math.floor(beatIndex / perMeasure) + 1,
    beat: (beatIndex % perMeasure) + 1,
    seconds: Math.max(0, position) / pixelsPerSecond
  };
};

export const formatPosition = (position, timing) => {
  const { measure, beat } = describePosition(position, timing);
  return `${measure}小節 ${beat}拍`;
};

export const formatSeconds = (seconds) => {
  const safe = isFinite(seconds) && seconds > 0 ? seconds : 0;
  const minutes = Math.floor(safe / 60);
  const rest = Math.floor(safe % 60);
  return `${minutes}:${String(rest).padStart(2, '0')}`;
};

// 音の長さを短く表す（例: 0.6秒, 12秒）
export const formatDuration = (seconds) => {
  if (!isFinite(seconds) || seconds <= 0) return '';
  if (seconds < 10) return `${(Math.round(seconds * 10) / 10).toFixed(1)}秒`;
  return `${Math.round(seconds)}秒`;
};

// タイムラインに表示する小節の数
export const getTimelineMeasureCount = ({ contentEndPx = 0, bpm, beatsPerMeasure, pixelsPerSecond }) => {
  const measure = measureWidthPx(bpm, beatsPerMeasure, pixelsPerSecond);
  if (!(measure > 0)) return MIN_TIMELINE_MEASURES;
  const usedMeasures = Math.ceil(Math.max(0, contentEndPx) / measure - EPSILON);
  return Math.max(MIN_TIMELINE_MEASURES, usedMeasures + EXTRA_TIMELINE_MEASURES);
};

// 位置を「何拍目か」「何秒目か」に直して小数第 6 位で丸め、新しい幅で掛け直す。
// 比率を掛け続けると誤差がたまり（200px が 199.999998px になる など）、
// 拍の頭にあった音が拍からずれたり、ぴったり隣り合った音が重なりと判定されたりする。
// 丸めた値をもとに戻すので、何度変えても同じ拍・同じ秒の上に戻る。
export const convertUnits = (value, fromUnitPx, toUnitPx) => (
  (Math.round((value / fromUnitPx) * 1e6) / 1e6) * toUnitPx
);

// テンポを変えたとき、置いた音が同じ拍の上に残るよう開始位置を動かす（音の長さは変えない）
export const rescaleTracksForTempo = (tracks, oldBpm, newBpm, pixelsPerSecond) => {
  const fromBeat = beatWidthPx(oldBpm, pixelsPerSecond);
  const toBeat = beatWidthPx(newBpm, pixelsPerSecond);
  if (fromBeat === toBeat) return tracks;
  return tracks.map((track) => ({
    ...track,
    clips: track.clips.map((clip) => ({ ...clip, startTime: convertUnits(clip.startTime, fromBeat, toBeat) }))
  }));
};

// 小節番号を何小節おきに書くか（ズームアウトして小節が狭いときは間引く）
export const getMeasureLabelInterval = (measurePx, minLabelPx = 32) => {
  if (!(measurePx > 0)) return 1;
  return Math.max(1, Math.ceil(minLabelPx / measurePx));
};
