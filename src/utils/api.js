// サーバー API 呼び出しの共通処理

// API の置き場所。本番（https://sound-library.redosila.com）はドメイン直下の api/ に置いている。
// 以前はページごとに '/api' と '../api' が混ざっていたので、ここで 1 つにまとめる。
// 別の場所に置くときはビルド時に指定する（例: REACT_APP_API_BASE_URL=https://example.com/sound-library3/api npm run build）。
// 開発サーバー（npm start）では src/setupProxy.js が /api を XAMPP に中継する。
export const API_BASE_URL = (process.env.REACT_APP_API_BASE_URL || '/api').replace(/\/+$/, '');

// PHP の警告などで JSON 以外が返ってきても、分かりやすいエラーにする
export const fetchJson = async (url, options) => {
  const response = await fetch(url, options);
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch (error) {
    console.error('JSON ではない応答:', url, text.slice(0, 200));
    if (response.status === 413) {
      throw new Error('データが大きすぎてサーバーに送れませんでした');
    }
    throw new Error(response.ok
      ? 'サーバーから正しい応答がありませんでした'
      : `サーバーエラーが発生しました (HTTP ${response.status})`);
  }
  if (!data || typeof data !== 'object') {
    throw new Error('サーバーから正しい応答がありませんでした');
  }
  return data;
};

// PHP 8.1 未満では数値の列も文字列で返るため、型をそろえて比較する
export const findRoomByNumber = (rooms, roomNumber) => {
  const target = Number(String(roomNumber === undefined || roomNumber === null ? '' : roomNumber).trim());
  if (!isFinite(target) || String(roomNumber).trim() === '') return null;
  return (rooms || []).find(room => Number(room.room_number) === target) || null;
};

// ダウンロード数を「1 人 1 回」と数えるための端末ごとの ID
export const getUserIdentifier = () => {
  let identifier = null;
  try {
    identifier = localStorage.getItem('user-identifier');
  } catch (error) {
    // プライベートモードなど
  }
  if (!identifier) {
    identifier = 'user_' + Math.random().toString(36).slice(2, 11);
    try {
      localStorage.setItem('user-identifier', identifier);
    } catch (error) {
      // 保存できなくても動作は続ける
    }
  }
  return identifier;
};
