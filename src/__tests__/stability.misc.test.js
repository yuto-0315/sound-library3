import React, { useState } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Link, useLocation } from 'react-router-dom';
import ErrorBoundary from '../components/ErrorBoundary';
import { useErrorMessages, useAnnouncement } from '../hooks/useAccessibility';
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
import { fetchJson, findRoomByNumber, getUserIdentifier } from '../utils/api';
import { isEnterKey, isImeComposing } from '../utils/keyboard';
import { installMemoryLocalStorage } from '../test-utils/storage';

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  delete global.fetch;
});

describe('ErrorBoundary（画面が真っ白にならない）', () => {
  const Broken = () => {
    throw new Error('boom');
  };

  test('子でエラーが起きたら案内と再読み込みボタンを表示する', () => {
    render(<ErrorBoundary resetKey="/a"><Broken /></ErrorBoundary>);
    expect(screen.getByRole('alert')).toHaveTextContent('問題が発生しました');
    expect(screen.getByRole('button', { name: 'ページを再読み込みする' })).toBeInTheDocument();
  });

  const RoutedBoundary = () => {
    const location = useLocation();
    return (
      <ErrorBoundary resetKey={location.pathname}>
        {location.pathname === '/broken' ? <Broken /> : <p>正常なページ</p>}
      </ErrorBoundary>
    );
  };

  test('別のページに移動すると元に戻る', () => {
    render(
      <MemoryRouter initialEntries={['/broken']}>
        <Link to="/ok">ほかのページ</Link>
        <RoutedBoundary />
      </MemoryRouter>
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    fireEvent.click(screen.getByText('ほかのページ'));
    expect(screen.getByText('正常なページ')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('useAccessibility（エラーやお知らせが再描画で消えない）', () => {
  const Harness = () => {
    const { showError, ErrorRegion } = useErrorMessages();
    const { announce, AnnouncementRegion } = useAnnouncement();
    const [count, setCount] = useState(0);
    return (
      <div>
        <button type="button" onClick={() => { showError('エラーです'); announce('お知らせです'); }}>表示</button>
        <button type="button" onClick={() => setCount(count + 1)}>再描画 {count}</button>
        <ErrorRegion className="test-error" />
        <AnnouncementRegion className="test-announcement" />
      </div>
    );
  };

  test('showError / announce の内容が state の変更後も残る', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '表示' }));
    fireEvent.click(screen.getByRole('button', { name: /再描画/ }));
    fireEvent.click(screen.getByRole('button', { name: /再描画/ }));
    expect(document.querySelector('.test-error')).toHaveTextContent('エラーです');
    expect(document.querySelector('.test-announcement')).toHaveTextContent('お知らせです');
  });
});

describe('useTouchDrag', () => {
  const touch = (target, type, x, y) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: type === 'touchend' || type === 'touchcancel' ? [] : [{ clientX: x, clientY: y }] });
    act(() => {
      target.dispatchEvent(event);
    });
    return event;
  };

  const Draggable = ({ handlers }) => {
    const ref = useTouchDrag(handlers);
    return (
      <div ref={ref} data-testid="box">
        <span data-testid="handle">つまみ</span>
        <button type="button">ボタン</button>
      </div>
    );
  };

  const setup = (extra = {}) => {
    const handlers = {
      onStart: jest.fn(),
      onMove: jest.fn(),
      onEnd: jest.fn(),
      onCancel: jest.fn(),
      ...extra
    };
    render(<Draggable handlers={handlers} />);
    return { handlers, box: screen.getByTestId('box') };
  };

  test('少しの移動ではドラッグを始めない（タップと区別する）', () => {
    const { handlers, box } = setup();
    touch(box, 'touchstart', 10, 10);
    const move = touch(box, 'touchmove', 13, 12);
    touch(box, 'touchend', 13, 12);
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(false);
  });

  test('しきい値を超えたら開始し、以降の移動はスクロールさせない', () => {
    const { handlers, box } = setup();
    touch(box, 'touchstart', 10, 10);
    const first = touch(box, 'touchmove', 30, 10);
    const second = touch(box, 'touchmove', 60, 40);
    const end = touch(box, 'touchend', 60, 40);
    expect(handlers.onStart).toHaveBeenCalledWith({ startX: 10, startY: 10, x: 30, y: 10 });
    expect(handlers.onMove).toHaveBeenLastCalledWith({ x: 60, y: 40 });
    expect(handlers.onEnd).toHaveBeenCalledWith({ x: 60, y: 40 });
    expect(first.defaultPrevented).toBe(true);
    expect(second.defaultPrevented).toBe(true);
    expect(end.defaultPrevented).toBe(true); // 指を離した所のボタンが押されないように
  });

  test('shouldStart が false ならスクロールとして扱い、そのタッチでは開始しない', () => {
    const { handlers, box } = setup({ shouldStart: (dx, dy) => dx > dy });
    touch(box, 'touchstart', 10, 10);
    touch(box, 'touchmove', 12, 40);
    touch(box, 'touchmove', 80, 40);
    touch(box, 'touchend', 80, 40);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  test('shouldStart には触り始めた要素が渡される', () => {
    const shouldStart = jest.fn((dx, dy, target) => target.dataset.testid === 'handle');
    const { handlers } = setup({ shouldStart });
    const handle = screen.getByTestId('handle');
    touch(handle, 'touchstart', 10, 10);
    touch(handle, 'touchmove', 10, 50);
    expect(handlers.onStart).toHaveBeenCalled();
  });

  test('ボタンから始まったタッチはドラッグにしない', () => {
    const { handlers } = setup();
    const button = screen.getByRole('button', { name: 'ボタン' });
    touch(button, 'touchstart', 10, 10);
    const move = touch(button, 'touchmove', 80, 80);
    expect(handlers.onStart).not.toHaveBeenCalled();
    expect(move.defaultPrevented).toBe(false);
  });

  test('touchcancel では onCancel を呼ぶ（onEnd は呼ばない）', () => {
    const { handlers, box } = setup();
    touch(box, 'touchstart', 10, 10);
    touch(box, 'touchmove', 50, 10);
    touch(box, 'touchcancel', 50, 10);
    expect(handlers.onCancel).toHaveBeenCalled();
    expect(handlers.onEnd).not.toHaveBeenCalled();
  });

  test('2 本指のタッチ（ピンチ操作など）は無視する', () => {
    const { handlers, box } = setup();
    const event = new Event('touchstart', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'touches', { value: [{ clientX: 0, clientY: 0 }, { clientX: 50, clientY: 50 }] });
    act(() => {
      box.dispatchEvent(event);
    });
    touch(box, 'touchmove', 80, 80);
    expect(handlers.onStart).not.toHaveBeenCalled();
  });

  test('2 本目の指を離してもドラッグは終わらず、最初の指を離したときに終わる', () => {
    const { handlers, box } = setup();
    const dispatch = (type, touches) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'touches', { value: touches });
      act(() => {
        box.dispatchEvent(event);
      });
      return event;
    };
    const first = { identifier: 1, clientX: 10, clientY: 10 };
    dispatch('touchstart', [first]);
    dispatch('touchmove', [{ ...first, clientX: 60 }]);
    expect(handlers.onStart).toHaveBeenCalled();
    // 2 本目の指が触れて、離れる（最初の指はまだ触れている）
    dispatch('touchstart', [{ ...first, clientX: 60 }, { identifier: 2, clientX: 300, clientY: 300 }]);
    dispatch('touchend', [{ ...first, clientX: 60 }]);
    expect(handlers.onEnd).not.toHaveBeenCalled();
    // 2 本目の指の動きは無視して、最初の指だけを追う
    dispatch('touchmove', [{ identifier: 2, clientX: 999, clientY: 999 }, { ...first, clientX: 80 }]);
    expect(handlers.onMove).toHaveBeenLastCalledWith({ x: 80, y: 10 });
    dispatch('touchend', []);
    expect(handlers.onEnd).toHaveBeenCalledWith({ x: 80, y: 10 });
  });

  test('ドラッグ中にアンマウントされたら onCancel を呼ぶ', () => {
    const handlers = { onStart: jest.fn(), onCancel: jest.fn() };
    const { unmount } = render(<Draggable handlers={handlers} />);
    const box = screen.getByTestId('box');
    touch(box, 'touchstart', 10, 10);
    touch(box, 'touchmove', 60, 10);
    unmount();
    expect(handlers.onCancel).toHaveBeenCalled();
  });
});

describe('ドラッグ中の画面制御', () => {
  test('スクロールの固定と解除（旧バージョンのインラインスタイルも消す）', () => {
    document.body.style.position = 'fixed';
    lockScrollForDrag();
    expect(document.body.classList.contains('dragging')).toBe(true);
    unlockScrollAfterDrag();
    expect(document.body.classList.contains('dragging')).toBe(false);
    expect(document.body.style.position).toBe('');
  });

  test('トラックのハイライトは 1 つだけ', () => {
    document.body.innerHTML = '<div class="track" data-track-id="1"></div><div class="track" data-track-id="2"></div>';
    const [first, second] = document.querySelectorAll('.track');
    highlightTrack(first);
    highlightTrack(second);
    expect(first.classList.contains('drag-over')).toBe(false);
    expect(second.classList.contains('drag-over')).toBe(true);
    clearTrackHighlights();
    expect(second.classList.contains('drag-over')).toBe(false);
  });

  test('findTrackAtPoint は指の下のトラックと、トラック内の位置を返す', () => {
    document.body.innerHTML = '<div class="track" data-track-id="42"><div class="audio-clip"><span id="inner">x</span></div></div><div id="outside"></div>';
    const track = document.querySelector('.track');
    track.getBoundingClientRect = () => ({ left: 100, top: 0, right: 500, bottom: 80 });
    document.elementFromPoint = jest.fn(() => document.getElementById('inner'));
    expect(findTrackAtPoint(250, 10)).toEqual({ element: track, trackId: '42', timePosition: 150 });
    document.elementFromPoint = jest.fn(() => document.getElementById('outside'));
    expect(findTrackAtPoint(250, 10)).toBeNull();
    document.elementFromPoint = jest.fn(() => null);
    expect(findTrackAtPoint(250, 10)).toBeNull();
  });

  test('指に付いてくるラベルを動かして消せる', () => {
    const label = createFloatingDragLabel('たいこ', 100, 200);
    const element = document.querySelector('.mobile-drag-preview');
    expect(element.textContent).toBe('たいこ');
    expect(element.style.left).toBe('50px');
    label.move(300, 300);
    expect(element.style.top).toBe('260px');
    label.remove();
    expect(document.querySelector('.mobile-drag-preview')).toBeNull();
    createFloatingDragLabel('a', 0, 0);
    createFloatingDragLabel('b', 0, 0);
    removeFloatingDragLabels();
    expect(document.querySelectorAll('.mobile-drag-preview')).toHaveLength(0);
  });
});

describe('api ユーティリティ', () => {
  test('findRoomByNumber は数値・文字列のどちらでも見つける', () => {
    const rooms = [{ id: 1, room_number: '101' }, { id: 2, room_number: 202 }];
    expect(findRoomByNumber(rooms, 101).id).toBe(1);
    expect(findRoomByNumber(rooms, '202').id).toBe(2);
    expect(findRoomByNumber(rooms, ' 101 ').id).toBe(1);
    expect(findRoomByNumber(rooms, '999')).toBeNull();
    expect(findRoomByNumber(rooms, '')).toBeNull();
    expect(findRoomByNumber(rooms, 'abc')).toBeNull();
    expect(findRoomByNumber(null, '101')).toBeNull();
  });

  test('fetchJson は JSON を返す', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('{"success":true}') }));
    await expect(fetchJson('/api/x')).resolves.toEqual({ success: true });
  });

  test('fetchJson は PHP のエラー画面など JSON 以外を分かるエラーにする', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 500, text: () => Promise.resolve('<br><b>Fatal error</b>') }));
    await expect(fetchJson('/api/x')).rejects.toThrow('サーバーエラーが発生しました (HTTP 500)');
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 413, text: () => Promise.resolve('Request Entity Too Large') }));
    await expect(fetchJson('/api/x')).rejects.toThrow('データが大きすぎて');
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('Warning: ...') }));
    await expect(fetchJson('/api/x')).rejects.toThrow('正しい応答がありませんでした');
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve('null') }));
    await expect(fetchJson('/api/x')).rejects.toThrow('正しい応答がありませんでした');
  });

  test('fetchJson はエラーの JSON もそのまま返す（メッセージを表示するため）', async () => {
    global.fetch = jest.fn(() => Promise.resolve({ ok: false, status: 400, text: () => Promise.resolve('{"success":false,"error":"部屋IDは必須です"}') }));
    await expect(fetchJson('/api/x')).resolves.toEqual({ success: false, error: '部屋IDは必須です' });
  });

  test('getUserIdentifier は一度作った ID を使い続ける', () => {
    const storage = installMemoryLocalStorage();
    const first = getUserIdentifier();
    expect(first).toMatch(/^user_[a-z0-9]+$/);
    expect(getUserIdentifier()).toBe(first);
    expect(storage['user-identifier']).toBe(first);
  });

  test('getUserIdentifier は localStorage が使えなくても ID を返す', () => {
    window.localStorage.getItem.mockImplementation(() => { throw new Error('private'); });
    window.localStorage.setItem.mockImplementation(() => { throw new Error('private'); });
    expect(getUserIdentifier()).toMatch(/^user_/);
  });
});

describe('keyboard ユーティリティ', () => {
  test('日本語入力の変換中の Enter を判定する', () => {
    expect(isImeComposing({ keyCode: 229 })).toBe(true);
    expect(isImeComposing({ nativeEvent: { isComposing: true } })).toBe(true);
    expect(isImeComposing({ isComposing: true })).toBe(true);
    expect(isImeComposing({ keyCode: 13, nativeEvent: { isComposing: false } })).toBe(false);
    expect(isImeComposing(null)).toBe(false);
  });

  test('isEnterKey は変換確定の Enter を除く', () => {
    expect(isEnterKey({ key: 'Enter', keyCode: 13 })).toBe(true);
    expect(isEnterKey({ key: 'Enter', keyCode: 229 })).toBe(false);
    expect(isEnterKey({ key: 'a', keyCode: 65 })).toBe(false);
  });
});
