import {
  DEFAULT_CLIP_WIDTH,
  DEFAULT_PIXELS_PER_SECOND,
  PROJECT_VERSION,
  ZOOM_LEVELS,
  deserializeProject,
  findNonOverlappingPosition,
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
    const scaled = rescaleTracks(tracks, 1.5);
    expect(scaled[0].clips[0]).toMatchObject({ startTime: 150, duration: 75 });
    expect(scaled[0].clips[0].soundData).toBe(drum);
    expect(tracks[0].clips[0].startTime).toBe(100);
  });

  test('拡大→縮小で元の位置に戻る', () => {
    const tracks = [{ id: 1, clips: [{ id: 1, startTime: 230, duration: 70 }] }];
    const back = rescaleTracks(rescaleTracks(tracks, 150 / 100), 100 / 150);
    expect(back[0].clips[0].startTime).toBeCloseTo(230);
    expect(back[0].clips[0].duration).toBeCloseTo(70);
  });
});

describe('findNonOverlappingPosition（クリップが重ならない位置）', () => {
  const clips = [
    { id: 'a', startTime: 100, duration: 100 }, // 100-200
    { id: 'b', startTime: 300, duration: 100 } // 300-400
  ];

  test('重ならなければその位置のまま', () => {
    expect(findNonOverlappingPosition(clips, 0, 100)).toBe(0);
    expect(findNonOverlappingPosition(clips, 200, 100)).toBe(200);
    expect(findNonOverlappingPosition([], 123, 50)).toBe(123);
  });

  test('重なる場合は一番近い空き位置に置く', () => {
    expect(findNonOverlappingPosition(clips, 150, 50)).toBe(200); // a の直後
    expect(findNonOverlappingPosition(clips, 110, 50)).toBe(50); // a の直前
    expect(findNonOverlappingPosition(clips, 350, 100)).toBe(400); // b の直後
  });

  test('空きが無いすき間には入れない', () => {
    // 200-300 のすき間(100)に 150 は入らない
    const position = findNonOverlappingPosition(clips, 220, 150);
    const end = position + 150;
    clips.forEach((c) => {
      expect(position < c.startTime + c.duration && end > c.startTime).toBe(false);
    });
  });

  test('移動中の自分自身とは重なりを判定しない', () => {
    expect(findNonOverlappingPosition(clips, 120, 100, 'a')).toBe(120);
  });

  test('スナップで重なる場合はスナップしない', () => {
    const snap = (value) => Math.round(value / 30) * 30;
    const position = findNonOverlappingPosition(clips, 150, 50, null, snap);
    const end = position + 50;
    clips.forEach((c) => {
      expect(position < c.startTime + c.duration && end > c.startTime).toBe(false);
    });
  });

  test('結果は 0 以上', () => {
    expect(findNonOverlappingPosition([{ id: 'x', startTime: 0, duration: 100 }], 10, 50)).toBe(100);
  });
});
