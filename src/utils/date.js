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
