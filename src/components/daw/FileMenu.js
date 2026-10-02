import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, FolderOpen } from 'lucide-react';
import Icon from '../Icon';

// 「ファイル」ボタンを押すと開く、保存・読み込みなどの一覧（ボタンで開閉する、ふつうのボタンの並び）。
// 以前はこれらのボタンが全部ツールバーに並び、iPad の画面の半分を使ってタイムラインを押し下げていた。
const FileMenu = ({ items }) => {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const panelRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const closeIfOutside = (event) => {
      const target = event.target;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (buttonRef.current && buttonRef.current.contains(target)) return;
      setOpen(false);
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
        if (buttonRef.current) buttonRef.current.focus();
      }
    };
    document.addEventListener('mousedown', closeIfOutside);
    document.addEventListener('touchstart', closeIfOutside, { passive: true });
    document.addEventListener('keydown', handleKeyDown);
    const first = panelRef.current && panelRef.current.querySelector('button:not([disabled])');
    if (first) first.focus();
    return () => {
      document.removeEventListener('mousedown', closeIfOutside);
      document.removeEventListener('touchstart', closeIfOutside, { passive: true });
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const visibleItems = items.filter(Boolean);

  return (
    <div className="file-menu">
      <button
        ref={buttonRef}
        type="button"
        className="button-secondary daw-toolbar-button"
        aria-expanded={open}
        aria-controls="daw-file-menu"
        onClick={() => setOpen((value) => !value)}
      >
        <Icon icon={FolderOpen} /> <span className="daw-button-label">ファイル</span> <Icon icon={ChevronDown} />
      </button>
      {open && (
        <div id="daw-file-menu" ref={panelRef} className="file-menu-panel">
          <ul>
            {visibleItems.map((item) => (
              <li key={item.id}>
                <button
                  type="button"
                  className={`file-menu-item ${item.danger ? 'file-menu-item-danger' : ''}`}
                  disabled={item.disabled}
                  // 名前は見出しの文字だけにし、説明は説明として読ませる（名前に混ざると 2 回読まれる）
                  aria-label={item.label}
                  aria-describedby={item.description ? `${item.id}-description` : undefined}
                  onClick={() => {
                    // ファイルを選ぶ画面などは、タップの処理の中で開かないと iPad で開かない
                    setOpen(false);
                    item.onSelect();
                  }}
                >
                  <Icon icon={item.icon} />
                  <span className="file-menu-item-text">
                    <span className="file-menu-item-label">{item.label}</span>
                    {item.description && (
                      <span id={`${item.id}-description`} className="file-menu-item-description">{item.description}</span>
                    )}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export default FileMenu;
