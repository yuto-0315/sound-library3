import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  FolderOpen,
  ListMusic,
  Mic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Save,
  Square,
  Trash2,
  X
} from 'lucide-react';
import './SoundCollection.css';
import Icon from '../components/Icon';
import { useAnnouncement, useErrorMessages } from '../hooks/useAccessibility';
import { useAudioPreview } from '../hooks/useAudioPreview';
import { addRecording, getAllRecordings, isQuotaExceededError, requestPersistentStorage } from '../utils/indexedDB';
import {
  blobToAudioDataUrl,
  getSupportedRecordingMimeType,
  isAudioFile,
  measureAudioDuration,
  withDetectedMimeType
} from '../utils/audio';
import { formatDuration, formatSeconds } from '../utils/timing';
import { isEnterKey } from '../utils/keyboard';
import { keepUnsavedDraft, takeUnsavedDraft } from '../utils/unsavedDraft';
import { compareByNewest } from '../utils/date';

const LEGACY_RECORDINGS_KEY = 'soundRecordings';

// 1 回の録音の長さの上限（止め忘れて大きな音声ができると、古い iPad では保存や読み込みが重くなる）
export const MAX_RECORDING_SECONDS = 60;
// 「さいきん集めた音」に出す数
const RECENT_LIMIT = 6;
// よく使うタグ（ライブラリにあるタグも候補に出す）
const DEFAULT_TAG_SUGGESTIONS = ['楽器', '自然', '機械', '動物', '声', '学校', '家'];

const DISCARD_CONFIRM_MESSAGE = 'まだ保存していない音があります。\n新しい音にすると、この音は消えます。よろしいですか？';
const THROW_AWAY_CONFIRM_MESSAGE = 'この音をすてますか？\n（保存していないので、もとに戻せません）';

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
      return 'マイクの使用が拒否されました。下の「マイクが使えないとき」を見て、許可してからもう一度お試しください。';
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

// 日時は時刻（数値）で比べる（2025 年 10 月の版は Date のまま保存していて、文字列で比べると
// 古い音が「さいきん集めた音」に居座り、新しく保存した音が出てこなかった）
const byNewest = compareByNewest;

const SoundCollection = () => {
  const [recentSounds, setRecentSounds] = useState([]);
  const [libraryTags, setLibraryTags] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [currentRecording, setCurrentRecording] = useState(null);
  const [isDraftRestored, setIsDraftRestored] = useState(false);
  const [notice, setNotice] = useState('');
  const [showMicHelp, setShowMicHelp] = useState(false);
  const [micDenied, setMicDenied] = useState(false);
  const fileInputRef = useRef(null);

  // 非同期処理やアンマウント時の後片付けで最新の値を参照するための ref
  const mediaRecorderRef = useRef(null);
  const streamRef = useRef(null);
  const isStartingRef = useRef(false);
  const isMountedRef = useRef(true);
  const objectUrlsRef = useRef(new Set());
  const savingUrlRef = useRef(null); // 保存中の音の URL（保存が終わるまで解放しない）
  const currentRecordingRef = useRef(currentRecording);
  currentRecordingRef.current = currentRecording;
  const editorFieldsRef = useRef(null); // 編集中の名前・タグ（ページを離れるときに覚えておくため）
  const recordingStartedAtRef = useRef(0);
  const timerRef = useRef(null);
  const stopRecordingRef = useRef(null);

  // アクセシビリティフック
  const { announce, AnnouncementRegion } = useAnnouncement();
  const { showError, clearError, ErrorRegion } = useErrorMessages();
  const preview = useAudioPreview({
    onError: () => {
      // エラーなので、緑のお知らせではなくエラーの表示で出す
      if (isMountedRef.current) showError('この音はこの端末では再生できませんでした。');
    }
  });
  // 保存・すてる・録音しなおすで今のボタンが消えたら、録音ボタンにフォーカスを移す
  const recordButtonRef = useRef(null);
  const focusRecordButtonRef = useRef(false);
  useEffect(() => {
    if (focusRecordButtonRef.current && recordButtonRef.current) {
      focusRecordButtonRef.current = false;
      recordButtonRef.current.focus();
    }
  });

  // アンマウント時だけ後片付けする。
  // （以前は録音一覧が変わるたびに実行され、表示中の音の URL まで解放して再生できなくなっていた）
  useEffect(() => {
    isMountedRef.current = true;
    const objectUrls = objectUrlsRef.current;

    // 前にこのページを離れたときの、保存していない音を戻す（URL は下の effect で描画後に作る）
    const draft = takeUnsavedDraft();
    if (draft) {
      setCurrentRecording({ ...draft, url: null });
      setIsDraftRestored(true);
    }

    return () => {
      isMountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
      const unsaved = currentRecordingRef.current;
      if (unsaved && unsaved.audioBlob && unsaved.url !== savingUrlRef.current) {
        const fields = editorFieldsRef.current || {};
        keepUnsavedDraft({
          audioBlob: unsaved.audioBlob,
          name: fields.name !== undefined ? fields.name : unsaved.name || '',
          tags: fields.tags || unsaved.tags || [],
          createdAt: unsaved.createdAt
        });
      }
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

  // 前に集めた音（新しい順）と、タグの候補を読み込む。
  // （以前は「このページで保存した音」だけを出していて、戻ってくると「まだ録音した音がありません」と表示され、
  //   音が消えたように見えていた）
  useEffect(() => {
    let cancelled = false;
    getAllRecordings()
      .then((records) => {
        if (cancelled) return;
        setRecentSounds([...records].sort(byNewest).slice(0, RECENT_LIMIT));
        setLibraryTags([...new Set(records.flatMap((record) => record.tags || []))]);
      })
      .catch((error) => {
        console.warn('前に集めた音を読み込めませんでした:', error);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 復元した音の再生用 URL を作る。
  // マウント時の effect の中で作ると、開発時の StrictMode の二重実行で後片付けに解放されてしまう。
  useEffect(() => {
    if (currentRecording && !currentRecording.url && currentRecording.audioBlob) {
      const url = URL.createObjectURL(currentRecording.audioBlob);
      objectUrlsRef.current.add(url);
      setCurrentRecording((prev) => (prev === currentRecording ? { ...prev, url } : prev));
    }
  }, [currentRecording]);

  // 音の長さを調べる（編集画面に表示し、保存するときにも記録する）
  useEffect(() => {
    if (!currentRecording || !currentRecording.audioBlob || currentRecording.duration !== undefined) return undefined;
    let cancelled = false;
    const target = currentRecording;
    measureAudioDuration(target.audioBlob).then((duration) => {
      if (cancelled || !isMountedRef.current) return;
      setCurrentRecording((prev) => (prev && prev.audioBlob === target.audioBlob ? { ...prev, duration } : prev));
    });
    return () => {
      cancelled = true;
    };
  }, [currentRecording]);

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

  // 保存していない音を捨ててよいか確認する（保存中の音は保存が終われば一覧に入るので確認しない）
  const confirmDiscardUnsaved = (message = DISCARD_CONFIRM_MESSAGE) => {
    const current = currentRecordingRef.current;
    if (!current || current.url === savingUrlRef.current) return true;
    return window.confirm(message);
  };

  // 編集中の音を差し替える（保存しなかった前の音の URL は解放する。保存中の音の URL は保存が終わるまで残す）
  // （setState の更新関数は次の描画のときに実行されるので、その時点の保存状況で判定する）
  const replaceCurrentRecording = (next) => {
    setIsDraftRestored(false);
    setSaveError('');
    preview.stop();
    setCurrentRecording(prev => {
      if (prev && prev.url && (!next || prev.url !== next.url) && prev.url !== savingUrlRef.current) {
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
      return 'お使いのブラウザは録音機能をサポートしていません。iPadの場合は iPadOS 14.5 以降の Safari をお使いください。';
    }
    if (navigator.permissions && navigator.permissions.query) {
      try {
        const permission = await navigator.permissions.query({ name: 'microphone' });
        if (permission && permission.state === 'denied') {
          return { message: getMicrophoneErrorMessage({ name: 'NotAllowedError' }), denied: true };
        }
      } catch (permError) {
        // Safari 15 以前は microphone の問い合わせに対応していない
      }
    }
    return null;
  };

  // エラーの場所（role="alert"）が読み上げるので、announce() では重ねて読ませない（以前は 2 回読まれた）
  const reportError = (message) => {
    showError(message);
  };

  const stopTimer = () => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  };

  const startTimer = () => {
    stopTimer();
    recordingStartedAtRef.current = Date.now();
    setElapsedSeconds(0);
    timerRef.current = setInterval(() => {
      const seconds = (Date.now() - recordingStartedAtRef.current) / 1000;
      setElapsedSeconds(seconds);
      if (seconds >= MAX_RECORDING_SECONDS && stopRecordingRef.current) {
        setNotice(`${MAX_RECORDING_SECONDS}秒になったので、録音を止めました。`);
        stopRecordingRef.current();
      }
    }, 250);
  };

  const startRecording = async () => {
    // 連打で録音が二重に始まらないようにする
    if (isStartingRef.current || mediaRecorderRef.current) return;
    if (!confirmDiscardUnsaved()) return;
    isStartingRef.current = true;

    try {
      clearError();
      setNotice('');
      setMicDenied(false);
      announce('録音を開始しています...', 'assertive');

      const supportError = await getRecordingSupportError();
      if (supportError) {
        if (typeof supportError === 'object') {
          setMicDenied(true);
          setShowMicHelp(true);
          reportError(supportError.message);
        } else {
          reportError(supportError);
        }
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
        if (error && (error.name === 'NotAllowedError' || error.name === 'SecurityError')) {
          setMicDenied(true);
          setShowMicHelp(true);
        }
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

        // 実際の録音形式で Blob を作る（常に audio/wav と表記すると iPad で再生できなくなる）
        const type = recorder.mimeType || (chunks[0] && chunks[0].type) || mimeType || 'audio/mp4';
        const blob = new Blob(chunks, { type });

        if (!isMountedRef.current) {
          // 録音中にほかのページへ移動した: 戻ってきたときに保存できるよう覚えておく
          if (blob.size > 0) {
            keepUnsavedDraft({ audioBlob: blob, name: '', tags: [], createdAt: new Date().toISOString() });
          }
          return;
        }
        // マイクが切断されたなどで自動的に止まった場合も「録音中」の表示を戻す
        stopTimer();
        setIsRecording(false);

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
      // 前の音を捨てて録り直すときは、その音の編集画面を閉じ、「録音停止」ボタンにフォーカスを移す
      if (currentRecordingRef.current) focusRecordButtonRef.current = true;
      replaceCurrentRecording(null);
      setIsRecording(true);
      startTimer();
      // 録音中は読み上げない（マイクが読み上げの声まで録音してしまう）。ボタンが「録音停止」に変わる
    } finally {
      isStartingRef.current = false;
    }
  };

  const stopRecording = () => {
    stopTimer();
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
  stopRecordingRef.current = stopRecording;

  const saveToLegacyStorage = (record) => {
    const existing = JSON.parse(localStorage.getItem(LEGACY_RECORDINGS_KEY) || '[]');
    localStorage.setItem(LEGACY_RECORDINGS_KEY, JSON.stringify([...existing, record]));
  };

  const saveRecording = async (name, tags) => {
    const target = currentRecording;
    if (!target || !target.audioBlob || !name.trim() || isSaving) return;

    setIsSaving(true);
    savingUrlRef.current = target.url;
    setSaveError('');
    try {
      const record = {
        name: name.trim(),
        tags: tags.map(tag => tag.trim()).filter(Boolean),
        audioData: await blobToAudioDataUrl(target.audioBlob),
        createdAt: target.createdAt || new Date().toISOString()
      };
      if (target.duration > 0) record.duration = target.duration;

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
      savingUrlRef.current = null;
      if (!isMountedRef.current) {
        releaseObjectUrl(target.url);
        return;
      }
      setRecentSounds(prev => [{ ...record, id }, ...prev].slice(0, RECENT_LIMIT));
      setLibraryTags(prev => [...new Set([...prev, ...record.tags])]);
      // 一覧の音は保存した音声データで再生するので、編集画面の URL は解放する
      setCurrentRecording(prev => {
        if (prev && prev.url === target.url) {
          releaseObjectUrl(target.url);
          return null;
        }
        return prev;
      });
      setIsDraftRestored(false);
      preview.stop();
      focusRecordButtonRef.current = true;
      // お知らせ欄（role="status"）が読み上げるので、announce() では重ねて読ませない
      setNotice(`「${record.name}」を保存しました。`);
    } catch (error) {
      console.error('録音の保存に失敗しました:', error);
      savingUrlRef.current = null;
      if (!isMountedRef.current) {
        // 保存中にほかのページへ移動して保存に失敗した: 戻ってきたときにもう一度保存できるようにする
        keepUnsavedDraft({ audioBlob: target.audioBlob, name: name.trim(), tags, createdAt: target.createdAt });
        return;
      }
      const message = isQuotaExceededError(error)
        ? '保存できる容量が足りません。音ライブラリで使わない音を削除してから、もう一度保存してください。'
        : '録音の保存に失敗しました。もう一度「保存する」を押してください。';
      // 保存ボタンの近くのエラー（role="alert"）が読み上げる
      setSaveError(message);
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
    if (!confirmDiscardUnsaved()) return;
    clearError();
    setNotice('');

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

  const openFilePicker = () => {
    if (fileInputRef.current) fileInputRef.current.click();
  };

  // 「この音をすてる」（保存していない音は戻せないので確認する）
  const throwAwayRecording = () => {
    if (!window.confirm(THROW_AWAY_CONFIRM_MESSAGE)) return;
    focusRecordButtonRef.current = true;
    replaceCurrentRecording(null);
    setNotice('音をすてました。');
  };

  const tagSuggestions = useMemo(
    () => [...new Set([...libraryTags, ...DEFAULT_TAG_SUGGESTIONS])].slice(0, 12),
    [libraryTags]
  );

  const remainingSeconds = Math.max(0, MAX_RECORDING_SECONDS - elapsedSeconds);

  return (
    <div className="sound-collection page-container">
      <header className="page-header">
        <h2 id="page-title">
          <Icon icon={Mic} /> 音あつめ
        </h2>
        <p className="page-description">
          身の回りにある音を録音したり、音ファイルを選んだりして、音素材を集めましょう。
        </p>
      </header>

      {/* アクセシビリティ用のライブリージョン */}
      <AnnouncementRegion />

      <div className="collection-notice-region" role="status" aria-live="polite">
        {notice && <p className="notice notice-success collection-notice">{notice}</p>}
      </div>

      {currentRecording ? (
        <RecordingEditor
          key={currentRecording.url || 'restoring'}
          isDraftRestored={isDraftRestored}
          onFieldsChange={(fields) => { editorFieldsRef.current = fields; }}
          recording={currentRecording}
          onSave={saveRecording}
          onThrowAway={throwAwayRecording}
          onRecordAgain={startRecording}
          isSaving={isSaving}
          saveError={saveError}
          startErrorSlot={(
            <>
              {/* 「録音しなおす」でマイクが使えなかったときも、ここに出す（以前は画面に何も出なかった） */}
              <ErrorRegion />
              {micDenied && (
                <p className="editor-mic-denied">
                  マイクが使えません。ページを読み込み直してから、もう一度録音してください。
                  <button type="button" className="button-secondary reload-btn" onClick={() => window.location.reload()}>
                    <Icon icon={RefreshCw} /> ページを読み込み直す
                  </button>
                </p>
              )}
            </>
          )}
          tagSuggestions={tagSuggestions}
          isPlaying={preview.playingId === 'editor'}
          onTogglePlay={() => preview.toggle('editor', currentRecording.url)}
        />
      ) : (
        <section className="collection-actions" aria-labelledby="collection-title">
          <h3 id="collection-title" className="sr-only">音の集め方</h3>

          <section className={`recording-section card ${isRecording ? 'is-recording' : ''}`} aria-labelledby="recording-title">
            <h3 id="recording-title">
              <Icon icon={Mic} /> 音を録音する
            </h3>

            <div className="recording-controls" role="group" aria-labelledby="recording-controls-label">
              <h4 id="recording-controls-label" className="sr-only">録音操作</h4>
              {!isRecording ? (
                <button
                  ref={recordButtonRef}
                  className="record-btn"
                  onClick={startRecording}
                  aria-describedby="record-instructions"
                  type="button"
                  disabled={isSaving}
                >
                  <span className="record-btn-circle" aria-hidden="true"><Icon icon={Mic} size={44} /></span>
                  <span className="record-btn-label">録音開始</span>
                </button>
              ) : (
                <button
                  ref={recordButtonRef}
                  className="record-btn stop"
                  onClick={stopRecording}
                  aria-describedby="stop-instructions"
                  type="button"
                >
                  <span className="record-btn-circle" aria-hidden="true"><Icon icon={Square} size={40} fill="currentColor" /></span>
                  <span className="record-btn-label">録音停止</span>
                </button>
              )}
              <p id="record-instructions" className="recording-hint">
                ボタンを押すと録音が始まります（{MAX_RECORDING_SECONDS}秒まで）
              </p>
              <p id="stop-instructions" className="sr-only">
                録音停止ボタンを押すと録音が終了し、音に名前をつけることができます
              </p>
            </div>

            {isRecording && (
              // 録音中は読み上げない（残り秒数を毎秒読むと、その声まで録音された）
              <div className="recording-status" aria-hidden="true">
                <div className="recording-indicator">
                  <span className="pulse-dot" aria-hidden="true"></span>
                  録音中...
                </div>
                <div className="recording-time" aria-hidden="true">
                  <span className="recording-elapsed">{formatSeconds(elapsedSeconds)}</span>
                  <span className="recording-limit"> / {formatSeconds(MAX_RECORDING_SECONDS)}</span>
                </div>
                <div className="recording-progress" aria-hidden="true">
                  <span style={{ width: `${Math.min(100, (elapsedSeconds / MAX_RECORDING_SECONDS) * 100)}%` }} />
                </div>
                {remainingSeconds <= 10 && (
                  <p className="recording-warning">あと {Math.ceil(remainingSeconds)} 秒で止まります</p>
                )}
              </div>
            )}

            {/* 録音のエラーはボタンの近くに出す */}
            <ErrorRegion />
            {micDenied && (
              <button type="button" className="button-secondary reload-btn" onClick={() => window.location.reload()}>
                <Icon icon={RefreshCw} /> ページを読み込み直す
              </button>
            )}

            <details className="mic-help" open={showMicHelp} onToggle={(event) => setShowMicHelp(event.currentTarget.open)}>
              <summary>マイクが使えないとき</summary>
              <div className="mic-help-body" role="region" aria-labelledby="ios-instructions">
                <h4 id="ios-instructions">iPhone/iPadをお使いの方へ：</h4>
                <ul>
                  <li>録音ボタンを押すと、マイクを使ってよいか聞かれます。「許可」を選んでください。</li>
                  <li>聞かれないときは、「設定」アプリ →「Safari」→「マイク」を「確認」か「許可」にしてください。</li>
                  <li>「許可しない」を選んだあとは、ページを読み込み直してから、もう一度録音ボタンを押してください。</li>
                </ul>
              </div>
            </details>
          </section>

          <section className="upload-section card" aria-labelledby="upload-title">
            <h3 id="upload-title">
              <Icon icon={FolderOpen} /> 音ファイルをアップロード
            </h3>
            <p className="upload-description">iPad の「ファイル」アプリやパソコンにある音を使えます。</p>
            <button
              className="button-secondary button-large upload-btn"
              onClick={openFilePicker}
              aria-describedby="upload-instructions"
              type="button"
              disabled={isSaving || isRecording}
            >
              <Icon icon={FolderOpen} /> ファイルを選択
            </button>
            <p id="upload-instructions" className="field-help">
              対応形式: MP3, WAV, M4A など
            </p>
          </section>
        </section>
      )}

      {/* ファイル選択の入力欄は、編集中もページに置いておく（選び直したときの確認のため） */}
      <input
        ref={fileInputRef}
        type="file"
        accept="audio/*"
        onChange={handleFileUpload}
        className="collection-file-input"
        tabIndex={-1}
        aria-label="音声ファイルを選択"
      />

      <section className="recent-recordings" aria-labelledby="recent-title">
        <div className="recent-header">
          <h3 id="recent-title">
            <Icon icon={ListMusic} /> さいきん集めた音
          </h3>
          {recentSounds.length > 0 && (
            <a href="#/library" className="recent-library-link">音ライブラリですべて見る</a>
          )}
        </div>
        {recentSounds.length === 0 ? (
          <p className="no-recordings empty-state">まだ録音した音がありません。上の録音ボタンから始めましょう！</p>
        ) : (
          <ul className="recordings-grid">
            {recentSounds.map((recording) => (
              <SoundCard
                key={recording.id}
                recording={recording}
                isPlaying={preview.playingId === recording.id}
                onTogglePlay={() => preview.toggle(recording.id, recording.audioData)}
              />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
};

const RecordingEditor = ({
  recording,
  onSave,
  onThrowAway,
  onRecordAgain,
  onFieldsChange,
  isSaving = false,
  saveError = '',
  isDraftRestored = false,
  tagSuggestions = [],
  isPlaying = false,
  onTogglePlay,
  startErrorSlot = null
}) => {
  const [name, setName] = useState(recording.name);
  const [tagInput, setTagInput] = useState('');
  const [tags, setTags] = useState(recording.tags);
  const [validationMessage, setValidationMessage] = useState('');
  const headingRef = useRef(null);
  const editorRef = useRef(null);
  const tagInputRef = useRef(null);
  // 押した候補や × は消えるので、タグの入力欄にフォーカスを移す（ページの先頭に戻らないように）
  const focusTagInput = () => {
    if (tagInputRef.current) tagInputRef.current.focus();
  };

  // 録音が終わったら、編集画面を見える所に出して読み上げにも知らせる
  useEffect(() => {
    if (editorRef.current && editorRef.current.scrollIntoView) {
      editorRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }
    if (headingRef.current) headingRef.current.focus();
  }, []);

  // 入力途中の名前・タグを親に伝える（ページを離れても戻ったときに続きから書けるように）
  useEffect(() => {
    if (onFieldsChange) onFieldsChange({ name, tags });
  }, [name, tags, onFieldsChange]);

  const addTag = (value = tagInput) => {
    const tag = value.trim();
    if (!tag) return;
    if (tags.includes(tag)) {
      setValidationMessage('このタグは既に追加されています');
      return;
    }
    setTags([...tags, tag]);
    if (value === tagInput) setTagInput('');
    setValidationMessage(`タグ「${tag}」を追加しました`);
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

  const durationText = formatDuration(recording.duration);
  const unusedSuggestions = tagSuggestions.filter((tag) => !tags.includes(tag));

  return (
    <section
      ref={editorRef}
      className="recording-editor card"
      aria-labelledby="editor-title"
      aria-describedby="editor-description"
    >
      <h3 id="editor-title" ref={headingRef} tabIndex={-1}>
        <Icon icon={Pencil} /> 音に名前をつけよう
      </h3>
      <p id="editor-description" className="sr-only">
        録音した音に名前とタグをつけて保存できます
      </p>
      {isDraftRestored && (
        <p className="draft-restored-notice" role="status">
          前に録音した音がまだ保存されていません。名前をつけて保存してください。
        </p>
      )}

      <div className="audio-preview-container">
        <button
          type="button"
          className={`preview-play-btn ${isPlaying ? 'playing' : ''}`}
          onClick={onTogglePlay}
          disabled={!recording.url}
          aria-label={isPlaying ? '録音した音を止める' : '録音した音をきく'}
        >
          <Icon icon={isPlaying ? Square : Play} fill="currentColor" size={26} />
          <span aria-hidden="true">{isPlaying ? 'とめる' : 'きく'}</span>
        </button>
        <span className="preview-duration">{durationText ? `長さ ${durationText}` : ''}</span>
      </div>

      <div className="form-group">
        <label htmlFor="soundName" className="field-label">
          音の名前 <span className="required">（必須）</span>
        </label>
        <input
          id="soundName"
          type="text"
          value={name}
          maxLength={50}
          onChange={(e) => {
            setName(e.target.value);
            if (validationMessage) setValidationMessage('');
          }}
          placeholder="例: ピアノの音、雨の音"
          className="text-field sound-name-input"
          required
          enterKeyHint="done"
          aria-describedby="name-help"
          aria-invalid={!name.trim() && validationMessage ? 'true' : 'false'}
        />
        <p id="name-help" className="field-help">
          この音を表す分かりやすい名前をつけてください。名前を入れると保存できます。
        </p>
      </div>

      <div className="form-group">
        <label htmlFor="soundTags" className="field-label">
          タグ <span className="optional">（なくてもよい）</span>
        </label>
        <div className="tag-input-container">
          <input
            ref={tagInputRef}
            id="soundTags"
            type="text"
            value={tagInput}
            maxLength={30}
            onChange={(e) => setTagInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="例: 楽器、自然"
            className="text-field tag-input"
            enterKeyHint="enter"
            aria-describedby="tag-help"
          />
          <button
            onClick={() => addTag()}
            className="button-secondary add-tag-btn"
            type="button"
            disabled={!tagInput.trim()}
          >
            <Icon icon={Plus} /> 追加
          </button>
        </div>
        <p id="tag-help" className="field-help">
          音の種類を表すことばです。下の候補を押しても追加できます。
        </p>

        {unusedSuggestions.length > 0 && (
          <div className="tag-suggestions" role="group" aria-label="タグの候補">
            {unusedSuggestions.map((tag) => (
              <button
                key={tag}
                type="button"
                className="chip chip-suggestion"
                onClick={() => {
                  addTag(tag);
                  focusTagInput();
                }}
              >
                <Icon icon={Plus} /> {tag}
              </button>
            ))}
          </div>
        )}

        {tags.length > 0 && (
          <div className="tags-display" role="group" aria-labelledby="tags-label">
            <p id="tags-label" className="tags-title">追加されたタグ:</p>
            {/* 追加・削除は下のメッセージで読み上げる（リストも読み上げると 2 回になる） */}
            <ul className="tags-list">
              {tags.map((tag) => (
                <li key={tag} className="tag-item">
                  <span className="tag">
                    {tag}
                    <button
                      onClick={() => {
                        removeTag(tag);
                        focusTagInput();
                      }}
                      className="remove-tag"
                      type="button"
                      aria-label={`タグ「${tag}」を削除`}
                    >
                      <Icon icon={X} size={16} />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* 読み上げの場所は空でも置いておく（あとから作ると、最初のメッセージが読まれないことがある） */}
      <div className="validation-message" role="status" aria-live="polite">
        {validationMessage}
      </div>

      {/* 保存のエラーは保存ボタンの近くに出す（以前はページの上に出て見えなかった） */}
      {saveError && <div className="error-message" role="alert">{saveError}</div>}
      {startErrorSlot}

      <div className="editor-actions" role="group" aria-labelledby="actions-label">
        <p id="actions-label" className="sr-only">保存・録り直し・すてる操作</p>
        <button
          onClick={handleSave}
          className="button-primary button-large save-btn"
          disabled={!name.trim() || isSaving}
          type="button"
        >
          <Icon icon={Save} /> {isSaving ? '保存中...' : '保存する'}
        </button>
        <button
          onClick={onRecordAgain}
          className="button-secondary"
          type="button"
          disabled={isSaving}
        >
          <Icon icon={Mic} /> 録音しなおす
        </button>
        <button
          onClick={onThrowAway}
          className="button-danger"
          type="button"
          disabled={isSaving}
        >
          <Icon icon={Trash2} /> この音をすてる
        </button>
      </div>
    </section>
  );
};

const SoundCard = ({ recording, isPlaying, onTogglePlay }) => {
  const date = new Date(recording.createdAt);
  const formattedDate = isNaN(date.getTime()) ? '' : date.toLocaleDateString('ja-JP', {
    month: 'long',
    day: 'numeric'
  });
  const durationText = formatDuration(recording.duration);

  return (
    <li className="sound-card">
      <button
        type="button"
        className={`sound-card-play ${isPlaying ? 'playing' : ''}`}
        onClick={onTogglePlay}
        aria-label={isPlaying ? `${recording.name}を止める` : `${recording.name}をきく`}
      >
        <Icon icon={isPlaying ? Square : Play} fill="currentColor" size={22} />
      </button>
      <div className="sound-info">
        <h4 className="sound-name">{recording.name}</h4>
        <p className="sound-date">
          {formattedDate}
          {durationText && <span className="sound-card-duration">{durationText}</span>}
        </p>
        {(recording.tags || []).length > 0 && (
          <ul className="sound-tags" aria-label="タグ">
            {recording.tags.map((tag) => (
              <li key={tag} className="tag-label">{tag}</li>
            ))}
          </ul>
        )}
      </div>
    </li>
  );
};

export default SoundCollection;
