import {
  DEFAULT_CLIP_WIDTH,
  DEFAULT_PIXELS_PER_SECOND,
  PROJECT_VERSION,
  ZOOM_LEVELS,
  deserializeProject,
  findFreePosition,
  getNextZoomLevel,
  rescaleTracks,
  serializeProject
} from '../../utils/project';
import { makeDataUrl } from '../../test-utils/audioFixtures';

const drum = { id: 1, name: 'たいこ', tags: ['楽器'], audioData: makeDataUrl('mp4', 'audio/mp4', 50), audioBlob: new Blob(['x']), url: 'blob:abc' };
const bell = { id: 2, name: 'すず', tags: [], audioData: makeDataUrl('wav', 'audio/wav', 30), audioBlob: new Blob(['y']) };

const clip = (id, sound, startTime, duration = 100) => ({ id, soundData: sound, startTime, duration, trackId: 't1' });

describe('serializeProject（保存用のデータ作成）', () => {
  const tracks = [
    { id: 't1', name: 'トラック 1', clips: [clip('c1', drum, 0), clip('c2', drum, 100), clip('c3', bell, 300)] },
    { id: 't2', name: 'トラック 2', clips: [clip('c4', drum, 50)] }
  ];

  test('同じ音を何回使っても音声データは 1 回だけ保存する', () => {
    const data = serializeProject({ tracks, pixelsPerSecond: 100, trackNameCounter: 2, trackIdCounter: 3 });
    expect(data.version).toBe(PROJECT_VERSION);
    expect(Object.keys(data.assets)).toHaveLength(2);
    expect(Object.values(data.assets)).toEqual(expect.arrayContaining([drum.audioData, bell.audioData]));
    const refs = data.tracks.flatMap((track) => track.clips.map((c) => c.audioRef));
    expect(new Set(refs).size).toBe(2);
    expect(refs[0]).toBe(refs[1]);
    expect(refs[0]).toBe(refs[3]);
  });

  test('クリップには音声データ・Blob・blob URL を含めない', () => {
    const data = serializeProject({ tracks, pixelsPerSecond: 100 });
    const json = JSON.stringify(data.tracks);
    expect(json).not.toContain('base64');
    expect(json).not.toContain('blob:abc');
    const soundData = data.tracks[0].clips[0].soundData;
    expect(soundData).toEqual({ id: 1, name: 'たいこ', tags: ['楽器'] });
  });

  test("includeSounds: 'used' ではライブラリの音を含めない（クラウド保存を軽くする）", () => {
    const data = serializeProject({ tracks, sounds: [drum, bell, { id: 3, name: '未使用', audioData: makeDataUrl('ogg', 'audio/ogg') }], pixelsPerSecond: 100 });
    expect(data.sounds).toEqual([]);
    expect(Object.keys(data.assets)).toHaveLength(2);
  });

  test("includeSounds: 'all' ではライブラリの音も含め、使用中の音と共有する", () => {
    const unused = { id: 3, name: '未使用', tags: [], audioData: makeDataUrl('ogg', 'audio/ogg') };
    const data = serializeProject({ tracks, sounds: [drum, bell, unused], pixelsPerSecond: 100 }, { includeSounds: 'all' });
    expect(data.sounds).toHaveLength(3);
    expect(Object.keys(data.assets)).toHaveLength(3);
    expect(data.sounds[0].audioRef).toBe(data.tracks[0].clips[0].audioRef);
    expect(data.sounds[2]).not.toHaveProperty('audioData');
  });

  test('ドラッグ中の一時的な値 originalTrackId は保存しない', () => {
    const data = serializeProject({ tracks: [{ id: 't1', name: 'x', clips: [{ ...clip('c1', drum, 0), originalTrackId: 't9' }] }], pixelsPerSecond: 100 });
    expect(data.tracks[0].clips[0]).not.toHaveProperty('originalTrackId');
  });

  test('soundData の無い壊れたクリップは保存しない', () => {
    const data = serializeProject({ tracks: [{ id: 't1', name: 'x', clips: [null, { id: 'bad' }, clip('c1', drum, 0)] }], pixelsPerSecond: 100 });
    expect(data.tracks[0].clips).toHaveLength(1);
  });

  test('JSON にしても元に戻せる（往復テスト）', () => {
    const data = JSON.parse(JSON.stringify(serializeProject({ tracks, pixelsPerSecond: 150, trackNameCounter: 5, trackIdCounter: 9 })));
    const project = deserializeProject(data);
    expect(project.pixelsPerSecond).toBe(150);
    expect(project.trackNameCounter).toBe(5);
    expect(project.trackIdCounter).toBe(9);
    expect(project.tracks).toHaveLength(2);
    expect(project.tracks[0].clips.map((c) => c.startTime)).toEqual([0, 100, 300]);
    expect(project.tracks[0].clips[0].soundData.audioData).toBe(drum.audioData);
    expect(project.tracks[0].clips[0].soundData.audioBlob).toBeInstanceOf(Blob);
    expect(project.tracks[0].clips[0].soundData.audioBlob.type).toBe('audio/mp4');
    expect(project.missingAudioCount).toBe(0);
  });
});

describe('deserializeProject（保存データの読み込み）', () => {
  test('同じ音声のクリップは同じ Blob を共有する（デコードが 1 回で済む）', () => {
    const data = serializeProject({ tracks: [{ id: 1, name: 'a', clips: [clip('c1', drum, 0), clip('c2', drum, 200)] }], pixelsPerSecond: 100 });
    const project = deserializeProject(data);
    const [first, second] = project.tracks[0].clips;
    expect(first.soundData.audioBlob).toBe(second.soundData.audioBlob);
    expect(project.usedSounds).toHaveLength(1);
  });

  test('旧形式 v1（クリップに音声を埋め込み）も読み込める', () => {
    const v1 = {
      version: '1.0',
      pixelsPerSecond: 100,
      tracks: [{ id: 111, name: 'トラック 1', clips: [{ id: 5, startTime: 40, duration: 120, trackId: 111, soundData: { id: 9, name: 'かね', tags: [], audioData: makeDataUrl('mp4', 'audio/wav') } }] }],
      sounds: [{ id: 9, name: 'かね', tags: [], audioData: makeDataUrl('mp4', 'audio/wav'), audioBlob: null }]
    };
    const project = deserializeProject(v1);
    const restored = project.tracks[0].clips[0];
    expect(restored.startTime).toBe(40);
    // 中身は mp4 なのに audio/wav と書かれていた古いデータの表記も直す
    expect(restored.soundData.audioData.startsWith('data:audio/mp4;base64,')).toBe(true);
    expect(restored.soundData.audioBlob.type).toBe('audio/mp4');
    expect(project.sounds).toHaveLength(1);
  });

  test('音声が含まれない旧形式の自動保存は、名前でライブラリから補う', () => {
    const legacy = {
      version: '1.0',
      tracks: [{ id: 1, name: 't', clips: [{ id: 1, startTime: 0, duration: 100, soundData: { name: 'たいこ', audioBlob: {} } }] }]
    };
    const findSoundByName = jest.fn((name) => (name === 'たいこ' ? drum : null));
    const project = deserializeProject(legacy, { findSoundByName });
    expect(findSoundByName).toHaveBeenCalledWith('たいこ');
    expect(project.tracks[0].clips[0].soundData.audioData).toBe(drum.audioData);
    expect(project.missingAudioCount).toBe(0);
  });

  test('音声が見つからないクリップも位置は残し、数を報告する', () => {
    const data = { version: '2.0', tracks: [{ id: 1, name: 't', clips: [{ id: 1, startTime: 0, duration: 100, audioRef: 'missing', soundData: { name: '消えた音' } }] }], assets: {} };
    const project = deserializeProject(data);
    expect(project.tracks[0].clips).toHaveLength(1);
    expect(project.tracks[0].clips[0].soundData.audioBlob).toBeNull();
    expect(project.missingAudioCount).toBe(1);
    expect(project.usedSounds).toHaveLength(0);
  });

  test('名前の無いクリップや壊れたクリップは除外して数を報告する', () => {
    const data = { version: '2.0', tracks: [{ id: 1, name: 't', clips: [null, {}, { soundData: {} }, { id: 2, startTime: 0, duration: 10, soundData: { name: 'ok' } }] }] };
    const project = deserializeProject(data);
    expect(project.tracks[0].clips).toHaveLength(1);
    expect(project.droppedClipCount).toBe(3);
  });

  test('位置・長さ・倍率が不正な値なら既定値にする', () => {
    const data = {
      version: '2.0',
      pixelsPerSecond: 'abc',
      tracks: [{ id: 1, name: 't', clips: [{ id: 1, startTime: -10, duration: NaN, soundData: { name: 'x' } }, { id: 2, startTime: 'x', duration: 0, soundData: { name: 'y' } }] }]
    };
    const project = deserializeProject(data);
    expect(project.pixelsPerSecond).toBe(DEFAULT_PIXELS_PER_SECOND);
    expect(project.tracks[0].clips.map((c) => [c.startTime, c.duration])).toEqual([[0, DEFAULT_CLIP_WIDTH], [0, DEFAULT_CLIP_WIDTH]]);
    expect(project.trackNameCounter).toBeNull();
  });

  test('重複・不正なトラック ID は振り直し、クリップの trackId もそろえる', () => {
    const data = { version: '2.0', tracks: [{ id: 5, name: 'a', clips: [] }, { id: 5, name: 'b', clips: [{ id: 1, startTime: 0, duration: 10, trackId: 5, soundData: { name: 'x' } }] }, { name: 'c', clips: [] }, null] };
    const project = deserializeProject(data);
    const ids = project.tracks.map((t) => String(t.id));
    expect(project.tracks).toHaveLength(3);
    expect(new Set(ids).size).toBe(3);
    expect(project.tracks[1].clips[0].trackId).toBe(project.tracks[1].id);
  });

  test('tracks が無いデータはエラー', () => {
    expect(() => deserializeProject(null)).toThrow('不正なプロジェクトデータです');
    expect(() => deserializeProject({ version: '1.0' })).toThrow();
    expect(() => deserializeProject('text')).toThrow();
  });

  test('ライブラリ用の音素材に音声が無いものは含めない', () => {
    const data = { version: '2.0', tracks: [], sounds: [{ name: 'a', audioRef: 'a1' }, { name: 'b', audioRef: 'nope' }, { audioRef: 'a1' }], assets: { a1: drum.audioData } };
    const project = deserializeProject(data);
    expect(project.sounds.map((s) => s.name)).toEqual(['a']);
    expect(project.sounds[0]).not.toHaveProperty('audioRef');
  });

  test('壊れた音声データでも例外にせず、音声なしとして扱う', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const data = { version: '2.0', tracks: [{ id: 1, name: 't', clips: [{ id: 1, startTime: 0, duration: 10, audioRef: 'a1', soundData: { name: 'x' } }] }], assets: { a1: 'data:audio/wav;base64,' } };
    const project = deserializeProject(data);
    expect(project.tracks[0].clips[0].soundData.audioBlob).toBeNull();
    expect(project.missingAudioCount).toBe(1);
    spy.mockRestore();
  });
});

describe('getNextZoomLevel（ズーム）', () => {
  test('1 段階ずつ拡大・縮小する', () => {
    expect(getNextZoomLevel(100, true)).toBe(150);
    expect(getNextZoomLevel(100, false)).toBe(67);
  });

  test('端では止まる', () => {
    expect(getNextZoomLevel(ZOOM_LEVELS[ZOOM_LEVELS.length - 1], true)).toBe(400);
    expect(getNextZoomLevel(ZOOM_LEVELS[0], false)).toBe(25);
  });

  test('一覧に無い倍率は最も近い段階から動かす', () => {
    expect(getNextZoomLevel(120, true)).toBe(150);
    expect(getNextZoomLevel(120, false)).toBe(67);
    expect(getNextZoomLevel(140, false)).toBe(100);
  });
});

describe('rescaleTracks（ズーム時のクリップ位置）', () => {
  test('位置と長さを同じ比率で伸縮し、元のデータは変更しない', () => {
    const tracks = [{ id: 1, clips: [{ id: 1, startTime: 100, duration: 50, soundData: drum }] }];
    const scaled = rescaleTracks(tracks, 100, 150);
    expect(scaled[0].clips[0]).toMatchObject({ startTime: 150, duration: 75 });
    expect(scaled[0].clips[0].soundData).toBe(drum);
    expect(tracks[0].clips[0].startTime).toBe(100);
  });

  test('拡大→縮小で元の位置に戻る（何度くり返しても誤差がたまらない）', () => {
    let tracks = [{ id: 1, clips: [{ id: 1, startTime: 230, duration: 70 }] }];
    const levels = [100, 67, 25, 400, 150, 100];
    for (let round = 0; round < 20; round++) {
      for (let i = 1; i < levels.length; i++) tracks = rescaleTracks(tracks, levels[i - 1], levels[i]);
    }
    // 2.3 × 100 のような掛け算そのものの誤差（1 兆分の 1 程度）は残るが、くり返してもたまらない
    expect(tracks[0].clips[0].startTime).toBeCloseTo(230, 9);
    expect(tracks[0].clips[0].duration).toBeCloseTo(70, 9);
  });

  test('倍率が同じならそのまま返す', () => {
    const tracks = [{ id: 1, clips: [] }];
    expect(rescaleTracks(tracks, 100, 100)).toBe(tracks);
  });
});

describe('findFreePosition（クリップが重ならない位置）', () => {
  const clips = [
    { id: 'a', startTime: 100, duration: 100 }, // 100-200
    { id: 'b', startTime: 300, duration: 100 } // 300-400
  ];
  const overlapsAny = (position, duration) => clips.some((c) => position < c.startTime + c.duration && position + duration > c.startTime);

  test('重ならなければその位置のまま', () => {
    expect(findFreePosition(clips, 0, 100)).toBe(0);
    expect(findFreePosition(clips, 200, 100)).toBe(200);
    expect(findFreePosition([], 123, 50)).toBe(123);
  });

  test('重なる場合は一番近い空き位置に置く', () => {
    expect(findFreePosition(clips, 150, 50)).toBe(200); // a の直後
    expect(findFreePosition(clips, 110, 50)).toBe(50); // a の直前
    expect(findFreePosition(clips, 350, 100)).toBe(400); // b の直後
  });

  test('空きが無いすき間には入れない', () => {
    // 200-300 のすき間(100)に 150 は入らない
    const position = findFreePosition(clips, 220, 150);
    expect(overlapsAny(position, 150)).toBe(false);
  });

  test('移動中の自分自身とは重なりを判定しない', () => {
    expect(findFreePosition(clips, 120, 100, { excludeClipId: 'a' })).toBe(120);
  });

  test('結果は 0 以上', () => {
    expect(findFreePosition([{ id: 'x', startTime: 0, duration: 100 }], 10, 50)).toBe(100);
  });

  test('ぴったり隣り合うのは重なりとみなさない（小数の誤差があっても）', () => {
    expect(findFreePosition(clips, 200.0000000001, 100)).toBeCloseTo(200);
    expect(findFreePosition([{ id: 'x', startTime: 0, duration: 49.99999999 }], 50, 50)).toBe(50);
  });

  describe('拍に合わせるとき（step）', () => {
    test('置く位置を一番近い拍にそろえる', () => {
      expect(findFreePosition([], 74, 30, { step: 50 })).toBe(50);
      expect(findFreePosition([], 76, 30, { step: 50 })).toBe(100);
    });

    test('ずらした先も拍の上にする（前の音の終わりがずれていても次の拍へ）', () => {
      const offBeat = [{ id: 'a', startTime: 0, duration: 130 }]; // 0-130（2.6 拍）
      expect(findFreePosition(offBeat, 100, 40, { step: 50 })).toBe(150);
    });

    test('前に入るときも拍の上にする', () => {
      const later = [{ id: 'a', startTime: 210, duration: 100 }];
      // 200 に置くと重なる → 前は 210-60=150 → 拍にそろえて 150、後ろは 310→350。近い方の 150
      expect(findFreePosition(later, 200, 60, { step: 50 })).toBe(150);
    });

    test("direction: 'forward' では後ろの空きだけを探す（＋ボタンで順に並べるとき）", () => {
      expect(findFreePosition(clips, 110, 50, { step: 50, direction: 'forward' })).toBe(200);
      expect(findFreePosition(clips, 110, 50, { step: 50 })).toBe(50);
    });
  });
});

describe('テンポ・拍子の保存', () => {
  const tracks = [{ id: 't1', name: 'トラック 1', muted: true, clips: [clip('c1', drum, 0)] }];

  test('テンポ・拍子・合わせ方・メトロノーム・ミュートを保存して読み込める', () => {
    const data = JSON.parse(JSON.stringify(serializeProject({
      tracks, pixelsPerSecond: 100, bpm: 90, beatsPerMeasure: 3, snapMode: 'half', metronome: true
    })));
    expect(data).toMatchObject({ bpm: 90, beatsPerMeasure: 3, snapMode: 'half', metronome: true });
    const project = deserializeProject(data);
    expect(project).toMatchObject({ bpm: 90, beatsPerMeasure: 3, snapMode: 'half', metronome: true });
    expect(project.tracks[0].muted).toBe(true);
  });

  test('テンポなどが無い以前の楽曲は既定値で開く', () => {
    const data = serializeProject({ tracks, pixelsPerSecond: 100 });
    delete data.bpm;
    delete data.beatsPerMeasure;
    delete data.snapMode;
    delete data.metronome;
    data.tracks[0].muted = undefined;
    const project = deserializeProject(data);
    expect(project).toMatchObject({ bpm: 120, beatsPerMeasure: 4, snapMode: 'beat', metronome: false });
    expect(project.tracks[0].muted).toBe(false);
  });

  test('不正な値は範囲内・選べる値に直す', () => {
    const project = deserializeProject({
      tracks: [], pixelsPerSecond: 100, bpm: 9999, beatsPerMeasure: 7, snapMode: 'quarter', metronome: 'yes'
    });
    expect(project).toMatchObject({ bpm: 200, beatsPerMeasure: 4, snapMode: 'beat', metronome: false });
    expect(deserializeProject({ tracks: [], bpm: 'abc' }).bpm).toBe(120);
  });
});
