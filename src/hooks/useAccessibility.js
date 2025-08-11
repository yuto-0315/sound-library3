import { useEffect, useRef } from 'react';

/**
 * フォーカス管理フック
 * @param {boolean} shouldFocus - フォーカスすべきかどうか
 */
export const useFocus = (shouldFocus = false) => {
  const elementRef = useRef(null);

  useEffect(() => {
    if (shouldFocus && elementRef.current) {
      elementRef.current.focus();
    }
  }, [shouldFocus]);

  return elementRef;
};

/**
 * アナウンスメント用フック（スクリーンリーダー対応）
 */
export const useAnnouncement = () => {
  const announcementRef = useRef(null);

  const announce = (message, priority = 'polite') => {
    if (announcementRef.current) {
      announcementRef.current.setAttribute('aria-live', priority);
      announcementRef.current.textContent = message;
    }
  };

  const AnnouncementRegion = ({ className = '' }) => (
    <div
      ref={announcementRef}
      aria-live="polite"
      aria-atomic="true"
      className={`sr-only ${className}`}
    />
  );

  return { announce, AnnouncementRegion };
};

/**
 * キーボードナビゲーション用フック
 */
export const useKeyboardNavigation = (items, options = {}) => {
  const {
    loop = true,
    orientation = 'horizontal', // 'horizontal' or 'vertical'
    onActivate = () => {},
  } = options;

  const currentIndex = useRef(0);
  const itemRefs = useRef([]);

  const getKeys = () => {
    if (orientation === 'vertical') {
      return {
        next: ['ArrowDown'],
        prev: ['ArrowUp'],
        activate: ['Enter', ' '],
      };
    }
    return {
      next: ['ArrowRight', 'ArrowDown'],
      prev: ['ArrowLeft', 'ArrowUp'],
      activate: ['Enter', ' '],
    };
  };

  const handleKeyDown = (event) => {
    const keys = getKeys();
    const { key } = event;

    if (keys.next.includes(key)) {
      event.preventDefault();
      moveToNext();
    } else if (keys.prev.includes(key)) {
      event.preventDefault();
      moveToPrev();
    } else if (keys.activate.includes(key)) {
      event.preventDefault();
      onActivate(currentIndex.current, items[currentIndex.current]);
    }
  };

  const moveToNext = () => {
    if (currentIndex.current < items.length - 1) {
      currentIndex.current += 1;
    } else if (loop) {
      currentIndex.current = 0;
    }
    focusCurrent();
  };

  const moveToPrev = () => {
    if (currentIndex.current > 0) {
      currentIndex.current -= 1;
    } else if (loop) {
      currentIndex.current = items.length - 1;
    }
    focusCurrent();
  };

  const focusCurrent = () => {
    const currentRef = itemRefs.current[currentIndex.current];
    if (currentRef) {
      currentRef.focus();
    }
  };

  const getItemProps = (index) => ({
    ref: (el) => {
      itemRefs.current[index] = el;
    },
    tabIndex: index === currentIndex.current ? 0 : -1,
    onKeyDown: handleKeyDown,
    onFocus: () => {
      currentIndex.current = index;
    },
  });

  return {
    getItemProps,
    focusCurrent,
    currentIndex: currentIndex.current,
  };
};

/**
 * エラーメッセージの管理フック
 */
export const useErrorMessages = () => {
  const errorRef = useRef(null);

  const showError = (message) => {
    if (errorRef.current) {
      errorRef.current.textContent = message;
      errorRef.current.setAttribute('aria-live', 'assertive');
    }
  };

  const clearError = () => {
    if (errorRef.current) {
      errorRef.current.textContent = '';
      errorRef.current.removeAttribute('aria-live');
    }
  };

  const ErrorRegion = ({ className = '' }) => (
    <div
      ref={errorRef}
      role="alert"
      className={`error-message ${className}`}
      aria-atomic="true"
    />
  );

  return { showError, clearError, ErrorRegion };
};

/**
 * 進捗状況の管理フック
 */
export const useProgress = () => {
  const progressRef = useRef(null);

  const updateProgress = (current, total, label = '') => {
    if (progressRef.current) {
      const percentage = Math.round((current / total) * 100);
      progressRef.current.setAttribute('aria-valuenow', current);
      progressRef.current.setAttribute('aria-valuemax', total);
      progressRef.current.setAttribute('aria-valuetext', 
        `${label} ${percentage}% 完了 (${current} / ${total})`
      );
    }
  };

  const ProgressBar = ({ className = '', label = '進捗' }) => (
    <div
      ref={progressRef}
      role="progressbar"
      aria-label={label}
      aria-valuenow={0}
      aria-valuemin={0}
      aria-valuemax={100}
      className={`progress-bar ${className}`}
    />
  );

  return { updateProgress, ProgressBar };
};
