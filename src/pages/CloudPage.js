import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Calendar,
  Check,
  CircleCheck,
  DoorOpen,
  Download,
  Globe,
  Headphones,
  Inbox,
  LoaderCircle,
  LogOut,
  Play,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
  Square,
  Tags,
  User,
  Users,
  X
} from 'lucide-react';
import './CloudPage.css';
import Icon from '../components/Icon';
import { useAudioPreview } from '../hooks/useAudioPreview';
import { addRecording, getAllRecordings, isQuotaExceededError } from '../utils/indexedDB';
import {
  blobToAudioDataUrl,
  dataUrlToBlob,
  getExtensionForMimeType,
  measureAudioDuration,
  primeAudioElement,
  withDetectedMimeType
} from '../utils/audio';
import {
  API_BASE_URL,
  fetchJson,
  findRoomByNumber,
  getSavedStudentProfile,
  getUserIdentifier,
  saveStudentProfile
} from '../utils/api';
import { formatDateJa } from '../utils/date';
import { isEnterKey } from '../utils/keyboard';
import { matchesSearch, toTagList, toText } from '../utils/text';
import { formatDuration } from '../utils/timing';

const ROOM_STORAGE_KEY = 'sound-library-room';
// サーバー（api/rooms.php）と同じ決まり
const ROOM_NUMBER_PATTERN = /^[0-9]{1,6}$/;
// サーバー（api/audio.php・api/validation.php）と同じ上限
const MAX_SHARE_BYTES = 20 * 1024 * 1024;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
// 部屋にいる間は、ほかの人が共有した音を 30 秒ごとに読み込み直す
const AUTO_REFRESH_MS = 30000;

const TABS = [
  { id: 'list', label: 'みんなの音', icon: Headphones },
  { id: 'share', label: '自分の音を共有する', icon: Share2 }
];

const readSavedRoomNumber = () => {
  try {
    const saved = String(localStorage.getItem(ROOM_STORAGE_KEY) || '').trim();
    return ROOM_NUMBER_PATTERN.test(saved) ? saved : '';
  } catch (error) {
    return '';
  }
};

const saveRoomNumber = (value) => {
  try {
    if (value) localStorage.setItem(ROOM_STORAGE_KEY, value);
    else localStorage.removeItem(ROOM_STORAGE_KEY);
  } catch (error) {
    // 保存できなくても、今は部屋を使える
  }
};

// ファイル名に使えない文字を除く
const toSafeFileName = (name) => (name || 'sound').replace(/[\\/:*?"<>|]/g, '_').trim() || 'sound';

// サーバーから届いた値をそろえる（PHP 8.1 未満では数値も文字列で届く。タグが null のこともある）
const normalizeSharedFiles = (list) => (Array.isArray(list) ? list : [])
  .filter((file) => file && toText(file.uid))
  .map((file) => ({
    uid: toText(file.uid),
    name: toText(file.file_name).trim() || '名前のない音',
    studentName: toText(file.student_name).trim(),
    tags: toTagList(file.tags),
    downloadCount: Math.max(0, Number(file.download_count) || 0),
    uploadDate: formatDateJa(file.upload_date)
  }));

const byNewest = (a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || ''));

// preview: 「きく」ボタンの試し聞き。ダウンロード数（もらった人の数）に数えない
const buildDownloadUrl = (file, { preview = false } = {}) => {
  const params = new URLSearchParams({ uid: file.uid });
  if (preview) params.set('preview', '1');
  else params.set('user_id', getUserIdentifier());
  return `${API_BASE_URL}/download.php?${params}`;
};

const fetchSharedAudio = async (file, options) => {
  const response = await fetch(buildDownloadUrl(file, options));
  if (!response.ok) {
    throw new Error('音声ファイルの読み込みに失敗しました');
  }
  // サーバーの Content-Type が間違っていても中身に合わせて直す
  return withDetectedMimeType(await response.blob());
};

const releasePlayer = (player) => {
  if (!player) return;
  player.audio.onended = null;
  player.audio.onerror = null;
  try {
    player.audio.pause();
  } catch (error) {
    // 無視
  }
  if (player.url) {
    URL.revokeObjectURL(player.url);
    player.url = null;
  }
};

const CloudPage = () => {
  const [roomInput, setRoomInput] = useState(readSavedRoomNumber);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [isJoining, setIsJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [activeTab, setActiveTab] = useState('list');

  // みんなの音
  const [sharedFiles, setSharedFiles] = useState([]);
  const [pendingFiles, setPendingFiles] = useState(null);
  const [hasLoadedList, setHasLoadedList] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [listError, setListError] = useState('');
  const [listNotice, setListNotice] = useState(null);
  const [downloadingUid, setDownloadingUid] = useState(null);
  const [playback, setPlayback] = useState({ uid: null, loading: false });

  // 自分の音（音ライブラリ）
  const [soundLibrary, setSoundLibrary] = useState([]);
  const [libraryError, setLibraryError] = useState('');
  const [isUploading, setIsUploading] = useState(false);
  const [previewError, setPreviewError] = useState('');

  const isMountedRef = useRef(true);
  // 今いる部屋（共有やダウンロードの途中で部屋を出たら、前の部屋の一覧を読み込まないため）
  const currentRoomRef = useRef(null);
  const joinRequestRef = useRef(0);
  const listRequestRef = useRef(0);
  const sharedFilesRef = useRef(sharedFiles);
  sharedFilesRef.current = sharedFiles;
  const playerRef = useRef(null);
  const playRequestRef = useRef(0);
  const tabRefs = useRef({});

  const libraryPreview = useAudioPreview({
    onError: () => setPreviewError('この音はこの端末では再生できませんでした。')
  });
  const stopLibraryPreview = libraryPreview.stop;

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      // ページを離れたら再生を止める（止めないと別のページでも鳴り続ける）
      playRequestRef.current += 1;
      releasePlayer(playerRef.current);
    };
  }, []);

  // ===== みんなの音を読み込む =====
  // quiet: 自動の読み込み直し。失敗しても知らせず、新しい音が届いてもすぐには並べ替えない
  const loadSharedFiles = useCallback(async (room, { quiet = false } = {}) => {
    const requestId = ++listRequestRef.current;
    if (!quiet) setIsRefreshing(true);
    try {
      const params = new URLSearchParams({ room_id: room.id });
      const data = await fetchJson(`${API_BASE_URL}/audio.php?${params}`);
      if (requestId !== listRequestRef.current || !isMountedRef.current) return;
      if (!data.success) throw new Error(data.error || 'みんなの音を読み込めませんでした');
      const next = normalizeSharedFiles(data.data);
      const current = sharedFilesRef.current;
      const known = new Set(current.map((file) => file.uid));
      if (quiet && current.length > 0 && next.some((file) => !known.has(file.uid))) {
        // 押そうとしたボタンの位置がずれないよう、届いた音は「見る」を押してから並べる。
        // 今ある音のもらった人の数などは新しくし、消された音は除く
        const nextByUid = new Map(next.map((file) => [file.uid, file]));
        setSharedFiles(current.filter((file) => nextByUid.has(file.uid)).map((file) => nextByUid.get(file.uid)));
        setPendingFiles(next);
      } else {
        setSharedFiles(next);
        setPendingFiles(null);
      }
      setListError('');
      setHasLoadedList(true);
    } catch (error) {
      if (requestId !== listRequestRef.current || !isMountedRef.current) return;
      console.error('Load audio files error:', error);
      if (!quiet) {
        setListError('みんなの音を読み込めませんでした。インターネットにつながっているか確かめて、「最新にする」を押してください。');
        setHasLoadedList(true);
      }
    } finally {
      if (requestId === listRequestRef.current && isMountedRef.current) setIsRefreshing(false);
    }
  }, []);

  // ===== 部屋に入る =====
  const joinRoom = async (value, { auto = false } = {}) => {
    const number = String(value === undefined || value === null ? '' : value).trim();
    if (!ROOM_NUMBER_PATTERN.test(number)) {
      setJoinError('部屋番号は数字で入れてください（例: 101）');
      return;
    }
    const requestId = ++joinRequestRef.current;
    setIsJoining(true);
    setJoinError('');
    try {
      const data = await fetchJson(`${API_BASE_URL}/rooms.php`);
      if (requestId !== joinRequestRef.current || !isMountedRef.current) return;
      if (!data.success) {
        setJoinError(data.error || '部屋の情報を読み込めませんでした');
        return;
      }
      const room = findRoomByNumber(data.data, number);
      if (!room) {
        if (auto) saveRoomNumber('');
        setJoinError(auto
          ? `前に入っていた部屋 ${number} が見つかりませんでした。先生に部屋番号を確かめてください。`
          : `部屋 ${number} が見つかりません。先生に部屋番号を確かめてください。`);
        return;
      }
      saveRoomNumber(number);
      setSharedFiles([]);
      setPendingFiles(null);
      setHasLoadedList(false);
      setListError('');
      setListNotice(null);
      setActiveTab('list');
      const joined = { ...room, room_number: toText(room.room_number, number), room_name: toText(room.room_name) };
      currentRoomRef.current = joined;
      setCurrentRoom(joined);
      await loadSharedFiles(joined);
    } catch (error) {
      if (requestId !== joinRequestRef.current || !isMountedRef.current) return;
      console.error('Room join error:', error);
      setJoinError('サーバーに接続できませんでした。インターネットにつながっているか確かめてください。');
    } finally {
      if (requestId === joinRequestRef.current && isMountedRef.current) setIsJoining(false);
    }
  };

  // 前回の部屋に自動で入る
  useEffect(() => {
    const saved = readSavedRoomNumber();
    if (saved) joinRoom(saved, { auto: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 部屋にいる間は、ときどき読み込み直す（画面が隠れている間はしない）
  useEffect(() => {
    if (!currentRoom) return undefined;
    const refresh = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      loadSharedFiles(currentRoom, { quiet: true });
    };
    const timer = setInterval(refresh, AUTO_REFRESH_MS);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [currentRoom, loadSharedFiles]);

  // 音ライブラリの音（IndexedDB）を読み込む
  useEffect(() => {
    let cancelled = false;
    getAllRecordings()
      .then((sounds) => {
        if (!cancelled) setSoundLibrary(sounds);
      })
      .catch((error) => {
        console.error('音ライブラリの読み込みに失敗:', error);
        if (!cancelled) setLibraryError('音ライブラリを読み込めませんでした。ページを再読み込みしてください。');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const libraryUids = useMemo(
    () => new Set(soundLibrary.map((sound) => sound.cloudUid).filter(Boolean)),
    [soundLibrary]
  );

  // ===== みんなの音をきく =====
  // 再生は 1 つの <audio> を使い回す（iOS はタップ中に一度再生した要素でないと再生を許可しない）
  const getPlayer = () => {
    if (!playerRef.current) {
      const audio = new Audio();
      audio.preload = 'auto';
      audio.playsInline = true;
      playerRef.current = { audio, url: null };
    }
    return playerRef.current;
  };

  const stopSharedPlayback = useCallback(() => {
    playRequestRef.current += 1;
    releasePlayer(playerRef.current);
    setPlayback({ uid: null, loading: false });
  }, []);

  const toggleSharedPlayback = async (file) => {
    if (playback.uid === file.uid) {
      stopSharedPlayback();
      return;
    }
    stopSharedPlayback();
    stopLibraryPreview();
    setListNotice(null);

    const player = getPlayer();
    const requestId = playRequestRef.current;
    // ダウンロードを待つとタップ操作の扱いが切れるので、先に要素の再生許可を取っておく
    primeAudioElement(player.audio);
    setPlayback({ uid: file.uid, loading: true });

    try {
      const audioBlob = await fetchSharedAudio(file, { preview: true });
      if (requestId !== playRequestRef.current) return; // 途中で別の操作をした

      const audioUrl = URL.createObjectURL(audioBlob);
      player.url = audioUrl;
      player.audio.onended = () => {
        if (requestId === playRequestRef.current) stopSharedPlayback();
      };
      player.audio.onerror = () => {
        if (requestId !== playRequestRef.current) return;
        console.error('CloudPage: Audio error:', player.audio.error);
        setListNotice({ type: 'error', text: `「${file.name}」はこの端末では再生できませんでした` });
        stopSharedPlayback();
      };
      player.audio.src = audioUrl;
      await player.audio.play();
      if (requestId === playRequestRef.current) setPlayback({ uid: file.uid, loading: false });
    } catch (error) {
      if (requestId !== playRequestRef.current) return;
      console.error('Play audio error:', error);
      setListNotice({ type: 'error', text: '音を再生できませんでした。もう一度ためしてください。' });
      stopSharedPlayback();
    }
  };

  const toggleLibraryPreview = (sound) => {
    stopSharedPlayback();
    setPreviewError('');
    libraryPreview.toggle(sound.id, sound.audioData);
  };

  // ===== みんなの音を音ライブラリに入れる =====
  const addToLibrary = async (file) => {
    if (downloadingUid || libraryUids.has(file.uid)) return;
    const room = currentRoomRef.current;
    setDownloadingUid(file.uid);
    setListNotice(null);
    try {
      const audioBlob = await fetchSharedAudio(file);
      const record = {
        name: file.name,
        audioData: await blobToAudioDataUrl(audioBlob),
        tags: file.tags,
        createdAt: new Date().toISOString(),
        source: 'cloud-download',
        cloudUid: file.uid
      };
      // 長さが分かれば一緒に保存する（音ライブラリと音楽づくりに表示する）
      const duration = await measureAudioDuration(audioBlob);
      if (duration) record.duration = duration;

      // IndexedDB に保存（以前は容量の小さい localStorage に保存していて、すぐ失敗していた）
      const id = await addRecording(record);
      if (!isMountedRef.current) return;
      setSoundLibrary((prev) => [...prev, { ...record, id }]);
      setListNotice({ type: 'success', text: `「${file.name}」を音ライブラリに入れました。音楽づくりで使えます。` });
      // もらった人の数を新しくする
      if (room && currentRoomRef.current === room) loadSharedFiles(room, { quiet: true });
    } catch (error) {
      console.error('Download error:', error);
      if (!isMountedRef.current) return;
      setListNotice({
        type: 'error',
        text: isQuotaExceededError(error)
          ? '保存できる容量が足りません。音ライブラリで使わない音を削除してください。'
          : `「${file.name}」を音ライブラリに入れられませんでした。もう一度ためしてください。`
      });
    } finally {
      if (isMountedRef.current) setDownloadingUid(null);
    }
  };

  // ===== 自分の音を共有する =====
  const shareSound = async (sound, { name, studentName, tags }) => {
    const room = currentRoomRef.current;
    if (!room || isUploading) return { ok: false, error: '' };
    let audioBlob;
    try {
      // 中身に合った形式・拡張子で送る（以前は mp4 でも「.wav」として送っていたため、
      // 共有された音が iPad で再生できなかった）
      audioBlob = dataUrlToBlob(sound.audioData);
    } catch (error) {
      console.error('音声データの変換に失敗:', error);
      return { ok: false, error: 'この音のデータがこわれているため、共有できません' };
    }
    if (!audioBlob || !audioBlob.size) {
      return { ok: false, error: 'この音のデータがこわれているため、共有できません' };
    }
    if (audioBlob.size > MAX_SHARE_BYTES) {
      return { ok: false, error: `この音はファイルが大きすぎて共有できません（${MAX_SHARE_BYTES / 1024 / 1024}MB まで）` };
    }

    const finalName = name.trim() || sound.name || '名前のない音';
    const formData = new FormData();
    formData.append('audio_file', audioBlob, `${toSafeFileName(finalName)}.${getExtensionForMimeType(audioBlob.type)}`);
    formData.append('room_id', room.id);
    formData.append('file_name', finalName);
    formData.append('student_name', studentName.trim());
    formData.append('tags', JSON.stringify(tags));
    // 毎回入力しなくてよいように、この端末に覚えておく（「先生に送る」と共通）
    saveStudentProfile({ studentName });

    setIsUploading(true);
    try {
      const data = await fetchJson(`${API_BASE_URL}/audio.php`, { method: 'POST', body: formData });
      if (!data.success) return { ok: false, error: data.error || '共有できませんでした' };
      if (isMountedRef.current && currentRoomRef.current === room) loadSharedFiles(room);
      return { ok: true, name: finalName };
    } catch (error) {
      console.error('Upload error:', error);
      return { ok: false, error: error.message || '共有できませんでした' };
    } finally {
      if (isMountedRef.current) setIsUploading(false);
    }
  };

  // ===== 部屋から出る・タブ =====
  const leaveRoom = () => {
    stopSharedPlayback();
    stopLibraryPreview();
    // 入る途中・読み込み途中の結果は使わない（「入っています...」のまま止まらないように、ここで戻す）
    joinRequestRef.current += 1;
    listRequestRef.current += 1;
    currentRoomRef.current = null;
    setIsJoining(false);
    setCurrentRoom(null);
    setSharedFiles([]);
    setPendingFiles(null);
    setHasLoadedList(false);
    setIsRefreshing(false);
    setListError('');
    setListNotice(null);
    setActiveTab('list');
    setRoomInput('');
    setJoinError('');
    saveRoomNumber('');
  };

  const selectTab = (id, { focus = false } = {}) => {
    if (id !== activeTab) {
      // 見えなくなる側の再生は止める
      stopSharedPlayback();
      stopLibraryPreview();
    }
    setActiveTab(id);
    if (focus && tabRefs.current[id]) tabRefs.current[id].focus();
  };

  // タブの矢印キー操作（WAI-ARIA のタブのパターン）
  const handleTabKeyDown = (event, index) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % TABS.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + TABS.length) % TABS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TABS.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    selectTab(TABS[nextIndex].id, { focus: true });
  };

  if (!currentRoom) {
    return (
      <div className="cloud-page page-container">
        <header className="page-header">
          <h2><Icon icon={Globe} /> みんなで共有</h2>
          <p>先生に教えてもらった部屋番号を入れると、クラスのみんなと音を聞かせ合えます。</p>
        </header>

        <form
          className="card cloud-join-card"
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            joinRoom(roomInput);
          }}
        >
          <label htmlFor="room-number" className="field-label"><Icon icon={DoorOpen} /> 部屋番号</label>
          <input
            id="room-number"
            className="text-field cloud-room-input"
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete="off"
            maxLength={6}
            enterKeyHint="go"
            placeholder="例: 101"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            aria-describedby="room-number-help"
            aria-invalid={joinError ? 'true' : undefined}
          />
          <p id="room-number-help" className="field-help">数字で入れてください。次からは自動で入ります。</p>
          <button type="submit" disabled={isJoining} className="button-primary button-large cloud-join-button">
            {isJoining ? <><Icon icon={LoaderCircle} className="icon-spin" /> 入っています...</> : <><Icon icon={DoorOpen} /> 部屋に入る</>}
          </button>
          {joinError && <div className="error-message" role="alert">{joinError}</div>}
        </form>
      </div>
    );
  }

  return (
    <div className="cloud-page page-container">
      <header className="page-header cloud-header">
        <div>
          <h2><Icon icon={Globe} /> みんなで共有</h2>
          <p>みんなが共有した音を聞いて音ライブラリに入れたり、自分の音を共有したりできます。</p>
        </div>
        <div className="cloud-room-badge">
          <span className="cloud-room-name">
            <Icon icon={DoorOpen} /> 部屋 <strong>{currentRoom.room_number}</strong>
            {currentRoom.room_name && <span className="cloud-room-subname">（{currentRoom.room_name}）</span>}
          </span>
          <button type="button" onClick={leaveRoom} className="button-ghost cloud-leave-button">
            <Icon icon={LogOut} /> 部屋を出る
          </button>
        </div>
      </header>

      <div className="cloud-tabs" role="tablist" aria-label="みんなで共有">
        {TABS.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[tab.id] = element; }}
            type="button"
            role="tab"
            id={`cloud-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`cloud-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`cloud-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => selectTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <Icon icon={tab.icon} /> {tab.label}
            {tab.id === 'list' && hasLoadedList && <span className="cloud-tab-count">{sharedFiles.length}</span>}
          </button>
        ))}
      </div>

      <SharedSoundsPanel
        hidden={activeTab !== 'list'}
        files={sharedFiles}
        pendingFiles={pendingFiles}
        onShowPending={() => {
          setSharedFiles(pendingFiles);
          setPendingFiles(null);
        }}
        hasLoaded={hasLoadedList}
        isRefreshing={isRefreshing}
        error={listError}
        notice={listNotice}
        onDismissNotice={() => setListNotice(null)}
        onRefresh={() => loadSharedFiles(currentRoom)}
        libraryUids={libraryUids}
        downloadingUid={downloadingUid}
        onAdd={addToLibrary}
        playback={playback}
        onTogglePlay={toggleSharedPlayback}
        onGoShare={() => selectTab('share', { focus: true })}
      />

      <ShareSoundPanel
        hidden={activeTab !== 'share'}
        sounds={soundLibrary}
        libraryError={libraryError}
        previewError={previewError}
        previewId={libraryPreview.playingId}
        onTogglePreview={toggleLibraryPreview}
        isUploading={isUploading}
        onShare={shareSound}
        onShowList={() => selectTab('list', { focus: true })}
      />
    </div>
  );
};

// ===== みんなの音 =====

const SharedSoundsPanel = ({
  hidden,
  files,
  pendingFiles,
  onShowPending,
  hasLoaded,
  isRefreshing,
  error,
  notice,
  onDismissNotice,
  onRefresh,
  libraryUids,
  downloadingUid,
  onAdd,
  playback,
  onTogglePlay,
  onGoShare
}) => {
  const [query, setQuery] = useState('');
  const [selectedTag, setSelectedTag] = useState('');

  const tags = useMemo(() => [...new Set(files.flatMap((file) => file.tags))], [files]);
  useEffect(() => {
    if (selectedTag && !tags.includes(selectedTag)) setSelectedTag('');
  }, [tags, selectedTag]);

  const visibleFiles = useMemo(() => files.filter((file) => (
    (!selectedTag || file.tags.includes(selectedTag)) &&
    // ひらがな・カタカナ、全角・半角を区別せずに、名前・タグ・つくった人で探す
    matchesSearch(query, file.name, file.studentName, file.tags)
  )), [files, selectedTag, query]);

  const isFiltered = !!(selectedTag || query.trim());
  const newCount = pendingFiles
    ? pendingFiles.filter((file) => !files.some((current) => current.uid === file.uid)).length
    : 0;

  return (
    <section
      className="cloud-panel"
      role="tabpanel"
      id="cloud-panel-list"
      aria-labelledby="cloud-tab-list"
      hidden={hidden}
    >
      <div className="cloud-toolbar card">
        <div className="cloud-search">
          <label htmlFor="cloud-list-search" className="field-label"><Icon icon={Search} /> みんなの音を探す</label>
          <input
            id="cloud-list-search"
            type="search"
            className="text-field"
            placeholder="音の名前・タグ・つくった人で検索..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            enterKeyHint="search"
          />
        </div>
        <button type="button" className="button-secondary cloud-refresh-button" onClick={onRefresh} disabled={isRefreshing}>
          <Icon icon={RefreshCw} className={isRefreshing ? 'icon-spin' : undefined} /> {isRefreshing ? '読み込み中...' : '最新にする'}
        </button>
        {tags.length > 0 && (
          <div className="cloud-tag-filter" role="group" aria-labelledby="cloud-list-tags-label">
            <span id="cloud-list-tags-label" className="field-label"><Icon icon={Tags} /> タグで絞り込み</span>
            <div className="chip-list">
              <button type="button" className="chip" aria-pressed={selectedTag === ''} onClick={() => setSelectedTag('')}>
                すべて
              </button>
              {tags.map((tag) => (
                <button
                  key={tag}
                  type="button"
                  className="chip"
                  aria-pressed={selectedTag === tag}
                  onClick={() => setSelectedTag(selectedTag === tag ? '' : tag)}
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {newCount > 0 && (
        <button type="button" className="cloud-new-banner" onClick={onShowPending}>
          <Icon icon={Sparkles} /> 新しい音が {newCount} こ届きました。ここを押すと表示します
        </button>
      )}

      <div className="cloud-status-region" role="status" aria-live="polite">
        {notice && notice.type === 'success' && (
          <p className="notice notice-success cloud-notice">
            <Icon icon={CircleCheck} /> <span className="cloud-notice-text">{notice.text}</span>
            <button type="button" className="cloud-notice-close" onClick={onDismissNotice} aria-label="メッセージを閉じる">
              <Icon icon={X} />
            </button>
          </p>
        )}
      </div>
      {notice && notice.type === 'error' && (
        <div className="error-message cloud-notice" role="alert">
          <span className="cloud-notice-text">{notice.text}</span>
          <button type="button" className="cloud-notice-close" onClick={onDismissNotice} aria-label="メッセージを閉じる">
            <Icon icon={X} />
          </button>
        </div>
      )}
      {error && <div className="error-message" role="alert">{error}</div>}

      {!hasLoaded ? (
        <p className="cloud-loading" role="status">読み込み中...</p>
      ) : files.length === 0 ? (
        !error && (
          <div className="empty-state cloud-empty">
            <p><Icon icon={Inbox} /> まだだれも音を共有していません</p>
            <p>最初の音を共有してみましょう！</p>
            <button type="button" className="button-primary" onClick={onGoShare}>
              <Icon icon={Share2} /> 自分の音を共有する
            </button>
          </div>
        )
      ) : visibleFiles.length === 0 ? (
        <div className="empty-state cloud-empty">
          <p><Icon icon={Search} /> 見つかりませんでした</p>
          <p>別のことばやタグで探してみてください</p>
        </div>
      ) : (
        <>
          {isFiltered && (
            <p className="cloud-count">{visibleFiles.length} こ見つかりました（全部で {files.length} こ）</p>
          )}
          <ul className="cloud-sound-grid">
            {visibleFiles.map((file) => (
              <SharedSoundCard
                key={file.uid}
                file={file}
                isInLibrary={libraryUids.has(file.uid)}
                isDownloading={downloadingUid === file.uid}
                isBusy={!!downloadingUid}
                playState={playback.uid === file.uid ? (playback.loading ? 'loading' : 'playing') : 'stopped'}
                onTogglePlay={() => onTogglePlay(file)}
                onAdd={() => onAdd(file)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  );
};

const SharedSoundCard = ({ file, isInLibrary, isDownloading, isBusy, playState, onTogglePlay, onAdd }) => {
  const isActive = playState !== 'stopped';
  let addLabel = `「${file.name}」を音ライブラリに入れる`;
  let addContent = <><Icon icon={Download} /> 音ライブラリに入れる</>;
  if (isInLibrary) {
    addLabel = `「${file.name}」は音ライブラリに入っています`;
    addContent = <><Icon icon={Check} /> 音ライブラリに入っています</>;
  } else if (isDownloading) {
    addLabel = `「${file.name}」を音ライブラリに入れています`;
    addContent = <><Icon icon={LoaderCircle} className="icon-spin" /> 入れています...</>;
  }

  return (
    <li className="cloud-sound-card">
      <div className="cloud-sound-main">
        <button
          type="button"
          className={`cloud-play-button ${isActive ? 'playing' : ''}`}
          onClick={onTogglePlay}
          aria-label={isActive ? `${file.name}を止める` : `${file.name}をきく`}
        >
          {playState === 'loading'
            ? <Icon icon={LoaderCircle} className="icon-spin" size={24} />
            : <Icon icon={isActive ? Square : Play} fill="currentColor" size={24} />}
        </button>
        <div className="cloud-sound-body">
          <h4>{file.name}</h4>
          <p className="cloud-sound-meta">
            {file.studentName && <span><Icon icon={User} /> {file.studentName}</span>}
            {file.uploadDate && <span><Icon icon={Calendar} /> {file.uploadDate}</span>}
            {file.downloadCount > 0 && <span><Icon icon={Users} /> {file.downloadCount}人がもらいました</span>}
          </p>
          {file.tags.length > 0 && (
            <ul className="cloud-tags" aria-label="タグ">
              {file.tags.map((tag) => <li key={tag} className="tag-label">{tag}</li>)}
            </ul>
          )}
        </div>
      </div>
      <button
        type="button"
        className={`cloud-add-button ${isInLibrary ? 'button-secondary added' : 'button-primary'}`}
        onClick={onAdd}
        disabled={isInLibrary || isBusy}
        aria-label={addLabel}
      >
        {addContent}
      </button>
    </li>
  );
};

// ===== 自分の音を共有する =====

const ShareSoundPanel = ({
  hidden,
  sounds,
  libraryError,
  previewError,
  previewId,
  onTogglePreview,
  isUploading,
  onShare,
  onShowList
}) => {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(null);
  const [name, setName] = useState('');
  const [studentName, setStudentName] = useState(() => getSavedStudentProfile().studentName);
  const [tags, setTags] = useState([]);
  const [newTag, setNewTag] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const sortedSounds = useMemo(() => [...sounds].sort(byNewest), [sounds]);
  const visibleSounds = useMemo(
    () => sortedSounds.filter((sound) => matchesSearch(query, sound.name, sound.tags || [])),
    [sortedSounds, query]
  );
  const selectedSound = sounds.find((sound) => sound.id === selectedId) || null;

  const selectSound = (sound) => {
    setSelectedId(sound.id);
    // 音ライブラリでつけた名前とタグを、そのまま共有できるように入れておく
    setName(toText(sound.name));
    setTags(toTagList(sound.tags).filter((tag) => tag.length <= MAX_TAG_LENGTH).slice(0, MAX_TAGS));
    setError('');
    setMessage('');
  };

  const addTag = () => {
    const tag = newTag.trim();
    if (!tag) return;
    if (!tags.includes(tag)) {
      if (tags.length >= MAX_TAGS) {
        setError(`タグは ${MAX_TAGS} こまでです`);
        return;
      }
      setTags((prev) => [...prev, tag]);
    }
    setNewTag('');
  };

  const submit = async (event) => {
    event.preventDefault();
    if (isUploading) return;
    setMessage('');
    if (!selectedSound) {
      setError('共有する音をえらんでください');
      return;
    }
    setError('');
    const result = await onShare(selectedSound, { name, studentName, tags });
    if (result.ok) {
      setMessage(`「${result.name}」をみんなに共有しました！`);
      setSelectedId(null);
      setName('');
      setTags([]);
      setNewTag('');
    } else if (result.error) {
      setError(result.error);
    }
  };

  // 入力欄で Enter を押しても送らない（iPad の日本語入力の確定や「改行」で、うっかり共有されないように）。
  // 共有は「みんなに共有する」ボタンだけで行う
  const preventEnterSubmit = (event) => {
    if (isEnterKey(event)) event.preventDefault();
  };

  return (
    <section
      className="cloud-panel"
      role="tabpanel"
      id="cloud-panel-share"
      aria-labelledby="cloud-tab-share"
      hidden={hidden}
    >
      <form className="cloud-share-form" onSubmit={submit} noValidate>
        <div className="cloud-share-layout">
          <section className="card cloud-step" aria-labelledby="cloud-step-pick">
            <h3 id="cloud-step-pick" className="cloud-step-title">
              <span className="cloud-step-number" aria-hidden="true">1</span> 共有する音をえらぶ
            </h3>
            {libraryError && <div className="error-message" role="alert">{libraryError}</div>}
            {previewError && <div className="error-message" role="alert">{previewError}</div>}
            {sounds.length === 0 ? (
              !libraryError && (
                <div className="empty-state cloud-empty">
                  <p><Icon icon={Inbox} /> 共有できる音がまだありません</p>
                  <a href="#/collection" className="button-primary">音あつめで録音する</a>
                </div>
              )
            ) : (
              <>
                <label htmlFor="cloud-picker-search" className="sr-only">自分の音を探す</label>
                <input
                  id="cloud-picker-search"
                  type="search"
                  className="text-field cloud-picker-search"
                  placeholder="自分の音を探す..."
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={preventEnterSubmit}
                  enterKeyHint="search"
                />
                {visibleSounds.length === 0 ? (
                  <p className="cloud-picker-none">見つかりませんでした</p>
                ) : (
                  <div className="cloud-picker-list" role="radiogroup" aria-labelledby="cloud-step-pick">
                    {visibleSounds.map((sound) => {
                      const checked = sound.id === selectedId;
                      const playing = previewId === sound.id;
                      const durationText = formatDuration(sound.duration);
                      const soundTags = sound.tags || [];
                      return (
                        <div key={sound.id} className={`cloud-picker-item ${checked ? 'selected' : ''}`}>
                          <button
                            type="button"
                            className={`cloud-mini-play ${playing ? 'playing' : ''}`}
                            onClick={() => onTogglePreview(sound)}
                            aria-label={playing ? `${sound.name}を止める` : `${sound.name}をきく`}
                          >
                            <Icon icon={playing ? Square : Play} fill="currentColor" />
                          </button>
                          <label className="cloud-picker-label">
                            <input
                              type="radio"
                              name="cloud-share-sound"
                              value={String(sound.id)}
                              checked={checked}
                              onChange={() => selectSound(sound)}
                              onKeyDown={preventEnterSubmit}
                            />
                            <span className="cloud-picker-text">
                              <span className="cloud-picker-name">{sound.name}</span>
                              {(durationText || soundTags.length > 0) && (
                                <span className="cloud-picker-meta">
                                  {[durationText, ...soundTags].filter(Boolean).join('・')}
                                </span>
                              )}
                            </span>
                          </label>
                        </div>
                      );
                    })}
                  </div>
                )}
              </>
            )}
          </section>

          <section className="card cloud-step" aria-labelledby="cloud-step-details">
            <h3 id="cloud-step-details" className="cloud-step-title">
              <span className="cloud-step-number" aria-hidden="true">2</span> 名前とタグをたしかめる
            </h3>
            <div className="cloud-field">
              <label htmlFor="cloud-share-name" className="field-label">共有するときの音の名前</label>
              <input
                id="cloud-share-name"
                type="text"
                className="text-field"
                maxLength={50}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={preventEnterSubmit}
                enterKeyHint="next"
                placeholder={selectedSound ? selectedSound.name : '音をえらぶと名前が入ります'}
              />
            </div>
            <div className="cloud-field">
              <label htmlFor="cloud-student-name" className="field-label">
                <Icon icon={User} /> あなたの名前（書かなくてもよい）
              </label>
              <input
                id="cloud-student-name"
                type="text"
                className="text-field"
                maxLength={30}
                autoComplete="off"
                value={studentName}
                onChange={(e) => setStudentName(e.target.value)}
                onKeyDown={preventEnterSubmit}
                enterKeyHint="next"
                aria-describedby="cloud-student-name-help"
              />
              <p id="cloud-student-name-help" className="field-help">この端末に覚えておきます。</p>
            </div>
            <div className="cloud-field">
              <label htmlFor="cloud-share-tag" className="field-label"><Icon icon={Tags} /> タグ</label>
              {tags.length > 0 && (
                <ul className="cloud-tags cloud-tags-editable" aria-label="付けるタグ">
                  {tags.map((tag) => (
                    <li key={tag} className="tag-label">
                      {tag}
                      <button
                        type="button"
                        className="cloud-tag-remove"
                        onClick={() => setTags((prev) => prev.filter((item) => item !== tag))}
                        aria-label={`タグ「${tag}」を外す`}
                      >
                        <Icon icon={X} size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="cloud-tag-row">
                <input
                  id="cloud-share-tag"
                  type="text"
                  className="text-field"
                  maxLength={MAX_TAG_LENGTH}
                  value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => {
                    if (isEnterKey(e)) {
                      e.preventDefault();
                      addTag();
                    }
                  }}
                  placeholder="タグを入れて「追加」"
                  enterKeyHint="enter"
                />
                <button type="button" className="button-secondary" onClick={addTag} disabled={!newTag.trim()}>
                  <Icon icon={Plus} /> 追加
                </button>
              </div>
            </div>

            <div className="cloud-share-submit">
              <p className="cloud-share-summary">
                {selectedSound
                  ? <>えらんだ音: <strong>{name.trim() || selectedSound.name}</strong></>
                  : 'まだ音をえらんでいません'}
              </p>
              <button type="submit" className="button-primary button-large cloud-share-button" disabled={isUploading}>
                {isUploading
                  ? <><Icon icon={LoaderCircle} className="icon-spin" /> 共有しています...</>
                  : <><Icon icon={Share2} /> みんなに共有する</>}
              </button>
              {error && <div className="error-message" role="alert">{error}</div>}
              <div className="cloud-status-region" role="status" aria-live="polite">
                {message && (
                  <div className="notice notice-success cloud-share-done">
                    <Icon icon={CircleCheck} />
                    <span className="cloud-notice-text">{message}</span>
                    <button type="button" className="button-secondary" onClick={onShowList}>
                      <Icon icon={Headphones} /> みんなの音を見る
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>
        </div>
      </form>
    </section>
  );
};

export default CloudPage;
