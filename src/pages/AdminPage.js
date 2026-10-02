import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DoorOpen, FileAudio, KeyRound, Music, Piano, Plus, RefreshCw, School, Trash2, TriangleAlert, CircleCheck } from 'lucide-react';
import './AdminPage.css';
import Icon from '../components/Icon';
import { saveSongData } from '../utils/indexedDB';
import { API_BASE_URL, fetchJson } from '../utils/api';
import { normalizeRoomNumberInput, toHalfWidth, toTagList, toText } from '../utils/text';
import { formatDateJa } from '../utils/date';

// 先生用の暗証番号（サーバーで設定しているときだけ必要。タブを閉じると忘れる）
const ADMIN_PIN_KEY = 'sound-library-admin-pin';

// 暗証番号は半角の英数字・記号だけ。ブラウザは日本語や全角の文字を HTTP ヘッダーで送れず、
// 以前は「さくら」などを入力すると、部屋の一覧も含めてすべての読み込みが失敗していた
const SENDABLE_PIN = /^[\x21-\x7E]+$/;
const normalizePin = (value) => toHalfWidth(value).trim();
const isSendablePin = (value) => SENDABLE_PIN.test(value);

const readStoredPin = () => {
  try {
    const stored = sessionStorage.getItem(ADMIN_PIN_KEY) || '';
    return isSendablePin(stored) ? stored : '';
  } catch (error) {
    return '';
  }
};

const storePin = (pin) => {
  try {
    if (pin) sessionStorage.setItem(ADMIN_PIN_KEY, pin);
    else sessionStorage.removeItem(ADMIN_PIN_KEY);
  } catch (error) {
    // 保存できなくても、このページを開いている間は使える
  }
};

// サーバーから届いた値に数字やオブジェクトが混ざっていても表示できるようにする
const normalizeAudioFile = (file) => ({
  ...file,
  file_name: toText(file.file_name, '名前のない音'),
  student_name: toText(file.student_name),
  tags: toTagList(file.tags)
});

const normalizeSong = (song) => ({
  ...song,
  song_title: toText(song.song_title, '名前のない曲'),
  student_name: toText(song.student_name),
  group_number: toText(song.group_number)
});

// サーバーの日時（「2026-05-01 10:00:00」）は Safari の new Date では読めないので、共通の関数で読む
const formatDate = formatDateJa;

const formatSize = (bytes) => {
  const size = Number(bytes) || 0;
  if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(size / 1024))}KB`;
};

const TABS = [
  { id: 'rooms', label: '部屋の管理', icon: School },
  { id: 'songs', label: '生徒の楽曲', icon: Music, needsRoom: true },
  { id: 'audio', label: '共有された音', icon: FileAudio, needsRoom: true }
];

const AdminPage = () => {
  const [rooms, setRooms] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [audioFiles, setAudioFiles] = useState([]);
  const [songs, setSongs] = useState([]);
  // 読み込めなかったときは「まだありません」ではなく、読み込めなかったと出す
  const [songsFailed, setSongsFailed] = useState(false);
  const [audioFailed, setAudioFailed] = useState(false);
  // サーバーの暗証番号の設定: 'off' | 'on' | 'invalid' | null（分からない・古いサーバー）
  const [pinStatus, setPinStatus] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState('rooms');
  const [pin, setPin] = useState(readStoredPin);
  const [pinInput, setPinInput] = useState(readStoredPin);
  const pinRef = useRef(pin);
  pinRef.current = pin;
  const tabRefs = useRef({});

  // 新規部屋作成用
  const [newRoom, setNewRoom] = useState({
    room_number: '',
    room_name: '',
    teacher_name: ''
  });

  // 暗証番号はサーバーで設定しているときだけ確認される（設定していなければ送っても無視される）
  const request = useCallback((path, options = {}) => {
    const headers = { ...(options.headers || {}) };
    if (pinRef.current && isSendablePin(pinRef.current)) headers['X-Admin-Pin'] = pinRef.current;
    return fetchJson(`${API_BASE_URL}/${path}`, { ...options, headers });
  }, []);

  const showResultError = (data, fallback) => {
    setError(data && data.error ? data.error : fallback);
  };

  const begin = () => {
    setError('');
    setMessage('');
  };

  // 部屋一覧を読み込み
  const loadRooms = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await request('rooms.php');
      if (data.success) {
        setRooms(Array.isArray(data.data) ? data.data : []);
      } else if (data.error && !pinRef.current) {
        // 部屋の一覧は暗証番号が必要（サーバーで設定しているとき）
        setError(`${data.error}。右上の「先生用の暗証番号」に入力してください。`);
      } else {
        setError(data.error || '部屋一覧の読み込みに失敗しました');
      }
    } catch (err) {
      setError('部屋一覧の読み込みに失敗しました');
      console.error('Load rooms error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [request]);

  // 暗証番号を入れ直したら、部屋の一覧も読み込み直す
  useEffect(() => {
    loadRooms();
  }, [loadRooms, pin]);

  // 暗証番号が設定されていなければ、先生に知らせる（誰でも部屋を削除できる状態のため）
  useEffect(() => {
    let cancelled = false;
    fetchJson(`${API_BASE_URL}/admin_status.php`)
      .then((data) => {
        if (!cancelled && data && data.success && data.data) setPinStatus(data.data.pin || null);
      })
      .catch(() => {
        // 古いサーバーには無い。表示しないだけ
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const savePin = (event) => {
    event.preventDefault();
    const value = normalizePin(pinInput);
    if (value && !isSendablePin(value)) {
      setMessage('');
      setError('暗証番号は半角の英数字・記号で入力してください（日本語や空白は使えません）。');
      return;
    }
    storePin(value);
    setPin(value);
    setPinInput(value);
    setError('');
    setMessage(value ? '暗証番号を入力しました。' : '暗証番号を消しました。');
  };

  // 新しい部屋を作成
  const createRoom = async (e) => {
    e.preventDefault();
    begin();
    setIsLoading(true);
    try {
      const data = await request('rooms.php', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newRoom)
      });
      if (data.success) {
        setNewRoom({ room_number: '', room_name: '', teacher_name: '' });
        await loadRooms();
        setMessage(`部屋 ${data.data && data.data.room_number ? data.data.room_number : ''} を作成しました。`);
      } else {
        showResultError(data, '部屋の作成に失敗しました');
      }
    } catch (err) {
      setError('部屋の作成に失敗しました');
      console.error('Create room error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 部屋削除
  const deleteRoom = async (room) => {
    if (!window.confirm(`部屋 ${room.room_number}（${room.room_name || ''}）を削除しますか？\n\nこの部屋に共有された音と生徒の楽曲も、すべて削除されます。`)) {
      return;
    }
    begin();
    setIsLoading(true);
    try {
      const data = await request(`rooms.php?id=${encodeURIComponent(room.id)}`, { method: 'DELETE' });
      if (data.success) {
        await loadRooms();
        if (selectedRoom && selectedRoom.id === room.id) {
          setSelectedRoom(null);
          setAudioFiles([]);
          setSongs([]);
          setActiveTab('rooms');
        }
        setMessage(`部屋 ${room.room_number} を削除しました。`);
      } else {
        showResultError(data, '部屋の削除に失敗しました');
      }
    } catch (err) {
      setError('部屋の削除に失敗しました');
      console.error('Delete room error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  // 部屋を開く（生徒の楽曲と共有された音を読み込む）
  // keepTab: 「読み込み直す」のときは、見ていたタブのままにする
  const selectRoom = async (room, { keepTab = false } = {}) => {
    begin();
    setSelectedRoom(room);
    if (!keepTab) setActiveTab('songs');
    setIsLoading(true);
    const problems = [];

    // 片方の読み込みに失敗しても、もう片方は表示する
    // （以前は楽曲の読み込みに失敗すると、読み込めていた音の一覧まで消していた）
    try {
      const songsData = await request(`songs.php?room_id=${encodeURIComponent(room.id)}`);
      if (songsData.success) {
        setSongs((songsData.data || []).map(normalizeSong));
        setSongsFailed(false);
      } else {
        setSongs([]);
        setSongsFailed(true);
        problems.push(`生徒の楽曲を読み込めませんでした（${songsData.error || '原因不明'}）`);
      }
    } catch (err) {
      console.error('Load songs error:', err);
      setSongs([]);
      setSongsFailed(true);
      problems.push(`生徒の楽曲を読み込めませんでした（${err.message}）`);
    }

    try {
      // サーバーは部屋の ID と部屋番号の両方を確かめる
      const params = new URLSearchParams({ room_id: room.id, room_number: room.room_number });
      const audioData = await request(`audio.php?${params}`);
      if (audioData.success) {
        setAudioFiles((audioData.data || []).map(normalizeAudioFile));
        setAudioFailed(false);
      } else {
        setAudioFiles([]);
        setAudioFailed(true);
        problems.push(`共有された音を読み込めませんでした（${audioData.error || '原因不明'}）`);
      }
    } catch (err) {
      console.error('Load audio error:', err);
      setAudioFiles([]);
      setAudioFailed(true);
      problems.push(`共有された音を読み込めませんでした（${err.message}）`);
    }

    if (problems.length > 0) setError(problems.join(' / '));
    setIsLoading(false);
  };

  // 音声ファイル削除
  const deleteAudioFile = async (audioFile) => {
    if (!window.confirm(`「${audioFile.file_name}」を削除しますか？`)) {
      return;
    }
    begin();
    try {
      const data = await request(`audio.php?uid=${encodeURIComponent(audioFile.uid)}`, { method: 'DELETE' });
      if (data.success) {
        setAudioFiles((prev) => prev.filter((file) => file.uid !== audioFile.uid));
        setMessage(`「${audioFile.file_name}」を削除しました。`);
      } else {
        showResultError(data, '音声ファイルの削除に失敗しました');
      }
    } catch (err) {
      setError('音声ファイルの削除に失敗しました');
      console.error('Delete audio error:', err);
    }
  };

  // 楽曲削除
  const deleteSong = async (song) => {
    if (!window.confirm(`「${song.song_title}」を削除しますか？`)) {
      return;
    }
    begin();
    try {
      const data = await request(`songs.php?uid=${encodeURIComponent(song.uid)}`, { method: 'DELETE' });
      if (data.success) {
        setSongs((prev) => prev.filter((item) => item.uid !== song.uid));
        setMessage(`「${song.song_title}」を削除しました。`);
      } else {
        showResultError(data, '楽曲の削除に失敗しました');
      }
    } catch (err) {
      setError('楽曲の削除に失敗しました');
      console.error('Delete song error:', err);
    }
  };

  // 楽曲再現（音楽づくりページで開く）
  const openSongInDAW = async (song) => {
    begin();
    // iPad の Safari は、タップ直後以外の window.open をポップアップとしてブロックする。
    // データの取得を待つ前に空のタブを開いておき、準備ができたらそのタブで音楽づくりを表示する。
    const dawUrl = `${window.location.origin}${window.location.pathname}${window.location.search}#/daw`;
    let newWindow = null;
    try {
      newWindow = window.open('', '_blank');
      if (newWindow && newWindow.document) {
        newWindow.document.title = '読み込み中...';
        newWindow.document.body.textContent = '楽曲を読み込んでいます...';
      }
    } catch (openError) {
      newWindow = null;
    }

    try {
      // 一覧には楽曲データを含めない（大きいため）。1 曲ずつ取得する
      let songData = song.song_data;
      if (song.data_omitted || !songData) {
        const result = await request(`songs.php?uid=${encodeURIComponent(song.uid)}`);
        if (!result.success) {
          throw new Error(result.error || '楽曲データの取得に失敗しました');
        }
        songData = result.data && result.data.song_data;
      }

      if (!songData || !Array.isArray(songData.tracks)) {
        throw new Error('楽曲データが壊れています');
      }

      // IndexedDB に保存（音楽づくりページが開いたときに読み込む）
      await saveSongData(songData);

      if (newWindow && !newWindow.closed) {
        newWindow.location.href = dawUrl;
      } else {
        // タブを開けなかった場合は、このタブで音楽づくりページを開く
        window.location.href = dawUrl;
      }
    } catch (openError) {
      console.error('Failed to save song data:', openError);
      if (newWindow && !newWindow.closed) newWindow.close();
      setError(`「${song.song_title}」を開けませんでした。${openError.message}`);
    }
  };

  // タブの矢印キー操作（WAI-ARIA のタブのパターン）
  const availableTabs = TABS.filter((tab) => !tab.needsRoom || selectedRoom);
  const handleTabKeyDown = (event, index) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % availableTabs.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + availableTabs.length) % availableTabs.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = availableTabs.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    const next = availableTabs[nextIndex];
    setActiveTab(next.id);
    if (tabRefs.current[next.id]) tabRefs.current[next.id].focus();
  };

  // 読み込めなかったときは数を出さない（「(0)」だと、送られた楽曲が無いように見える）
  const tabCounts = { songs: songsFailed ? null : songs.length, audio: audioFailed ? null : audioFiles.length };

  return (
    <div className="admin-page page-container">
      <header className="page-header admin-header">
        <div>
          <h2><Icon icon={School} /> 先生用管理ページ</h2>
          <p>部屋の作成と、生徒が送った楽曲・共有した音の確認ができます。</p>
        </div>
        <form className="admin-pin-form" onSubmit={savePin}>
          <label htmlFor="admin-pin" className="field-label">
            <Icon icon={KeyRound} /> 先生用の暗証番号
          </label>
          <div className="admin-pin-row">
            <input
              id="admin-pin"
              type="password"
              className="text-field"
              value={pinInput}
              onChange={(e) => setPinInput(e.target.value)}
              autoComplete="off"
              aria-describedby="admin-pin-help"
            />
            <button type="submit" className="button-secondary">入力</button>
          </div>
          <p id="admin-pin-help" className="field-help">
            サーバーで暗証番号を設定しているときに入力します（{pin ? '入力済み' : '未入力'}）。
          </p>
        </form>
      </header>

      {pinStatus === 'off' && (
        <p className="notice notice-warning admin-pin-status">
          <Icon icon={TriangleAlert} />
          <span>
            暗証番号が設定されていません。このページの URL を知っている人は、だれでも部屋や音・楽曲を削除できます。
            設定のしかたは SETUP.md の「先生用ページの暗証番号」を見てください。
          </span>
        </p>
      )}
      {pinStatus === 'invalid' && (
        <div className="error-message" role="alert">
          サーバーの暗証番号の設定が正しくありません。半角の英数字・記号で 6 文字以上にしてください（SETUP.md）。
        </div>
      )}

      {error && (
        <div className="error-message" role="alert">{error}</div>
      )}
      <div className="admin-message-region" role="status" aria-live="polite">
        {message && (
          <p className="notice notice-success"><Icon icon={CircleCheck} /> {message}</p>
        )}
      </div>

      {selectedRoom && (
        <div className="admin-selected-room">
          <Icon icon={DoorOpen} />
          <span>開いている部屋: <strong>部屋 {selectedRoom.room_number}</strong> {selectedRoom.room_name}</span>
          <button type="button" className="button-ghost" onClick={() => selectRoom(selectedRoom, { keepTab: true })}>
            <Icon icon={RefreshCw} /> 読み込み直す
          </button>
        </div>
      )}

      <div className="admin-tabs" role="tablist" aria-label="管理する内容">
        {availableTabs.map((tab, index) => (
          <button
            key={tab.id}
            ref={(element) => { tabRefs.current[tab.id] = element; }}
            type="button"
            role="tab"
            id={`admin-tab-${tab.id}`}
            aria-selected={activeTab === tab.id}
            aria-controls={`admin-panel-${tab.id}`}
            tabIndex={activeTab === tab.id ? 0 : -1}
            className={`admin-tab ${activeTab === tab.id ? 'active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
            onKeyDown={(event) => handleTabKeyDown(event, index)}
          >
            <Icon icon={tab.icon} /> {tab.label}
            {tab.needsRoom && tabCounts[tab.id] !== null && <span className="admin-tab-count">({tabCounts[tab.id]})</span>}
          </button>
        ))}
      </div>

      {activeTab === 'rooms' && (
        <section className="admin-panel" role="tabpanel" id="admin-panel-rooms" aria-labelledby="admin-tab-rooms">
          <section className="card create-room-section" aria-labelledby="create-room-title">
            <h3 id="create-room-title"><Icon icon={Plus} /> 新しい部屋を作成</h3>
            <form onSubmit={createRoom} className="create-room-form">
              <div className="form-row">
                <div className="form-group">
                  <label htmlFor="room-number" className="field-label">部屋番号 *</label>
                  <input
                    id="room-number"
                    className="text-field"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]*"
                    maxLength={6}
                    value={newRoom.room_number}
                    onChange={(e) => setNewRoom((prev) => ({ ...prev, room_number: normalizeRoomNumberInput(e.target.value) }))}
                    placeholder="例: 101"
                    aria-describedby="room-number-help"
                    required
                  />
                  <p id="room-number-help" className="field-help">
                    生徒が部屋に入るときの番号です。クラスの外の人に推測されにくい番号（例: 6 けた）がおすすめです。
                  </p>
                </div>

                <div className="form-group">
                  <label htmlFor="room-name" className="field-label">部屋名</label>
                  <input
                    id="room-name"
                    className="text-field"
                    type="text"
                    maxLength={255}
                    value={newRoom.room_name}
                    onChange={(e) => setNewRoom((prev) => ({ ...prev, room_name: e.target.value }))}
                    placeholder="例: 1年1組"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="teacher-name" className="field-label">先生名</label>
                  <input
                    id="teacher-name"
                    className="text-field"
                    type="text"
                    maxLength={255}
                    value={newRoom.teacher_name}
                    onChange={(e) => setNewRoom((prev) => ({ ...prev, teacher_name: e.target.value }))}
                    placeholder="あなたの名前"
                  />
                </div>
              </div>

              <button type="submit" disabled={isLoading || !newRoom.room_number} className="button-primary">
                <Icon icon={Plus} /> {isLoading ? '作成中...' : '部屋を作成'}
              </button>
            </form>
          </section>

          <section className="rooms-list-section" aria-labelledby="rooms-list-title">
            <h3 id="rooms-list-title" className="section-title">部屋の一覧（{rooms.length}件）</h3>
            {rooms.length === 0 ? (
              <p className="empty-state">部屋がありません</p>
            ) : (
              <ul className="rooms-grid">
                {rooms.map((room) => (
                  <li key={room.id} className={`room-card ${selectedRoom && selectedRoom.id === room.id ? 'selected' : ''}`}>
                    <div className="room-info">
                      <h4>部屋 {room.room_number}</h4>
                      <p className="room-name">{toText(room.room_name)}</p>
                      {room.teacher_name && <p>担当: {toText(room.teacher_name)}</p>}
                      <p className="room-date">作成日: {formatDate(room.created_at)}</p>
                    </div>
                    <div className="room-actions">
                      <button
                        type="button"
                        onClick={() => selectRoom(room)}
                        className="button-primary"
                        aria-label={`部屋 ${room.room_number} を開く`}
                      >
                        <Icon icon={DoorOpen} /> 開く
                      </button>
                      <button
                        type="button"
                        onClick={() => deleteRoom(room)}
                        className="button-danger"
                        aria-label={`部屋 ${room.room_number} を削除`}
                      >
                        <Icon icon={Trash2} /> 削除
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </section>
      )}

      {activeTab === 'songs' && selectedRoom && (
        <section className="admin-panel songs-section" role="tabpanel" id="admin-panel-songs" aria-labelledby="admin-tab-songs">
          {songsFailed ? (
            <p className="empty-state">生徒の楽曲を読み込めませんでした。上の「読み込み直す」を押してください。</p>
          ) : songs.length === 0 ? (
            <p className="empty-state">この部屋に送られた楽曲はまだありません</p>
          ) : (
            <ul className="admin-list songs-list">
              {songs.map((song) => (
                <li key={song.uid || song.id} className="admin-list-item song-item">
                  <div className="song-info">
                    <h4>{song.song_title}</h4>
                    <div className="item-details">
                      {song.student_name && <span>作った人: {song.student_name}</span>}
                      {song.group_number && <span>班: {song.group_number}</span>}
                      {song.song_data_size > 0 && <span>大きさ: {formatSize(song.song_data_size)}</span>}
                      <span>送った日: {formatDate(song.created_at)}</span>
                    </div>
                  </div>
                  <div className="item-actions">
                    <button
                      type="button"
                      onClick={() => openSongInDAW(song)}
                      className="button-primary"
                      aria-label={`「${song.song_title}」を音楽づくりで開く`}
                    >
                      <Icon icon={Piano} /> 音楽づくりで開く
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSong(song)}
                      className="button-danger"
                      aria-label={`「${song.song_title}」を削除`}
                    >
                      <Icon icon={Trash2} /> 削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {activeTab === 'audio' && selectedRoom && (
        <section className="admin-panel audio-section" role="tabpanel" id="admin-panel-audio" aria-labelledby="admin-tab-audio">
          {audioFailed ? (
            <p className="empty-state">共有された音を読み込めませんでした。上の「読み込み直す」を押してください。</p>
          ) : audioFiles.length === 0 ? (
            <p className="empty-state">この部屋に共有された音はまだありません</p>
          ) : (
            <ul className="admin-list audio-list">
              {audioFiles.map((audioFile) => (
                <li key={audioFile.uid || audioFile.id} className="admin-list-item audio-item">
                  <div className="audio-info">
                    <h4>{audioFile.file_name}</h4>
                    <div className="item-details">
                      {audioFile.student_name && <span>共有した人: {audioFile.student_name}</span>}
                      <span>大きさ: {formatSize(audioFile.file_size)}</span>
                      <span>ダウンロード数: {Number(audioFile.download_count) || 0}</span>
                      <span>共有した日: {formatDate(audioFile.upload_date)}</span>
                    </div>
                    {audioFile.tags.length > 0 && (
                      <div className="item-tags">
                        {audioFile.tags.map((tag) => (
                          <span key={tag} className="tag-label">{tag}</span>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="item-actions">
                    {/* preload="none": 一覧を開いただけで全ファイルをダウンロードし、ダウンロード数が増えてしまうのを防ぐ */}
                    <audio
                      controls
                      preload="none"
                      src={`${API_BASE_URL}/download.php?uid=${encodeURIComponent(audioFile.uid)}&preview=1`}
                      aria-label={`${audioFile.file_name}を再生`}
                    >
                      <track kind="captions" label="音声キャプション" />
                      お使いのブラウザは音声の再生に対応していません
                    </audio>
                    <button
                      type="button"
                      onClick={() => deleteAudioFile(audioFile)}
                      className="button-danger"
                      aria-label={`「${audioFile.file_name}」を削除`}
                    >
                      <Icon icon={Trash2} /> 削除
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {isLoading && (
        <div className="loading-overlay" role="status">
          <div className="loading-spinner">読み込み中...</div>
        </div>
      )}

      {!error && rooms.length === 0 && !isLoading && (
        <p className="admin-hint"><Icon icon={TriangleAlert} /> 部屋が無いと、生徒は「みんなで共有」や「先生に送る」を使えません。</p>
      )}
    </div>
  );
};

export default AdminPage;
