import { useLayoutEffect, useRef } from 'react';

// ========== ドラッグ中の画面制御 ==========

// 以前は body を position: fixed にしてスクロールを止めていたが、iPad ではその瞬間にページが
// 先頭へ飛び、指の下の要素がずれて違うトラックに置かれてしまっていた。
// 今はクラスを付けるだけにして、スクロールは touchmove の preventDefault で止める。
export const lockScrollForDrag = () => {
  document.body.classList.add('dragging');
};

export const unlockScrollAfterDrag = () => {
  document.body.classList.remove('dragging');
  // 旧バージョンが付けたインラインスタイルが残っていても解除する
  document.body.style.overflow = '';
  document.body.style.position = '';
  document.body.style.width = '';
  document.body.style.height = '';
};

export const clearTrackHighlights = () => {
  document.querySelectorAll('.track.drag-over').forEach((track) => {
    track.classList.remove('drag-over');
  });
};

export const highlightTrack = (trackElement) => {
  document.querySelectorAll('.track.drag-over').forEach((track) => {
    if (track !== trackElement) track.classList.remove('drag-over');
  });
  if (trackElement) trackElement.classList.add('drag-over');
};

// 指の位置にあるトラックを探す
export const findTrackAtPoint = (x, y) => {
  const element = document.elementFromPoint(x, y);
  const trackElement = element && element.closest ? element.closest('.track') : null;
  if (!trackElement || !trackElement.dataset || !trackElement.dataset.trackId) return null;
  const rect = trackElement.getBoundingClientRect();
  return {
    element: trackElement,
    trackId: trackElement.dataset.trackId,
    timePosition: x - rect.left
  };
};

// 指に付いてくる名前ラベル（pointer-events: none なので elementFromPoint の邪魔をしない）
export const createFloatingDragLabel = (text, x, y) => {
  const element = document.createElement('div');
  element.className = 'mobile-drag-preview';
  element.textContent = text;
  document.body.appendChild(element);
  const move = (px, py) => {
    element.style.left = `${px - 50}px`;
    element.style.top = `${py - 40}px`;
  };
  move(x, y);
  return {
    move,
    remove: () => {
      if (element.parentNode) element.parentNode.removeChild(element);
    }
  };
};

export const removeFloatingDragLabels = () => {
  document.querySelectorAll('.mobile-drag-preview').forEach((element) => element.remove());
};

// ========== タッチでのドラッグ ==========

// React の onTouchMove は passive 扱いで preventDefault できず、ドラッグ中に画面が一緒に
// スクロールしてしまう。そのため要素に直接 { passive: false } のリスナーを付ける。
//
// shouldStart(dx, dy, target): 指が threshold 以上動いたときに呼ばれ、true ならドラッグ開始、
// false ならスクロール操作とみなしてこのタッチは無視する。
// ボタン・入力欄から始まったタッチはドラッグにしない（▶ や × を押せるように）。
export const useTouchDrag = ({ onStart, onMove, onEnd, onCancel, shouldStart, threshold = 8 }) => {
  const elementRef = useRef(null);
  const handlersRef = useRef(null);
  handlersRef.current = { onStart, onMove, onEnd, onCancel, shouldStart };

  // 描画と同時にリスナーを付ける（useEffect だと、表示されてから付くまでの間のタッチを取りこぼす）
  useLayoutEffect(() => {
    const element = elementRef.current;
    if (!element) return undefined;

    const state = { tracking: false, dragging: false, startX: 0, startY: 0, x: 0, y: 0, target: null };
    const call = (name, payload) => {
      const handler = handlersRef.current[name];
      if (handler) handler(payload);
    };

    const handleTouchStart = (event) => {
      const target = event.target;
      if (event.touches.length !== 1 || (target && target.closest && target.closest('button, input, select, textarea, a'))) {
        state.tracking = false;
        return;
      }
      const touch = event.touches[0];
      state.tracking = true;
      state.dragging = false;
      state.startX = touch.clientX;
      state.startY = touch.clientY;
      state.x = touch.clientX;
      state.y = touch.clientY;
      state.target = target;
    };

    const handleTouchMove = (event) => {
      if (!state.tracking) return;
      const touch = event.touches[0];
      state.x = touch.clientX;
      state.y = touch.clientY;

      if (!state.dragging) {
        const dx = Math.abs(state.x - state.startX);
        const dy = Math.abs(state.y - state.startY);
        if (dx < threshold && dy < threshold) return;
        const canStart = handlersRef.current.shouldStart;
        if (canStart && !canStart(dx, dy, state.target)) {
          state.tracking = false; // スクロールとして扱う
          return;
        }
        state.dragging = true;
        call('onStart', { startX: state.startX, startY: state.startY, x: state.x, y: state.y });
      }

      if (event.cancelable) event.preventDefault();
      call('onMove', { x: state.x, y: state.y });
    };

    const finish = (name) => {
      const wasDragging = state.dragging;
      state.tracking = false;
      state.dragging = false;
      if (wasDragging) call(name, { x: state.x, y: state.y });
    };

    const handleTouchEnd = (event) => {
      // ドラッグ後の「クリック」を発生させない（指を離した所のボタンが押されるのを防ぐ）
      if (state.dragging && event.cancelable) event.preventDefault();
      finish('onEnd');
    };

    // 他のジェスチャー（iPad の標準ドラッグ、通知など）に割り込まれた場合
    const handleTouchCancel = () => finish('onCancel');

    element.addEventListener('touchstart', handleTouchStart, { passive: true });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: false });
    element.addEventListener('touchcancel', handleTouchCancel);

    return () => {
      element.removeEventListener('touchstart', handleTouchStart, { passive: true });
      element.removeEventListener('touchmove', handleTouchMove, { passive: false });
      element.removeEventListener('touchend', handleTouchEnd, { passive: false });
      element.removeEventListener('touchcancel', handleTouchCancel);
      if (state.dragging) finish('onCancel');
    };
  }, [threshold]);

  return elementRef;
};
