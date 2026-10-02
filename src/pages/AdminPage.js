import React, { useCallback, useEffect, useRef, useState } from 'react';
import { DoorOpen, FileAudio, KeyRound, Music, Piano, Plus, RefreshCw, School, Trash2, TriangleAlert, CircleCheck } from 'lucide-react';
import './AdminPage.css';
import Icon from '../components/Icon';
import { saveSongData } from '../utils/indexedDB';
import { API_BASE_URL, fetchJson } from '../utils/api';
import { toTagList, toText } from '../utils/text';

// 先生用の暗証番号（サーバーで設定しているときだけ必要。タブを閉じると忘れる）
const ADMIN_PIN_KEY = 'sound-library-admin-pin';

const readStoredPin = () => {
  try {
    return sessionStorage.getItem(ADMIN_PIN_KEY) || '';
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

const formatDate = (value) => {
  const date = new Date(value);
  return isNaN(date.getTime()) ? '' : date.toLocaleDateString('ja-JP');
};

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
    if (pinRef.current) headers['X-Admin-Pin'] = pinRef.current;
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

  useEffect(() => {
    loadRooms();
  }, [loadRooms]);

  const savePin = (event) => {
    event.preventDefault();
    const value = pinInput.trim();
    storePin(value);
    setPin(value);
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
  const selectRoom = async (room) => {
    begin();
    setSelectedRoom(room);
    setActiveTab('songs');
    setIsLoading(true);
    const problems = [];

    // 片方の読み込みに失敗しても、もう片方は表示する
    // （以前は楽曲の読み込みに失敗すると、読み込めていた音の一覧まで消していた）
    try {
      const songsData = await request(`songs.php?room_id=${encodeURIComponent(room.id)}`);
      if (songsData.success) {
        setSongs((songsData.data || []).map(normalizeSong));
      } else {
        setSongs([]);
        problems.push(`生徒の楽曲を読み込めませんでした（${songsData.error || '原因不明'}）`);
      }
    } catch (err) {
      console.error('Load songs error:', err);
      setSongs([]);
      problems.push(`生徒の楽曲を読み込めませんでした（${err.message}）`);
    }

    try {
      const audioData = await request(`audio.php?room_id=${encodeURIComponent(room.id)}`);
      if (audioData.success) {
        setAudioFiles((audioData.data || []).map(normalizeAudioFile));
      } else {
        setAudioFiles([]);
        problems.push(`共有された音を読み込めませんでした（${audioData.error || '原因不明'}）`);
      }
    } catch (err) {
      console.error('Load audio error:', err);
      setAudioFiles([]);
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

  const tabCounts = { songs: songs.length, audio: audioFiles.length };

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
          <button type="button" className="button-ghost" onClick={() => selectRoom(selectedRoom)}>
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
            {tab.needsRoom && <span className="admin-tab-count">({tabCounts[tab.id]})</span>}
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
                    onChange={(e) => setNewRoom((prev) => ({ ...prev, room_number: e.target.value.replace(/[^0-9]/g, '') }))}
                    placeholder="例: 101"
                    required
                  />
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
          {songs.length === 0 ? (
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
          {audioFiles.length === 0 ? (
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
                      src={`${API_BASE_URL}/download.php?uid=${encodeURIComponent(audioFile.uid)}&user_id=teacher-admin`}
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
