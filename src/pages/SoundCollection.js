import React, { useState, useRef, useEffect } from 'react';
import './SoundCollection.css';
import { useAnnouncement, useErrorMessages } from '../hooks/useAccessibility';

const SoundCollection = () => {
  const [recordings, setRecordings] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [currentRecording, setCurrentRecording] = useState(null);
  const fileInputRef = useRef(null);
  const recordButtonRef = useRef(null);

  // アクセシビリティフック
  const { announce, AnnouncementRegion } = useAnnouncement();
  const { showError, clearError, ErrorRegion } = useErrorMessages();

  // コンポーネントアンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      // 録音中の場合は停止
      if (mediaRecorder && isRecording) {
        mediaRecorder.stop();
        if (mediaRecorder.stream) {
          mediaRecorder.stream.getTracks().forEach(track => track.stop());
        }
      }
      
      // 作成されたBlobURLをクリーンアップ
      recordings.forEach(recording => {
        if (recording.url && recording.url.startsWith('blob:')) {
          URL.revokeObjectURL(recording.url);
        }
      });
    };
  }, [mediaRecorder, isRecording, recordings]);

  const startRecording = async () => {
    try {
      // エラーメッセージをクリア
      clearError();
      announce('録音を開始しています...', 'assertive');

      // iOSでのマイクアクセス改善 - まずテストを実行
      const hasAccess = await testMicrophoneAccess();
      if (!hasAccess) {
        showError('マイクにアクセスできませんでした。ブラウザの設定を確認してください。');
        return;
      }

      
      // iPad用の音声設定を最適化
      const audioConstraints = {
        echoCancellation: false, // iPadでは無効にする
        noiseSuppression: false, // iPadでは無効にする  
        autoGainControl: false,  // iPadでは無効にする
        sampleRate: 44100,       // 明示的にサンプルレートを指定
        channelCount: 1          // モノラル録音を明示
      };
      
      
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: audioConstraints
      });
      
      
      // MediaRecorderのオプションを決定
      let recorderOptions = {};
      
      if (MediaRecorder.isTypeSupported('audio/webm;codecs=opus')) {
        recorderOptions.mimeType = 'audio/webm;codecs=opus';
      } else if (MediaRecorder.isTypeSupported('audio/mp4')) {
        recorderOptions.mimeType = 'audio/mp4';
      } else if (MediaRecorder.isTypeSupported('audio/wav')) {
        recorderOptions.mimeType = 'audio/wav';
      } else {
      }
      
      const recorder = new MediaRecorder(stream, recorderOptions);
      
      const chunks = [];

      recorder.ondataavailable = (e) => {
        chunks.push(e.data);
      };

      recorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'audio/wav' });
        const url = URL.createObjectURL(blob);
        setCurrentRecording({
          id: Date.now(),
          url: url,
          audioBlob: blob,
          name: '',
          tags: [],
          createdAt: new Date()
        });
        
        announce('録音が完了しました。音に名前をつけて保存してください。', 'assertive');
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
      announce('録音を開始しました。', 'assertive');
      
    } catch (error) {
      console.error('録音の開始に失敗しました:', error);
      
      let errorMessage = '録音を開始できませんでした。';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'マイクの使用が拒否されました。ブラウザの設定でマイクアクセスを許可してください。';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'マイクが見つかりません。デバイスにマイクが接続されているか確認してください。';
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'お使いのブラウザは録音機能をサポートしていません。';
      } else if (error.name === 'NotReadableError') {
        errorMessage = 'マイクが他のアプリケーションで使用中の可能性があります。';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      showError(errorMessage);
      announce(errorMessage, 'assertive');
    }
  };

  const stopRecording = () => {
    setIsRecording(false); // まず録音状態を停止に設定
    
    if (mediaRecorder) {
      mediaRecorder.stop();
      mediaRecorder.stream.getTracks().forEach(track => track.stop());
      setMediaRecorder(null);
      announce('録音を停止しました。', 'assertive');
    }
    
  };

  // Blobを Base64 に変換する関数
  const blobToBase64 = (blob) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  };

  const saveRecording = async (name, tags) => {
    if (currentRecording && name.trim()) {
      try {
        // Blobをbase64に変換
        const base64Data = await blobToBase64(currentRecording.audioBlob);
        
        const savedRecording = {
          ...currentRecording,
          name: name.trim(),
          tags: tags.filter(tag => tag.trim()).map(tag => tag.trim()),
          audioData: base64Data, // base64データを保存
          // audioBlobは一時的なものなので削除
          audioBlob: undefined
        };
        
        setRecordings([...recordings, savedRecording]);
        setCurrentRecording(null);
        
        // LocalStorageに保存（audioBlobは除外）
        const existingRecordings = JSON.parse(localStorage.getItem('soundRecordings') || '[]');
        const recordingToSave = { ...savedRecording };
        delete recordingToSave.audioBlob; // Blobは保存しない
        localStorage.setItem('soundRecordings', JSON.stringify([...existingRecordings, recordingToSave]));
      } catch (error) {
        console.error('録音の保存に失敗しました:', error);
        alert('録音の保存に失敗しました。再度お試しください。');
      }
    }
  };

  const handleFileUpload = (event) => {
    const file = event.target.files[0];
    if (file && file.type.startsWith('audio/')) {
      const url = URL.createObjectURL(file);
      setCurrentRecording({
        id: Date.now(),
        url: url,
        audioBlob: file,
        name: file.name.replace(/\.[^/.]+$/, ''),
        tags: [],
        createdAt: new Date()
      });
    }
  };

  // マイクアクセステスト機能（iOSでの問題対策）
  const testMicrophoneAccess = async () => {
    try {
      
      // HTTPS接続チェック
      if (!checkHTTPS()) {
        alert('🔒 録音機能を使用するにはHTTPS接続が必要です。\n\niPhoneでは特に、セキュアな接続が必要となります。');
        return false;
      }
      
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        throw new Error('お使いのブラウザは録音機能をサポートしていません。');
      }

      // まずマイクの権限状態を確認
      if (navigator.permissions) {
        try {
          const permission = await navigator.permissions.query({ name: 'microphone' });
          
          if (permission.state === 'denied') {
            alert('マイクアクセスが拒否されています。ブラウザの設定からマイクの使用を許可してください。');
            return false;
          }
        } catch (permError) {
        }
      }

      // 実際にマイクアクセスをテスト
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      // すぐにストリームを停止
      stream.getTracks().forEach(track => track.stop());
      return true;
      
    } catch (error) {
      console.error('マイクアクセステスト失敗:', error);
      
      let errorMessage = 'マイクにアクセスできません。';
      
      if (error.name === 'NotAllowedError') {
        errorMessage = 'マイクの使用が拒否されました。ブラウザの設定でマイクアクセスを許可してください。\n\niPhoneの場合：\n1. Safari設定 > プライバシーとセキュリティ > マイク\n2. このサイトを許可に設定';
      } else if (error.name === 'NotFoundError') {
        errorMessage = 'マイクが見つかりません。';
      } else if (error.name === 'NotSupportedError') {
        errorMessage = 'お使いのブラウザは録音機能をサポートしていません。';
      } else if (error.message) {
        errorMessage = error.message;
      }
      
      alert(errorMessage);
      return false;
    }
  };

  // HTTPS接続チェック（iOSでの録音に必要）
  const checkHTTPS = () => {
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
      return false;
    }
    return true;
  };

  // 音声レベル監視関数
  return (
    <div className="sound-collection">
      <header>
        <h2 id="page-title">
          <span role="img" aria-label="マイク">🎤</span> 音あつめページ
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
            <span role="img" aria-label="マイク">🎙️</span> 音を録音する
          </h3>
          
          {/* iOS用の説明 */}
          <div className="ios-notice" role="region" aria-labelledby="ios-instructions">
            <h4 id="ios-instructions" className="sr-only">iPhone/iPad使用時の注意事項</h4>
            <p>
              <span role="img" aria-label="スマートフォン">📱</span> 
              <strong>iPhone/iPadをお使いの方へ：</strong>
            </p>
            <p>録音ボタンを押すとマイクの使用許可を求めるダイアログが表示されます。「許可」を選択してください。</p>
            <p>ダイアログが表示されない場合は、Safari設定 → プライバシーとセキュリティ → マイク でこのサイトを許可してください。</p>
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
                <span role="img" aria-label="録音開始">🔴</span> 録音開始
              </button>
            ) : (
              <button 
                className="accessible-button button-secondary large-button stop-btn"
                onClick={stopRecording}
                aria-describedby="stop-instructions"
                type="button"
              >
                <span role="img" aria-label="停止">⏹️</span> 録音停止
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
            <span role="img" aria-label="フォルダ">📁</span> 音ファイルをアップロード
          </h3>
          <button 
            className="accessible-button button-secondary large-button"
            onClick={() => fileInputRef.current?.click()}
            aria-describedby="upload-instructions"
            type="button"
          >
            <span role="img" aria-label="ファイル選択">📂</span> ファイルを選択
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
          recording={currentRecording}
          onSave={saveRecording}
          onCancel={() => setCurrentRecording(null)}
        />
      )}

      <section className="recent-recordings" aria-labelledby="recent-title">
        <h3 id="recent-title">
          <span role="img" aria-label="メモ">📝</span> 最近録音した音
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

const RecordingEditor = ({ recording, onSave, onCancel }) => {
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

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
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
        <span role="img" aria-label="編集">✏️</span> 音に名前をつけよう
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
            onKeyPress={handleKeyPress}
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
                      className="remove-tag"
                      type="button"
                      aria-label={`タグ「${tag}」を削除`}
                    >
                      <span aria-hidden="true">×</span>
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
          disabled={!name.trim()}
          type="button"
          aria-describedby="save-help"
        >
          <span role="img" aria-label="保存">💾</span> 保存
        </button>
        <button 
          onClick={onCancel} 
          className="accessible-button button-secondary"
          type="button"
          aria-describedby="cancel-help"
        >
          <span role="img" aria-label="キャンセル">❌</span> キャンセル
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
        {recording.tags.length > 0 && (
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
