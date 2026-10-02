import React, { useEffect, useRef } from 'react';
import ReactDOM from 'react-dom';
import './Modal.css';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])'
].join(',');

// 画面の上に重ねて出すダイアログ。
// - 開いたら中の入力欄（initialFocusRef）か最初のボタンにフォーカスし、閉じたら開く前の場所に戻す
// - Esc で閉じる。Tab でダイアログの外に出ない
// - 後ろの画面は操作・読み上げできないようにする（inert）
// 以前のダイアログは画面の左上に出て、後ろのボタンにも Tab で移動でき、閉じるとフォーカスが消えていた。
const Modal = ({ titleId, onClose, initialFocusRef, children, className = '', closeOnBackdrop = true }) => {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const previouslyFocused = document.activeElement;
    const appRoot = document.getElementById('root');
    const wasInert = appRoot ? appRoot.hasAttribute('inert') : false;
    if (appRoot && !wasInert) appRoot.setAttribute('inert', '');

    const dialog = dialogRef.current;
    const target = (initialFocusRef && initialFocusRef.current) || (dialog && dialog.querySelector(FOCUSABLE)) || dialog;
    if (target && target.focus) target.focus();

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE));
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    // 後ろの画面のショートカット（Delete キーなど）より先に受け取る
    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      if (appRoot && !wasInert) appRoot.removeAttribute('inert');
      if (previouslyFocused && previouslyFocused.focus && document.body.contains(previouslyFocused)) {
        previouslyFocused.focus();
      }
    };
    // 開いたときに 1 回だけ行う
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleBackdropPointerDown = (event) => {
    if (closeOnBackdrop && event.target === event.currentTarget) onCloseRef.current();
  };

  return ReactDOM.createPortal(
    // 背景を押すと閉じる（キーボードでは Esc で閉じる）
    <div className="modal-backdrop" role="presentation" onMouseDown={handleBackdropPointerDown}>
      <div
        ref={dialogRef}
        className={`modal-dialog ${className}`.trim()}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        {children}
      </div>
    </div>,
    document.body
  );
};

export default Modal;
