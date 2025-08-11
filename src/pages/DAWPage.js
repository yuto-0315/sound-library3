import React, { useState, useRef, useEffect, useCallback } from 'react';
import './DAWPage.css';

// DAWの定数
const BEAT_WIDTH = 100; // 1拍の幅（px）
const BEATS_PER_MEASURE = 4; // 1小節あたりの拍数
const MEASURE_WIDTH = BEAT_WIDTH * BEATS_PER_MEASURE; // 1小節の幅（400px）
const SUB_BEAT_WIDTH = BEAT_WIDTH / 2; // 8分音符の幅（50px）
const TOTAL_MEASURES = 16; // 表示する小節数
const TOTAL_BEATS = TOTAL_MEASURES * BEATS_PER_MEASURE; // 総拍数

// 時間モードの定数
const TIME_MODE_TOTAL_SECONDS = 60; // 表示する総秒数
const PIXELS_PER_SECOND = 100; // 1秒あたりのピクセル数

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
        
        // 無効なクリップをフィルタリング
        const validTracks = (projectData.tracks || []).map(track => ({
          ...track,
          clips: (track.clips || []).filter(clip => {
            if (!clip.soundData || !clip.soundData.name) {
              console.warn('自動保存データから無効なクリップを除外:', clip);
              return false;
            }
            return true;
          })
        }));
        
        return {
          tracks: validTracks.length > 0 ? validTracks : [{ 
            id: Date.now(), 
            name: 'トラック 1', 
            clips: [] 
          }],
          bpm: projectData.bpm || 120,
          isTimeMode: projectData.isTimeMode || false,
          secondsPerBeat: projectData.secondsPerBeat || 0.5
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
      bpm: 120,
      isTimeMode: false,
      secondsPerBeat: 0.5
    };
  };

  const initialData = loadAutoSavedProject();
  const [tracks, setTracks] = useState(initialData.tracks);
  const [bpm, setBpm] = useState(initialData.bpm);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioContext, setAudioContext] = useState(null);
  const [trackHeight] = useState(80);
  const [playingAudios, setPlayingAudios] = useState(new Map());
  const [startPlayTime, setStartPlayTime] = useState(null);
  const [error, setError] = useState(null);
  const [sounds, setSounds] = useState([]);
  const [showSoundPanel, setShowSoundPanel] = useState(true);
  const [draggedClip, setDraggedClip] = useState(null);
  const [dragPreview, setDragPreview] = useState(null);
  const [draggedSoundDuration, setDraggedSoundDuration] = useState(400); // ドラッグ中の音素材の長さ
  const [dragOffset, setDragOffset] = useState(0); // ドラッグ開始時のクリップ内オフセット
  
  // 時間モード関連の状態
  const [isTimeMode, setIsTimeMode] = useState(initialData.isTimeMode); // false: 拍子モード, true: 秒数モード
  const [secondsPerBeat, setSecondsPerBeat] = useState(initialData.secondsPerBeat); // 秒数モード時の1拍あたりの秒数
  const [isExporting, setIsExporting] = useState(false); // 音源出力中フラグ
  const timelineRef = useRef(null);
  const animationFrameRef = useRef(null);
  const dragOverTimeoutRef = useRef(null);

  useEffect(() => {
    // Web Audio API の初期化
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    setAudioContext(ctx);
    
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

  // 音声ファイルの継続時間を取得してピクセル幅に変換
  const getAudioDuration = useCallback((audioBlob, currentBpm = bpm, currentSecondsPerBeat = secondsPerBeat) => {
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
            let pixelsPerSecond;
            if (isTimeMode) {
              // 秒数モード：1拍の秒数に基づいてピクセル/秒を計算
              const beatWidthInPixels = currentSecondsPerBeat * PIXELS_PER_SECOND;
              pixelsPerSecond = PIXELS_PER_SECOND;
            } else {
              // 拍子モード：BPMベース
              pixelsPerSecond = (currentBpm / 60) * 100;
            }
            const widthInPixels = durationInSeconds * pixelsPerSecond;
            resolve(widthInPixels);
            return;
          }
        } catch (error) {
          console.error('AudioContext方式でエラー:', error);
        }
      }
      resolve(400);
    });
  }, [audioContext, bpm, isTimeMode, secondsPerBeat]);

  // 時間モードとBPMモードを切り替える関数
  const toggleTimeMode = useCallback(async () => {
    const newTimeMode = !isTimeMode;
    setIsTimeMode(newTimeMode);
    
    // 既存のクリップのdurationを新しいモードで再計算
    const updatedTracks = await Promise.all(
      tracks.map(async (track) => {
        const updatedClips = await Promise.all(
          track.clips.map(async (clip) => {
            if (clip.soundData && clip.soundData.audioBlob) {
              try {
                const arrayBuffer = await clip.soundData.audioBlob.arrayBuffer();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                const durationInSeconds = audioBuffer.duration;
                
                let pixelsPerSecond;
                if (newTimeMode) {
                  pixelsPerSecond = PIXELS_PER_SECOND;
                } else {
                  pixelsPerSecond = (bpm / 60) * 100;
                }
                const newDuration = durationInSeconds * pixelsPerSecond;
                
                return { ...clip, duration: newDuration };
              } catch (error) {
                console.warn('クリップのduration再計算に失敗:', error);
                return clip;
              }
            }
            return clip;
          })
        );
        return { ...track, clips: updatedClips };
      })
    );
    
    setTracks(updatedTracks);
  }, [isTimeMode, tracks, audioContext, bpm]);

  // 秒数モードでの1拍あたりの秒数を変更する関数
  const handleSecondsPerBeatChange = useCallback(async (newSecondsPerBeat) => {
    setSecondsPerBeat(newSecondsPerBeat);
    
    // 秒数モードの場合、既存のクリップのdurationを再計算
    if (isTimeMode) {
      const updatedTracks = await Promise.all(
        tracks.map(async (track) => {
          const updatedClips = await Promise.all(
            track.clips.map(async (clip) => {
              if (clip.soundData && clip.soundData.audioBlob) {
                try {
                  const newDuration = await getAudioDuration(clip.soundData.audioBlob, bpm, newSecondsPerBeat);
                  return { ...clip, duration: newDuration };
                } catch (error) {
                  console.warn('クリップのduration再計算に失敗:', error);
                  return clip;
                }
              }
              return clip;
            })
          );
          return { ...track, clips: updatedClips };
        })
      );
      
      setTracks(updatedTracks);
    }
  }, [isTimeMode, tracks, getAudioDuration, bpm]);

  // スナップ処理（拍子モード vs 秒数モード）
  const getSnapPosition = useCallback((position) => {
    if (isTimeMode) {
      // 秒数モード：1拍（秒数）単位でスナップ
      const beatWidthInPixels = secondsPerBeat * PIXELS_PER_SECOND;
      const subBeatWidth = beatWidthInPixels / 2; // 半拍でスナップ
      return Math.round(position / subBeatWidth) * subBeatWidth;
    } else {
      // 拍子モード：8分音符単位でスナップ
      return Math.round(position / SUB_BEAT_WIDTH) * SUB_BEAT_WIDTH;
    }
  }, [isTimeMode, secondsPerBeat]);

  // プレイヘッドのアニメーション更新
  const updatePlayhead = useCallback(() => {
    const animate = () => {
      if (isPlaying && startPlayTime) {
        const elapsed = (Date.now() - startPlayTime) / 1000; // 経過時間（秒）
        
        let pixelsPerSecond;
        if (isTimeMode) {
          // 秒数モード：直接1秒 = PIXELS_PER_SECONDピクセル
          pixelsPerSecond = PIXELS_PER_SECOND;
        } else {
          // 拍子モード：BPMに基づいたピクセル/秒
          pixelsPerSecond = (bpm / 60) * 100;
        }
        
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
  }, [isPlaying, startPlayTime, bpm, isTimeMode]);

  useEffect(() => {
    if (isPlaying) {
      if (!startPlayTime) {
        // 再生開始時にstartPlayTimeを設定
        let pixelsPerSecond;
        if (isTimeMode) {
          pixelsPerSecond = PIXELS_PER_SECOND;
        } else {
          pixelsPerSecond = (bpm / 60) * 100;
        }
        
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
  }, [isPlaying, bpm, currentTime, isTimeMode]);

  // startPlayTimeが設定されたときにアニメーションを開始
  useEffect(() => {
    if (isPlaying && startPlayTime) {
      updatePlayhead();
    }
  }, [isPlaying, startPlayTime, updatePlayhead]);

  // BPM変更時のハンドラー
  const handleBpmChange = useCallback(async (newBpm) => {
    setBpm(newBpm);
    
    // 既存のクリップのdurationを新しいBPMで再計算
    const updatedTracks = await Promise.all(
      tracks.map(async (track) => {
        const updatedClips = await Promise.all(
          track.clips.map(async (clip) => {
            if (clip.soundData && clip.soundData.audioBlob) {
              try {
                const newDuration = await getAudioDuration(clip.soundData.audioBlob, newBpm);
                return { ...clip, duration: newDuration };
              } catch (error) {
                console.warn('クリップのduration更新に失敗:', error);
                return clip;
              }
            }
            return clip;
          })
        );
        return { ...track, clips: updatedClips };
      })
    );
    
    setTracks(updatedTracks);
  }, [tracks, getAudioDuration]);

  // プロジェクト保存機能
  const saveProject = () => {
    try {
      const projectData = {
        version: '1.0',
        bpm: bpm,
        tracks: tracks,
        sounds: sounds.map(sound => ({
          ...sound,
          audioBlob: null, // Blobは別途保存
          audioData: sound.audioData // base64データを保持
        })),
        timestamp: Date.now(),
        trackNameCounter: trackNameCounterRef.current,
        trackIdCounter: trackIdCounterRef.current,
        isTimeMode: isTimeMode,
        secondsPerBeat: secondsPerBeat
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

        // BPMを復元
        setBpm(projectData.bpm || 120);
        
        // 時間モード設定を復元
        setIsTimeMode(projectData.isTimeMode || false);
        setSecondsPerBeat(projectData.secondsPerBeat || 0.5);
        
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
            bpm: projectData.bpm || 120,
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
          const pixelsPerSecond = (bpm / 60) * 100;
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
              
              const pixelsPerSecond = (bpm / 60) * 100;
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
        
        
        // 既存クリップの移動
        const updatedClip = {
          ...draggedClip,
          startTime: snappedPosition,
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
      if (window.currentDraggedSoundBlob) {
        soundData.audioBlob = window.currentDraggedSoundBlob;
        window.currentDraggedSoundBlob = null; // クリーンアップ
      }
      
      // グローバル変数をクリア
      window.currentDraggedSound = null;
      
      
      // 音声の実際の継続時間を取得（現在のBPMに基づいて）
      let duration = 400; // デフォルト値（1小節）
      if (soundData.audioBlob) {
        try {
          duration = await getAudioDuration(soundData.audioBlob, bpm);
        } catch (error) {
          console.warn('音声継続時間の取得に失敗しました:', error);
        }
      }

      // durationが有効な値かチェック
      if (!isFinite(duration) || duration <= 0) {
        console.warn('無効なduration:', duration, 'デフォルト値を使用');
        duration = 400; // 1小節分
      }

      // 新しい音素材の場合は通常のスナップ処理
      const snappedPosition = getSnapPosition(timePosition);

      const newClip = {
        id: Date.now() + Math.random(), // より確実にユニークなIDを生成
        soundData: soundData,
        startTime: snappedPosition,
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
    
    // ボディクラスのクリーンアップ
    document.body.classList.remove('dragging');
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
    // ドロップが正常に処理されなかった場合、元の状態を保持
    if (draggedClip && e && e.dataTransfer && e.dataTransfer.dropEffect === 'none') {
    }
    
    // 完全なクリーンアップ
    cleanupDragState();
  };

  const play = async () => {
    try {
      // AudioContextが中断されている場合は再開
      if (audioContext && audioContext.state === 'suspended') {
        await audioContext.resume();
      }
      
      setIsPlaying(true);
      
      // 現在の時間位置に基づいて、再生すべきクリップを見つける
      let pixelsPerSecond;
      if (isTimeMode) {
        pixelsPerSecond = PIXELS_PER_SECOND;
      } else {
        pixelsPerSecond = (bpm / 60) * 100;
      }
      
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
            if (isFinite(delay) && delay >= 0) {
              scheduleClipPlayback(clip, delay * 1000, newPlayingAudios);
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

  const scheduleClipPlayback = (clip, delayMs, playingAudiosMap) => {
    
    if (clip.soundData && clip.soundData.audioBlob && clip.soundData.audioBlob instanceof Blob) {
      try {
        const audio = new Audio();
        const audioUrl = URL.createObjectURL(clip.soundData.audioBlob);
        audio.src = audioUrl;
        
        const timeoutId = setTimeout(() => {
          audio.play().catch(error => {
            console.error('音声再生エラー:', error);
            URL.revokeObjectURL(audioUrl); // メモリリークを防ぐ
          });
        }, delayMs);
        
        // 音声終了時にURLを解放
        audio.addEventListener('ended', () => {
          URL.revokeObjectURL(audioUrl);
        });
        
        playingAudiosMap.set(clip.id, { audio, timeoutId, audioUrl });
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
          scheduleClipPlayback(clip, delayMs, playingAudiosMap);
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
          bpm: bpm,
          tracks: tracks,
          timestamp: Date.now(),
          trackNameCounter: trackNameCounterRef.current,
          trackIdCounter: trackIdCounterRef.current,
          isTimeMode: isTimeMode,
          secondsPerBeat: secondsPerBeat
        };

        localStorage.setItem('dawProjectAutoSave', JSON.stringify(projectData));

      } catch (error) {
        console.error('プロジェクトの自動保存に失敗:', error);
      }
    };

    // 初期化後の自動保存（tracksやbpmが変更された時）
    if (tracks.length > 0) {
      autoSaveProject();
    }
  }, [tracks, bpm, isTimeMode, secondsPerBeat]);

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
      setBpm(120);
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

        {/* 下段：再生コントロール、BPM、モード設定 */}
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
            {!isTimeMode && (
              <div className="bpm-control">
                <label htmlFor="bpm">🎵 BPM:</label>
                <input
                  id="bpm"
                  type="number"
                  value={bpm}
                  onChange={(e) => handleBpmChange(parseInt(e.target.value))}
                  min="60"
                  max="200"
                  className="bpm-input"
                />
              </div>
            )}

            <div className="time-mode-control">
              <button 
                className={`time-mode-toggle ${isTimeMode ? 'active' : ''}`}
                onClick={toggleTimeMode}
                title={isTimeMode ? '拍子モードに切り替え' : '秒数モードに切り替え'}
              >
                ⏰ {isTimeMode ? '秒数モード' : '拍子モード'}
              </button>
              
              {isTimeMode && (
                <div className="seconds-per-beat-control">
                  <label htmlFor="secondsPerBeat">1拍:</label>
                  <input
                    id="secondsPerBeat"
                    type="number"
                    value={secondsPerBeat}
                    onChange={(e) => handleSecondsPerBeatChange(parseFloat(e.target.value))}
                    min="0.1"
                    max="5.0"
                    step="0.1"
                    className="seconds-input"
                  />
                  <span>秒</span>
                </div>
              )}
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
          <div className="sound-list">
            {sounds.length > 0 ? (
              sounds.map(sound => (
                <SoundItem 
                  key={sound.id} 
                  sound={sound} 
                  onDragStart={async (sound) => {
                    // ドラッグ開始時に音声の長さを計算
                    if (sound.audioBlob) {
                      try {
                        const duration = await getAudioDuration(sound.audioBlob, bpm, secondsPerBeat);
                        setDraggedSoundDuration(duration);
                      } catch (error) {
                        console.warn('ドラッグ時の音声長さ計算に失敗:', error);
                        setDraggedSoundDuration(400);
                      }
                    } else {
                      setDraggedSoundDuration(400);
                    }
                  }}
                />
              ))
            ) : (
              <div className="no-sounds">
                <p>音素材がありません</p>
                <p>「音あつめ」ページで音を録音してください</p>
              </div>
            )}
          </div>
        </div>

        <div className={`daw-workspace ${!showSoundPanel ? 'panel-hidden' : ''}`}>
          <div className="track-headers">
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

          <div className="timeline-container">
            <Timeline bpm={bpm} isTimeMode={isTimeMode} secondsPerBeat={secondsPerBeat} />
            <div 
              className="tracks-area" 
              ref={timelineRef} 
              style={{ 
                minWidth: isTimeMode 
                  ? Math.ceil(TIME_MODE_TOTAL_SECONDS / secondsPerBeat) * (secondsPerBeat * PIXELS_PER_SECOND)
                  : TOTAL_MEASURES * MEASURE_WIDTH 
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
                  isTimeMode={isTimeMode}
                  secondsPerBeat={secondsPerBeat}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="instructions card">
        <h3>📖 使い方</h3>
        <ul>
          <li><strong>🖥️ PC:</strong> 左側の音素材パネルから音素材をトラックにドラッグ&ドロップして配置</li>
          <li><strong>📱 スマホ/タブレット:</strong> 音素材を長押ししてからトラックまでドラッグして配置</li>
          <li>配置済みの音素材もドラッグして別の場所に移動できます</li>
          <li>ドラッグ中は配置予定位置に青い影が表示されます</li>
          <li><strong>⏰ 時間モード切り替え:</strong> 「拍子モード」と「秒数モード」を切り替えできます</li>
          <li><strong>拍子モード:</strong> 8分音符（裏拍含む）に合わせて音素材が自動配置され、BPMで速さを調整</li>
          <li><strong>秒数モード:</strong> 小節や拍子の概念をなくし、「何秒で1拍」という単位で音素材を配置</li>
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
            <li><strong>自動保存:</strong> トラック、BPM、時間モード設定の変更は自動的に保存されます</li>
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
    </div>
  );
};

const SoundItem = ({ sound, onDragStart }) => {
  const [isPlaying, setIsPlaying] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [touchStart, setTouchStart] = useState(null);
  const [touchMove, setTouchMove] = useState(null);

  const handleDragStart = (e) => {
    // audioBlob以外のデータをJSON文字列として設定
    const soundDataForTransfer = {
      ...sound,
      audioBlob: null // Blobは直接シリアライズできないため一時的にnullに
    };
    
    e.dataTransfer.setData('application/json', JSON.stringify(soundDataForTransfer));
    e.dataTransfer.effectAllowed = 'copy';
    
    // 実際のaudioBlobは別途グローバル変数で保持
    window.currentDraggedSoundBlob = sound.audioBlob;
    
    // 親コンポーネントのonDragStart関数を呼び出し（音声の長さを計算）
    if (onDragStart) {
      onDragStart(sound);
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
    
    // ドラッグ開始の判定（15px以上移動）- 閾値を上げてより意図的な移動のみドラッグ扱い
    const deltaX = Math.abs(currentPos.x - touchStart.x);
    const deltaY = Math.abs(currentPos.y - touchStart.y);
    
    if (!isDragging && (deltaX > 15 || deltaY > 15)) {
      setIsDragging(true);
      // スクロールを一時的に無効化（移動が確定してから）
      document.body.classList.add('dragging');
      
      // 親コンポーネントのonDragStart関数を呼び出し
      if (onDragStart) {
        onDragStart(sound);
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
    
    // SoundItem 内での直接クリーンアップ
    document.body.classList.remove('dragging');
    
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
      let audioUrl;
      
      try {
        audioUrl = URL.createObjectURL(sound.audioBlob);
        audio.src = audioUrl;
        
        audio.play()
          .then(() => {
            setIsPlaying(true);
            
            const handleEnded = () => {
              setIsPlaying(false);
              if (audioUrl) {
                URL.revokeObjectURL(audioUrl); // URLをクリーンアップ
              }
              audio.removeEventListener('ended', handleEnded);
            };
            
            audio.addEventListener('ended', handleEnded);
            
            // 音声の読み込みエラーもハンドリング
            audio.addEventListener('error', (error) => {
              console.error('音声読み込みエラー:', error);
              setIsPlaying(false);
              if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
              }
            });
          })
          .catch(error => {
            console.error('音声再生エラー:', error);
            if (audioUrl) {
              URL.revokeObjectURL(audioUrl); // エラー時もクリーンアップ
            }
            setIsPlaying(false);
          });
      } catch (error) {
        console.error('createObjectURLエラー:', error);
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
      </div>
      <div className="sound-actions">
        <button 
          className="play-sound-btn"
          onClick={playSound}
          disabled={isPlaying}
        >
          {isPlaying ? '⏸️' : '▶️'}
        </button>
      </div>
    </div>
  );
};

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

const Timeline = ({ bpm, isTimeMode, secondsPerBeat }) => {
  if (isTimeMode) {
    // 秒数モード: 1拍の秒数に基づいて表示
    const totalBeats = Math.ceil(TIME_MODE_TOTAL_SECONDS / secondsPerBeat);
    const beatWidthInPixels = secondsPerBeat * PIXELS_PER_SECOND;
    
    return (
      <div className="timeline" style={{ minWidth: totalBeats * beatWidthInPixels }}>
        {Array.from({ length: Math.ceil(totalBeats / 4) }, (_, intervalIndex) => (
          <div key={intervalIndex} className="time-interval">
            <div className="time-number">{(intervalIndex * 4 * secondsPerBeat).toFixed(1)}秒</div>
            <div className="time-marks">
              {Array.from({ length: Math.min(4, totalBeats - intervalIndex * 4) }, (_, beatIndex) => (
                <div 
                  key={beatIndex} 
                  className="time-mark"
                  style={{ width: beatWidthInPixels }}
                >
                  <div className="time-main">
                    {((intervalIndex * 4 + beatIndex + 1) * secondsPerBeat).toFixed(1)}s
                  </div>
                  <div className="time-sub">
                    <div className="sub-time-marker">・</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  } else {
    // 拍子モード: 従来の小節・拍表示
    const measures = TOTAL_MEASURES; // 16小節表示
    const beatsPerMeasure = BEATS_PER_MEASURE; // 4/4拍子

    return (
      <div className="timeline" style={{ minWidth: TOTAL_MEASURES * MEASURE_WIDTH }}>
        {Array.from({ length: measures }, (_, measureIndex) => (
          <div key={measureIndex} className="measure">
            <div className="measure-number">{measureIndex + 1}</div>
            <div className="beats">
              {Array.from({ length: beatsPerMeasure }, (_, beatIndex) => (
                <div 
                  key={beatIndex} 
                  className="beat"
                  style={{ width: BEAT_WIDTH }}
                >
                  <div className="beat-main">
                    {beatIndex + 1}
                  </div>
                  <div className="beat-sub">
                    <div className="sub-beat-marker">・</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    );
  }
};

const Track = ({ track, onDrop, onDragOver, onRemoveClip, onClipDragStart, onDragEnd, trackHeight, updateDragPreview, isTimeMode, secondsPerBeat }) => {
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
        {isTimeMode ? (
          // 秒数モード: 秒単位でグリッド線を表示
          <>
            {/* 1秒ごとの主要な境界線 */}
            {Array.from({ length: TIME_MODE_TOTAL_SECONDS }, (_, index) => (
              <div 
                key={`time-main-${index}`} 
                className={`beat-line beat-line-main ${index === 0 ? 'first-beat' : ''} ${index % 5 === 0 ? 'measure-start' : ''}`} 
                style={{ left: index * PIXELS_PER_SECOND }} 
              />
            ))}
            {/* 0.5秒ごとの副次的な境界線 */}
            {Array.from({ length: TIME_MODE_TOTAL_SECONDS * 2 }, (_, index) => {
              if (index % 2 === 1) { // 奇数のインデックス（0.5秒、1.5秒など）
                return (
                  <div 
                    key={`time-sub-${index}`} 
                    className="beat-line beat-line-sub" 
                    style={{ left: (index * PIXELS_PER_SECOND) / 2 }} 
                  />
                );
              }
              return null;
            })}
          </>
        ) : (
          // 拍子モード: 従来の拍・小節グリッド
          <>
            {/* 表拍（主要な拍）の境界線を表示 */}
            {Array.from({ length: TOTAL_BEATS }, (_, index) => {
              const isFirstBeat = index === 0;
              const isMeasureStart = index % BEATS_PER_MEASURE === 0;
              const className = `beat-line beat-line-main ${isFirstBeat ? 'first-beat' : ''} ${isMeasureStart ? 'measure-start' : ''}`;
              return (
                <div key={`main-${index}`} className={className} style={{ left: index * BEAT_WIDTH }} />
              );
            })}
            {/* 裏拍（8分音符）の境界線を表示 */}
            {Array.from({ length: TOTAL_BEATS }, (_, index) => (
              <div key={`sub-${index}`} className="beat-line beat-line-sub" style={{ left: index * BEAT_WIDTH + SUB_BEAT_WIDTH }} />
            ))}
          </>
        )}
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
