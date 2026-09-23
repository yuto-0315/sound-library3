import React from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DAWPage from '../pages/DAWPage';
import { addRecording, getAllRecordings, getProjectAutoSave, saveProjectAutoSave } from '../utils/indexedDB';
import { serializeProject } from '../utils/project';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, createMockAudioContext, makeDataUrl, readBlobBytes } from '../test-utils/audioFixtures';

const drumAudio = makeDataUrl('mp4', 'audio/mp4', 84); // 100 バイト → 1 秒
const bellAudio = makeDataUrl('wav', 'audio/wav', 184); // 200 バイト → 2 秒

let audioContext;
let storage;
let createdBlobs;

// jsdom には DragEvent が無く、fireEvent.drop の clientX が捨てられるので補う
class TestDragEvent extends MouseEvent {
  constructor(type, init = {}) {
    super(type, init);
    this.dataTransfer = init.dataTransfer || null;
  }
}

beforeEach(() => {
  window.DragEvent = TestDragEvent;
  installFakeIndexedDB();
  storage = installMemoryLocalStorage();
  audioContext = createMockAudioContext();
  window.AudioContext = jest.fn(() => audioContext);
  global.FileReader = TestFileReader;
  createdBlobs = [];
  URL.createObjectURL.mockImplementation((blob) => {
    createdBlobs.push(blob);
    return `blob:test-${createdBlobs.length}`;
  });
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

const renderDAW = async () => {
  const utils = render(<DAWPage />);
  await waitFor(() => expect(screen.queryByText('前回の作業内容を読み込んでいます...')).not.toBeInTheDocument());
  return utils;
};

const clipElements = (container) => Array.from(container.querySelectorAll('.audio-clip'));
const clipNames = (container) => clipElements(container).map((clip) => clip.querySelector('.clip-name').textContent);
const trackElements = (container) => Array.from(container.querySelectorAll('.track'));

const seedLibrary = async () => {
  const drumId = await addRecording({ name: 'たいこ', tags: ['楽器'], audioData: drumAudio });
  const bellId = await addRecording({ name: 'すず', tags: [], audioData: bellAudio });
  return { drumId, bellId };
};

const seedProject = async (clips, pixelsPerSecond = 100) => {
  await saveProjectAutoSave(serializeProject({
    tracks: [{ id: 101, name: 'トラック 1', clips }, { id: 102, name: 'トラック 2', clips: [] }],
    pixelsPerSecond
  }));
};

const drumClip = (id, startTime) => ({ id, startTime, duration: 100, trackId: 101, soundData: { name: 'たいこ', audioData: drumAudio } });
const bellClip = (id, startTime) => ({ id, startTime, duration: 200, trackId: 101, soundData: { name: 'すず', audioData: bellAudio } });

const createDataTransfer = (data = {}) => {
  const store = { ...data };
  return {
    setData: jest.fn((type, value) => { store[type] = value; }),
    getData: jest.fn((type) => store[type] || ''),
    setDragImage: jest.fn(),
    dropEffect: 'none',
    effectAllowed: 'all',
    store
  };
};

const touchEvent = (type, target, x, y) => {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }];
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'changedTouches', { value: [{ clientX: x, clientY: y }] });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
};

describe('再生（Web Audio）', () => {
  test('▶️ で全クリップを AudioContext の時計で予約し、⏹️ で止める', async () => {
    await seedProject([drumClip(1, 0), bellClip(2, 250)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));

    await waitFor(() => expect(audioContext.started.length).toBe(3)); // unlock 用 1 + クリップ 2
    const [, first, second] = audioContext.started;
    expect(first.when).toBeCloseTo(0.05);
    expect(first.offset).toBe(0);
    expect(second.when).toBeCloseTo(2.55); // 250px / 100px/s = 2.5 秒後
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(first.source.stop).toHaveBeenCalled();
    expect(second.source.stop).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
  });

  test('一時停止した位置から再開すると、途中のクリップは途中から鳴らす', async () => {
    await seedProject([bellClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));

    audioContext.currentTime = 1.05; // 1 秒再生した
    fireEvent.click(screen.getByRole('button', { name: '一時停止' }));
    expect(container.querySelector('.playhead').style.left).toBe('100px');

    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(4));
    const resumed = audioContext.started[3];
    expect(resumed.offset).toBeCloseTo(1); // 2 秒の音の 1 秒目から
    expect(resumed.when).toBeCloseTo(1.1);
  });

  test('停止すると先頭に戻る', async () => {
    await seedProject([bellClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    audioContext.currentTime = 1.05;
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    expect(container.querySelector('.playhead').style.left).toBe('0px');
  });

  test('準備中に停止したら、後から音が鳴り始めない（以前は停止後に鳴ることがあった）', async () => {
    let releaseDecode;
    const gate = new Promise((resolve) => { releaseDecode = resolve; });
    const original = audioContext.decodeAudioData;
    audioContext.decodeAudioData = jest.fn((buffer, ok, ng) => gate.then(() => original(buffer, ok, ng)));
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    fireEvent.click(screen.getByRole('button', { name: '停止' }));
    await act(async () => {
      releaseDecode();
      await gate;
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    expect(audioContext.started.length).toBe(1); // unlock 用の無音だけ
  });

  test('再生中の毎フレームで画面全体を描き直さない（プレイヘッドは直接動かす）', async () => {
    const frames = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    await seedProject([bellClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    const renderedClip = container.querySelector('.audio-clip');
    audioContext.currentTime = 0.55;
    act(() => {
      frames[frames.length - 1](0);
    });
    expect(container.querySelector('.playhead').style.left).toBe('50px');
    expect(container.querySelector('.audio-clip')).toBe(renderedClip);
  });

  test('最後のクリップまで再生したら自動で止まって先頭に戻る', async () => {
    const frames = [];
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(frames.length).toBeGreaterThan(0));
    audioContext.currentTime = 5;
    act(() => {
      frames[frames.length - 1](0);
    });
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    expect(container.querySelector('.playhead').style.left).toBe('0px');
  });

  test('デコードできない音があっても他の音は鳴らし、件数を知らせる', async () => {
    audioContext = createMockAudioContext({ failDecode: (buffer) => buffer.byteLength === 200 });
    window.AudioContext = jest.fn(() => audioContext);
    await seedProject([drumClip(1, 0), bellClip(2, 150)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(await screen.findByText(/1個のクリップの音を読み込めなかった/)).toBeInTheDocument();
    expect(audioContext.started.length).toBe(2);
  });

  test('iPad で音の再生が許可されなかったら、もう一度押すよう案内する', async () => {
    audioContext = createMockAudioContext({ state: 'suspended' });
    audioContext.resume = jest.fn(() => Promise.resolve()); // resume しても suspended のまま
    window.AudioContext = jest.fn(() => audioContext);
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(await screen.findByText(/もう一度「再生」ボタンを押してください/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
  });

  test('AudioContext が使えないブラウザではエラーを表示する', async () => {
    window.AudioContext = jest.fn(() => { throw new Error('not supported'); });
    await renderDAW();
    expect(screen.getByText(/音声の再生に対応していません/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(screen.getByText(/このブラウザでは音声を再生できません/)).toBeInTheDocument();
  });

  test('ページを離れると再生中の音を止めて AudioContext を閉じる', async () => {
    await seedProject([drumClip(1, 0)]);
    const { unmount } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    const clipSource = audioContext.started[1].source;
    unmount();
    expect(clipSource.stop).toHaveBeenCalled();
    expect(audioContext.close).toHaveBeenCalled();
  });

  test('同じ音素材は 1 回だけデコードする', async () => {
    await seedProject([drumClip(1, 0), drumClip(2, 200), drumClip(3, 400)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(4));
    expect(audioContext.decodeAudioData).toHaveBeenCalledTimes(1);
  });
});

describe('ドラッグ&ドロップ（マウス / iPad の長押しドラッグ）', () => {
  test('音素材をトラックに置くと、音の長さのクリップができる（ID だけを受け渡す）', async () => {
    const { drumId } = await seedLibrary();
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    const panel = container.querySelector('.sound-panel');
    const item = (await within(panel).findByText('たいこ')).closest('.sound-item');
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(item, { dataTransfer });
    expect(dataTransfer.store['text/plain']).toBe(`sound-id:${drumId}`);
    expect(JSON.stringify(dataTransfer.store)).not.toContain('base64'); // 音声データそのものは渡さない

    fireEvent.drop(trackElements(container)[1], { dataTransfer, clientX: 333 });
    await waitFor(() => expect(clipNames(container)).toEqual(['たいこ']));
    const clip = clipElements(container)[0];
    expect(clip.style.width).toBe('100px'); // 1 秒 × 100px
    expect(clip.style.left).toBe('330px'); // 0.1 秒単位にスナップ
    expect(clip.closest('.track')).toBe(trackElements(container)[1]);
  });

  test('重なる位置に置いたら隣の空いている位置にずらす', async () => {
    const { drumId } = await seedLibrary();
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    const dataTransfer = createDataTransfer({ 'text/plain': `sound-id:${drumId}` });
    fireEvent.drop(trackElements(container)[0], { dataTransfer, clientX: 150 });
    await waitFor(() => expect(clipElements(container)).toHaveLength(2));
    const lefts = clipElements(container).map((clip) => parseFloat(clip.style.left)).sort((a, b) => a - b);
    expect(lefts).toEqual([100, 200]);
  });

  test('見つからない音素材のドロップはエラーを表示する', async () => {
    const { container } = await renderDAW();
    fireEvent.drop(trackElements(container)[0], { dataTransfer: createDataTransfer({ 'text/plain': 'sound-id:999' }), clientX: 10 });
    expect(await screen.findByText(/音素材が見つかりません/)).toBeInTheDocument();
    expect(clipElements(container)).toHaveLength(0);
  });

  test('配置済みのクリップを別のトラックに移動できる', async () => {
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    const clip = clipElements(container)[0];
    const dataTransfer = createDataTransfer();
    fireEvent.dragStart(clip, { dataTransfer, clientX: 120 });
    expect(dataTransfer.store['text/plain']).toBe('existing-clip-1');
    fireEvent.drop(trackElements(container)[1], { dataTransfer, clientX: 420 });
    fireEvent.dragEnd(clip, { dataTransfer, clientX: 420, clientY: 50 });
    await waitFor(() => expect(trackElements(container)[1].querySelectorAll('.audio-clip')).toHaveLength(1));
    expect(trackElements(container)[0].querySelectorAll('.audio-clip')).toHaveLength(0);
    // 掴んだ位置（クリップの左端から 120px ずれ ではなく、getBoundingClientRect が 0 なので 120px）を考慮
    expect(trackElements(container)[1].querySelector('.audio-clip').style.left).toBe('300px');
  });

  test('ドラッグ中はドロップ予定位置の影を表示し、終わったら消す', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const track = trackElements(container)[0];
    fireEvent.dragOver(track, { dataTransfer: createDataTransfer(), clientX: 210 });
    await waitFor(() => expect(container.querySelector('.drag-preview')).not.toBeNull());
    expect(container.querySelector('.drag-preview').style.left).toBe('210px');
    expect(track.classList.contains('drag-over')).toBe(true);
    fireEvent.dragEnd(document);
    expect(container.querySelector('.drag-preview')).toBeNull();
    expect(track.classList.contains('drag-over')).toBe(false);
  });

  test('座標が取れないドロップでも位置が壊れない（0 の位置に置く）', async () => {
    const { drumId } = await seedLibrary();
    const { container } = await renderDAW();
    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: createDataTransfer({ 'text/plain': `sound-id:${drumId}` }) });
    act(() => {
      trackElements(container)[0].dispatchEvent(event);
    });
    await waitFor(() => expect(clipElements(container)).toHaveLength(1));
    expect(clipElements(container)[0].style.left).toBe('0px');
  });

  test('クリップの × ボタンで削除できる', async () => {
    await seedProject([drumClip(1, 0), bellClip(2, 200)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'たいこを削除' }));
    expect(clipNames(container)).toEqual(['すず']);
  });
});

describe('タッチ操作でのドラッグ', () => {
  test('音素材を指で横に動かしてトラックに置ける', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    const item = (await within(panel).findByText('すず')).closest('.sound-item');
    const track = trackElements(container)[0];
    document.elementFromPoint = jest.fn(() => track);

    touchEvent('touchstart', item, 10, 10);
    const move = touchEvent('touchmove', item, 60, 12);
    expect(move.defaultPrevented).toBe(true); // ドラッグ中は画面をスクロールさせない
    expect(document.querySelector('.mobile-drag-preview')).not.toBeNull();
    expect(document.body.classList.contains('dragging')).toBe(true);
    expect(document.body.style.position).toBe(''); // 以前のように position: fixed にしない
    touchEvent('touchend', item, 60, 12);

    await waitFor(() => expect(clipNames(container)).toEqual(['すず']));
    expect(document.querySelector('.mobile-drag-preview')).toBeNull();
    expect(document.body.classList.contains('dragging')).toBe(false);
  });

  test('音素材リストを縦に動かしたときはスクロールとして扱う（ドラッグしない）', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const item = (await within(container.querySelector('.sound-panel')).findByText('すず')).closest('.sound-item');
    document.elementFromPoint = jest.fn(() => trackElements(container)[0]);
    touchEvent('touchstart', item, 10, 10);
    const move = touchEvent('touchmove', item, 12, 80);
    expect(move.defaultPrevented).toBe(false);
    touchEvent('touchend', item, 12, 80);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(clipElements(container)).toHaveLength(0);
  });

  test('つまみ（⋮⋮）を持てば縦方向にもドラッグできる（縦並びの画面用）', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    const item = (await within(container.querySelector('.sound-panel')).findByText('すず')).closest('.sound-item');
    const handle = item.querySelector('.sound-drag-handle');
    document.elementFromPoint = jest.fn(() => trackElements(container)[1]);
    touchEvent('touchstart', handle, 10, 10);
    const move = touchEvent('touchmove', handle, 12, 300);
    expect(move.defaultPrevented).toBe(true);
    touchEvent('touchend', handle, 12, 300);
    await waitFor(() => expect(trackElements(container)[1].querySelectorAll('.audio-clip')).toHaveLength(1));
  });

  test('ドラッグ中に割り込まれても（touchcancel）画面がスクロールできない状態のまま残らない', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const item = (await within(container.querySelector('.sound-panel')).findByText('すず')).closest('.sound-item');
    document.elementFromPoint = jest.fn(() => trackElements(container)[0]);
    touchEvent('touchstart', item, 10, 10);
    touchEvent('touchmove', item, 80, 10);
    expect(document.body.classList.contains('dragging')).toBe(true);
    touchEvent('touchcancel', item, 80, 10);
    expect(document.body.classList.contains('dragging')).toBe(false);
    expect(document.querySelector('.mobile-drag-preview')).toBeNull();
    expect(clipElements(container)).toHaveLength(0);
  });

  test('トラックの外で指を離したら何もしない', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const item = (await within(container.querySelector('.sound-panel')).findByText('すず')).closest('.sound-item');
    document.elementFromPoint = jest.fn(() => document.body);
    touchEvent('touchstart', item, 10, 10);
    touchEvent('touchmove', item, 80, 10);
    touchEvent('touchend', item, 80, 10);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(clipElements(container)).toHaveLength(0);
  });

  test('配置済みのクリップを指で別のトラックに移動できる', async () => {
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    const clip = clipElements(container)[0];
    document.elementFromPoint = jest.fn(() => trackElements(container)[1]);
    touchEvent('touchstart', clip, 130, 20);
    const move = touchEvent('touchmove', clip, 130, 100);
    expect(move.defaultPrevented).toBe(true);
    touchEvent('touchmove', clip, 530, 100);
    touchEvent('touchend', clip, 530, 100);
    await waitFor(() => expect(trackElements(container)[1].querySelectorAll('.audio-clip')).toHaveLength(1));
    // 指を置いた位置（クリップ左端から 130px）を保ったまま移動する
    expect(trackElements(container)[1].querySelector('.audio-clip').style.left).toBe('400px');
  });

  test('クリップの × ボタンのタッチはドラッグにしない', async () => {
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    const removeButton = screen.getByRole('button', { name: 'たいこを削除' });
    document.elementFromPoint = jest.fn(() => trackElements(container)[1]);
    touchEvent('touchstart', removeButton, 10, 10);
    const move = touchEvent('touchmove', removeButton, 80, 80);
    expect(move.defaultPrevented).toBe(false);
    touchEvent('touchend', removeButton, 80, 80);
    expect(trackElements(container)[0].querySelectorAll('.audio-clip')).toHaveLength(1);
  });
});

describe('トラックとズーム', () => {
  test('ズームするとクリップの位置と長さが同じ比率で変わる', async () => {
    await seedProject([bellClip(1, 100)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン（拡大）' }));
    expect(screen.getByText('150%')).toBeInTheDocument();
    const clip = clipElements(container)[0];
    expect(clip.style.left).toBe('150px');
    expect(clip.style.width).toBe('300px');
    fireEvent.click(screen.getByRole('button', { name: 'ズームアウト（縮小）' }));
    fireEvent.click(screen.getByRole('button', { name: 'ズームアウト（縮小）' }));
    expect(screen.getByText('67%')).toBeInTheDocument();
    expect(parseFloat(clipElements(container)[0].style.left)).toBeCloseTo(67);
    // ズームしても音声を再デコードしない
    expect(audioContext.decodeAudioData).not.toHaveBeenCalled();
  });

  test('ズームしても再生のタイミング（秒）は変わらない', async () => {
    await seedProject([bellClip(1, 200)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン（拡大）' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    expect(audioContext.started[1].when).toBeCloseTo(2.05);
  });

  test('音が置かれたトラックを消すときは確認し、キャンセルできる', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'トラック 1を削除' }));
    expect(window.confirm).toHaveBeenCalled();
    expect(trackElements(container)).toHaveLength(2);
    window.confirm = jest.fn(() => true);
    fireEvent.click(screen.getByRole('button', { name: 'トラック 1を削除' }));
    expect(trackElements(container)).toHaveLength(1);
  });

  test('空のトラックは確認なしで消せる。最後の 1 つは消せない', async () => {
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(trackElements(container)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'トラック 2を削除' }));
    expect(window.confirm).not.toHaveBeenCalled();
    expect(trackElements(container)).toHaveLength(1);
    expect(screen.getByRole('button', { name: 'トラック 1を削除' })).toBeDisabled();
  });
});

describe('保存・読み込み・出力', () => {
  test('プロジェクト保存は音素材ライブラリも含め、音声は重複させない', async () => {
    await seedLibrary();
    await seedProject([drumClip(1, 0), drumClip(2, 200)]);
    await renderDAW();
    await waitFor(() => expect(screen.getAllByText('すず').length).toBeGreaterThan(0));
    fireEvent.click(screen.getByRole('button', { name: /プロジェクト保存/ }));
    const blob = createdBlobs[createdBlobs.length - 1];
    expect(blob.type).toBe('application/json');
    const data = JSON.parse(Buffer.from(readBlobBytes(blob)).toString('utf8'));
    expect(data.version).toBe('2.0');
    expect(data.sounds.map((s) => s.name).sort()).toEqual(['すず', 'たいこ']);
    expect(Object.keys(data.assets)).toHaveLength(2);
    expect(HTMLAnchorElement.prototype.click).toHaveBeenCalled();
  });

  test('プロジェクト読み込みで音素材もライブラリに保存する（再読み込みで消えない）', async () => {
    const project = serializeProject({
      tracks: [{ id: 1, name: 'トラック 1', clips: [bellClip(1, 50)] }],
      sounds: [{ name: 'すず', tags: [], audioData: bellAudio }, { name: 'ふえ', tags: ['楽器'], audioData: makeDataUrl('ogg', 'audio/ogg', 40) }],
      pixelsPerSecond: 100
    }, { includeSounds: 'all' });
    const { container } = await renderDAW();
    const input = container.querySelector('input[type="file"]');
    const file = new File([JSON.stringify(project)], 'project.json', { type: 'application/json' });
    fireEvent.change(input, { target: { files: [file] } });
    await waitFor(() => expect(clipNames(container)).toEqual(['すず']));
    await waitFor(async () => {
      const names = (await getAllRecordings()).map((s) => s.name).sort();
      expect(names).toEqual(['すず', 'ふえ']);
    });
  });

  test('壊れたプロジェクトファイルはエラーを表示し、今の作業内容を残す', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    const input = container.querySelector('input[type="file"]');
    fireEvent.change(input, { target: { files: [new File(['{broken'], 'x.json')] } });
    expect(await screen.findByText(/プロジェクトファイルの読み込みに失敗しました/)).toBeInTheDocument();
    fireEvent.change(input, { target: { files: [new File([JSON.stringify({ tracks: [] })], 'x.json')] } });
    expect(clipNames(container)).toEqual(['たいこ']);
  });

  test('音源出力は全クリップを重ねた WAV を作る', async () => {
    await seedProject([drumClip(1, 0), bellClip(2, 50)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /音源出力/ }));
    await waitFor(() => expect(createdBlobs.some((blob) => blob.type === 'audio/wav')).toBe(true));
    const wav = createdBlobs.find((blob) => blob.type === 'audio/wav');
    const bytes = readBlobBytes(wav);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    // 最後の音は 0.5 秒 + 2 秒 = 2.5 秒で終わる。sampleRate 1000、ステレオ 16bit
    expect(view.getUint32(40, true)).toBe(2500 * 2 * 2);
    expect(view.getUint16(22, true)).toBe(2);
    // 0.5〜1.0 秒は 2 つの音が重なる（0.25 + 0.25）
    const sampleAt = (index) => view.getInt16(44 + index * 4, true);
    expect(sampleAt(100)).toBe(Math.floor(0.25 * 0x7fff));
    expect(sampleAt(700)).toBe(Math.floor(0.5 * 0x7fff));
    await waitFor(() => expect(screen.getByRole('button', { name: /音源出力/ })).not.toBeDisabled());
  });

  test('音が無いときの音源出力は案内を表示する', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /音源出力/ }));
    expect(screen.getByText(/出力する音声がありません/)).toBeInTheDocument();
  });
});

describe('クラウド保存', () => {
  const rooms = { success: true, data: [{ id: 7, room_number: '101', room_name: '1年1組' }] };
  const mockFetch = (songResponse = { success: true }) => {
    global.fetch = jest.fn((url) => Promise.resolve({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(url.includes('rooms') ? rooms : songResponse))
    }));
  };

  const openDialogAndSave = async (roomNumber = '101') => {
    fireEvent.click(screen.getByRole('button', { name: /クラウド保存/ }));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/部屋番号/), { target: { value: roomNumber } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'クラウドに保存' }));
    return dialog;
  };

  test('使っている音だけを 1 回ずつ送る（部屋番号が文字列で返ってきても見つける）', async () => {
    mockFetch();
    await seedLibrary();
    await seedProject([drumClip(1, 0), drumClip(2, 200)]);
    await renderDAW();
    await openDialogAndSave();
    await waitFor(() => expect(window.alert).toHaveBeenCalledWith('楽曲をクラウドに保存しました！'));
    const [, options] = global.fetch.mock.calls.find(([url]) => url.includes('songs'));
    const body = JSON.parse(options.body);
    expect(body.room_id).toBe(7);
    expect(body.song_data.sounds).toEqual([]);
    expect(Object.keys(body.song_data.assets)).toHaveLength(1);
    expect(body.song_data.tracks[0].clips).toHaveLength(2);
    expect(storage['sound-library-room']).toBe('101');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  test('部屋が見つからないときはダイアログの中にエラーを表示する', async () => {
    mockFetch();
    await renderDAW();
    const dialog = await openDialogAndSave('999');
    expect(await within(dialog).findByText('指定された部屋番号が見つかりません')).toBeInTheDocument();
  });

  test('サーバーのエラーを表示し、ダイアログは閉じない', async () => {
    mockFetch({ success: false, error: '楽曲データを読み取れませんでした。データが大きすぎる可能性があります。' });
    await renderDAW();
    const dialog = await openDialogAndSave();
    expect(await within(dialog).findByText(/データが大きすぎる可能性/)).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
  });

  test('サーバーが JSON 以外（PHP のエラー画面など）を返しても分かるエラーにする', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('<b>Fatal error</b>') }));
    await renderDAW();
    const dialog = await openDialogAndSave();
    expect(await within(dialog).findByText(/サーバーエラーが発生しました/)).toBeInTheDocument();
  });

  test('保存中はボタンを押せない（二重送信の防止）', async () => {
    let resolveRooms;
    global.fetch = jest.fn(() => new Promise((resolve) => { resolveRooms = resolve; }));
    await renderDAW();
    const dialog = await openDialogAndSave();
    expect(within(dialog).getByRole('button', { name: '保存中...' })).toBeDisabled();
    await act(async () => {
      resolveRooms({ ok: true, status: 200, text: () => Promise.resolve(JSON.stringify({ success: false, error: 'x' })) });
    });
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe('自動保存の表示', () => {
  test('変更すると保存待ち → 保存しましたと表示する', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(screen.getByText(/保存待ち|保存中/)).toBeInTheDocument();
    expect(await screen.findByText('自動保存しました', {}, { timeout: 3000 })).toBeInTheDocument();
    const saved = await getProjectAutoSave();
    expect(saved.tracks).toHaveLength(2);
  });
});
