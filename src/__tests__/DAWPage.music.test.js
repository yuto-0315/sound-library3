// 音楽づくりページの「拍」まわりの機能と、編集しやすさのためのテスト
// （テンポ・拍子・置き方・メトロノーム・再生位置・元に戻す・選んだ音の操作・＋ボタン・キーボード・ミュート）
import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import DAWPage from '../pages/DAWPage';
import { addRecording, getProjectAutoSave, saveProjectAutoSave } from '../utils/indexedDB';
import { serializeProject } from '../utils/project';
import { installFakeIndexedDB } from '../test-utils/fakeIndexedDB';
import { installMemoryLocalStorage } from '../test-utils/storage';
import { TestFileReader, createMockAudioContext, makeDataUrl } from '../test-utils/audioFixtures';

const drumAudio = makeDataUrl('mp4', 'audio/mp4', 84); // 100 バイト → モックでは 1 秒
const bellAudio = makeDataUrl('wav', 'audio/wav', 184); // 200 バイト → 2 秒

let audioContext;

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
  installMemoryLocalStorage();
  audioContext = createMockAudioContext();
  window.AudioContext = jest.fn(() => audioContext);
  global.FileReader = TestFileReader;
  window.alert = jest.fn();
  window.confirm = jest.fn(() => true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));
  jest.restoreAllMocks();
});

const renderDAW = async () => {
  const utils = render(<DAWPage />);
  await waitFor(() => expect(screen.queryByText('前回の作業内容を読み込んでいます...')).not.toBeInTheDocument());
  return utils;
};

const clipElements = (container) => Array.from(container.querySelectorAll('.audio-clip'));
const clipLefts = (container) => clipElements(container).map((clip) => clip.style.left);
const trackElements = (container) => Array.from(container.querySelectorAll('.track'));
const drumClip = (id, startTime, trackId = 101) => ({ id, startTime, duration: 100, trackId, soundData: { id: 1, name: 'たいこ', audioData: drumAudio } });
const bellClip = (id, startTime, trackId = 101) => ({ id, startTime, duration: 200, trackId, soundData: { id: 2, name: 'すず', audioData: bellAudio } });

const seedProject = async (clips, options = {}) => {
  await saveProjectAutoSave(serializeProject({
    tracks: [{ id: 101, name: 'トラック 1', clips }, { id: 102, name: 'トラック 2', clips: options.secondTrackClips || [] }],
    pixelsPerSecond: 100,
    ...options.project
  }));
};

const seedLibrary = async () => {
  const drumId = await addRecording({ name: 'たいこ', tags: ['楽器'], audioData: drumAudio });
  const bellId = await addRecording({ name: 'すず', tags: [], audioData: bellAudio });
  return { drumId, bellId };
};

const positionText = () => document.querySelector('.daw-position-beat').textContent;

describe('テンポ・拍子・置き方', () => {
  test('テンポを変えると、置いた音は同じ拍の上に残り、音の長さは変わらない', async () => {
    await seedProject([drumClip(1, 100), bellClip(2, 300)]);
    const { container } = await renderDAW();
    expect(screen.getByText('120')).toBeInTheDocument();
    // 120 → 60（5 ずつ 12 回）
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole('button', { name: 'テンポを遅くする' }));
    expect(screen.getByText('60')).toBeInTheDocument();
    expect(clipLefts(container)).toEqual(['200px', '600px']);
    expect(clipElements(container).map((clip) => clip.style.width)).toEqual(['100px', '200px']);
    // 1 拍の幅も 2 倍
    expect(container.querySelector('.timeline-container').style.getPropertyValue('--beat-px')).toBe('100px');
  });

  test('テンポは 40〜200 の範囲で、端ではボタンを押せない', async () => {
    await saveProjectAutoSave(serializeProject({ tracks: [{ id: 1, name: 'トラック 1', clips: [] }], pixelsPerSecond: 100, bpm: 195 }));
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'テンポを速くする' }));
    expect(screen.getByText('200')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'テンポを速くする' })).toBeDisabled();
  });

  test('拍子を変えると小節の幅が変わる（3 拍子では 1 小節 = 3 拍）', async () => {
    const { container } = await renderDAW();
    fireEvent.change(screen.getByRole('combobox', { name: '拍子' }), { target: { value: '3' } });
    expect(container.querySelector('.timeline-container').style.getPropertyValue('--measure-px')).toBe('150px');
    expect(within(container.querySelector('.timeline')).getByText('2').style.left).toBe('150px');
  });

  test('「半拍に合わせる」「合わせない」で置く位置の細かさが変わる', async () => {
    const { drumId } = await seedLibrary();
    const { container } = await renderDAW();
    const drop = (clientX) => fireEvent.drop(trackElements(container)[0], {
      dataTransfer: { getData: () => `sound-id:${drumId}`, setData: jest.fn() },
      clientX
    });
    fireEvent.change(screen.getByRole('combobox', { name: '置き方' }), { target: { value: 'half' } });
    drop(330); // 半拍 = 25px → 325
    await waitFor(() => expect(clipLefts(container)).toEqual(['325px']));
    fireEvent.change(screen.getByRole('combobox', { name: '置き方' }), { target: { value: 'off' } });
    drop(712); // 0.05 秒 = 5px → 710
    await waitFor(() => expect(clipLefts(container)).toContain('710px'));
  });

  test('テンポ・拍子・置き方・メトロノームは自動保存され、開き直しても残る', async () => {
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'テンポを遅くする' }));
    fireEvent.change(screen.getByRole('combobox', { name: '拍子' }), { target: { value: '2' } });
    fireEvent.change(screen.getByRole('combobox', { name: '置き方' }), { target: { value: 'half' } });
    fireEvent.click(screen.getByRole('button', { name: 'メトロノーム' }));
    await waitFor(async () => {
      expect(await getProjectAutoSave()).toMatchObject({ bpm: 115, beatsPerMeasure: 2, snapMode: 'half', metronome: true });
    }, { timeout: 3000 });
    cleanup();
    await renderDAW();
    expect(screen.getByText('115')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: '拍子' })).toHaveValue('2');
    expect(screen.getByRole('combobox', { name: '置き方' })).toHaveValue('half');
    expect(screen.getByRole('button', { name: 'メトロノーム' })).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('メトロノーム', () => {
  test('オンにすると、再生する範囲の拍ごとに音を鳴らす（小節の頭は別の音）', async () => {
    await seedProject([drumClip(1, 0)]); // 0〜1 秒 → 小節の終わり（2 秒）まで鳴らす
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'メトロノーム' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    // unlock 用 1 + クリップ 1 + 拍 4（0, 0.5, 1.0, 1.5 秒）
    await waitFor(() => expect(audioContext.started.length).toBe(6));
    const clicks = audioContext.started.slice(2);
    expect(clicks.map((item) => Number(item.when.toFixed(2)))).toEqual([0.05, 0.55, 1.05, 1.55]);
    expect(clicks[0].source.buffer).not.toBe(clicks[1].source.buffer); // 1 拍目は高い音
    expect(clicks[1].source.buffer).toBe(clicks[2].source.buffer);
  });

  test('オフのときは鳴らさない', async () => {
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(audioContext.started.length).toBe(2);
  });
});

describe('再生位置', () => {
  test('上の目盛りを押すと、そこ（拍の頭）から再生する', async () => {
    await seedProject([bellClip(1, 0)]);
    const { container } = await renderDAW();
    const ruler = screen.getByRole('slider', { name: /再生位置/ });
    fireEvent.click(ruler, { clientX: 108 }); // 拍（50px）に合わせて 100px
    expect(container.querySelector('.playhead').style.left).toBe('100px');
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 3拍');
    expect(positionText()).toBe('1小節 3拍');
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    expect(audioContext.started[1].offset).toBeCloseTo(1); // 2 秒の音の 1 秒目から
  });

  test('目盛りはキーボードの矢印で 1 拍ずつ、Page Up/Down で 1 小節ずつ動かせる', async () => {
    await renderDAW();
    const ruler = screen.getByRole('slider', { name: /再生位置/ });
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 3拍');
    fireEvent.keyDown(ruler, { key: 'PageDown' });
    expect(ruler).toHaveAttribute('aria-valuetext', '2小節 3拍');
    fireEvent.keyDown(ruler, { key: 'Home' });
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 1拍');
    fireEvent.keyDown(ruler, { key: 'ArrowLeft' });
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 1拍'); // 0 より前には行かない
  });

  test('再生中に目盛りを押すと、その位置から鳴らし直す', async () => {
    await seedProject([bellClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    const first = audioContext.started[1].source;
    fireEvent.click(screen.getByRole('slider', { name: /再生位置/ }), { clientX: 150 });
    expect(first.stop).toHaveBeenCalled();
    await waitFor(() => expect(audioContext.started.length).toBe(3));
    expect(audioContext.started[2].offset).toBeCloseTo(1.5);
  });

  test('最後の音より後ろで再生を押したら、先頭から再生する', async () => {
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('slider', { name: /再生位置/ }), { clientX: 500 });
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    expect(audioContext.started[1].offset).toBe(0);
    expect(audioContext.started[1].when).toBeCloseTo(0.05);
  });
});

describe('再生中の編集', () => {
  test('再生中に音を消すと、その音は鳴らさない（以前は再生を押した時の音のまま鳴っていた）', async () => {
    await seedProject([drumClip(1, 0), bellClip(2, 200)]);
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(3));
    const bellSource = audioContext.started[2].source;
    fireEvent.click(clipElements(container)[1]);
    fireEvent.click(screen.getByRole('button', { name: 'すずを削除' }));
    expect(bellSource.stop).toHaveBeenCalled();
    await waitFor(() => expect(audioContext.started.length).toBe(4));
    // 予約し直したのは「たいこ」だけ
    expect(audioContext.started[3].source.buffer.duration).toBeCloseTo(1);
  });

  test('ミュートしたトラックの音は鳴らさない', async () => {
    await seedProject([drumClip(1, 0)], { secondTrackClips: [bellClip(2, 0, 102)] });
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'トラック 2をミュート' }));
    expect(screen.getByRole('button', { name: 'トラック 2をミュート' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(audioContext.started.length).toBe(2);
    expect(audioContext.started[1].source.buffer.duration).toBeCloseTo(1); // たいこだけ
  });
});

describe('＋ボタンで置く（ドラッグしなくても置ける）', () => {
  test('選んでいるトラックの再生位置に置き、再生位置はその音の後ろ（次の拍）に進む', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    const place = await within(panel).findByRole('button', { name: 'たいこをトラック 1に置く' });
    fireEvent.click(place);
    await waitFor(() => expect(clipLefts(container)).toEqual(['0px']));
    expect(positionText()).toBe('1小節 3拍'); // 1 秒の音 → 2 拍分進む
    fireEvent.click(place);
    await waitFor(() => expect(clipLefts(container)).toEqual(['0px', '100px']));
    expect(await screen.findByText('「たいこ」をトラック 1の1小節 3拍に置きました')).toBeInTheDocument();
    // 置いた音が選ばれている
    expect(clipElements(container)[1]).toHaveAttribute('aria-pressed', 'true');
  });

  test('トラックを選ぶと、そのトラックに置く', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    fireEvent.click(screen.getByRole('button', { name: 'トラック 1' }));
    fireEvent.click(screen.getByRole('button', { name: 'トラック 2' }));
    const place = await within(container.querySelector('.sound-panel')).findByRole('button', { name: 'すずをトラック 2に置く' });
    fireEvent.click(place);
    await waitFor(() => expect(trackElements(container)[1].querySelectorAll('.audio-clip')).toHaveLength(1));
  });

  test('重なるときは後ろの空いている拍に置く', async () => {
    await seedLibrary();
    await seedProject([bellClip(1, 0)]); // 0〜200px
    const { container } = await renderDAW();
    fireEvent.click(await within(container.querySelector('.sound-panel')).findByRole('button', { name: 'たいこをトラック 1に置く' }));
    await waitFor(() => expect(clipLefts(container)).toEqual(['0px', '200px']));
  });
});

describe('選んだ音の操作', () => {
  test('複製を押すと、すぐ後ろ（次の拍）に同じ音を置き、続けて押すとくり返せる', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'たいこを複製' }));
    fireEvent.click(screen.getByRole('button', { name: 'たいこを複製' }));
    expect(clipLefts(container)).toEqual(['0px', '100px', '200px']);
    expect(clipElements(container)[2]).toHaveAttribute('aria-pressed', 'true');
  });

  test('「きく」で選んだ音だけを鳴らす', async () => {
    await seedProject([bellClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'すずをきく' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    expect(audioContext.started[1].when).toBe(0);
  });

  test('何もない所を押すと、選ぶのをやめる', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    expect(screen.getByRole('group', { name: '選んでいる音: たいこ' })).toBeInTheDocument();
    fireEvent.click(trackElements(container)[0]);
    expect(screen.queryByRole('group', { name: /選んでいる音/ })).not.toBeInTheDocument();
    expect(clipElements(container)[0]).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('キーボードでの操作（マウスや指を使わなくても曲を作れる）', () => {
  test('置いた音は Tab で選べ、← → で拍ごとに、↓ で下のトラックへ動かせる', async () => {
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    const clip = clipElements(container)[0];
    expect(clip).toHaveAttribute('tabindex', '0');
    expect(clip).toHaveAccessibleName('たいこ、1小節 3拍から1.0秒');
    clip.focus();
    fireEvent.keyDown(clip, { key: 'ArrowRight' });
    expect(clipLefts(container)).toEqual(['150px']);
    fireEvent.keyDown(clipElements(container)[0], { key: 'ArrowLeft' });
    fireEvent.keyDown(clipElements(container)[0], { key: 'ArrowLeft' });
    expect(clipLefts(container)).toEqual(['50px']);
    fireEvent.keyDown(clipElements(container)[0], { key: 'ArrowDown' });
    await waitFor(() => expect(trackElements(container)[1].querySelectorAll('.audio-clip')).toHaveLength(1));
    // 別のトラックに動かしてもフォーカスが残る
    await waitFor(() => expect(trackElements(container)[1].querySelector('.audio-clip')).toHaveFocus());
  });

  test('Delete キーで選んだ音を消し、⌘Z / Ctrl+Z で元に戻せる', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.keyDown(document.body, { key: 'Delete' });
    expect(clipElements(container)).toHaveLength(0);
    fireEvent.keyDown(document.body, { key: 'z', ctrlKey: true });
    expect(clipElements(container)).toHaveLength(1);
    fireEvent.keyDown(document.body, { key: 'z', metaKey: true, shiftKey: true });
    expect(clipElements(container)).toHaveLength(0);
  });

  test('スペースキーで再生・一時停止（ボタンにフォーカスがあるときはそのボタンを優先）', async () => {
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: ' ' });
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
    const addTrack = screen.getByRole('button', { name: /トラック追加/ });
    fireEvent.keyDown(addTrack, { key: ' ' });
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
  });

  test('入力欄で文字を打っているときはショートカットを使わない', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: '先生に送る' }));
    const title = screen.getByLabelText(/曲のタイトル/);
    fireEvent.keyDown(title, { key: 'Backspace' });
    fireEvent.keyDown(title, { key: ' ' });
    expect(clipElements(container)).toHaveLength(1);
    expect(screen.getByRole('button', { name: '再生' })).toBeInTheDocument();
  });
});

describe('元に戻す・やり直す', () => {
  test('置く・動かす・消す・トラックの追加を順に戻せ、やり直せる', async () => {
    const { drumId } = await seedLibrary();
    const { container } = await renderDAW();
    const undo = screen.getByRole('button', { name: '元に戻す' });
    const redo = screen.getByRole('button', { name: 'やり直す' });
    expect(undo).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    fireEvent.drop(trackElements(container)[0], { dataTransfer: { getData: () => `sound-id:${drumId}`, setData: jest.fn() }, clientX: 100 });
    await waitFor(() => expect(clipLefts(container)).toEqual(['100px']));
    fireEvent.keyDown(clipElements(container)[0], { key: 'ArrowRight' });
    expect(clipLefts(container)).toEqual(['150px']);

    fireEvent.click(undo);
    expect(clipLefts(container)).toEqual(['100px']);
    fireEvent.click(undo);
    expect(clipElements(container)).toHaveLength(0);
    fireEvent.click(undo);
    expect(trackElements(container)).toHaveLength(1);
    expect(undo).toBeDisabled();

    fireEvent.click(redo);
    fireEvent.click(redo);
    expect(trackElements(container)).toHaveLength(2);
    expect(clipLefts(container)).toEqual(['100px']);
  });

  test('テンポの −/+ を続けて押したときは、1 回の「元に戻す」で戻る', async () => {
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    for (let i = 0; i < 4; i++) fireEvent.click(screen.getByRole('button', { name: 'テンポを速くする' }));
    expect(screen.getByText('140')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(screen.getByText('120')).toBeInTheDocument();
    expect(clipLefts(container)).toEqual(['100px']);
  });

  test('ズームしてから戻しても、今の倍率の位置に戻る', async () => {
    await seedProject([drumClip(1, 100)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'たいこを削除' }));
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン（拡大）' })); // 150%
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(clipLefts(container)).toEqual(['150px']);
    expect(clipElements(container)[0].style.width).toBe('150px');
  });

  test('別の作業内容を開いたら（リセットなど）、それより前には戻れない', async () => {
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: /トラック追加/ }));
    expect(screen.getByRole('button', { name: '元に戻す' })).not.toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'ファイル' }));
    fireEvent.click(screen.getByRole('button', { name: /リセット/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: '元に戻す' })).toBeDisabled());
  });
});

describe('表示', () => {
  test('音素材の一覧に音の長さを出す（試聴・ドラッグなどでデコードして分かったとき）', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    const panel = container.querySelector('.sound-panel');
    fireEvent.click(await within(panel).findByRole('button', { name: 'すずを試聴' }));
    expect(await within(panel).findByText('2.0秒')).toBeInTheDocument();
  });

  test('置いた音には実際の音の大きさの波形を出す', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    await waitFor(() => expect(container.querySelector('.clip-waveform path')).not.toBeNull());
    expect(container.querySelector('.clip-waveform path').getAttribute('d')).toMatch(/^M/);
  });

  test('音が無いときは置き方の案内を出し、置いたら消す', async () => {
    const { drumId } = await seedLibrary();
    const { container } = await renderDAW();
    expect(screen.getByText(/音素材の「＋」を押すと/)).toBeInTheDocument();
    fireEvent.drop(trackElements(container)[0], { dataTransfer: { getData: () => `sound-id:${drumId}`, setData: jest.fn() }, clientX: 0 });
    await waitFor(() => expect(screen.queryByText(/音素材の「＋」を押すと/)).not.toBeInTheDocument());
  });

  test('音素材パネルを隠すと、中のボタンに Tab で移動しない', async () => {
    await seedLibrary();
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '音素材を隠す' }));
    expect(container.querySelector('.sound-panel')).not.toBeVisible();
    expect(screen.getByRole('button', { name: '音素材を表示' })).toHaveAttribute('aria-expanded', 'false');
  });
});

describe('レビューで見つかった不具合（再生・＋ボタン・キーボード・フォーカス）', () => {
  test('音の長さを調べている間に＋を 2 回押しても、同じ位置に重ねず順に並べる（元に戻すと 1 つずつ戻る）', async () => {
    await seedLibrary();
    // 音の長さを調べ終わるのを遅らせる（初めて使う音を続けて押したとき）
    let releaseDecode;
    const gate = new Promise((resolve) => { releaseDecode = resolve; });
    const decode = audioContext.decodeAudioData.getMockImplementation();
    audioContext.decodeAudioData.mockImplementation((buffer, ok, ng) => gate.then(() => decode(buffer, ok, ng)));
    const { container } = await renderDAW();
    const place = await within(container.querySelector('.sound-panel')).findByRole('button', { name: 'たいこをトラック 1に置く' });
    fireEvent.click(place);
    fireEvent.click(place);
    await act(async () => {
      releaseDecode();
    });
    await waitFor(() => expect(clipLefts(container)).toHaveLength(2));
    expect(clipLefts(container)).toEqual(['0px', '100px']);
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(clipLefts(container)).toEqual(['0px']);
  });

  test('再生中に、この先に鳴る音が無くなる編集をしたら、曲の最初に戻らずにその場で止まる', async () => {
    await seedProject([drumClip(1, 0)], { secondTrackClips: [bellClip(2, 0, 102)] }); // たいこ 0〜1 秒、すず 0〜2 秒
    const { container } = await renderDAW();
    fireEvent.click(screen.getByRole('slider', { name: /再生位置/ }), { clientX: 150 }); // 1.5 秒（たいこは終わっている）
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2)); // 無音 + すず
    // すずのトラックをミュートすると、この先に鳴らす音が無い（以前は曲の最初から鳴り直した）
    fireEvent.click(screen.getByRole('button', { name: 'トラック 2をミュート' }));
    expect(await screen.findByRole('button', { name: '再生' })).toBeInTheDocument();
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(audioContext.started.length).toBe(2);
    expect(container.querySelector('.playhead').style.left).toBe('150px');
  });

  test('再生中にズームしても、鳴っている音を止めて予約し直さない（音が途切れない）', async () => {
    await seedProject([bellClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    await waitFor(() => expect(audioContext.started.length).toBe(2));
    const source = audioContext.started[1].source;
    fireEvent.click(screen.getByRole('button', { name: 'ズームイン（拡大）' }));
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    expect(source.stop).not.toHaveBeenCalled();
    expect(audioContext.started.length).toBe(2);
    // テンポを変えたときは、鳴る位置が変わるので予約し直す
    fireEvent.click(screen.getByRole('button', { name: 'テンポを速くする' }));
    await waitFor(() => expect(source.stop).toHaveBeenCalled());
  });

  test('全部のトラックをミュートして再生を押すと、音が無いのではなくミュートだと知らせる', async () => {
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    fireEvent.click(screen.getByRole('button', { name: 'トラック 1をミュート' }));
    fireEvent.click(screen.getByRole('button', { name: '再生' }));
    expect(await screen.findByText('再生できる音がありません（ミュートしていないトラックに音を置きましょう）。')).toBeInTheDocument();
    expect(screen.queryByText(/まだ音が置かれていません/)).not.toBeInTheDocument();
  });

  test('拍の途中で止めたときも、目盛りの → で次の拍、← で前の拍へ動く（1 拍とばさない）', async () => {
    await renderDAW();
    fireEvent.change(screen.getByRole('combobox', { name: /置き方/ }), { target: { value: 'off' } });
    const ruler = screen.getByRole('slider', { name: /再生位置/ });
    fireEvent.click(ruler, { clientX: 80 }); // 1.6 拍
    expect(document.querySelector('.playhead').style.left).toBe('80px');
    fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    expect(document.querySelector('.playhead').style.left).toBe('100px'); // 以前は 150px（2 拍目をとばした）
    fireEvent.click(ruler, { clientX: 80 });
    fireEvent.keyDown(ruler, { key: 'ArrowLeft' });
    expect(document.querySelector('.playhead').style.left).toBe('50px');
  });

  test('上の目盛りを押したあとも、スペースキーで再生できる', async () => {
    await seedProject([drumClip(1, 0)]);
    await renderDAW();
    const ruler = screen.getByRole('slider', { name: /再生位置/ });
    ruler.focus();
    fireEvent.keyDown(ruler, { key: ' ' });
    expect(screen.getByRole('button', { name: '一時停止' })).toBeInTheDocument();
  });

  test('テンポを元に戻すと、再生位置も同じ拍の上に戻る', async () => {
    await renderDAW();
    const ruler = screen.getByRole('slider', { name: /再生位置/ });
    for (let i = 0; i < 3; i++) fireEvent.keyDown(ruler, { key: 'ArrowRight' });
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 4拍');
    for (let i = 0; i < 12; i++) fireEvent.click(screen.getByRole('button', { name: 'テンポを遅くする' })); // 120 → 60
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 4拍');
    fireEvent.click(screen.getByRole('button', { name: '元に戻す' }));
    expect(screen.getByText('120')).toBeInTheDocument();
    // 以前は 60 のときのピクセル位置のまま残り、「2小節 3拍」になっていた
    expect(ruler).toHaveAttribute('aria-valuetext', '1小節 4拍');
  });

  test('Delete キーで消したあとは、となりの音に、音が無ければトラック名のボタンにフォーカスが移る', async () => {
    await seedProject([drumClip(1, 0), drumClip(2, 200)]);
    const { container } = await renderDAW();
    const first = clipElements(container)[0];
    first.focus();
    fireEvent.keyDown(first, { key: 'Delete' });
    await waitFor(() => expect(clipElements(container)).toHaveLength(1));
    await waitFor(() => expect(clipElements(container)[0]).toHaveFocus());
    fireEvent.keyDown(clipElements(container)[0], { key: 'Delete' });
    await waitFor(() => expect(clipElements(container)).toHaveLength(0));
    await waitFor(() => expect(screen.getByRole('button', { name: 'トラック 1' })).toHaveFocus());
  });

  test('選んだ音の「削除」「選ぶのをやめる」を押したあとも、フォーカスがページの先頭に飛ばない', async () => {
    await seedProject([drumClip(1, 0), drumClip(2, 200)]);
    const { container } = await renderDAW();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: '選ぶのをやめる' }));
    expect(clipElements(container)[0]).toHaveFocus();
    fireEvent.click(clipElements(container)[0]);
    fireEvent.click(screen.getByRole('button', { name: 'たいこを削除' }));
    await waitFor(() => expect(clipElements(container)).toHaveLength(1));
    await waitFor(() => expect(clipElements(container)[0]).toHaveFocus());
  });

  test('トラックを削除したら、となりのトラックのボタンにフォーカスが移る', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    expect(trackElements(container)).toHaveLength(2);
    fireEvent.click(screen.getByRole('button', { name: 'トラック 1を削除' }));
    await waitFor(() => expect(trackElements(container)).toHaveLength(1));
    await waitFor(() => expect(document.activeElement).toHaveClass('track-select-btn'));
  });

  test('「ファイル」の項目を選んだら、「ファイル」ボタンにフォーカスを戻す', async () => {
    await renderDAW();
    window.confirm = jest.fn(() => false);
    fireEvent.click(screen.getByRole('button', { name: 'ファイル' }));
    fireEvent.click(screen.getByRole('button', { name: '新しく作る（リセット）' }));
    expect(screen.getByRole('button', { name: 'ファイル' })).toHaveFocus();
  });

  test('← で動かせなかった音に、あとで別の操作をしたときフォーカスが飛ばない', async () => {
    await seedProject([drumClip(1, 0)]);
    const { container } = await renderDAW();
    const clip = clipElements(container)[0];
    clip.focus();
    fireEvent.keyDown(clip, { key: 'ArrowLeft' }); // 0 より前には動かない
    const tempoUp = screen.getByRole('button', { name: 'テンポを速くする' });
    tempoUp.focus();
    fireEvent.click(tempoUp);
    await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
    expect(tempoUp).toHaveFocus();
  });
});
