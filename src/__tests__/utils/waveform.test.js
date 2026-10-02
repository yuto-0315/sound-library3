import { buildWaveformPath, computeEnvelope, getEnvelope, getWaveformPointCount, resampleEnvelope } from '../../utils/waveform';

const makeBuffer = (samples, sampleRate = 1000, channels = 1) => {
  const data = Array.from({ length: channels }, (_, channel) => Float32Array.from(samples.map((value) => value * (channel === 1 ? 0.5 : 1))));
  return {
    numberOfChannels: channels,
    length: samples.length,
    sampleRate,
    duration: samples.length / sampleRate,
    getChannelData: (channel) => data[channel]
  };
};

describe('computeEnvelope（音の大きさの包絡）', () => {
  test('1 秒あたり 100 点で、区間の一番大きい音を取り、一番大きいところを 1 にそろえる', () => {
    // 1 秒（1000 サンプル）。前半は小さく、後半は大きい
    const samples = Array.from({ length: 1000 }, (_, i) => (i < 500 ? 0.1 : -0.4));
    const envelope = computeEnvelope(makeBuffer(samples));
    expect(envelope).toHaveLength(100);
    expect(envelope[0]).toBeCloseTo(0.25); // 0.1 / 0.4
    expect(envelope[99]).toBeCloseTo(1);
  });

  test('ステレオは大きい方のチャンネルを使う', () => {
    const envelope = computeEnvelope(makeBuffer([0.2, 0.2, 0.2, 0.2], 400, 2));
    expect(Array.from(envelope)).toEqual([1]);
  });

  test('無音はそのまま 0、空の音は空', () => {
    expect(Array.from(computeEnvelope(makeBuffer([0, 0, 0, 0], 400)))).toEqual([0]);
    expect(computeEnvelope(null)).toHaveLength(0);
    expect(computeEnvelope({ numberOfChannels: 1, length: 0 })).toHaveLength(0);
  });

  test('同じ音は 1 回だけ計算する（ズームのたびに全部のサンプルを見直さない）', () => {
    const buffer = makeBuffer(Array.from({ length: 1000 }, () => 0.5));
    const spy = jest.spyOn(buffer, 'getChannelData');
    const first = getEnvelope(buffer);
    expect(getEnvelope(buffer)).toBe(first);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('resampleEnvelope（表示する点の数に減らす）', () => {
  test('区間の最大値を使い、短い大きな音が消えない', () => {
    const envelope = Float32Array.from([0, 0, 1, 0, 0, 0, 0, 0.5]);
    expect(resampleEnvelope(envelope, 2)).toEqual([1, 0.5]);
    expect(resampleEnvelope(envelope, 4)).toEqual([0, 1, 0, 0.5]);
  });

  test('点が足りないときはそのまま', () => {
    expect(resampleEnvelope(Float32Array.from([0.5, 1]), 10)).toEqual([0.5, 1]);
    expect(resampleEnvelope(new Float32Array(0), 10)).toEqual([]);
  });
});

describe('波形の描き方', () => {
  test('クリップの幅から点の数を決める（およそ 3px に 1 本、8〜400 本）', () => {
    expect(getWaveformPointCount(300)).toBe(100);
    expect(getWaveformPointCount(5)).toBe(8);
    expect(getWaveformPointCount(5000)).toBe(400);
  });

  test('点ごとに上下対称の棒を描く（無音でも細い線は出す）', () => {
    const path = buildWaveformPath([1, 0]);
    expect(path.split('M')).toHaveLength(3);
    expect(path).toContain('M0.15 4h0.7v92h-0.7z');
    expect(path).toContain('M1.15 49h0.7v2h-0.7z');
  });
});
