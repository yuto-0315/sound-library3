// サーバー API 呼び出しの共通処理

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
