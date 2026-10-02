// クリップに表示する波形（実際の音の大きさの変化）
//
// 以前はクリップ ID から作った模様を表示していて、音の形とは関係がなかった。
// デコード済みの AudioBuffer から音の大きさの包絡（1 秒あたり 100 点）を 1 回だけ計算しておき、
// 表示するときはクリップの幅に合わせて点を減らして使う（ズームのたびに全サンプルを見直さない）。

const ENVELOPE_POINTS_PER_SECOND = 100;
const MAX_ENVELOPE_POINTS = 12000; // 2 分ぶん
// 1 点あたりで調べるサンプル数の上限（長い音でも古い iPad で重くならないように間引く）
const MAX_SAMPLES_PER_POINT = 96;

const envelopeCache = new WeakMap(); // AudioBuffer → Float32Array

export const computeEnvelope = (buffer, pointsPerSecond = ENVELOPE_POINTS_PER_SECOND) => {
  if (!buffer || !(buffer.length > 0) || !(buffer.numberOfChannels > 0)) return new Float32Array(0);
  const channels = [];
  for (let i = 0; i < buffer.numberOfChannels; i++) {
    channels.push(buffer.getChannelData(i));
  }
  const duration = buffer.duration > 0 ? buffer.duration : buffer.length / (buffer.sampleRate || 44100);
  const count = Math.max(1, Math.min(MAX_ENVELOPE_POINTS, Math.round(duration * pointsPerSecond)));
  const samplesPerPoint = buffer.length / count;
  const envelope = new Float32Array(count);
  let loudest = 0;

  for (let point = 0; point < count; point++) {
    const start = Math.floor(point * samplesPerPoint);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor((point + 1) * samplesPerPoint)));
    const stride = Math.max(1, Math.floor((end - start) / MAX_SAMPLES_PER_POINT));
    let peak = 0;
    for (let c = 0; c < channels.length; c++) {
      const data = channels[c];
      for (let i = start; i < end; i += stride) {
        const value = Math.abs(data[i]);
        if (value > peak) peak = value;
      }
    }
    envelope[point] = peak;
    if (peak > loudest) loudest = peak;
  }

  // 小さな音でも形が見えるよう、一番大きいところを 1 にそろえる（無音はそのまま）
  if (loudest > 0.001) {
    for (let point = 0; point < count; point++) envelope[point] /= loudest;
  }
  return envelope;
};

export const getEnvelope = (buffer) => {
  if (!buffer || typeof buffer !== 'object') return new Float32Array(0);
  if (!envelopeCache.has(buffer)) envelopeCache.set(buffer, computeEnvelope(buffer));
  return envelopeCache.get(buffer);
};

// 点の数を count 個に減らす（区間の最大値を使い、短い大きな音が消えないようにする）
export const resampleEnvelope = (envelope, count) => {
  const target = Math.max(1, Math.floor(count));
  if (!envelope || envelope.length === 0) return [];
  if (envelope.length <= target) return Array.from(envelope);
  const result = new Array(target);
  const size = envelope.length / target;
  for (let i = 0; i < target; i++) {
    const start = Math.floor(i * size);
    const end = Math.max(start + 1, Math.floor((i + 1) * size));
    let peak = 0;
    for (let j = start; j < end && j < envelope.length; j++) {
      if (envelope[j] > peak) peak = envelope[j];
    }
    result[i] = peak;
  }
  return result;
};

// クリップの幅（ピクセル）から表示する点の数を決める（およそ 3px に 1 本）
export const getWaveformPointCount = (widthPx) => Math.max(8, Math.min(400, Math.round((widthPx || 0) / 3)));

// SVG の path（viewBox="0 0 点の数 100"、preserveAspectRatio="none" で幅いっぱいに伸ばす）
export const buildWaveformPath = (peaks, height = 100) => {
  const round = (value) => Math.round(value * 100) / 100;
  return peaks.map((peak, index) => {
    const barHeight = Math.max(2, Math.min(1, peak) * height * 0.92);
    const top = (height - barHeight) / 2;
    return `M${round(index + 0.15)} ${round(top)}h0.7v${round(barHeight)}h-0.7z`;
  }).join('');
};
