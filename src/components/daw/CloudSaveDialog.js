import React, { useRef } from 'react';
import { LoaderCircle, Send, X } from 'lucide-react';
import Icon from '../Icon';
import Modal from '../Modal';
import { focusNextFieldOnEnter } from '../../utils/keyboard';
import { normalizeRoomNumberInput } from '../../utils/text';

// 「先生に送る」（楽曲をサーバーに保存して、先生用ページで開けるようにする）
const CloudSaveDialog = ({ values, onChange, onSubmit, onClose, isSaving, error }) => {
  const titleInputRef = useRef(null);
  const canSubmit = !isSaving && values.songTitle.trim() !== '' && String(values.roomNumber).trim() !== '';
  const update = (field) => (event) => onChange({ ...values, [field]: event.target.value });

  return (
    <Modal titleId="cloud-save-title" onClose={onClose} initialFocusRef={titleInputRef} closeOnBackdrop={!isSaving}>
      <div className="modal-header">
        <h3 id="cloud-save-title"><Icon icon={Send} /> 曲を先生に送る</h3>
        <button type="button" className="modal-close-btn" onClick={onClose} aria-label="ダイアログを閉じる">
          <Icon icon={X} />
        </button>
      </div>

      <form
        className="modal-body"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit();
        }}
      >
        <p className="field-help">送った曲は、先生のページで開いて聞くことができます。</p>
        {/* ダイアログの後ろに隠れて見えないので、エラーはダイアログ内にも出す */}
        {error && <div className="error-message" role="alert">{error}</div>}

        <div className="form-group">
          <label htmlFor="cloud-song-title" className="field-label">曲のタイトル（必須）</label>
          <input
            ref={titleInputRef}
            id="cloud-song-title"
            className="text-field"
            type="text"
            maxLength={100}
            value={values.songTitle}
            onChange={update('songTitle')}
            onKeyDown={focusNextFieldOnEnter}
            placeholder="例: あめのおと"
            enterKeyHint="next"
            required
          />
        </div>

        <div className="form-group">
          <label htmlFor="cloud-room-number" className="field-label">部屋番号（必須）</label>
          <input
            id="cloud-room-number"
            className="text-field"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            maxLength={6}
            value={values.roomNumber}
            onChange={(event) => onChange({ ...values, roomNumber: normalizeRoomNumberInput(event.target.value) })}
            onKeyDown={focusNextFieldOnEnter}
            enterKeyHint="next"
            placeholder="先生に教えてもらった番号（例: 101）"
            required
          />
        </div>

        <div className="form-row-2">
          <div className="form-group">
            <label htmlFor="cloud-student-name" className="field-label">あなたの名前</label>
            <input
              id="cloud-student-name"
              className="text-field"
              type="text"
              maxLength={50}
              value={values.studentName}
              onChange={update('studentName')}
              onKeyDown={focusNextFieldOnEnter}
              enterKeyHint="next"
              placeholder="（なくてもよい）"
            />
          </div>

          <div className="form-group">
            <label htmlFor="cloud-group-number" className="field-label">班の番号</label>
            <input
              id="cloud-group-number"
              className="text-field"
              type="text"
              maxLength={20}
              value={values.groupNumber}
              onChange={update('groupNumber')}
              onKeyDown={focusNextFieldOnEnter}
              enterKeyHint="done"
              placeholder="（なくてもよい）"
            />
          </div>
        </div>

        <div className="modal-footer">
          <button type="button" className="button-secondary" onClick={onClose} disabled={isSaving}>
            やめる
          </button>
          <button type="submit" className="button-primary" disabled={!canSubmit}>
            {isSaving
              ? <><Icon icon={LoaderCircle} className="icon-spin" /> 送っています...</>
              : <><Icon icon={Send} /> 先生に送る</>}
          </button>
        </div>
      </form>
    </Modal>
  );
};

export default CloudSaveDialog;
