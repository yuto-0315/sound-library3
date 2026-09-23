import React, { useState, useRef, useEffect } from 'react';
import { Circle, FileAudio, FolderOpen, ListMusic, Mic, Pencil, Save, Square, TabletSmartphone, X } from 'lucide-react';
import './SoundCollection.css';
import Icon from '../components/Icon';
import { useAnnouncement, useErrorMessages } from '../hooks/useAccessibility';
import { addRecording, isQuotaExceededError, requestPersistentStorage } from '../utils/indexedDB';
import {
  blobToAudioDataUrl,
  getSupportedRecordingMimeType,
  isAudioFile,
  withDetectedMimeType
} from '../utils/audio';
import { isEnterKey } from '../utils/keyboard';

const LEGACY_RECORDINGS_KEY = 'soundRecordings';

const stopStream = (stream) => {
  if (!stream) return;
  try {
    stream.getTracks().forEach(track => track.stop());
  } catch (error) {
    // 既に停止している
  }
};

// HTTPS接続チェック（iOSでの録音に必要）
const isSecureOrigin = () => (
  window.location.protocol === 'https:' ||
  window.location.hostname === 'localhost' ||
  window.location.hostname === '127.0.0.1'
);

const getMicrophoneErrorMessage = (error) => {
  switch (error && error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'マイクの使用が拒否されました。iPad の「設定」アプリ →「Safari」→「マイク」を「確認」か「許可」にしてから、もう一度お試しください。';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'マイクが見つかりません。デバイスにマイクが接続されているか確認してください。';
    case 'NotSupportedError':
      return 'お使いのブラウザは録音機能をサポートしていません。';
    case 'NotReadableError':
    case 'AbortError':
      return 'マイクが他のアプリケーションで使用中の可能性があります。他のアプリを閉じてからもう一度お試しください。';
    default:
      return '録音を開始できませんでした。もう一度お試しください。';
  }
};

const SoundCollection = () => {
  const [recordings, setRecordings] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [currentRecording, setCurrentRecording] = useState(null);
  const fileInputRef = useRef(null);
  const recordButtonRef = useRef(null);

  // 非同期処理やアンマウント時の後片付けで最新の値を参照するための ref
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const isStartingRef = useRef(false);
  const isMountedRef = useRef(true);
  const objectUrlsRef = useRef(new Set());

  // アクセシビリティフック
  const { announce, AnnouncementRegion } = useAnnouncement();
  const { showError, clearError, ErrorRegion } = useErrorMessages();

  // アンマウント時だけ後片付けする。
  // （以前は録音一覧が変わるたびに実行され、表示中の音の URL まで解放して再生できなくなっていた）
  useEffect(() => {
    isMountedRef.current = true;
    const objectUrls = objectUrlsRef.current;
    return () => {
      isMountedRef.current = false;
      const recorder = mediaRecorderRef.current;
      mediaRecorderRef.current = null;
      if (recorder && recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch (error) {
          // 既に停止している
        }
      }
      stopStream(streamRef.current);
      streamRef.current = null;
      objectUrls.forEach(url => URL.revokeObjectURL(url));
      objectUrls.clear();
    };
  }, []);

  const createObjectUrl = (blob) => {
    const url = URL.createObjectURL(blob);
    objectUrlsRef.current.add(url);
    return url;
  };

  const releaseObjectUrl = (url) => {
    if (url && objectUrlsRef.current.has(url)) {
      URL.revokeObjectURL(url);
      objectUrlsRef.current.delete(url);
    }
  };

  // 編集中の音を差し替える（保存しなかった前の音の URL は解放する）
  const replaceCurrentRecording = (next) => {
    setCurrentRecording(prev => {
      if (prev && prev.url && (!next || prev.url !== next.url)) {
        releaseObjectUrl(prev.url);
      }
      return next;
    });
  };

  // 録音できる環境かどうかを確認し、問題があればメッセージを返す
  const getRecordingSupportError = async () => {
    if (!isSecureOrigin()) {
      return '録音機能を使用するにはHTTPS接続（https:// で始まるアドレス）が必要です。';
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
      return 'お使いのブラウザは録音機能をサポートしていません。iPadの場合は iPadOS 14.3 以降の Safari をお使いください。';
    }
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        if (permission && permission.state === 'denied') {
          return getMicrophoneErrorMessage({ name: 'NotAllowedError' });
        }
      } catch (permError) {
        // Safari 15 以前は microphone の問い合わせに対応していない
      }
    }
    return null;
  };

  const reportError = (message) => {
    showError(message);
    announce(message, 'assertive');
  };

  const startRecording = async () => {
    // 連打で録音が二重に始まらないようにする
    if (isStartingRef.current || mediaRecorderRef.current) return;
    isStartingRef.current = true;

    try {
      clearError();
      announce('録音を開始しています...', 'assertive');

      const supportError = await getRecordingSupportError();
      if (supportError) {
        reportError(supportError);
        return;
      }

      let stream;
      try {
        // マイクの取得は 1 回だけにする（取得→停止→再取得すると一部の iPad で無音になる）
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 1
          }
        });
      } catch (error) {
        console.error('マイクの取得に失敗しました:', error);
        reportError(getMicrophoneErrorMessage(error));
        return;
      }

      if (!isMountedRef.current) {
        stopStream(stream);
        return;
      }

      const mimeType = getSupportedRecordingMimeType();
      let recorder;
      try {
        recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      } catch (error) {
        try {
          recorder = new MediaRecorder(stream);
        } catch (fallbackError) {
          console.error('MediaRecorder を作成できませんでした:', fallbackError);
          stopStream(stream);
          reportError(getMicrophoneErrorMessage({ name: 'NotSupportedError' }));
          return;
        }
      }

      const chunks = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = () => {
        stopStream(stream);
        if (streamRef.current === stream) streamRef.current = null;
        if (mediaRecorderRef.current === recorder) mediaRecorderRef.current = null;
        if (!isMountedRef.current) return;

        // 実際の録音形式で Blob を作る（常に audio/wav と表記すると iPad で再生できなくなる）
        const type = recorder.mimeType || (chunks[0] && chunks[0].type) || mimeType || 'audio/mp4';
        const blob = new Blob(chunks, { type });
        if (blob.size === 0) {
          reportError('録音データが空でした。もう一度録音してください。');
          return;
        }

        replaceCurrentRecording({
          url: createObjectUrl(blob),
          audioBlob: blob,
          name: '',
          tags: [],
          createdAt: new Date().toISOString()
        });

        announce('録音が完了しました。音に名前をつけて保存してください。', 'assertive');
      };

      recorder.onerror = (event) => {
        console.error('録音中にエラーが発生しました:', event && event.error);
        reportError('録音中にエラーが発生しました。もう一度お試しください。');
      };

      try {
        recorder.start();
      } catch (error) {
        console.error('録音の開始に失敗しました:', error);
        stopStream(stream);
        reportError(getMicrophoneErrorMessage(error));
        return;
      }

      mediaRecorderRef.current = recorder;
      streamRef.current = stream;
      setIsRecording(true);
      announce('録音を開始しました。', 'assertive');
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopRecording = () => {
    setIsRecording(false); // まず録音状態を停止に設定

    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        // マイクは onstop で止める（先に止めると最後の音が欠けることがある）
        recorder.stop();
      } catch (error) {
        console.error('録音の停止に失敗しました:', error);
        stopStream(streamRef.current);
        mediaRecorderRef.current = null;
      }
    } else {
      stopStream(streamRef.current);
      mediaRecorderRef.current = null;
    }
    announce('録音を停止しました。', 'assertive');
  };

  const saveToLegacyStorage = (record) => {
    const existing = JSON.parse(localStorage.getItem(LEGACY_RECORDINGS_KEY) || '[]');
    localStorage.setItem(LEGACY_RECORDINGS_KEY, JSON.stringify([...existing, record]));
  };

  const saveRecording = async (name, tags) => {
    const target = currentRecording;
    if (!target || !name.trim() || isSaving) return;

    setIsSaving(true);
    clearError();
    try {
      const record = {
        name: name.trim(),
        tags: tags.map(tag => tag.trim()).filter(Boolean),
        audioData: await blobToAudioDataUrl(target.audioBlob),
        createdAt: target.createdAt || new Date().toISOString()
      };

      let id;
      try {
        id = await addRecording(record);
      } catch (dbError) {
        if (isQuotaExceededError(dbError)) throw dbError;
        console.error('IndexedDB保存エラー、localStorageにフォールバック:', dbError);
        // 次回の読み込み時に IndexedDB へ移行される
        saveToLegacyStorage(record);
        id = `local-${Date.now()}`;
      }

      // 保存が確定してから一覧に出す（保存できていないのに保存済みに見えるのを防ぐ）
      requestPersistentStorage();
      if (!isMountedRef.current) return;
      setRecordings(prev => [...prev, { ...record, id, url: target.url }]);
      setCurrentRecording(null);
      announce(`「${record.name}」を保存しました。`, 'polite');
    } catch (error) {
      console.error('録音の保存に失敗しました:', error);
      if (!isMountedRef.current) return;
      reportError(isQuotaExceededError(error)
        ? '保存できる容量が足りません。音ライブラリで使わない音を削除してから、もう一度保存してください。'
        : '録音の保存に失敗しました。もう一度「保存」を押してください。');
    } finally {
      if (isMountedRef.current) setIsSaving(false);
    }
  };

  const handleFileUpload = async (event) => {
    const input = event.target;
    const file = input.files && input.files[0];
    // 同じファイルをもう一度選んでも反応するようにリセットする
    input.value = '';
    if (!file) return;

    if (!isAudioFile(file)) {
      reportError('音声ファイルを選択してください。対応形式: MP3, WAV, M4A など');
      return;
    }
    clearError();

    let blob = file;
    try {
      // iPad では file.type が空や誤っていることがあるので中身から判定し直す
      blob = await withDetectedMimeType(file);
    } catch (error) {
      console.warn('ファイル形式の判定に失敗しました:', error);
    }
    if (!isMountedRef.current) return;

    replaceCurrentRecording({
      url: createObjectUrl(blob),
      audioBlob: blob,
      name: file.name.replace(/\.[^/.]+$/, ''),
      tags: [],
      createdAt: new Date().toISOString()
    });
  };

  // 音声レベル監視関数
  return (
    <div className="sound-collection">
      <header>
        <h2 id="page-title">
          <Icon icon={Mic} label="マイク" /> 音あつめページ
        </h2>
        <p className="page-description">
          身の回りにある音を録音したり、音ファイルをアップロードして音素材を集めましょう！
        </p>
      </header>
      
      {/* アクセシビリティ用のライブリージョン */}
      <AnnouncementRegion />
      <ErrorRegion />
      
      <section className="collection-actions" aria-labelledby="collection-title">
        <h3 id="collection-title" className="sr-only">音の収集方法</h3>
        
        <section className="recording-section card" aria-labelledby="recording-title">
          <h3 id="recording-title">
            <Icon icon={Mic} label="マイク" /> 音を録音する
          </h3>
          
          {/* iOS用の説明 */}
          <div className="ios-notice" role="region" aria-labelledby="ios-instructions">
            <h4 id="ios-instructions" className="sr-only">iPhone/iPad使用時の注意事項</h4>
            <p>
              <Icon icon={TabletSmartphone} label="スマートフォン" /> 
              <strong>iPhone/iPadをお使いの方へ：</strong>
            </p>
            <p>録音ボタンを押すとマイクの使用許可を求めるダイアログが表示されます。「許可」を選択してください。</p>
            <p>ダイアログが表示されない場合は、「設定」アプリ →「Safari」→「マイク」を「確認」か「許可」にしてください。</p>
          </div>
          
          <div className="recording-controls" role="group" aria-labelledby="recording-controls-label">
            <h4 id="recording-controls-label" className="sr-only">録音操作</h4>
            {!isRecording ? (
              <button 
                ref={recordButtonRef}
                className="accessible-button button-primary large-button record-btn"
                onClick={startRecording}
                aria-describedby="record-instructions"
                type="button"
              >
                <Icon icon={Circle} label="録音開始" fill="currentColor" /> 録音開始
              </button>
            ) : (
              <button 
                className="accessible-button button-secondary large-button stop-btn"
                onClick={stopRecording}
                aria-describedby="stop-instructions"
                type="button"
              >
                <Icon icon={Square} label="停止" fill="currentColor" /> 録音停止
              </button>
            )}
            <div id="record-instructions" className="sr-only">
              録音開始ボタンを押すとマイクが有効になり、音声の録音が始まります
            </div>
            <div id="stop-instructions" className="sr-only">
              録音停止ボタンを押すと録音が終了し、音に名前をつけることができます
            </div>
          </div>

          {isRecording && (
            <div 
              className="recording-status" 
              role="status" 
              aria-live="polite"
              aria-label="録音状況"
            >
              <div className="recording-indicator">
                <div className="pulse-dot" aria-hidden="true"></div>
                録音中...
              </div>
            </div>
          )}
        </section>

        <section className="upload-section card" aria-labelledby="upload-title">
          <h3 id="upload-title">
            <Icon icon={FolderOpen} label="フォルダ" /> 音ファイルをアップロード
          </h3>
          <button 
            className="accessible-button button-secondary large-button"
            onClick={() => fileInputRef.current?.click()}
            aria-describedby="upload-instructions"
            type="button"
          >
            <Icon icon={FileAudio} label="ファイル選択" /> ファイルを選択
          </button>
          <div id="upload-instructions" className="sr-only">
            音声ファイルを選択してアップロードできます。対応形式: MP3, WAV, M4A など
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            onChange={handleFileUpload}
            style={{ display: 'none' }}
            aria-label="音声ファイルを選択"
          />
        </section>
      </section>

      {currentRecording && (
        <RecordingEditor 
          key={currentRecording.url}
          recording={currentRecording}
          onSave={saveRecording}
          onCancel={() => replaceCurrentRecording(null)}
          isSaving={isSaving}
        />
      )}

      <section className="recent-recordings" aria-labelledby="recent-title">
        <h3 id="recent-title">
          <Icon icon={ListMusic} label="メモ" /> 最近録音した音
        </h3>
        {recordings.length === 0 ? (
          <p className="no-recordings">まだ録音した音がありません。上の録音ボタンから始めましょう！</p>
        ) : (
          <div 
            className="recordings-grid" 
            role="grid" 
            aria-label="録音された音のリスト"
          >
            {recordings.map((recording, index) => (
              <SoundCard 
                key={recording.id} 
                recording={recording} 
                index={index}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
};

const RecordingEditor = ({ recording, onSave, onCancel, isSaving = false }) => {
  const [name, setName] = useState(recording.name);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState(recording.tags);
  const [validationMessage, setValidationMessage] = useState('');

  const addTag = () => {
    if (tagInput.trim() && !tags.includes(tagInput.trim())) {
      setTags([...tags, tagInput.trim()]);
      setTagInput('');
      setValidationMessage(`タグ「${tagInput.trim()}」を追加しました`);
    } else if (tags.includes(tagInput.trim())) {
      setValidationMessage('このタグは既に追加されています');
    }
  };

  const removeTag = (tagToRemove) => {
    setTags(tags.filter(tag => tag !== tagToRemove));
    setValidationMessage(`タグ「${tagToRemove}」を削除しました`);
  };

  const handleKeyDown = (e) => {
    if (isEnterKey(e)) {
      e.preventDefault();
      addTag();
    }
  };

  const handleSave = () => {
    if (!name.trim()) {
      setValidationMessage('音の名前を入力してください');
      return;
    }
    onSave(name, tags);
  };

  return (
    <section 
      className="recording-editor card" 
      role="dialog" 
      aria-labelledby="editor-title"
      aria-describedby="editor-description"
    >
      <h3 id="editor-title">
        <Icon icon={Pencil} label="編集" /> 音に名前をつけよう
      </h3>
      <p id="editor-description" className="sr-only">
        録音した音に名前とタグをつけて保存できます
      </p>
      
      <div className="audio-preview-container">
        <label htmlFor="audio-preview" className="audio-preview-label">録音した音のプレビュー:</label>
        <audio 
          id="audio-preview"
          controls 
          src={recording.url} 
          className="accessible-audio audio-preview"
          preload="auto"
          playsInline
          onError={(e) => {
            console.error('音声プレビューの読み込みエラー:', e);
          }}
          aria-describedby="audio-preview-desc"
        >
          <track kind="captions" label="音声説明" srcLang="ja" />
          お使いのブラウザは音声再生に対応していません。
        </audio>
        <p id="audio-preview-desc" className="sr-only">
          録音された音声を再生して確認できます
        </p>
      </div>
      
      <div className="form-group">
        <label htmlFor="soundName" className="required-label">
          音の名前 <span aria-label="必須" className="required">*</span>:
        </label>
        <input
          id="soundName"
          type="text"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (validationMessage) setValidationMessage('');
          }}
          placeholder="例: ピアノの音、雨の音"
          className="accessible-input sound-name-input"
          required
          aria-describedby="name-help"
          aria-invalid={!name.trim() && validationMessage ? 'true' : 'false'}
        />
        <p id="name-help" className="help-text">
          この音を表す分かりやすい名前をつけてください
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="soundTags" className="optional-label">
          タグ <span className="optional">(任意)</span>:
        </label>
        <div className="tag-input-container">
          <input
            id="soundTags"
            type="text"
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 楽器、自然"
            className="accessible-input tag-input"
            aria-describedby="tag-help"
            list="tag-suggestions"
          />
          <datalist id="tag-suggestions">
            <option value="楽器">楽器</option>
            <option value="自然">自然</option>
            <option value="機械">機械</option>
            <option value="動物">動物</option>
            <option value="声">声</option>
          </datalist>
          <button 
            onClick={addTag} 
            className="accessible-button add-tag-btn"
            type="button"
            disabled={!tagInput.trim()}
            aria-describedby="add-tag-help"
          >
            追加
          </button>
        </div>
        <p id="tag-help" className="help-text">
          音の種類やカテゴリを表すタグを追加できます。Enterキーでも追加できます。
        </p>
        <p id="add-tag-help" className="sr-only">
          入力したタグを音に追加します
        </p>
        
        {tags.length > 0 && (
          <div className="tags-display" role="group" aria-labelledby="tags-label">
            <p id="tags-label" className="tags-title">追加されたタグ:</p>
            <ul className="tags-list" aria-live="polite">
              {tags.map((tag, index) => (
                <li key={tag} className="tag-item">
                  <span className="tag">
                    {tag}
                    <button 
                      onClick={() => removeTag(tag)} 
                      className="remove-tag touch-target-expand"
                      type="button"
                      aria-label={`タグ「${tag}」を削除`}
                    >
                      <Icon icon={X} size={14} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {validationMessage && (
        <div 
          className="validation-message" 
          role="status" 
          aria-live="polite"
        >
          {validationMessage}
        </div>
      )}

      <div className="editor-actions" role="group" aria-labelledby="actions-label">
        <p id="actions-label" className="sr-only">保存・キャンセル操作</p>
        <button 
          onClick={handleSave}
          className="accessible-button button-primary"
          disabled={!name.trim() || isSaving}
          type="button"
          aria-describedby="save-help"
        >
          <Icon icon={Save} label="保存" /> {isSaving ? '保存中...' : '保存'}
        </button>
        <button 
          onClick={onCancel} 
          className="accessible-button button-secondary"
          type="button"
          aria-describedby="cancel-help"
        >
          <Icon icon={X} label="キャンセル" /> キャンセル
        </button>
        <p id="save-help" className="sr-only">
          音の名前とタグを保存します
        </p>
        <p id="cancel-help" className="sr-only">
          編集をキャンセルして録音を破棄します
        </p>
      </div>
    </section>
  );
};


const SoundCard = ({ recording, index }) => {
  const formattedDate = new Date(recording.createdAt).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });

  return (
    <article 
      className="sound-card" 
      aria-labelledby={`sound-title-${recording.id}`}
      aria-describedby={`sound-desc-${recording.id}`}
    >
      <header className="sound-info">
        <h4 id={`sound-title-${recording.id}`} className="sound-name">
          {recording.name}
        </h4>
        <p className="sound-date" aria-label={`録音日: ${formattedDate}`}>
          {formattedDate}
        </p>
        {(recording.tags || []).length > 0 && (
          <div className="sound-tags" role="group" aria-label="タグ">
            {recording.tags.map((tag, tagIndex) => (
              <span 
                key={tag} 
                className="tag small"
                role="mark"
                aria-label={`タグ: ${tag}`}
              >
                {tag}
              </span>
            ))}
          </div>
        )}
      </header>
      
      <div className="sound-player">
        <label htmlFor={`audio-${recording.id}`} className="sr-only">
          {recording.name}の音声プレーヤー
        </label>
        <audio 
          id={`audio-${recording.id}`}
          controls 
          src={recording.url}
          className="accessible-audio"
          preload="auto"
          playsInline
          onError={(e) => {
            console.error('音声カードの読み込みエラー:', e, 'recording:', recording.name);
          }}
          aria-describedby={`audio-desc-${recording.id}`}
        >
          <track kind="captions" label="音声説明" srcLang="ja" />
          お使いのブラウザは音声再生に対応していません。
        </audio>
        <p id={`audio-desc-${recording.id}`} className="sr-only">
          {recording.name}の音声ファイル。再生ボタンで音を聞くことができます。
        </p>
      </div>
    </article>
  );
};

export default SoundCollection;
