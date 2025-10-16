import React, { useState, useRef, useEffect, useCallback } from 'react';
import './DAWPage.css';
import { getSongData, deleteSongData } from '../utils/indexedDB';

// DAWの定数（時間ベースのタイムライン）
const TIME_MODE_TOTAL_SECONDS = 90; // 表示する総秒数
const DEFAULT_PIXELS_PER_SECOND = 100; // デフォルトの1秒あたりのピクセル数

const DAWPage = () => {
  // ユニークID生成用のカウンター
  const trackIdCounterRef = useRef(1);
  // トラック名の番号管理用カウンター
  const trackNameCounterRef = useRef(1);
  
  // LocalStorageからの自動復元機能
  const loadAutoSavedProject = () => {
    try {
      const autoSavedData = localStorage.getItem('dawProjectAutoSave');
      if (autoSavedData) {
        const projectData = JSON.parse(autoSavedData);
        
        // トラックカウンターの復元
        if (projectData.trackNameCounter) {
          trackNameCounterRef.current = projectData.trackNameCounter;
        }
        if (projectData.trackIdCounter) {
          trackIdCounterRef.current = projectData.trackIdCounter;
        }
        
        // 音素材データを復元（LocalStorageから）
        const savedSounds = JSON.parse(localStorage.getItem('soundRecordings') || '[]');
        const soundsMap = new Map();
        
        // 音素材をMapに格納（名前をキーにして高速検索）
        savedSounds.forEach(sound => {
          if (sound.name && sound.audioData) {
            soundsMap.set(sound.name, sound);
          }
        });
        
        // audioBlobを復元する関数
        const restoreAudioBlob = (soundData) => {
          if (!soundData || !soundData.name) return soundData;
          
          // LocalStorageの音素材から対応するデータを取得
          const savedSound = soundsMap.get(soundData.name);
          if (savedSound && savedSound.audioData) {
            try {
              const byteCharacters = atob(savedSound.audioData.split(',')[1]);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: 'audio/wav' });
              return { ...soundData, audioBlob: blob, audioData: savedSound.audioData };
            } catch (error) {
              console.error('audioBlob復元エラー:', soundData.name, error);
            }
          }
          return soundData;
        };
        
        // 無効なクリップをフィルタリング & audioBlobを復元
        const validTracks = (projectData.tracks || []).map(track => ({
          ...track,
          clips: (track.clips || [])
            .map(clip => {
              if (!clip.soundData || !clip.soundData.name) {
                console.warn('自動保存データから無効なクリップを除外:', clip);
                return null;
              }
              // soundDataのaudioBlobを復元
              return {
                ...clip,
                soundData: restoreAudioBlob(clip.soundData)
              };
            })
            .filter(clip => clip !== null)
        }));
        
        return {
          tracks: validTracks.length > 0 ? validTracks : [{ 
            id: Date.now(), 
            name: 'トラック 1', 
            clips: [] 
          }],
          pixelsPerSecond: projectData.pixelsPerSecond || DEFAULT_PIXELS_PER_SECOND
        };
      }
    } catch (error) {
      console.error('自動保存データの復元に失敗:', error);
    }
    
    return {
      tracks: [{ 
        id: Date.now(), 
        name: 'トラック 1', 
        clips: [] 
      }],
      pixelsPerSecond: DEFAULT_PIXELS_PER_SECOND
    };
  };

  const initialData = loadAutoSavedProject();
  const [tracks, setTracks] = useState(initialData.tracks);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioContext, setAudioContext] = useState(null);
  const [trackHeight] = useState(80);
  const [playingAudios, setPlayingAudios] = useState(new Map());
  const [startPlayTime, setStartPlayTime] = useState(null);
  const [error, setError] = useState(null);
  const [sounds, setSounds] = useState([]);
  const [filteredSounds, setFilteredSounds] = useState([]); // フィルタリングされた音素材
  const [selectedTag, setSelectedTag] = useState(''); // 選択されたタグ
  const [allTags, setAllTags] = useState([]); // 全タグのリスト
  const [instructionsExpanded, setInstructionsExpanded] = useState(false); // 使い方の折りたたみ状態
  const [showSoundPanel, setShowSoundPanel] = useState(true);
  const [draggedClip, setDraggedClip] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [draggedSoundDuration, setDraggedSoundDuration] = useState(400); // ドラッグ中の音素材の長さ
  const [dragOffset, setDragOffset] = useState(0); // ドラッグ開始時のクリップ内オフセット
  
  // タイムライン関連の状態
  const [pixelsPerSecond, setPixelsPerSecond] = useState(DEFAULT_PIXELS_PER_SECOND); // ズーム倍率
  const [isExporting, setIsExporting] = useState(false); // 音源出力中フラグ
  
  // クラウド保存用のstate
  const [showCloudSaveDialog, setShowCloudSaveDialog] = useState(false);
  const [cloudSaveData, setCloudSaveData] = useState({
    songTitle: '',
    studentName: '',
    groupNumber: '',
    roomNumber: ''
  });
  const timelineRef = useRef(null);
  const trackHeadersRef = useRef(null);
  const timelineContainerRef = useRef(null);
  const animationFrameRef = useRef(null);
  const dragOverTimeoutRef = useRef(null);
  const isScrollingSyncRef = useRef(false); // スクロール同期中フラグ

  useEffect(() => {
    // デバイス情報をログに記録（デバッグ用）
    console.log('=== Device Information ===');
    console.log('User Agent:', navigator.userAgent);
    console.log('Platform:', navigator.platform);
    console.log('iOS Device:', /iPad|iPhone|iPod/.test(navigator.userAgent));
    console.log('Safari:', /^((?!chrome|android).)*safari/i.test(navigator.userAgent));
    console.log('Touch Support:', 'ontouchstart' in window);
    console.log('Audio Support:', {
      canPlayWav: document.createElement('audio').canPlayType('audio/wav'),
      canPlayMp3: document.createElement('audio').canPlayType('audio/mpeg'),
      canPlayOgg: document.createElement('audio').canPlayType('audio/ogg')
    });
    console.log('========================');
    
    // Web Audio API の初期化
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    setAudioContext(ctx);
    console.log('AudioContext initialized. State:', ctx.state);
    
    // iPad/iOS対策: ユーザー操作でAudioContextを再開
    const resumeAudioContext = () => {
      if (!ctx || ctx.state === 'closed') {
        console.warn('⚠️ AudioContext is closed or not initialized');
        return;
      }
      
      if (ctx.state === 'suspended') {
        console.log('⚠️ AudioContext is suspended. Attempting to resume...');
        ctx.resume().then(() => {
          console.log('✓ AudioContext resumed successfully. State:', ctx.state);
        }).catch(err => {
          // AudioDestinationNode初期化エラーを無視（Safariの既知の問題）
          if (err.name === 'InvalidStateError') {
            console.warn('⚠️ AudioContext resume skipped (not ready yet):', err.message);
          } else {
            console.error('❌ AudioContext resume failed:', err);
          }
        });
      } else {
        console.log('✓ AudioContext is already running. State:', ctx.state);
      }
    };
    
    // 最初のタッチやクリックでAudioContextを再開
    document.addEventListener('touchstart', resumeAudioContext, { once: true });
    document.addEventListener('click', resumeAudioContext, { once: true });
    
    // LocalStorageから音素材を読み込み
    const savedSounds = JSON.parse(localStorage.getItem('soundRecordings') || '[]');
    
    // audioDataからBlobを復元
    const soundsWithBlob = savedSounds.map(sound => {
      if (sound.audioData) {
        try {
          // Base64データの検証
          if (!sound.audioData.includes(',')) {
            console.error('無効なBase64フォーマット:', sound.name);
            return sound;
          }
          
          const base64Data = sound.audioData.split(',')[1];
          if (!base64Data || base64Data.length === 0) {
            console.error('Base64データが空です:', sound.name);
            return sound;
          }
          
          const byteCharacters = atob(base64Data);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          
          // Blobサイズの検証
          if (byteArray.length === 0) {
            console.error('Blobデータが空です:', sound.name);
            return sound;
          }
          
          const blob = new Blob([byteArray], { type: 'audio/wav' });
          
          // Blobの有効性を確認
          if (blob.size === 0) {
            console.error('作成されたBlobのサイズが0です:', sound.name);
            return sound;
          }
          
          return { ...sound, audioBlob: blob };
        } catch (error) {
          console.error('音声データの復元に失敗:', sound.name, error);
          return sound;
        }
      }
      return sound;
    });
    
    // 有効な音素材のみをフィルタリング
    const validSounds = soundsWithBlob.filter(sound => {
      if (!sound.audioBlob) {
        console.warn('audioBlobが存在しない音素材をスキップ:', sound.name);
        return false;
      }
      if (!(sound.audioBlob instanceof Blob)) {
        console.warn('無効なBlob形式の音素材をスキップ:', sound.name);
        return false;
      }
      if (sound.audioBlob.size === 0) {
        console.warn('サイズが0のBlob音素材をスキップ:', sound.name);
        return false;
      }
      return true;
    });
    
    setSounds(validSounds);
    setFilteredSounds(validSounds);
    
    // 全てのタグを取得
    const tags = [...new Set(validSounds.flatMap(sound => sound.tags || []))];
    setAllTags(tags);
    
    // 無効な音素材があった場合はLocalStorageを更新
    if (validSounds.length !== soundsWithBlob.length) {
      const validSoundsForStorage = validSounds.map(sound => ({
        ...sound,
        audioBlob: undefined // Blobは保存しない
      }));
      localStorage.setItem('soundRecordings', JSON.stringify(validSoundsForStorage));
    }
    
    return () => {
      if (ctx && ctx.state !== 'closed') {
        ctx.close().catch(error => {
          console.warn('初期AudioContext のクローズに失敗:', error);
        });
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (dragOverTimeoutRef.current) {
        clearTimeout(dragOverTimeoutRef.current);
      }
      // 再生中の音声をすべて停止・クリーンアップ
      // useEffect内でplayingAudiosの最新値を取得
      setPlayingAudios(currentPlayingAudios => {
        currentPlayingAudios.forEach(({ audio, timeoutId, audioUrl }) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          if (audio) {
            audio.pause();
            audio.src = '';
          }
          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
          }
        });
        return new Map(); // 空のMapを返す
      });
      // グローバル変数をクリーンアップ
      if (window.currentDraggedSoundBlob) {
        window.currentDraggedSoundBlob = null;
      }
      if (window.currentDraggedSound) {
        window.currentDraggedSound = null;
      }
    };
  }, []);

  // タグによるフィルタリング
  useEffect(() => {
    let filtered = sounds;
    
    if (selectedTag) {
      filtered = filtered.filter(sound => 
        sound.tags && sound.tags.includes(selectedTag)
      );
    }
    
    setFilteredSounds(filtered);
  }, [sounds, selectedTag]);

  // トラックヘッダーとタイムラインコンテナのスクロール同期
  useEffect(() => {
    const trackHeaders = trackHeadersRef.current;
    const timelineContainer = timelineContainerRef.current;

    if (!trackHeaders || !timelineContainer) {
      return;
    }

    // トラックヘッダーのスクロールイベントハンドラ
    const handleTrackHeadersScroll = () => {
      if (isScrollingSyncRef.current) {
        return;
      }
      
      isScrollingSyncRef.current = true;
      timelineContainer.scrollTop = trackHeaders.scrollTop;
      
      // 次のフレームでフラグをリセット
      requestAnimationFrame(() => {
        isScrollingSyncRef.current = false;
      });
    };

    // タイムラインコンテナのスクロールイベントハンドラ
    const handleTimelineContainerScroll = () => {
      if (isScrollingSyncRef.current) {
        return;
      }
      
      isScrollingSyncRef.current = true;
      trackHeaders.scrollTop = timelineContainer.scrollTop;
      
      // 次のフレームでフラグをリセット
      requestAnimationFrame(() => {
        isScrollingSyncRef.current = false;
      });
    };

    // イベントリスナーを追加
    trackHeaders.addEventListener('scroll', handleTrackHeadersScroll);
    timelineContainer.addEventListener('scroll', handleTimelineContainerScroll);

    // クリーンアップ
    return () => {
      trackHeaders.removeEventListener('scroll', handleTrackHeadersScroll);
      timelineContainer.removeEventListener('scroll', handleTimelineContainerScroll);
    };
  }, []);

  // 音声ファイルの継続時間を取得してピクセル幅に変換
  const getAudioDuration = useCallback((audioBlob, currentPixelsPerSecond = pixelsPerSecond) => {
    return new Promise(async (resolve) => {
      if (!audioBlob || !(audioBlob instanceof Blob)) {
        resolve(400);
        return;
      }


      // AudioContextを使用した方法を優先
      if (audioContext) {
        try {
          const arrayBuffer = await audioBlob.arrayBuffer();
          const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
          const durationInSeconds = audioBuffer.duration;
          
          if (isFinite(durationInSeconds) && durationInSeconds > 0) {
            const widthInPixels = durationInSeconds * currentPixelsPerSecond;
            resolve(widthInPixels);
            return;
          }
        } catch (error) {
          console.error('AudioContext方式でエラー:', error);
        }
      }
      resolve(400);
    });
  }, [audioContext, pixelsPerSecond]);

  // ズームレベルの定義（ピクセル/秒）
  const ZOOM_LEVELS = [25, 50, 67, 100, 150, 200, 300, 400];

  // ズームイン/ズームアウト機能
  const handleZoom = useCallback(async (zoomIn) => {
    // 現在のズームレベルのインデックスを見つける
    let currentIndex = ZOOM_LEVELS.findIndex(level => level === pixelsPerSecond);
    
    // 完全一致しない場合は、最も近いレベルを見つける
    if (currentIndex === -1) {
      currentIndex = ZOOM_LEVELS.findIndex(level => level > pixelsPerSecond);
      if (currentIndex === -1) {
        currentIndex = ZOOM_LEVELS.length - 1;
      } else if (currentIndex > 0) {
        // より近い方を選択
        const lower = ZOOM_LEVELS[currentIndex - 1];
        const upper = ZOOM_LEVELS[currentIndex];
        currentIndex = (pixelsPerSecond - lower) < (upper - pixelsPerSecond) 
          ? currentIndex - 1 
          : currentIndex;
      }
    }
    
    // 新しいインデックスを計算
    const newIndex = zoomIn 
      ? Math.min(currentIndex + 1, ZOOM_LEVELS.length - 1)
      : Math.max(currentIndex - 1, 0);
    
    const newPixelsPerSecond = ZOOM_LEVELS[newIndex];
    
    // 同じ値なら何もしない
    if (newPixelsPerSecond === pixelsPerSecond) return;
    
    // ズーム比率を計算
    const zoomRatio = newPixelsPerSecond / pixelsPerSecond;
    
    setPixelsPerSecond(newPixelsPerSecond);
    
    // 既存のクリップのdurationとstartTimeを新しい倍率で再計算
    const updatedTracks = await Promise.all(
      tracks.map(async (track) => {
        const updatedClips = await Promise.all(
          track.clips.map(async (clip) => {
            if (clip.soundData && clip.soundData.audioBlob) {
              try {
                const newDuration = await getAudioDuration(clip.soundData.audioBlob, newPixelsPerSecond);
                // startTimeもズーム比率に合わせて調整（時間的な位置を維持）
                const newStartTime = clip.startTime * zoomRatio;
                return { ...clip, duration: newDuration, startTime: newStartTime };
              } catch (error) {
                console.warn('クリップのduration再計算に失敗:', error);
                // エラー時もstartTimeは調整
                const newStartTime = clip.startTime * zoomRatio;
                return { ...clip, startTime: newStartTime };
              }
            }
            // audioBlobがない場合もstartTimeは調整
            const newStartTime = clip.startTime * zoomRatio;
            return { ...clip, startTime: newStartTime };
          })
        );
        return { ...track, clips: updatedClips };
      })
    );
    
    setTracks(updatedTracks);
  }, [pixelsPerSecond, tracks, getAudioDuration]);

  // スナップ処理（0.1秒単位でスナップ）
  const getSnapPosition = useCallback((position) => {
    const snapInterval = pixelsPerSecond * 0.1; // 0.1秒単位
    return Math.round(position / snapInterval) * snapInterval;
  }, [pixelsPerSecond]);

  // クリップが重ならないように位置を調整する関数
  const findNonOverlappingPosition = useCallback((trackClips, newStartTime, newDuration, excludeClipId = null) => {
    // 対象となるトラックのクリップ（自分自身は除外）
    const otherClips = trackClips.filter(clip => clip.id !== excludeClipId);
    
    // 重なりがない場合はそのままの位置を返す
    const hasOverlap = (start, duration) => {
      const end = start + duration;
      return otherClips.some(clip => {
        const clipEnd = clip.startTime + clip.duration;
        // 重なりの判定: 新しいクリップの開始が既存クリップの範囲内、または終了が既存クリップの範囲内
        return (start < clipEnd && end > clip.startTime);
      });
    };

    if (!hasOverlap(newStartTime, newDuration)) {
      return newStartTime;
    }

    // 重なりがある場合、前後の近い隙間を探す
    const findNearestGap = (preferredStart) => {
      // 全てのクリップを開始時間順にソート
      const sortedClips = [...otherClips].sort((a, b) => a.startTime - b.startTime);
      
      // 前方向（左側）を探す
      let leftPosition = preferredStart;
      for (let i = sortedClips.length - 1; i >= 0; i--) {
        const clip = sortedClips[i];
        const clipEnd = clip.startTime + clip.duration;
        
        if (clipEnd <= preferredStart) {
          // このクリップの後ろから開始できるかチェック
          const candidateStart = clipEnd;
          const nextClip = sortedClips[i + 1];
          
          if (!nextClip || candidateStart + newDuration <= nextClip.startTime) {
            leftPosition = candidateStart;
            break;
          }
        }
      }

      // 後方向（右側）を探す
      let rightPosition = null;
      for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        const clipEnd = clip.startTime + clip.duration;
        
        if (clip.startTime >= preferredStart) {
          // このクリップの前に配置できるかチェック
          const candidateStart = clip.startTime - newDuration;
          
          if (candidateStart >= 0) {
            const prevClip = sortedClips[i - 1];
            if (!prevClip || candidateStart >= prevClip.startTime + prevClip.duration) {
              rightPosition = candidateStart;
              break;
            }
          }
          
          // このクリップの後ろに配置
          const candidateStart2 = clipEnd;
          const nextClip = sortedClips[i + 1];
          
          if (!nextClip || candidateStart2 + newDuration <= nextClip.startTime) {
            if (rightPosition === null) {
              rightPosition = candidateStart2;
            }
            break;
          }
        }
      }

      // 最後のクリップの後ろもチェック
      if (sortedClips.length > 0 && rightPosition === null) {
        const lastClip = sortedClips[sortedClips.length - 1];
        rightPosition = lastClip.startTime + lastClip.duration;
      }

      // 先頭（0秒）もチェック
      if (sortedClips.length === 0 || (sortedClips[0].startTime >= newDuration)) {
        const startPosition = 0;
        if (leftPosition === preferredStart && rightPosition === null) {
          return startPosition;
        }
      }

      // 前後どちらが近いか比較
      const leftDistance = Math.abs(leftPosition - preferredStart);
      const rightDistance = rightPosition !== null ? Math.abs(rightPosition - preferredStart) : Infinity;

      if (rightDistance < leftDistance) {
        return rightPosition;
      }
      
      return leftPosition >= 0 ? leftPosition : (rightPosition !== null ? rightPosition : 0);
    };

    const adjustedPosition = findNearestGap(newStartTime);
    return Math.max(0, getSnapPosition(adjustedPosition));
  }, [getSnapPosition]);

  // プレイヘッドのアニメーション更新
  const updatePlayhead = useCallback(() => {
    const animate = () => {
      if (isPlaying && startPlayTime) {
        const elapsed = (Date.now() - startPlayTime) / 1000; // 経過時間（秒）
        
        const newCurrentTime = elapsed * pixelsPerSecond;
        
        // 有効な数値かチェック
        if (isFinite(newCurrentTime) && newCurrentTime >= 0) {
          setCurrentTime(newCurrentTime);
        } else {
          console.warn('無効なcurrentTime:', newCurrentTime, 'elapsed:', elapsed, 'pixelsPerSecond:', pixelsPerSecond);
        }
        
        // 次のフレームを要求
        animationFrameRef.current = requestAnimationFrame(animate);
      }
    };
    
    if (isPlaying && startPlayTime) {
      animate();
    }
  }, [isPlaying, startPlayTime, pixelsPerSecond]);

  useEffect(() => {
    if (isPlaying) {
      if (!startPlayTime) {
        // 再生開始時にstartPlayTimeを設定
        if (isFinite(pixelsPerSecond) && pixelsPerSecond > 0) {
          const timeInSeconds = currentTime / pixelsPerSecond;
          if (isFinite(timeInSeconds) && timeInSeconds >= 0) {
            setStartPlayTime(Date.now() - (timeInSeconds * 1000));
          } else {
            setStartPlayTime(Date.now());
          }
        } else {
          setStartPlayTime(Date.now());
        }
      }
    } else {
      // 再生停止時にアニメーションをクリア
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      setStartPlayTime(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, currentTime, pixelsPerSecond]);

  // startPlayTimeが設定されたときにアニメーションを開始
  useEffect(() => {
    if (isPlaying && startPlayTime) {
      updatePlayhead();
    }
  }, [isPlaying, startPlayTime, updatePlayhead]);

  // プロジェクト保存機能
  const saveProject = () => {
    try {
      const projectData = {
        version: '1.0',
        pixelsPerSecond: pixelsPerSecond,
        tracks: tracks.map(track => ({
          ...track,
          clips: track.clips.map(clip => ({
            ...clip,
            soundData: clip.soundData ? {
              ...clip.soundData,
              audioBlob: null, // Blobは送信しない
              audioData: clip.soundData.audioData // base64データを保持
            } : null
          }))
        })),
        sounds: sounds.map(sound => ({
          ...sound,
          audioBlob: null, // Blobは別途保存
          audioData: sound.audioData // base64データを保持
        })),
        timestamp: Date.now(),
        trackNameCounter: trackNameCounterRef.current,
        trackIdCounter: trackIdCounterRef.current
      };

      const projectJson = JSON.stringify(projectData, null, 2);
      const blob = new Blob([projectJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `music-project-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
    } catch (error) {
      console.error('プロジェクト保存エラー:', error);
      setError('プロジェクトの保存に失敗しました。');
    }
  };

  // プロジェクト読み込み機能
  const loadProject = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const projectData = JSON.parse(e.target.result);
        
        // バージョンチェック
        if (!projectData.version) {
          throw new Error('不正なプロジェクトファイルです');
        }

        // 音声データ復元用のヘルパー関数
        const restoreAudioBlob = (soundData) => {
          if (soundData && soundData.audioData) {
            try {
              const byteCharacters = atob(soundData.audioData.split(',')[1]);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: 'audio/wav' });
              return { ...soundData, audioBlob: blob };
            } catch (error) {
              console.error('音声データの復元に失敗:', soundData.name || 'unknown', error);
              return soundData;
            }
          }
          return soundData;
        };

        // ピクセル/秒を復元
        setPixelsPerSecond(projectData.pixelsPerSecond || DEFAULT_PIXELS_PER_SECOND);
        
        // トラックを復元（クリップ内の音声データも復元）
        if (projectData.tracks) {
          const restoredTracks = projectData.tracks.map(track => ({
            ...track,
            clips: track.clips
              .map(clip => ({
                ...clip,
                soundData: restoreAudioBlob(clip.soundData)
              }))
              .filter(clip => {
                // 無効なクリップを除外
                if (!clip.soundData || !clip.soundData.name) {
                  console.warn('無効なクリップを除外:', clip);
                  return false;
                }
                return true;
              })
          }));
          setTracks(restoredTracks);
        }
        
        // カウンターを復元
        if (projectData.trackNameCounter) {
          trackNameCounterRef.current = projectData.trackNameCounter;
        }
        if (projectData.trackIdCounter) {
          trackIdCounterRef.current = projectData.trackIdCounter;
        }
        
        // 音素材を復元（既存の音素材に追加）
        if (projectData.sounds) {
          const restoredSounds = projectData.sounds.map(sound => restoreAudioBlob(sound));
          
          // 既存の音素材と読み込んだ音素材を結合
          setSounds(prevSounds => {
            const maxId = prevSounds.length > 0 ? Math.max(...prevSounds.map(s => s.id)) : 0;
            const existingNames = new Set(prevSounds.map(s => s.name));
            
            const newSounds = restoredSounds.map((sound, index) => {
              let newName = sound.name;
              let counter = 1;
              
              // 名前の重複をチェックして、重複する場合は番号を付ける
              while (existingNames.has(newName)) {
                newName = `${sound.name} (${counter})`;
                counter++;
              }
              existingNames.add(newName);
              
              return {
                ...sound,
                id: maxId + index + 1, // 新しいIDを割り当て
                name: newName // 重複しない名前を設定
              };
            });
            
            return [...prevSounds, ...newSounds];
          });
        }
        
        setError(null);
        
        // 読み込み後に自動保存データも更新
        setTimeout(() => {
          const autoSaveData = {
            version: '1.0',
            pixelsPerSecond: projectData.pixelsPerSecond || DEFAULT_PIXELS_PER_SECOND,
            tracks: projectData.tracks || [],
            timestamp: Date.now(),
            trackNameCounter: projectData.trackNameCounter || 1,
            trackIdCounter: projectData.trackIdCounter || 1
          };
          localStorage.setItem('dawProjectAutoSave', JSON.stringify(autoSaveData));
        }, 100);
      } catch (error) {
        console.error('プロジェクト読み込みエラー:', error);
        setError('プロジェクトファイルの読み込みに失敗しました。ファイルが正しいか確認してください。');
      }
    };
    
    reader.readAsText(file);
    // ファイル選択をリセット
    event.target.value = '';
  };

  // クラウド保存機能
  const openCloudSaveDialog = () => {
    // ローカルストレージから部屋番号を取得
    const savedRoom = localStorage.getItem('sound-library-room');
    setCloudSaveData(prev => ({
      ...prev,
      roomNumber: savedRoom || '',
      songTitle: `楽曲_${new Date().toLocaleDateString('ja-JP')}`
    }));
    setShowCloudSaveDialog(true);
  };

  const saveToCloud = async () => {
    try {
      if (!cloudSaveData.songTitle.trim()) {
        setError('楽曲タイトルを入力してください');
        return;
      }

      if (!cloudSaveData.roomNumber.trim()) {
        setError('部屋番号を入力してください');
        return;
      }

      // 部屋IDを取得
      const roomsResponse = await fetch('/api/rooms.php');
      const roomsData = await roomsResponse.json();
      
      if (!roomsData.success) {
        setError('部屋情報の取得に失敗しました');
        return;
      }

      const targetRoom = roomsData.data.find(room => 
        room.room_number === parseInt(cloudSaveData.roomNumber, 10)
      );

      if (!targetRoom) {
        setError('指定された部屋番号が見つかりません');
        return;
      }

      // プロジェクトデータを準備
      const projectData = {
        version: '1.0',
        pixelsPerSecond: pixelsPerSecond,
        tracks: tracks.map(track => ({
          ...track,
          clips: track.clips.map(clip => ({
            ...clip,
            soundData: clip.soundData ? {
              ...clip.soundData,
              audioBlob: null, // Blobは送信しない
              audioData: clip.soundData.audioData // base64データを保持
            } : null
          }))
        })),
        sounds: sounds.map(sound => ({
          ...sound,
          audioBlob: null,
          audioData: sound.audioData
        })),
        timestamp: Date.now(),
        trackNameCounter: trackNameCounterRef.current,
        trackIdCounter: trackIdCounterRef.current
      };

      // APIに送信
      const response = await fetch('/api/songs.php', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          room_id: targetRoom.id,
          student_name: cloudSaveData.studentName,
          group_number: cloudSaveData.groupNumber,
          song_title: cloudSaveData.songTitle,
          song_data: projectData
        })
      });

      const result = await response.json();

      if (result.success) {
        alert('楽曲をクラウドに保存しました！');
        setShowCloudSaveDialog(false);
        setCloudSaveData({
          songTitle: '',
          studentName: '',
          groupNumber: '',
          roomNumber: ''
        });
      } else {
        setError(result.error || 'クラウド保存に失敗しました');
      }
    } catch (error) {
      console.error('クラウド保存エラー:', error);
      setError('クラウド保存に失敗しました');
    }
  };

  // 先生用管理ページから楽曲を読み込む機能
  useEffect(() => {
    const checkForImportedSong = async () => {
      try {
        // IndexedDBから楽曲データを取得
        const songData = await getSongData();
        
        if (songData) {
          console.log('✓ Song data loaded from IndexedDB');
          
          // プロジェクトデータを復元
          setPixelsPerSecond(songData.pixelsPerSecond || DEFAULT_PIXELS_PER_SECOND);
          
          // audioDataからaudioBlobを復元する関数
          const restoreAudioBlob = (soundData) => {
            if (soundData.audioData && !soundData.audioBlob) {
              try {
                const byteCharacters = atob(soundData.audioData.split(',')[1]);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                  byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: 'audio/wav' });
                return { ...soundData, audioBlob: blob };
              } catch (error) {
                console.error('Blob復元エラー:', error);
                return soundData;
              }
            }
            return soundData;
          };
          
          // 使用されている音素材を収集
          const usedSounds = new Map(); // name をキーにして重複を避ける
          
          if (songData.tracks) {
            // 各トラックのクリップのsoundDataを復元
            const restoredTracks = songData.tracks.map(track => ({
              ...track,
              clips: track.clips.map(clip => {
                const restoredSoundData = restoreAudioBlob(clip.soundData);
                
                // 音素材を収集（重複チェック）
                if (restoredSoundData && restoredSoundData.name && !usedSounds.has(restoredSoundData.name)) {
                  usedSounds.set(restoredSoundData.name, restoredSoundData);
                }
                
                return {
                  ...clip,
                  soundData: restoredSoundData
                };
              })
            }));
            setTracks(restoredTracks);
          }
          
          // 使用されている音素材を音ライブラリーに自動追加
          if (usedSounds.size > 0) {
            setSounds(prevSounds => {
              const existingNames = new Set(prevSounds.map(s => s.name));
              const maxId = prevSounds.length > 0 ? Math.max(...prevSounds.map(s => s.id)) : 0;
              
              const newSounds = [];
              let idCounter = 1;
              
              usedSounds.forEach((soundData) => {
                // すでに同じ名前の音素材が存在する場合はスキップ
                if (!existingNames.has(soundData.name)) {
                  newSounds.push({
                    ...soundData,
                    id: maxId + idCounter,
                    source: 'cloud-import',
                    importedAt: new Date().toISOString()
                  });
                  idCounter++;
                  existingNames.add(soundData.name);
                }
              });
              
              if (newSounds.length > 0) {
                // LocalStorageにも保存
                const updatedSounds = [...prevSounds, ...newSounds];
                const soundsForStorage = updatedSounds.map(sound => ({
                  ...sound,
                  audioBlob: undefined // Blobは保存しない
                }));
                localStorage.setItem('soundRecordings', JSON.stringify(soundsForStorage));
                
                console.log(`${newSounds.length}個の音素材を音ライブラリーに追加しました`);
              }
              
              return [...prevSounds, ...newSounds];
            });
          }
          
          if (songData.trackNameCounter) {
            trackNameCounterRef.current = songData.trackNameCounter;
          }
          
          if (songData.trackIdCounter) {
            trackIdCounterRef.current = songData.trackIdCounter;
          }
          
          // インポート済みデータをIndexedDBから削除
          await deleteSongData();
          
          const soundCount = usedSounds.size;
          alert(`先生が指定した楽曲を読み込みました!\n使用されている${soundCount}個の音素材を音ライブラリーに追加しました。`);
        }
      } catch (error) {
        console.error('インポートされた楽曲の読み込みに失敗:', error);
      }
    };

    checkForImportedSong();
  }, []);

  // 音源出力機能
  const exportAudio = async () => {
    if (!audioContext) {
      setError('AudioContextが初期化されていません。');
      return;
    }

    setIsExporting(true);
    try {
      // 全トラックの全クリップの最大終了時間を計算
      let maxDuration = 0;
      tracks.forEach(track => {
        track.clips.forEach(clip => {
          const clipStartTimeInSeconds = clip.startTime / pixelsPerSecond;
          const clipDurationInSeconds = clip.duration / pixelsPerSecond;
          const clipEndTime = clipStartTimeInSeconds + clipDurationInSeconds;
          maxDuration = Math.max(maxDuration, clipEndTime);
        });
      });

      if (maxDuration === 0) {
        setError('出力する音声がありません。音素材を配置してください。');
        setIsExporting(false);
        return;
      }

      // 出力用AudioContextを作成（44.1kHz）
      const exportContext = new AudioContext({ sampleRate: 44100 });
      const bufferLength = Math.ceil(maxDuration * exportContext.sampleRate);
      const outputBuffer = exportContext.createBuffer(2, bufferLength, exportContext.sampleRate);
      
      const leftChannel = outputBuffer.getChannelData(0);
      const rightChannel = outputBuffer.getChannelData(1);

      // 各トラックの各クリップを処理
      for (const track of tracks) {
        for (const clip of track.clips) {
          if (clip.soundData && clip.soundData.audioBlob) {
            try {
              const arrayBuffer = await clip.soundData.audioBlob.arrayBuffer();
              const audioBuffer = await exportContext.decodeAudioData(arrayBuffer);
              
              const startTimeInSamples = Math.floor((clip.startTime / pixelsPerSecond) * exportContext.sampleRate);
              
              // 音声をミックス
              for (let channel = 0; channel < Math.min(audioBuffer.numberOfChannels, 2); channel++) {
                const sourceData = audioBuffer.getChannelData(channel);
                const targetData = channel === 0 ? leftChannel : rightChannel;
                
                for (let i = 0; i < sourceData.length && (startTimeInSamples + i) < targetData.length; i++) {
                  targetData[startTimeInSamples + i] += sourceData[i];
                }
              }
              
              // モノラル音源の場合は両チャンネルにコピー
              if (audioBuffer.numberOfChannels === 1) {
                const sourceData = audioBuffer.getChannelData(0);
                for (let i = 0; i < sourceData.length && (startTimeInSamples + i) < rightChannel.length; i++) {
                  rightChannel[startTimeInSamples + i] += sourceData[i];
                }
              }
            } catch (error) {
              console.error('クリップの処理エラー:', error);
            }
          }
        }
      }

      // WAVファイルとして出力
      const wavBlob = audioBufferToWav(outputBuffer);
      const url = URL.createObjectURL(wavBlob);
      
      const link = document.createElement('a');
      link.href = url;
      link.download = `exported-music-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.wav`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      if (exportContext && exportContext.state !== 'closed') {
        await exportContext.close().catch(error => {
          console.warn('Export AudioContext のクローズに失敗:', error);
        });
      }
    } catch (error) {
      console.error('音源出力エラー:', error);
      setError('音源の出力に失敗しました。');
    } finally {
      setIsExporting(false);
    }
  };

  // AudioBufferをWAVファイルに変換
  const audioBufferToWav = (buffer) => {
    const length = buffer.length;
    const numberOfChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const bytesPerSample = 2;
    const blockAlign = numberOfChannels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;
    const dataSize = length * blockAlign;
    const bufferSize = 44 + dataSize;
    
    const arrayBuffer = new ArrayBuffer(bufferSize);
    const view = new DataView(arrayBuffer);
    
    // WAVファイルヘッダー
    const writeString = (offset, string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };
    
    writeString(0, 'RIFF');
    view.setUint32(4, bufferSize - 8, true);
    writeString(8, 'WAVE');
    writeString(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numberOfChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bytesPerSample * 8, true);
    writeString(36, 'data');
    view.setUint32(40, dataSize, true);
    
    // 音声データ
    let offset = 44;
    for (let i = 0; i < length; i++) {
      for (let channel = 0; channel < numberOfChannels; channel++) {
        const sample = buffer.getChannelData(channel)[i];
        const intSample = Math.max(-1, Math.min(1, sample)) * 0x7FFF;
        view.setInt16(offset, intSample, true);
        offset += 2;
      }
    }
    
    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  const addTrack = () => {
    // より確実にユニークなIDを生成
    trackIdCounterRef.current += 1;
    const uniqueId = Date.now() + trackIdCounterRef.current;
    
    // トラック名の番号を増加（削除されても番号は戻らない）
    trackNameCounterRef.current += 1;
    const trackName = `トラック ${trackNameCounterRef.current}`;
    
    const newTrack = {
      id: uniqueId,
      name: trackName,
      clips: []
    };
    setTracks(prevTracks => [...prevTracks, newTrack]);
  };

  const removeTrack = (trackId) => {
    setTracks(prevTracks => {
      if (prevTracks.length > 1) {
        return prevTracks.filter(track => track.id !== trackId);
      }
      return prevTracks;
    });
  };

  const handleDrop = async (e, trackId, timePosition) => {
    e.preventDefault();
    setDragPreview(null);
    
    
    try {
      
      // 既存のクリップの移動かどうかチェック
      if (draggedClip) {
        // ドラッグオフセットを考慮した新しい開始位置を計算
        const adjustedPosition = timePosition - dragOffset;
        // 拍または秒に合わせて位置を調整
        const snappedPosition = Math.max(0, getSnapPosition(adjustedPosition));
        
        // ターゲットトラックのクリップを取得
        const targetTrack = tracks.find(track => track.id === trackId);
        if (!targetTrack) {
          console.error('ターゲットトラックが見つかりません');
          setDraggedClip(null);
          setDragOffset(0);
          return;
        }

        // 重ならない位置を計算（自分自身は除外）
        const nonOverlappingPosition = findNonOverlappingPosition(
          targetTrack.clips,
          snappedPosition,
          draggedClip.duration,
          draggedClip.id
        );
        
        // 既存クリップの移動
        const updatedClip = {
          ...draggedClip,
          startTime: nonOverlappingPosition,
          trackId: trackId
        };

        setTracks(prevTracks => prevTracks.map(track => {
          if (track.id === draggedClip.originalTrackId && track.id === trackId) {
            // 同じトラック内での移動
            return {
              ...track,
              clips: track.clips.map(clip => 
                clip.id === draggedClip.id ? updatedClip : clip
              )
            };
          } else if (track.id === draggedClip.originalTrackId) {
            // 元のトラックからクリップを削除
            return {
              ...track,
              clips: track.clips.filter(clip => clip.id !== draggedClip.id)
            };
          } else if (track.id === trackId) {
            // 新しいトラックにクリップを追加
            return {
              ...track,
              clips: [...track.clips, updatedClip]
            };
          }
          return track;
        }));
        setDraggedClip(null);
        setDragOffset(0);
        return;
      }
      
      // 新しい音素材の配置
      let soundData;
      try {
        // dataTransferからデータを取得
        const jsonData = e.dataTransfer ? e.dataTransfer.getData('application/json') : '';
        if (jsonData) {
          soundData = JSON.parse(jsonData);
        } else {
          // モバイルの場合はグローバル変数から取得
          soundData = window.currentDraggedSound;
        }
      } catch (error) {
        console.error('ドラッグデータの取得に失敗:', error);
        soundData = window.currentDraggedSound; // フォールバック
      }
      
      if (!soundData) {
        console.error('音素材データが見つかりません');
        setError('音素材データが見つかりません。再度お試しください。');
        return;
      }

      // soundDataの必要なプロパティをチェック
      if (!soundData.name) {
        console.error('音素材の名前が見つかりません:', soundData);
        setError('音素材の名前が不正です。再度お試しください。');
        return;
      }
      
      // グローバル変数からaudioBlobを復元
      console.log('audioBlob復元前:', {
        hasGlobalBlob: !!window.currentDraggedSoundBlob,
        hasAudioData: !!soundData.audioData,
        soundName: soundData.name
      });
      
      if (window.currentDraggedSoundBlob) {
        soundData.audioBlob = window.currentDraggedSoundBlob;
        console.log('audioBlob復元成功:', {
          isBlob: soundData.audioBlob instanceof Blob,
          size: soundData.audioBlob?.size
        });
      } else if (soundData.audioData) {
        // audioDataからBlobを再生成
        console.log('audioDataからBlob再生成を試みます');
        try {
          const byteCharacters = atob(soundData.audioData.split(',')[1]);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          soundData.audioBlob = new Blob([byteArray], { type: 'audio/wav' });
          console.log('audioDataからBlob再生成成功:', {
            isBlob: soundData.audioBlob instanceof Blob,
            size: soundData.audioBlob?.size
          });
        } catch (error) {
          console.error('audioDataからBlob再生成に失敗:', error);
        }
      }
      
      // グローバル変数をクリア
      if (window.currentDraggedSoundBlob) {
        window.currentDraggedSoundBlob = null;
      }
      if (window.currentDraggedSound) {
        window.currentDraggedSound = null;
      }
      
      
      // 音声の実際の継続時間を取得
      let duration = 400; // デフォルト値
      
      // audioBlobの状態を詳しくチェック
      console.log('audioBlob状態チェック:', {
        hasAudioBlob: !!soundData.audioBlob,
        isInstanceOfBlob: soundData.audioBlob instanceof Blob,
        audioBlobType: typeof soundData.audioBlob,
        audioBlobSize: soundData.audioBlob?.size,
        hasAudioData: !!soundData.audioData,
        soundName: soundData.name,
        hasGlobalDuration: !!window.currentDraggedSoundDuration
      });
      
      // まずグローバル変数から事前計算された長さを取得
      if (window.currentDraggedSoundDuration && 
          isFinite(window.currentDraggedSoundDuration) && 
          window.currentDraggedSoundDuration > 0) {
        duration = window.currentDraggedSoundDuration;
        console.log('事前計算された音声の長さを使用:', duration);
      } else if (soundData.audioBlob && soundData.audioBlob instanceof Blob && soundData.audioBlob.size > 0) {
        // グローバル変数が無い場合は再計算
        console.log('音声の長さを再計算中...');
        try {
          duration = await getAudioDuration(soundData.audioBlob, pixelsPerSecond);
          console.log('計算された音声の長さ:', duration);
        } catch (error) {
          console.warn('音声継続時間の取得に失敗しました:', error);
          duration = 400;
        }
      } else {
        console.warn('audioBlobが無効です。クリップ情報:', {
          hasAudioBlob: !!soundData.audioBlob,
          isInstanceOfBlob: soundData.audioBlob instanceof Blob,
          audioBlobType: typeof soundData.audioBlob,
          hasAudioData: !!soundData.audioData,
          soundDataName: soundData.name,
          clipId: Date.now()
        });
        console.warn('audioBlobが見つかりません。デフォルト値を使用:', duration);
      }

      // durationが有効な値かチェック
      if (!isFinite(duration) || duration <= 0) {
        console.warn('無効なduration:', duration, 'デフォルト値を使用');
        duration = 400;
      }
      
      // グローバル変数をクリア
      window.currentDraggedSoundDuration = null;

      // 新しい音素材の場合は通常のスナップ処理
      const snappedPosition = getSnapPosition(timePosition);

      // ターゲットトラックのクリップを取得して重ならない位置を計算
      const targetTrack = tracks.find(track => track.id === trackId);
      const nonOverlappingPosition = targetTrack 
        ? findNonOverlappingPosition(targetTrack.clips, snappedPosition, duration)
        : snappedPosition;

      const newClip = {
        id: Date.now() + Math.random(), // より確実にユニークなIDを生成
        soundData: soundData,
        startTime: nonOverlappingPosition,
        duration: duration,
        trackId: trackId
      };


      // 関数型更新を使用して最新の状態を確実に取得
      setTracks(prevTracks => {
        const updatedTracks = prevTracks.map(track => 
          track.id === trackId 
            ? { ...track, clips: [...track.clips, newClip] }
            : track
        );
        return updatedTracks;
      });
    } catch (error) {
      console.error('ドロップエラー:', error);
      setError('音素材の配置に失敗しました。再度お試しください。');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    
    // ドラッグされているのが既存クリップか新しい音素材かで処理を分ける
    if (draggedClip) {
      e.dataTransfer.dropEffect = 'move';
    } else {
      e.dataTransfer.dropEffect = 'copy';
    }
    
    // スロットリング - 16ms（60FPS）間隔で実行を制限
    if (dragOverTimeoutRef.current) {
      return;
    }
    
    // 必要な情報を事前に抽出
    const clientX = e.clientX;
    const currentTarget = e.currentTarget;
    
    dragOverTimeoutRef.current = setTimeout(() => {
      dragOverTimeoutRef.current = null;
      updateDragPreview(clientX, currentTarget);
    }, 16);
  };
  
  const updateDragPreview = (clientX, trackElement) => {
    // null チェックを追加
    if (!trackElement || !timelineRef.current) {
      return;
    }

    // 初回ドラッグプレビュー表示時に強制クリーンアップタイマーを設定
    if (!window.dragCleanupTimer) {
      window.dragCleanupTimer = setTimeout(() => {
        cleanupDragState();
      }, 10000); // 10秒後に強制クリーンアップ
    }
    
    try {
      // ドラッグプレビューの更新
      const rect = trackElement.getBoundingClientRect();
      const timePosition = clientX - rect.left;
      
      let snappedPosition;
      
      if (draggedClip) {
        // 既存クリップの場合：ドラッグオフセットを考慮
        const adjustedPosition = timePosition - dragOffset;
        snappedPosition = Math.max(0, getSnapPosition(adjustedPosition));
      } else {
        // 新しい音素材の場合：通常の処理
        snappedPosition = getSnapPosition(timePosition);
      }
      
      const trackRect = trackElement.getBoundingClientRect();
      const tracksAreaRect = timelineRef.current.getBoundingClientRect();
      
      if (tracksAreaRect && trackElement.dataset && trackElement.dataset.trackId) {
        const relativeTop = trackRect.top - tracksAreaRect.top;
        const trackId = parseInt(trackElement.dataset.trackId);
        
        // trackIdが有効な数値かチェック
        if (isNaN(trackId)) {
          return;
        }
        
        // プレビュー幅を決定
        let previewWidth = 400; // デフォルト値（1小節）
        
        if (draggedClip) {
          // 既存クリップの場合
          previewWidth = isFinite(draggedClip.duration) && draggedClip.duration > 0 
            ? draggedClip.duration 
            : 400;
        } else {
          // 新しい音素材の場合、事前に計算された長さを使用
          previewWidth = draggedSoundDuration;
        }
        
        setDragPreview({
          left: snappedPosition,
          top: relativeTop + 10,
          width: previewWidth,
          trackId: trackId
        });
      }
    } catch (error) {
      console.warn('ドラッグプレビュー更新エラー:', error);
      // エラーが発生した場合はプレビューをクリア
      setDragPreview(null);
    }
  };

  const removeClip = (trackId, clipId) => {
    setTracks(prevTracks => prevTracks.map(track => 
      track.id === trackId 
        ? { ...track, clips: track.clips.filter(clip => clip.id !== clipId) }
        : track
    ));
  };

  // クリップのドラッグ開始
  const handleClipDragStart = (clip, originalTrackId, mouseX, clipElement) => {
    
    // クリップ内でのマウス位置のオフセットを計算
    const clipRect = clipElement.getBoundingClientRect();
    const offsetInClip = mouseX - clipRect.left;
    
    
    setDraggedClip({ ...clip, originalTrackId });
    setDragOffset(offsetInClip);
  };

  // ドラッグ状態の完全なクリーンアップ
  const cleanupDragState = useCallback(() => {
    
    // ドラッグオーバーのタイムアウトをクリア
    if (dragOverTimeoutRef.current) {
      clearTimeout(dragOverTimeoutRef.current);
      dragOverTimeoutRef.current = null;
    }
    
    // 強制クリーンアップタイマーをクリア
    if (window.dragCleanupTimer) {
      clearTimeout(window.dragCleanupTimer);
      window.dragCleanupTimer = null;
    }
    
    // すべてのドラッグ関連の状態をリセット
    setDraggedClip(null);
    setDragPreview(null);
    setDraggedSoundDuration(400);
    setDragOffset(0);
    
    // DOM要素のクリーンアップ
    document.querySelectorAll('.track').forEach(track => {
      track.classList.remove('drag-over');
    });
    
    // モバイル用のドラッグプレビューを削除
    const mobileDragPreview = document.querySelector('.mobile-drag-preview');
    if (mobileDragPreview) {
      mobileDragPreview.remove();
    }
    
    // グローバル変数のクリーンアップ
    if (window.currentDraggedSoundBlob) {
      window.currentDraggedSoundBlob = null;
    }
    if (window.currentDraggedSound) {
      window.currentDraggedSound = null;
    }
    if (window.currentDraggedSoundDuration) {
      window.currentDraggedSoundDuration = null;
    }
    
    // ボディクラスとスタイルのクリーンアップ（スクロールを再有効化）
    document.body.classList.remove('dragging');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.height = '';
  }, []);

  // コンポーネントマウント時にグローバルコールバックを設定
  useEffect(() => {
    window.cleanupDragStateCallback = cleanupDragState;
    
    // グローバルなドラッグ終了イベントリスナーを追加
    const handleGlobalDragEnd = () => {
      cleanupDragState();
    };

    const handleGlobalDragLeave = (e) => {
      // ドキュメント外にドラッグが出た場合
      if (!e.relatedTarget || e.relatedTarget.nodeName === 'HTML') {
        cleanupDragState();
      }
    };

    // ドキュメントレベルでイベントリスナーを設定
    document.addEventListener('dragend', handleGlobalDragEnd);
    document.addEventListener('dragleave', handleGlobalDragLeave);
    
    // クリーンアップ関数
    return () => {
      if (window.cleanupDragStateCallback === cleanupDragState) {
        window.cleanupDragStateCallback = null;
      }
      document.removeEventListener('dragend', handleGlobalDragEnd);
      document.removeEventListener('dragleave', handleGlobalDragLeave);
    };
  }, [cleanupDragState]);

  // ドラッグ終了時のクリーンアップ
  const handleDragEnd = (e) => {
    // タイムラインエリアの外にドロップされた場合、クリップを削除
    if (draggedClip && timelineRef.current && e && e.clientX !== undefined && e.clientY !== undefined) {
      const timelineRect = timelineRef.current.getBoundingClientRect();
      const dropX = e.clientX;
      const dropY = e.clientY;
      
      // タイムライン領域外にドロップされた場合
      if (dropX < timelineRect.left || dropX > timelineRect.right ||
          dropY < timelineRect.top || dropY > timelineRect.bottom) {
        // クリップを削除
        setTracks(prevTracks => prevTracks.map(track => {
          if (track.id === draggedClip.originalTrackId) {
            return {
              ...track,
              clips: track.clips.filter(clip => clip.id !== draggedClip.id)
            };
          }
          return track;
        }));
      }
    }
    
    // 完全なクリーンアップ
    cleanupDragState();
  };

  // onDragStartハンドラーをメモ化
  const handleSoundDragStart = useCallback(async (sound) => {
    console.log('onDragStart呼び出し:', sound.name);
    // ドラッグ開始時に音声の長さを計算
    if (sound.audioBlob) {
      try {
        const duration = await getAudioDuration(sound.audioBlob, pixelsPerSecond);
        console.log('音声の長さ計算完了:', duration, 'ピクセル');
        setDraggedSoundDuration(duration);
        // グローバル変数にも保存（ドロップ時に使用）
        window.currentDraggedSoundDuration = duration;
      } catch (error) {
        console.warn('ドラッグ時の音声長さ計算に失敗:', error);
        setDraggedSoundDuration(400);
        window.currentDraggedSoundDuration = 400;
      }
    } else {
      console.warn('audioBlobが見つかりません');
      setDraggedSoundDuration(400);
      window.currentDraggedSoundDuration = 400;
    }
  }, [getAudioDuration, pixelsPerSecond]);

  const play = async () => {
    console.log('=== Play Button Clicked ===');
    console.log('Current Time:', currentTime);
    console.log('AudioContext State:', audioContext?.state);
    console.log('Number of Tracks:', tracks.length);
    console.log('Total Clips:', tracks.reduce((sum, track) => sum + track.clips.length, 0));
    
    try {
      // iPad/iOS対策: AudioContextが中断されている場合は再開
      if (audioContext && audioContext.state === 'suspended') {
        console.log('⚠️ Resuming suspended AudioContext...');
        await audioContext.resume();
        console.log('✓ AudioContext state after resume:', audioContext.state);
      }
      
      setIsPlaying(true);
      
      // 現在の時間位置に基づいて、再生すべきクリップを見つける
      const currentTimeInSeconds = currentTime / pixelsPerSecond;
      
      // 各トラックのクリップを再生
      const newPlayingAudios = new Map();
      
      tracks.forEach(track => {
        track.clips.forEach(clip => {
          // clip.durationが有効な値かチェック
          if (!isFinite(clip.duration) || clip.duration <= 0) {
            console.warn('無効なclip.duration:', clip.duration, 'クリップをスキップします');
            return;
          }
          
          const clipStartTimeInSeconds = clip.startTime / pixelsPerSecond;
          const clipEndTimeInSeconds = clipStartTimeInSeconds + (clip.duration / pixelsPerSecond);
          
          // 計算結果が有効かチェック
          if (!isFinite(clipStartTimeInSeconds) || !isFinite(clipEndTimeInSeconds)) {
            console.warn('無効な時間計算:', { clipStartTimeInSeconds, clipEndTimeInSeconds });
            return;
          }
          
          // 現在の時間位置がクリップの範囲内または今後再生される場合
          if (clipEndTimeInSeconds > currentTimeInSeconds) {
            const delay = Math.max(0, clipStartTimeInSeconds - currentTimeInSeconds);
            
            // クリップ内のオフセット位置を計算
            let clipOffset = 0;
            if (currentTimeInSeconds > clipStartTimeInSeconds) {
              // 現在位置がクリップの途中にある場合、オフセットを計算
              clipOffset = currentTimeInSeconds - clipStartTimeInSeconds;
            }
            
            if (isFinite(delay) && delay >= 0) {
              scheduleClipPlayback(clip, delay * 1000, clipOffset, newPlayingAudios);
            }
          }
        });
      });
      
      setPlayingAudios(newPlayingAudios);
    } catch (error) {
      console.error('再生エラー:', error);
      setError('音声の再生に失敗しました。ブラウザで音声が有効になっているか確認してください。');
    }
  };

  const scheduleClipPlayback = (clip, delayMs, clipOffset, playingAudiosMap) => {
    
    if (clip.soundData && clip.soundData.audioBlob && clip.soundData.audioBlob instanceof Blob) {
      try {
        const audio = new Audio();
        
        // iPad/iOS対策: audioDataがある場合はData URLを使用（より確実）
        let audioUrl;
        let useDataUrl = false;
        
        if (clip.soundData.audioData) {
          // Data URL方式（iOS/iPadでより安定）
          audio.src = clip.soundData.audioData;
          useDataUrl = true;
          console.log('Using Data URL for clip:', clip.id);
        } else {
          // Blob URL方式（フォールバック）
          audioUrl = URL.createObjectURL(clip.soundData.audioBlob);
          audio.src = audioUrl;
          console.log('Using Blob URL for clip:', clip.id);
        }
        
        // iPad/iOS対策: 音声の設定を明示的に行う
        audio.preload = 'auto';
        audio.volume = 1.0;
        audio.muted = false;
        audio.playsInline = true; // iOS対策: インライン再生を有効化
        
        // iPad/iOS対策: ロード完了を確実に待つ
        let isLoaded = false;
        let canPlayTriggered = false;
        
        audio.addEventListener('loadeddata', () => {
          isLoaded = true;
          console.log('✓ Audio loaded successfully for clip:', clip.id, {
            duration: audio.duration,
            readyState: audio.readyState
          });
        });
        
        audio.addEventListener('canplay', () => {
          canPlayTriggered = true;
          console.log('✓ Audio can play for clip:', clip.id);
        });
        
        audio.addEventListener('canplaythrough', () => {
          console.log('✓ Audio can play through for clip:', clip.id);
        });
        
        audio.addEventListener('error', (e) => {
          console.error('❌ Audio load error for clip:', clip.id, e);
          console.error('Audio error details:', {
            error: audio.error,
            errorCode: audio.error?.code,
            errorMessage: audio.error?.message,
            readyState: audio.readyState,
            networkState: audio.networkState,
            src: audio.src.substring(0, 50) + '...'
          });
        });
        
        // iPad/iOS対策: loadメソッドを呼び出して音声を準備
        audio.load();
        
        const timeoutId = setTimeout(async () => {
          // ロード完了を待つ（最大2秒）
          const waitForLoad = new Promise((resolve) => {
            if (isLoaded || canPlayTriggered || audio.readyState >= 2) {
              resolve(true);
              return;
            }
            
            const checkInterval = setInterval(() => {
              if (isLoaded || canPlayTriggered || audio.readyState >= 2) {
                clearInterval(checkInterval);
                resolve(true);
              }
            }, 50);
            
            // タイムアウト: 2秒後
            setTimeout(() => {
              clearInterval(checkInterval);
              console.warn('⚠️ Audio load timeout for clip:', clip.id, {
                readyState: audio.readyState,
                isLoaded,
                canPlayTriggered
              });
              resolve(false);
            }, 2000);
          });
          
          await waitForLoad;
          
          // クリップのオフセット位置から再生を開始
          if (clipOffset > 0) {
            try {
              audio.currentTime = clipOffset;
            } catch (error) {
              console.error('Failed to set currentTime:', error);
            }
          }
          
          // 再生開始のログ
          console.log('🎵 Attempting to play clip:', clip.id, {
            readyState: audio.readyState,
            networkState: audio.networkState,
            duration: audio.duration,
            currentTime: audio.currentTime,
            volume: audio.volume,
            muted: audio.muted,
            paused: audio.paused
          });
          
          // iPad/iOS対策: 再生前に音声が準備できているか確認
          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log('✓ Playback started successfully for clip:', clip.id);
              })
              .catch(error => {
                console.error('❌ 音声再生エラー:', error.name, error.message);
                // iOS Safari特有のエラーログ
                console.error('Audio state at error:', {
                  readyState: audio.readyState,
                  networkState: audio.networkState,
                  error: audio.error,
                  errorCode: audio.error?.code,
                  src: useDataUrl ? 'Data URL' : 'Blob URL',
                  currentTime: audio.currentTime,
                  duration: audio.duration,
                  paused: audio.paused,
                  volume: audio.volume,
                  muted: audio.muted,
                  played: audio.played.length
                });
                
                // Blob URLの場合のみクリーンアップ
                if (!useDataUrl && audioUrl) {
                  URL.revokeObjectURL(audioUrl);
                }
              });
          }
        }, delayMs);
        
        // 音声終了時の処理
        audio.addEventListener('ended', () => {
          console.log('✓ Audio playback ended for clip:', clip.id);
          if (!useDataUrl && audioUrl) {
            URL.revokeObjectURL(audioUrl);
          }
        });
        
        playingAudiosMap.set(clip.id, { audio, timeoutId, audioUrl: useDataUrl ? null : audioUrl });
      } catch (error) {
        console.error('createObjectURL エラー:', error, 'audioBlob:', clip.soundData.audioBlob);
      }
    } else {
      console.warn('audioBlobが無効です。クリップ情報:', {
        clipId: clip.id,
        soundDataName: clip.soundData?.name,
        hasAudioData: !!clip.soundData?.audioData,
        hasAudioBlob: !!clip.soundData?.audioBlob,
        audioBlobType: typeof clip.soundData?.audioBlob,
        isInstanceOfBlob: clip.soundData?.audioBlob instanceof Blob
      });
      
      // AudioBlobが無効な場合、audioDataから復元を試行
      if (clip.soundData && clip.soundData.audioData && !clip.soundData.audioBlob) {
        try {
          const byteCharacters = atob(clip.soundData.audioData.split(',')[1]);
          const byteNumbers = new Array(byteCharacters.length);
          for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
          }
          const byteArray = new Uint8Array(byteNumbers);
          const blob = new Blob([byteArray], { type: 'audio/wav' });
          
          // クリップのsoundDataを更新
          clip.soundData.audioBlob = blob;
          
          // 再帰的に再試行
          scheduleClipPlayback(clip, delayMs, clipOffset, playingAudiosMap);
          return;
        } catch (restoreError) {
          console.error('audioDataからのBlob復元に失敗:', restoreError);
        }
      }
    }
  };

  const pause = () => {
    setIsPlaying(false);
    
    // 再生中の音声を一時停止
    playingAudios.forEach(({ audio, timeoutId, audioUrl }) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      if (!audio.paused) {
        audio.pause();
      }
      // URLを解放
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    });
  };

  const stop = () => {
    setIsPlaying(false);
    setCurrentTime(0);
    
    // 再生中の音声を停止
    playingAudios.forEach(({ audio, timeoutId, audioUrl }) => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      audio.pause();
      audio.currentTime = 0;
      // URLを解放
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    });
    
    setPlayingAudios(new Map());
  };

  // タイムラインデータの自動保存機能
  useEffect(() => {
    const autoSaveProject = () => {
      try {
        const projectData = {
          version: '1.0',
          pixelsPerSecond: pixelsPerSecond,
          tracks: tracks,
          timestamp: Date.now(),
          trackNameCounter: trackNameCounterRef.current,
          trackIdCounter: trackIdCounterRef.current
        };

        localStorage.setItem('dawProjectAutoSave', JSON.stringify(projectData));

      } catch (error) {
        console.error('プロジェクトの自動保存に失敗:', error);
      }
    };

    // 初期化後の自動保存（tracksやpixelsPerSecondが変更された時）
    if (tracks.length > 0) {
      autoSaveProject();
    }
  }, [tracks, pixelsPerSecond]);

  // 音素材の更新監視（他のページで音が追加された場合の対応）
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        // ページが表示されたときに音素材を再読み込み
        const savedSounds = JSON.parse(localStorage.getItem('soundRecordings') || '[]');
        
        // 音声データ復元処理（既存のロジックを再利用）
        const soundsWithBlob = savedSounds.map(sound => {
          if (sound.audioData) {
            try {
              const base64Data = sound.audioData.split(',')[1];
              if (!base64Data || base64Data.length === 0) {
                return sound;
              }
              
              const byteCharacters = atob(base64Data);
              const byteNumbers = new Array(byteCharacters.length);
              for (let i = 0; i < byteCharacters.length; i++) {
                byteNumbers[i] = byteCharacters.charCodeAt(i);
              }
              const byteArray = new Uint8Array(byteNumbers);
              const blob = new Blob([byteArray], { type: 'audio/wav' });
              
              return { ...sound, audioBlob: blob };
            } catch (error) {
              console.error('音声データの復元に失敗:', sound.name, error);
              return sound;
            }
          }
          return sound;
        });
        
        const validSounds = soundsWithBlob.filter(sound => 
          sound.audioBlob && sound.audioBlob instanceof Blob && sound.audioBlob.size > 0
        );
        
        setSounds(validSounds);
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  // 自動保存データをクリアする機能
  const clearAutoSave = () => {
    try {
      localStorage.removeItem('dawProjectAutoSave');
      
      // 初期状態にリセット
      setTracks([{ 
        id: Date.now(), 
        name: 'トラック 1', 
        clips: [] 
      }]);
      setPixelsPerSecond(DEFAULT_PIXELS_PER_SECOND);
      trackNameCounterRef.current = 1;
      trackIdCounterRef.current = 1;
      
      setError(null);
      alert('✅ プロジェクトをリセットしました');
    } catch (error) {
      console.error('自動保存データのクリアに失敗:', error);
      setError('プロジェクトのリセットに失敗しました');
    }
  };

  // 無効なクリップを除外する関数
  const cleanupInvalidClips = () => {
    setTracks(prevTracks => {
      const cleanedTracks = prevTracks.map(track => ({
        ...track,
        clips: track.clips.filter(clip => {
          if (!clip.soundData || !clip.soundData.name) {
            console.warn('無効なクリップを除外:', clip);
            return false;
          }
          return true;
        })
      }));
      
      const removedCount = prevTracks.reduce((total, track) => total + track.clips.length, 0) - 
                          cleanedTracks.reduce((total, track) => total + track.clips.length, 0);
      
      if (removedCount > 0) {
      }
      
      return cleanedTracks;
    });
  };

  // 初期化時に無効なクリップをクリーンアップ
  useEffect(() => {
    const timer = setTimeout(() => {
      cleanupInvalidClips();
    }, 1000); // 1秒後に実行

    return () => clearTimeout(timer);
  }, []);

  // コンポーネントアンマウント時の包括的クリーンアップ
  useEffect(() => {
    return () => {
      // ドラッグ状態のクリーンアップ
      cleanupDragState();
      
      // 再生中の音声をすべて停止
      setPlayingAudios(currentPlayingAudios => {
        currentPlayingAudios.forEach(({ audio, timeoutId, audioUrl }) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          if (audio) {
            audio.pause();
            audio.src = '';
          }
          if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
          }
        });
        return new Map();
      });
      
      // AudioContextをクリーンアップ
      if (audioContext && audioContext.state !== 'closed') {
        audioContext.close().catch(error => {
          console.warn('AudioContext のクローズに失敗:', error);
        });
      }
      
      // アニメーションフレームをクリア
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      
      // タイムアウトをクリア
      if (dragOverTimeoutRef.current) {
        clearTimeout(dragOverTimeoutRef.current);
      }
    };
  }, [cleanupDragState, audioContext]);

  return (
    <div className="daw-page">
      <h2>🎹 音楽づくりページ</h2>
      <p>音素材をドラッグ&ドロップして音楽を作りましょう！</p>

      {error && (
        <div className="error-message">
          <span>⚠️ {error}</span>
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="daw-controls card">
        {/* 上段：音素材表示切り替え、保存関連機能 */}
        <div className="top-controls-row">
          <div className="left-controls">
            <button 
              className="button-secondary" 
              onClick={() => setShowSoundPanel(!showSoundPanel)}
            >
              {showSoundPanel ? '🎵 音素材を隠す' : '🎵 音素材を表示'}
            </button>
          </div>

          <div className="right-controls">
            <div className="project-controls">
              <button className="button-secondary" onClick={saveProject}>
                💾 プロジェクト保存
              </button>
              <button className="button-secondary" onClick={openCloudSaveDialog}>
                🌐 クラウド保存
              </button>
              <label className="button-secondary file-input-label">
                📁 プロジェクト読み込み
                <input
                  type="file"
                  accept=".json"
                  onChange={loadProject}
                  style={{ display: 'none' }}
                />
              </label>
            <button 
              className="button-warning" 
              onClick={() => {
                if (window.confirm('🗑️ プロジェクトをリセットしますか？\n\n現在の作業内容がすべて削除されます。')) {
                  clearAutoSave();
                }
              }}
              title="プロジェクトをリセット（自動保存データもクリア）"
            >
              🗑️ リセット
            </button>
            <button 
              className="button-primary" 
              onClick={exportAudio}
              disabled={isExporting}
            >
              {isExporting ? '🔄 出力中...' : '🎧 音源出力'}
            </button>
            </div>
          </div>
        </div>

        {/* 下段：再生コントロール、ズームコントロール */}
        <div className="bottom-controls-row">
          <div className="transport-controls">
            <button 
              className={`transport-btn play-btn ${isPlaying ? 'playing' : ''}`}
              onClick={isPlaying ? pause : play}
            >
              {isPlaying ? '⏸️' : '▶️'}
            </button>
            <button className="transport-btn stop-btn" onClick={stop}>
              ⏹️
            </button>
          </div>

          <div className="timing-controls">
            <div className="zoom-control">
              <span>🔍 タイムライン拡大/縮小:</span>
              <button 
                className="zoom-btn"
                onClick={() => handleZoom(false)}
                title="ズームアウト（縮小）"
              >
                －
              </button>
              <span className="zoom-display">
                {Math.round(pixelsPerSecond / DEFAULT_PIXELS_PER_SECOND * 100)}%
              </span>
              <button 
                className="zoom-btn"
                onClick={() => handleZoom(true)}
                title="ズームイン（拡大）"
              >
                ＋
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="daw-main-area">
        <div className={`sound-panel ${!showSoundPanel ? 'panel-hidden' : ''}`}>
          <div className="sound-panel-header">
            <h3>🎵 音素材</h3>
            <button 
              className="sound-panel-close"
              onClick={() => setShowSoundPanel(false)}
              title="音素材パネルを閉じる"
            >
              ✕
            </button>
          </div>
          
          {/* タグフィルター */}
          {allTags.length > 0 && (
            <div className="sound-panel-filters">
              <div className="tag-filter-label">🏷️ タグで絞り込み:</div>
              <div className="tag-filters-compact">
                <button
                  className={`tag-filter-btn-compact ${selectedTag === '' ? 'active' : ''}`}
                  onClick={() => setSelectedTag('')}
                  title="すべての音素材を表示"
                >
                  すべて
                </button>
                {allTags.map(tag => (
                  <button
                    key={tag}
                    className={`tag-filter-btn-compact ${selectedTag === tag ? 'active' : ''}`}
                    onClick={() => setSelectedTag(tag)}
                    title={`${tag}でフィルター`}
                  >
                    {tag}
                  </button>
                ))}
              </div>
            </div>
          )}
          
          <div className="sound-list">
            {sounds.length > 0 ? (
              filteredSounds.length > 0 ? (
                filteredSounds.map(sound => (
                <MemoizedSoundItem 
                  key={sound.id} 
                  sound={sound} 
                  onDragStart={handleSoundDragStart}
                />
              ))
              ) : (
                <div className="no-sounds">
                  <p>選択したタグの音素材がありません</p>
                  <button 
                    className="reset-filter-btn"
                    onClick={() => setSelectedTag('')}
                  >
                    フィルターをリセット
                  </button>
                </div>
              )
            ) : (
              <div className="no-sounds">
                <p>音素材がありません</p>
                <p>「音あつめ」ページで音を録音してください</p>
              </div>
            )}
          </div>
        </div>

        <div className={`daw-workspace ${!showSoundPanel ? 'panel-hidden' : ''}`}>
          <div className="track-headers" ref={trackHeadersRef}>
            <div className="timeline-header-spacer">
              タイムライン
            </div>
            {tracks.map((track, index) => (
              <TrackHeader 
                key={track.id} 
                track={track} 
                trackIndex={index}
                onRemove={removeTrack}
                trackHeight={trackHeight}
              />
            ))}
            <div className="track-add-button-container" style={{ height: trackHeight }}>
              <button className="button-primary track-add-btn" onClick={addTrack}>
                ➕ トラック追加
              </button>
            </div>
          </div>

          <div className="timeline-container" ref={timelineContainerRef}>
            <Timeline pixelsPerSecond={pixelsPerSecond} />
            <div 
              className="tracks-area" 
              ref={timelineRef} 
              style={{ 
                minWidth: TIME_MODE_TOTAL_SECONDS * pixelsPerSecond
              }}
            >
              <Playhead currentTime={currentTime} />
              {dragPreview && (
                <div 
                  className="drag-preview"
                  style={{
                    left: dragPreview.left,
                    top: dragPreview.top,
                    width: dragPreview.width
                  }}
                />
              )}
              {tracks.map((track) => (
                <Track
                  key={track.id}
                  track={track}
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onRemoveClip={removeClip}
                  onClipDragStart={handleClipDragStart}
                  onDragEnd={handleDragEnd}
                  trackHeight={trackHeight}
                  updateDragPreview={updateDragPreview}
                  pixelsPerSecond={pixelsPerSecond}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="instructions-collapsible">
        <div className="instructions-summary" role="button" tabIndex={0} onClick={() => setInstructionsExpanded(prev => !prev)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') setInstructionsExpanded(prev => !prev); }}>
          <span className="instructions-title">📖 使い方</span>
          <button className="instructions-toggle" aria-expanded={instructionsExpanded} aria-controls="instructions-body">
            {instructionsExpanded ? '折りたたむ' : '表示'}
          </button>
        </div>
        {instructionsExpanded && (
          <div id="instructions-body">
            <InstructionsSection />
          </div>
        )}
      </div>

      {/* クラウド保存ダイアログ */}
      {showCloudSaveDialog && (
        <>
          <button
            type="button"
            className="modal-overlay"
            onClick={() => setShowCloudSaveDialog(false)}
            aria-label="ダイアログを閉じる"
            tabIndex={0}
            style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, border: 'none', padding: 0, margin: 0 }}
          />
          <div
            className="modal-content"
            role="dialog"
            aria-modal="true"
            style={{ position: 'fixed', zIndex: 1001 }}
          >
            <div className="modal-header">
              <h3>🌐 楽曲をクラウドに保存</h3>
              <button 
                type="button"
                className="modal-close-btn"
                onClick={() => setShowCloudSaveDialog(false)}
                aria-label="ダイアログを閉じる"
              >
                ×
              </button>
            </div>
            
            <div className="modal-body">
              <div className="form-group">
                <label htmlFor="cloud-song-title">楽曲タイトル *</label>
                <input
                  id="cloud-song-title"
                  type="text"
                  value={cloudSaveData.songTitle}
                  onChange={(e) => setCloudSaveData(prev => ({...prev, songTitle: e.target.value}))}
                  placeholder="楽曲のタイトルを入力"
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="cloud-room-number">部屋番号 *</label>
                <input
                  id="cloud-room-number"
                  type="number"
                  value={cloudSaveData.roomNumber}
                  onChange={(e) => setCloudSaveData(prev => ({...prev, roomNumber: e.target.value}))}
                  placeholder="例: 101"
                  required
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="cloud-student-name">あなたの名前</label>
                <input
                  id="cloud-student-name"
                  type="text"
                  value={cloudSaveData.studentName}
                  onChange={(e) => setCloudSaveData(prev => ({...prev, studentName: e.target.value}))}
                  placeholder="名前を入力（任意）"
                />
              </div>
              
              <div className="form-group">
                <label htmlFor="cloud-group-number">班番号</label>
                <input
                  id="cloud-group-number"
                  type="text"
                  value={cloudSaveData.groupNumber}
                  onChange={(e) => setCloudSaveData(prev => ({...prev, groupNumber: e.target.value}))}
                  placeholder="班番号を入力（任意）"
                />
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="button-secondary"
                onClick={() => setShowCloudSaveDialog(false)}
              >
                キャンセル
              </button>
              <button 
                className="button-primary"
                onClick={saveToCloud}
                disabled={!cloudSaveData.songTitle.trim() || !cloudSaveData.roomNumber.trim()}
              >
                クラウドに保存
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

const SoundItem = ({ sound, onDragStart }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchMove, setTouchMove] = useState(null);
  const audioRef = useRef(null);
  const audioUrlRef = useRef(null);
  const durationCacheRef = useRef(null); // 音声の長さをキャッシュ
  
  // マウスオーバー時に音声の長さを事前計算
  const handleMouseEnter = useCallback(() => {
    // 既にキャッシュされている場合はスキップ
    if (durationCacheRef.current !== null) {
      return;
    }
    
    // 音声の長さを事前に計算してキャッシュ
    if (onDragStart && sound.audioBlob) {
      onDragStart(sound).then(() => {
        // 計算完了後、グローバル変数から取得してキャッシュ
        if (window.currentDraggedSoundDuration) {
          durationCacheRef.current = window.currentDraggedSoundDuration;
        }
      }).catch(err => {
        console.warn('音声長さの事前計算に失敗:', err);
      });
    }
  }, [sound, onDragStart]);

  const handleDragStart = async (e) => {
    console.log('handleDragStart開始:', sound.name, 'キャッシュ:', durationCacheRef.current);
    
    // スクロールを無効化（強制的に）
    document.body.classList.add('dragging');
    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.width = '100%';
    document.body.style.height = '100%';
    
    // カスタムドラッグイメージを設定（テキストとして表示）
    const dragImage = document.createElement('div');
    dragImage.textContent = sound.name;
    dragImage.style.cssText = `
      position: absolute;
      top: -1000px;
      background: rgba(0, 123, 255, 0.9);
      color: white;
      padding: 8px 16px;
      border-radius: 6px;
      font-size: 14px;
      font-weight: 600;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      pointer-events: none;
    `;
    document.body.appendChild(dragImage);
    
    // ドラッグイメージとして設定（中央に配置）
    e.dataTransfer.setDragImage(dragImage, dragImage.offsetWidth / 2, dragImage.offsetHeight / 2);
    
    // 少し遅延してから削除
    setTimeout(() => {
      if (dragImage && dragImage.parentNode) {
        dragImage.parentNode.removeChild(dragImage);
      }
    }, 0);
    
    // audioBlob以外のデータをJSON文字列として設定（audioDataは含める）
    const soundDataForTransfer = {
      ...sound,
      audioBlob: null // Blobは直接シリアライズできないため一時的にnullに
    };
    
    console.log('dataTransferに設定するデータ:', {
      name: soundDataForTransfer.name,
      hasAudioData: !!soundDataForTransfer.audioData,
      audioDataLength: soundDataForTransfer.audioData?.length
    });
    
    e.dataTransfer.setData('application/json', JSON.stringify(soundDataForTransfer));
    e.dataTransfer.effectAllowed = 'copy';
    
    // 実際のaudioBlobは別途グローバル変数で保持
    window.currentDraggedSoundBlob = sound.audioBlob;
    console.log('audioBlob設定:', {
      hasAudioBlob: !!sound.audioBlob,
      isBlob: sound.audioBlob instanceof Blob,
      size: sound.audioBlob?.size,
      hasAudioData: !!sound.audioData
    });
    
    // キャッシュされた長さがある場合はそれを使用
    if (durationCacheRef.current !== null) {
      window.currentDraggedSoundDuration = durationCacheRef.current;
      console.log('キャッシュから音声長さを使用:', durationCacheRef.current);
    }
    
    // 親コンポーネントのonDragStart関数を呼び出し（音声の長さを計算）
    // キャッシュがない場合は計算を開始（待機しない）
    if (onDragStart && durationCacheRef.current === null) {
      onDragStart(sound).catch(err => {
        console.warn('ドラッグ開始時の音声長さ計算に失敗:', err);
        // エラーが発生してもグローバル変数にデフォルト値を設定
        if (!window.currentDraggedSoundDuration) {
          window.currentDraggedSoundDuration = 400;
        }
      });
    }
  };

  // タッチイベント対応
  const handleTouchStart = (e) => {
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY });
    setIsDragging(false);
    
    // 長押し判定用のタイマーは設定せず、移動検知でのみドラッグを開始
  };

  const handleTouchMove = (e) => {
    if (!touchStart) return;
    
    const touch = e.touches[0];
    const currentPos = { x: touch.clientX, y: touch.clientY };
    setTouchMove(currentPos);
    
    // ドラッグ開始の判定（5px以上移動）- より即座に反応するように閾値を下げる
    const deltaX = Math.abs(currentPos.x - touchStart.x);
    const deltaY = Math.abs(currentPos.y - touchStart.y);
    
    if (!isDragging && (deltaX > 5 || deltaY > 5)) {
      setIsDragging(true);
      // スクロールを一時的に無効化（移動が確定してから）
      document.body.classList.add('dragging');
      document.body.style.overflow = 'hidden';
      document.body.style.position = 'fixed';
      document.body.style.width = '100%';
      document.body.style.height = '100%';
      
      // タッチドラッグ用にグローバル変数を設定
      window.currentDraggedSound = {
        ...sound,
        audioBlob: null // Blobは別途設定
      };
      window.currentDraggedSoundBlob = sound.audioBlob;
      console.log('タッチドラッグ開始 - グローバル変数設定:', {
        name: sound.name,
        hasAudioData: !!sound.audioData,
        hasAudioBlob: !!sound.audioBlob
      });
      
      // 親コンポーネントのonDragStart関数を呼び出し（非同期）
      if (onDragStart) {
        // 非同期で音声の長さを計算（待たない）
        onDragStart(sound).catch(err => {
          console.warn('タッチドラッグ開始時の音声長さ計算に失敗:', err);
        });
      }
      // グローバル変数に設定
      window.currentDraggedSoundBlob = sound.audioBlob;
      window.currentDraggedSound = sound;
    }
    
    if (isDragging) {
      // passiveイベントではpreventDefaultが使えないので、代わりにtouchActionでスクロールを制御
      
      // ドラッグプレビューの位置を更新
      const dragPreview = document.querySelector('.mobile-drag-preview');
      if (dragPreview) {
        dragPreview.style.left = `${currentPos.x - 50}px`;
        dragPreview.style.top = `${currentPos.y - 20}px`;
      }
      
      // ドロップターゲットのハイライト
      const elementBelow = document.elementFromPoint(currentPos.x, currentPos.y);
      const trackElement = elementBelow?.closest('.track');
      
      // 既存のハイライトを削除
      document.querySelectorAll('.track').forEach(track => {
        track.classList.remove('drag-over');
      });
      
      // 新しいハイライトを追加
      if (trackElement) {
        trackElement.classList.add('drag-over');
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (isDragging && touchMove) {
      // ドロップ処理
      const elementBelow = document.elementFromPoint(touchMove.x, touchMove.y);
      const trackElement = elementBelow?.closest('.track');
      
      if (trackElement) {
        const trackId = parseInt(trackElement.dataset.trackId);
        const rect = trackElement.getBoundingClientRect();
        const timePosition = touchMove.x - rect.left;
        
        // ドロップイベントを発火
        const dropEvent = new CustomEvent('mobileDrop', {
          detail: {
            trackId,
            timePosition,
            sound: sound
          }
        });
        trackElement.dispatchEvent(dropEvent);
      }
    }
    
    // クリーンアップ
    setTouchStart(null);
    setTouchMove(null);
    setIsDragging(false);
    
    // SoundItem 内での直接クリーンアップ（スクロールを再有効化）
    document.body.classList.remove('dragging');
    document.body.style.overflow = '';
    document.body.style.position = '';
    document.body.style.width = '';
    document.body.style.height = '';
    
    // ハイライトを削除
    document.querySelectorAll('.track').forEach(track => {
      track.classList.remove('drag-over');
    });
    
    // モバイル用のドラッグプレビューを削除
    const mobileDragPreview = document.querySelector('.mobile-drag-preview');
    if (mobileDragPreview) {
      mobileDragPreview.remove();
    }
    
    // グローバル変数をクリア
    if (window.currentDraggedSoundBlob) {
      window.currentDraggedSoundBlob = null;
    }
    if (window.currentDraggedSound) {
      window.currentDraggedSound = null;
    }
    if (window.currentDraggedSoundDuration) {
      window.currentDraggedSoundDuration = null;
    }
  };

  const playSound = () => {
    if (sound.audioBlob && !isPlaying && !isDragging) {
      // Blobの有効性をチェック
      if (!(sound.audioBlob instanceof Blob) || sound.audioBlob.size === 0) {
        console.error('無効なaudioBlob:', {
          name: sound.name,
          isBlob: sound.audioBlob instanceof Blob,
          size: sound.audioBlob?.size
        });
        return;
      }
      
      const audio = new Audio();
      // 重要: audioRefに先に格納してGCを防ぐ
      audioRef.current = audio;
      
      try {
        // iPad/iOS対策: audioDataがある場合はData URLを優先使用
        let useDataUrl = false;
        if (sound.audioData) {
          audio.src = sound.audioData;
          useDataUrl = true;
          console.log('🎵 Using Data URL for preview:', sound.name);
        } else {
          const audioUrl = URL.createObjectURL(sound.audioBlob);
          audioUrlRef.current = audioUrl;
          audio.src = audioUrl;
          console.log('🎵 Using Blob URL for preview:', sound.name);
        }
        
        // iPad/iOS対策: 音声の設定を明示的に行う
        audio.preload = 'auto';
        audio.volume = 1.0;
        audio.muted = false;
        audio.playsInline = true; // iOS対策: インライン再生を有効化
        
        // iPad/iOS対策: ロード状態を監視
        let isLoaded = false;
        let canPlayTriggered = false;
        
        audio.addEventListener('loadeddata', () => {
          isLoaded = true;
          console.log('✓ Preview audio loaded:', sound.name, {
            duration: audio.duration,
            readyState: audio.readyState
          });
        });
        
        audio.addEventListener('canplay', () => {
          canPlayTriggered = true;
          console.log('✓ Preview audio can play:', sound.name);
        });
        
        audio.addEventListener('canplaythrough', () => {
          console.log('✓ Preview audio can play through:', sound.name);
        });
        
        audio.addEventListener('error', (e) => {
          console.error('❌ Preview audio error:', sound.name, e);
          console.error('Error details:', {
            error: audio.error,
            errorCode: audio.error?.code,
            errorMessage: audio.error?.message,
            readyState: audio.readyState,
            networkState: audio.networkState
          });
        });
        
        // iPad/iOS対策: loadメソッドを呼び出して音声を準備
        audio.load();
        
        // ロード完了を待ってから再生
        const attemptPlay = async () => {
          // ロード完了を待つ（最大2秒）
          const waitForLoad = new Promise((resolve) => {
            if (isLoaded || canPlayTriggered || audio.readyState >= 2) {
              resolve(true);
              return;
            }
            
            const checkInterval = setInterval(() => {
              if (isLoaded || canPlayTriggered || audio.readyState >= 2) {
                clearInterval(checkInterval);
                resolve(true);
              }
            }, 50);
            
            setTimeout(() => {
              clearInterval(checkInterval);
              console.warn('⚠️ Preview audio load timeout:', sound.name, {
                readyState: audio.readyState,
                isLoaded,
                canPlayTriggered
              });
              resolve(false);
            }, 2000);
          });
          
          await waitForLoad;
          
          console.log('🎵 Attempting to play preview:', sound.name, {
            readyState: audio.readyState,
            duration: audio.duration,
            volume: audio.volume,
            muted: audio.muted
          });
          
          // iPad/iOS対策: 再生処理
          const playPromise = audio.play();
          
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                console.log('✓ Preview playback started:', sound.name);
                setIsPlaying(true);
                
                const handleEnded = () => {
                  setIsPlaying(false);
                  if (!useDataUrl && audioUrlRef.current) {
                    URL.revokeObjectURL(audioUrlRef.current);
                    audioUrlRef.current = null;
                  }
                  audioRef.current = null;
                  audio.removeEventListener('ended', handleEnded);
                };
                
                audio.addEventListener('ended', handleEnded);
              })
              .catch(error => {
                console.error('❌ Preview playback error:', error.name, error.message);
                console.error('Audio state:', {
                  readyState: audio.readyState,
                  networkState: audio.networkState,
                  error: audio.error,
                  errorCode: audio.error?.code,
                  duration: audio.duration,
                  volume: audio.volume,
                  muted: audio.muted
                });
                if (!useDataUrl && audioUrlRef.current) {
                  URL.revokeObjectURL(audioUrlRef.current);
                  audioUrlRef.current = null;
                }
                audioRef.current = null;
                setIsPlaying(false);
              });
          }
        };
        
        // 再生を試みる
        attemptPlay();
        
      } catch (error) {
        console.error('❌ createObjectURL/setup error:', error);
        setIsPlaying(false);
      }
    } else {
      console.error('再生条件不満足:', {
        hasAudioBlob: !!sound.audioBlob,
        isPlaying,
        isDragging
      });
    }
  };

  const stopSound = () => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current = null;
    }
    if (audioUrlRef.current) {
      URL.revokeObjectURL(audioUrlRef.current);
      audioUrlRef.current = null;
    }
    setIsPlaying(false);
  };

  // ドラッグプレビューを作成
  const createDragPreview = useCallback(() => {
    if (isDragging && touchMove) {
      let dragPreview = document.querySelector('.mobile-drag-preview');
      if (!dragPreview) {
        dragPreview = document.createElement('div');
        dragPreview.className = 'mobile-drag-preview';
        dragPreview.textContent = sound.name;
        dragPreview.style.cssText = `
          position: fixed;
          background: rgba(0, 123, 255, 0.8);
          color: white;
          padding: 5px 10px;
          border-radius: 4px;
          font-size: 12px;
          pointer-events: none;
          z-index: 1000;
          left: ${touchMove.x - 50}px;
          top: ${touchMove.y - 20}px;
        `;
        document.body.appendChild(dragPreview);
      }
    }
  }, [isDragging, touchMove, sound.name]);

  // ドラッグプレビューの更新
  React.useEffect(() => {
    if (isDragging) {
      createDragPreview();
    }
  }, [isDragging, touchMove, createDragPreview]);

  return (
    <div
      className={`sound-item ${isDragging ? 'dragging' : ''}`}
      draggable="true"
      onDragStart={handleDragStart}
      onMouseEnter={handleMouseEnter}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      <div className="sound-info">
        <h4>{sound.name}</h4>
        <div className="sound-tags">
          {sound.tags.map((tag, index) => (
            <span key={index} className="sound-tag">{tag}</span>
          ))}
        </div>
        <div className="sound-actions">
          <button 
            className="play-sound-btn"
            onClick={isPlaying ? stopSound : playSound}
          >
            {isPlaying ? '⏹️' : '▶️'}
          </button>
        </div>
      </div>
    </div>
  );
};

// SoundItemをメモ化して不要な再レンダリングを防ぐ
const MemoizedSoundItem = React.memo(SoundItem, (prevProps, nextProps) => {
  // sound.idとonDragStartが変わらなければ再レンダリングしない
  return prevProps.sound.id === nextProps.sound.id &&
         prevProps.onDragStart === nextProps.onDragStart;
});

const TrackHeader = ({ track, onRemove, trackHeight, trackIndex }) => {
  // トラック名を表示番号と元の名前で構成
  const displayName = `トラック ${trackIndex + 1}`;
  
  return (
    <div className="track-header" style={{ height: trackHeight }}>
      <div className="track-info">
        <h4>{displayName}</h4>
        <div className="track-actions">
          <button 
            className="remove-track-btn"
            onClick={() => onRemove(track.id)}
            title={`${displayName}を削除`}
            aria-label={`${displayName}を削除`}
          >
            🗑️
          </button>
        </div>
      </div>
    </div>
  );
};

const Timeline = ({ pixelsPerSecond }) => {
  // 秒数ベースのタイムライン表示
  const totalSeconds = TIME_MODE_TOTAL_SECONDS;
  
  return (
    <div className="timeline" style={{ minWidth: totalSeconds * pixelsPerSecond }}>
      {Array.from({ length: totalSeconds + 1 }, (_, second) => (
        <div 
          key={second} 
          className="time-mark"
          style={{ 
            position: 'absolute',
            left: second * pixelsPerSecond,
            width: pixelsPerSecond,
            height: '100%'
          }}
        >
          {second % 5 === 0 && (
            <div className="time-main">
              {second}s
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

const Track = ({ track, onDrop, onDragOver, onRemoveClip, onClipDragStart, onDragEnd, trackHeight, updateDragPreview, pixelsPerSecond }) => {
  const handleDrop = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const timePosition = e.clientX - rect.left;
    onDrop(e, track.id, timePosition);
  };

  // モバイルドロップイベントの処理
  const handleMobileDrop = useCallback((e) => {
    const { trackId, timePosition, sound } = e.detail;
    
    // 模擬的なドロップイベントを作成
    const mockDropEvent = {
      preventDefault: () => {},
      dataTransfer: {
        getData: (type) => {
          if (type === 'application/json') {
            return JSON.stringify(sound);
          }
          return '';
        }
      }
    };
    
    onDrop(mockDropEvent, trackId, timePosition);
  }, [onDrop]);

  // モバイルクリップ移動イベントの処理
  const handleMobileClipMove = useCallback((e) => {
    const { clip, newTrackId, timePosition } = e.detail;
    
    // 模擬的なドロップイベントを作成
    const mockDropEvent = {
      preventDefault: () => {},
      dataTransfer: {
        getData: (type) => {
          if (type === 'text/plain') {
            return `existing-clip-${clip.id}`;
          }
          return '';
        }
      }
    };
    
    onDrop(mockDropEvent, newTrackId, timePosition);
  }, [onDrop]);

  const handleUpdateDragPreview = useCallback((e) => {
    const { clientX, trackElement } = e.detail;
    // 親コンポーネントのupdateDragPreview関数を呼び出し
    if (typeof updateDragPreview === 'function') {
      updateDragPreview(clientX, trackElement);
    }
  }, [updateDragPreview]);

  React.useEffect(() => {
    const trackElement = document.querySelector(`[data-track-id="${track.id}"]`);
    if (trackElement) {
      trackElement.addEventListener('mobileDrop', handleMobileDrop);
      trackElement.addEventListener('mobileClipMove', handleMobileClipMove);
      trackElement.addEventListener('updateDragPreview', handleUpdateDragPreview);
      return () => {
        trackElement.removeEventListener('mobileDrop', handleMobileDrop);
        trackElement.removeEventListener('mobileClipMove', handleMobileClipMove);
        trackElement.removeEventListener('updateDragPreview', handleUpdateDragPreview);
      };
    }
  }, [track.id, handleMobileDrop, handleMobileClipMove, handleUpdateDragPreview]);

  return (
    <div 
      className="track"
      style={{ height: trackHeight }}
      data-track-id={track.id}
      onDrop={handleDrop}
      onDragOver={onDragOver}
    >
      <div className="track-grid">
        {/* 秒単位でグリッド線を表示 */}
        <>
          {/* 1秒ごとの主要な境界線 */}
          {Array.from({ length: TIME_MODE_TOTAL_SECONDS }, (_, index) => (
            <div 
              key={`time-main-${index}`} 
              className={`beat-line beat-line-main ${index === 0 ? 'first-beat' : ''} ${index % 5 === 0 ? 'measure-start' : ''}`} 
              style={{ left: index * pixelsPerSecond }} 
            />
          ))}
          {/* 0.5秒ごとの副次的な境界線 */}
          {Array.from({ length: TIME_MODE_TOTAL_SECONDS * 2 }, (_, index) => {
            if (index % 2 === 1) { // 奇数のインデックス（0.5秒、1.5秒など）
              return (
                <div 
                  key={`time-sub-${index}`} 
                  className="beat-line beat-line-sub" 
                  style={{ left: (index * pixelsPerSecond) / 2 }} 
                />
              );
            }
            return null;
          })}
        </>
      </div>
      
      {track.clips.map(clip => (
        <AudioClip
          key={clip.id}
          clip={clip}
          trackId={track.id}
          onRemove={() => onRemoveClip(track.id, clip.id)}
          onDragStart={onClipDragStart}
          onDragEnd={onDragEnd}
        />
      ))}
    </div>
  );
};

const AudioClip = ({ clip, trackId, onRemove, onDragStart, onDragEnd }) => {
  const [waveformData, setWaveformData] = React.useState([]);
  const [isDragging, setIsDragging] = React.useState(false);
  const [touchStart, setTouchStart] = React.useState(null);
  const [touchMove, setTouchMove] = React.useState(null);

  React.useEffect(() => {
    // clip.soundData が存在する場合のみ波形データを生成
    if (clip && clip.soundData) {
      // 簡単な波形データ生成（実際の実装では音声解析が必要）
      const generateWaveform = () => {
        const points = 20; // 波形のポイント数
        const data = [];
        for (let i = 0; i < points; i++) {
          data.push(Math.random() * 0.8 + 0.2); // 0.2-1.0の間のランダム値
        }
        setWaveformData(data);
      };

      generateWaveform();
    }
  }, [clip, clip?.soundData]);

  // clip.soundData の安全性をチェック（Hooksの後で）
  if (!clip || !clip.soundData) {
    console.warn('無効なクリップデータ:', clip);
    return null; // 無効なクリップは表示しない
  }

  const handleDragStart = (e) => {
    e.stopPropagation(); // イベントバブリングを防ぐ
    
    // スクロールを無効化
    document.body.classList.add('dragging');
    
    // ドラッグデータに既存クリップの情報を設定
    e.dataTransfer.setData('text/plain', `existing-clip-${clip.id}`);
    e.dataTransfer.effectAllowed = 'move';
    
    // onDragStartコールバックを呼び出し（マウス位置とクリップ要素を渡す）
    onDragStart(clip, trackId, e.clientX, e.currentTarget);
  };

  const handleDragEnd = (e) => {
    // ドラッグ終了時にクリーンアップを呼び出し
    if (onDragEnd) {
      onDragEnd(e);
    }
  };

  // タッチイベント対応（クリップの移動）
  const handleTouchStart = (e) => {
    e.stopPropagation();
    const touch = e.touches[0];
    setTouchStart({ x: touch.clientX, y: touch.clientY });
    setIsDragging(false);
    
    // ドラッグモードは移動が確定してから有効化
  };

  const handleTouchMove = (e) => {
    if (!touchStart) return;
    
    const touch = e.touches[0];
    const currentPos = { x: touch.clientX, y: touch.clientY };
    setTouchMove(currentPos);
    
    // ドラッグ開始の判定（10px以上移動）
    const deltaX = Math.abs(currentPos.x - touchStart.x);
    const deltaY = Math.abs(currentPos.y - touchStart.y);
    
    if (!isDragging && (deltaX > 10 || deltaY > 10)) {
      setIsDragging(true);
      // スクロールを一時的に無効化（移動が確定してから）
      document.body.classList.add('dragging');
      onDragStart(clip, trackId, touchStart.x, e.currentTarget);
    }
    
    if (isDragging) {
      // passiveイベントではpreventDefaultが使えないので、touchActionで制御
      
      // ドロップターゲットのハイライト
      const elementBelow = document.elementFromPoint(currentPos.x, currentPos.y);
      const trackElement = elementBelow?.closest('.track');
      
      // 既存のハイライトを削除
      document.querySelectorAll('.track').forEach(track => {
        track.classList.remove('drag-over');
      });
      
      // 新しいハイライトを追加（自分のトラック以外も含む）
      if (trackElement) {
        trackElement.classList.add('drag-over');
        
        // ドラッグプレビューも更新（onDragStart時と同様のロジック）
        if (onDragStart) {
          // 親コンポーネントのupdateDragPreview関数を呼び出すためのカスタムイベント
          const dragPreviewEvent = new CustomEvent('updateDragPreview', {
            detail: {
              clientX: currentPos.x,
              trackElement: trackElement
            }
          });
          trackElement.dispatchEvent(dragPreviewEvent);
        }
      }
    }
  };

  const handleTouchEnd = (e) => {
    if (isDragging && touchMove) {
      // ドロップ処理
      const elementBelow = document.elementFromPoint(touchMove.x, touchMove.y);
      const trackElement = elementBelow?.closest('.track');
      
      if (trackElement) {
        const newTrackId = parseInt(trackElement.dataset.trackId);
        const rect = trackElement.getBoundingClientRect();
        const timePosition = touchMove.x - rect.left;
        
        // 既存クリップの移動イベントを発火
        const moveEvent = new CustomEvent('mobileClipMove', {
          detail: {
            clip,
            originalTrackId: trackId,
            newTrackId,
            timePosition
          }
        });
        trackElement.dispatchEvent(moveEvent);
      }
    }
    
    // クリーンアップ
    setTouchStart(null);
    setTouchMove(null);
    setIsDragging(false);
    document.body.classList.remove('dragging');
    
    // ハイライトを削除
    document.querySelectorAll('.track').forEach(track => {
      track.classList.remove('drag-over');
    });
    
    // ドラッグプレビューをクリア（親コンポーネントの状態もリセット）
    if (onDragEnd) {
      onDragEnd(null); // nullを渡してガード条件を満たす
    }
  };

  return (
    <div 
      className={`audio-clip ${isDragging ? 'dragging' : ''}`}
      draggable="true"
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      style={{
        left: clip.startTime,
        width: isFinite(clip.duration) && clip.duration > 0 ? clip.duration : 400 // デフォルト1小節
      }}
    >
      <div className="clip-header">
        <span className="clip-name">{clip.soundData?.name || '不明な音素材'}</span>
        <button 
          className="remove-clip-btn"
          onClick={onRemove}
          title="クリップを削除"
        >
          ×
        </button>
      </div>
      <div className="clip-waveform">
        {waveformData.length > 0 ? (
          <svg className="waveform-svg" width="100%" height="30">
            {waveformData.map((height, index) => (
              <rect
                key={index}
                x={`${(index / waveformData.length) * 100}%`}
                y={`${(1 - height) * 15}`}
                width={`${80 / waveformData.length}%`}
                height={`${height * 30}`}
                fill="rgba(255, 255, 255, 0.8)"
              />
            ))}
          </svg>
        ) : (
          <div className="waveform-placeholder">🔊</div>
        )}
      </div>
    </div>
  );
};

// 使い方セクション - メモ化して再レンダリングを防ぐ
const InstructionsSection = React.memo(() => {
  return (
    <div className="instructions card">
      <h3>📖 使い方</h3>
      <ul>
        <li><strong>🖥️ PC:</strong> 左側の音素材パネルから音素材をトラックにドラッグ&ドロップして配置</li>
        <li><strong>📱 スマホ/タブレット:</strong> 音素材を長押ししてからトラックまでドラッグして配置</li>
        <li>配置済みの音素材もドラッグして別の場所に移動できます</li>
        <li>ドラッグ中は配置予定位置に青い影が表示されます</li>
        <li><strong>🔍 ズーム機能:</strong> ＋／－ボタンでタイムラインの表示倍率を変更できます</li>
        <li>タイムラインは秒数ベースで、0.1秒単位で音素材を配置できます</li>
        <li>音素材パネルの▶️ボタンで個別に音を確認できます</li>
        <li>▶️ボタンで再生、⏸️ボタンで一時停止、⏹️ボタンで停止</li>
        <li>トラックを追加して複数の音を重ねることができます</li>
        <li><strong>💾 プロジェクト保存:</strong> 編集中のデータをJSONファイルとして保存</li>
        <li><strong>📁 プロジェクト読み込み:</strong> 保存したプロジェクトファイルを読み込んで編集を再開</li>
        <li><strong>🎧 音源出力:</strong> 完成した楽曲をWAVファイルとして出力</li>
        <li><strong>🗑️ リセット:</strong> 現在のプロジェクトをリセットして新しく始める</li>
      </ul>
      <div className="auto-save-info">
        <h4>💾 自動保存機能</h4>
        <ul>
          <li><strong>自動保存:</strong> トラックとズーム倍率の変更は自動的に保存されます</li>
          <li><strong>他ページとの連携:</strong> 「音あつめ」ページで録音した音は自動的に反映されます</li>
          <li><strong>復元機能:</strong> ページをリロードしても作業内容が自動的に復元されます</li>
          <li><strong>安心して移動:</strong> 他のページに移動しても作業内容は保持されます</li>
        </ul>
      </div>
      <div className="mobile-tips">
        <h4>📱 スマートフォン利用のコツ</h4>
        <ul>
          <li>音素材を軽く長押しするとドラッグモードになります</li>
          <li>ドラッグ中は画面がスクロールしないよう制御されます</li>
          <li>青くハイライトされたトラックで指を離すと音素材が配置されます</li>
          <li>横画面表示にするとより使いやすくなります</li>
        </ul>
      </div>
    </div>
  );
});

InstructionsSection.displayName = 'InstructionsSection';

const Playhead = ({ currentTime }) => {
  // currentTimeが有効な数値かチェック
  const safeCurrentTime = isFinite(currentTime) && currentTime >= 0 ? currentTime : 0;
  
  return (
    <div 
      className="playhead"
      style={{ left: safeCurrentTime }}
    />
  );
};

export default DAWPage;
