// サーバーから届く日時を表示用にそろえる。
//
// MySQL の DATETIME は「2026-05-01 10:00:00」の形で届く。
// iPad の Safari は日付と時刻の間が空白だと読めず（Invalid Date）、日付が表示されなかった。
// 「T」に置き換えるだけだと古い Safari が世界標準時として読むので、数字を取り出してこの端末の時刻として作る。
const MYSQL_DATETIME = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?$/;

export const parseServerDate = (value) => {
  if (value instanceof Date) return isNaN(value.getTime()) ? null : value;
  if (typeof value === 'string') {
    const match = value.trim().match(MYSQL_DATETIME);
    if (match) {
      const [year, month, day, hour, minute, second] = match.slice(1).map((part) => Number(part || 0));
      // new Date は 13 月や 25 時を次の年・日に繰り上げてしまうので、範囲の外は読めない値にする
      if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59 || second > 59) return null;
      const date = new Date(year, month - 1, day, hour, minute, second);
      return isNaN(date.getTime()) ? null : date;
    }
    if (!value.trim()) return null;
  } else if (typeof value !== 'number') {
    return null;
  }
  const date = new Date(value);
  return isNaN(date.getTime()) ? null : date;
};

// 「2026/5/1」の形。読めない値は空文字
export const formatDateJa = (value) => {
  const date = parseServerDate(value);
  return date ? date.toLocaleDateString('ja-JP') : '';
};

// 並べ替え用の時刻（ミリ秒）。読めない値は 0（いちばん古い扱い）。
// 2025 年 10 月の版は、録音の作成日時を文字列ではなく Date のまま IndexedDB に保存していた。
// 文字列として比べると「Thu Oct 16 2025 …」が「2026-…」より新しい扱いになり、古い音が先頭に並んでいた
export const toTimestamp = (value) => {
  const date = parseServerDate(value);
  return date ? date.getTime() : 0;
};

// 新しい順に並べる比較関数（createdAt を持つもの）
export const compareByNewest = (a, b) => toTimestamp(b && b.createdAt) - toTimestamp(a && a.createdAt);

// 保存されていた日時を ISO 形式の文字列にそろえる（Date・数値・文字列のどれでも）。読めなければ元の値のまま
export const toIsoDateString = (value) => {
  if (typeof value === 'string') return value;
  const date = parseServerDate(value);
  return date ? date.toISOString() : value;
};
