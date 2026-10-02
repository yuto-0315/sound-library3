import { useCallback, useEffect, useRef, useState } from 'react';

// 一覧の「▶ きく」ボタン用の再生。
// <audio controls> を音ごとに並べると、iPad では再生ボタンが小さく押しにくく、たくさん並ぶと重くなる。
// 1 つの <audio> を使い回す（iOS はタップの中で一度再生した要素なら、次からも再生を許可する）。
export const useAudioPreview = ({ onError } = {}) => {
  const audioRef = useRef(null);
  const playingIdRef = useRef(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const [playingId, setPlayingId] = useState(null);

  const setPlaying = (id) => {
    playingIdRef.current = id;
    setPlayingId(id);
  };

  const stop = useCallback(() => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch (error) {
        // 無視
      }
    }
    setPlaying(null);
  }, []);

  const toggle = useCallback((id, src) => {
    if (playingIdRef.current === id) {
      stop();
      return;
    }
    if (!src) return;
    let audio = audioRef.current;
    if (!audio) {
      audio = new Audio();
      audio.preload = 'auto';
      audio.playsInline = true;
      audioRef.current = audio;
    }
    stop();
    audio.onended = () => {
      if (playingIdRef.current === id) setPlaying(null);
    };
    audio.onerror = () => {
      if (playingIdRef.current !== id) return;
      setPlaying(null);
      if (onErrorRef.current) onErrorRef.current(id);
    };
    audio.src = src;
    setPlaying(id);
    try {
      const result = audio.play();
      if (result && typeof result.catch === 'function') {
        result.catch((error) => {
          if (playingIdRef.current !== id) return;
          console.warn('音を再生できませんでした:', error);
          setPlaying(null);
          if (onErrorRef.current) onErrorRef.current(id);
        });
      }
    } catch (error) {
      setPlaying(null);
      if (onErrorRef.current) onErrorRef.current(id);
    }
  }, [stop]);

  // ページを離れたら止める（止めないと別のページでも鳴り続ける）
  useEffect(() => () => {
    const audio = audioRef.current;
    if (audio) {
      audio.onended = null;
      audio.onerror = null;
      try {
        audio.pause();
      } catch (error) {
        // 無視
      }
    }
  }, []);

  return { playingId, toggle, stop };
};

export default useAudioPreview;
