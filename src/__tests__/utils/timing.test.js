import {
  DEFAULT_BPM,
  EXTRA_TIMELINE_MEASURES,
  MIN_TIMELINE_MEASURES,
  beatWidthPx,
  ceilToStep,
  clampBpm,
  describePosition,
  floorToStep,
  formatDuration,
  formatPosition,
  formatSeconds,
  getMeasureLabelInterval,
  getTimelineMeasureCount,
  measureWidthPx,
  normalizeBeatsPerMeasure,
  normalizeSnapMode,
  rescaleTracksForTempo,
  roundToStep,
  snapStepPx
} from '../../utils/timing';

const timing = { bpm: 120, beatsPerMeasure: 4, pixelsPerSecond: 100 };

describe('拍と小節の幅', () => {
  test('120 BPM では 1 拍 0.5 秒（100px/秒で 50px）、4 拍子の 1 小節は 200px', () => {
    expect(beatWidthPx(120, 100)).toBe(50);
    expect(measureWidthPx(120, 4, 100)).toBe(200);
    expect(measureWidthPx(120, 3, 100)).toBe(150);
  });

  test('ズーム倍率に比例する', () => {
    expect(beatWidthPx(120, 200)).toBe(100);
    expect(beatWidthPx(60, 50)).toBe(50);
  });

  test('合わせる間隔: 拍・半拍・合わせない（0.05 秒）', () => {
    expect(snapStepPx({ bpm: 120, pixelsPerSecond: 100, snapMode: 'beat' })).toBe(50);
    expect(snapStepPx({ bpm: 120, pixelsPerSecond: 100, snapMode: 'half' })).toBe(25);
    expect(snapStepPx({ bpm: 120, pixelsPerSecond: 100, snapMode: 'off' })).toBeCloseTo(5);
  });
});

describe('値の正規化', () => {
  test('テンポは 40〜200 の整数にする', () => {
    expect(clampBpm(10)).toBe(40);
    expect(clampBpm(500)).toBe(200);
    expect(clampBpm(99.6)).toBe(100);
    expect(clampBpm('abc')).toBe(DEFAULT_BPM);
    expect(clampBpm(undefined)).toBe(DEFAULT_BPM);
  });

  test('拍子と合わせ方は選べる値だけ', () => {
    expect(normalizeBeatsPerMeasure(3)).toBe(3);
    expect(normalizeBeatsPerMeasure('2')).toBe(2);
    expect(normalizeBeatsPerMeasure(5)).toBe(4);
    expect(normalizeSnapMode('half')).toBe('half');
    expect(normalizeSnapMode('xxx')).toBe('beat');
  });
});

describe('目盛りへのそろえ方', () => {
  test('一番近い・次の・前の目盛り', () => {
    expect(roundToStep(74, 50)).toBe(50);
    expect(roundToStep(75, 50)).toBe(100);
    expect(ceilToStep(101, 50)).toBe(150);
    expect(floorToStep(149, 50)).toBe(100);
  });

  test('ちょうど目盛りの上（小数の誤差込み）ならそのまま', () => {
    expect(ceilToStep(100.0000000001, 50)).toBe(100);
    expect(floorToStep(99.9999999999, 50)).toBe(100);
  });

  test('間隔が 0 ならそろえない', () => {
    expect(roundToStep(74, 0)).toBe(74);
    expect(ceilToStep(74, 0)).toBe(74);
  });
});

describe('位置の表し方', () => {
  test('何小節目の何拍目か（1 から数える）', () => {
    expect(describePosition(0, timing)).toMatchObject({ measure: 1, beat: 1, seconds: 0 });
    expect(describePosition(50, timing)).toMatchObject({ measure: 1, beat: 2 });
    expect(describePosition(199, timing)).toMatchObject({ measure: 1, beat: 4 });
    expect(describePosition(200, timing)).toMatchObject({ measure: 2, beat: 1, seconds: 2 });
    expect(formatPosition(450, timing)).toBe('3小節 2拍');
    expect(formatPosition(450, { ...timing, beatsPerMeasure: 3 })).toBe('4小節 1拍');
  });

  test('小数の誤差で 1 つ前の拍にならない', () => {
    expect(describePosition(49.99999999, timing).beat).toBe(2);
  });

  test('秒・音の長さの表示', () => {
    expect(formatSeconds(0)).toBe('0:00');
    expect(formatSeconds(65.4)).toBe('1:05');
    expect(formatSeconds(NaN)).toBe('0:00');
    expect(formatDuration(0.64)).toBe('0.6秒');
    expect(formatDuration(3)).toBe('3.0秒');
    expect(formatDuration(12.4)).toBe('12秒');
    expect(formatDuration(0)).toBe('');
  });
});

describe('タイムラインの長さ', () => {
  test('音が無くても最低限の小節を表示する', () => {
    expect(getTimelineMeasureCount({ contentEndPx: 0, ...timing })).toBe(MIN_TIMELINE_MEASURES);
  });

  test('音の後ろにも余白の小節を残す', () => {
    // 30 小節目の途中まで音がある → 30 + 余白
    const contentEndPx = 29.5 * 200;
    expect(getTimelineMeasureCount({ contentEndPx, ...timing })).toBe(30 + EXTRA_TIMELINE_MEASURES);
  });

  test('小節番号は狭いときに間引く', () => {
    expect(getMeasureLabelInterval(200)).toBe(1);
    expect(getMeasureLabelInterval(20)).toBe(2);
    expect(getMeasureLabelInterval(10)).toBe(4);
  });
});

describe('テンポを変えたときのクリップの位置', () => {
  const tracks = [{ id: 't1', clips: [{ id: 'a', startTime: 100, duration: 30 }, { id: 'b', startTime: 250, duration: 80 }] }];

  test('同じ拍の上に残るよう開始位置だけを動かし、長さは変えない', () => {
    // 120 → 60: 1 拍の幅が 2 倍になる
    const slower = rescaleTracksForTempo(tracks, 120, 60);
    expect(slower[0].clips.map((c) => c.startTime)).toEqual([200, 500]);
    expect(slower[0].clips.map((c) => c.duration)).toEqual([30, 80]);
    // 120 → 240（上限 200 に丸める）
    const faster = rescaleTracksForTempo(tracks, 120, 200);
    expect(faster[0].clips[0].startTime).toBeCloseTo(60);
  });

  test('元のデータは変えず、同じテンポならそのまま返す', () => {
    rescaleTracksForTempo(tracks, 120, 60);
    expect(tracks[0].clips[0].startTime).toBe(100);
    expect(rescaleTracksForTempo(tracks, 120, 120)).toBe(tracks);
  });
});
