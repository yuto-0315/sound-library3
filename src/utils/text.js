// 名前やタグを、画面に表示できる文字列にそろえる。
//
// サーバーや楽曲ファイルから届いた値に、数字やオブジェクトが混ざっていることがある。
// React はオブジェクトをそのまま表示できずに画面全体が止まり、検索の toLowerCase() も失敗していた。

export const toText = (value, fallback = '') => {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return fallback;
};

// 文字列のタグだけを、前後の空白を除いて重複なしで返す
export const toTagList = (value) => {
  if (!Array.isArray(value)) return [];
  const tags = [];
  value.forEach((tag) => {
    const text = toText(tag).trim();
    if (text && !tags.includes(text)) tags.push(text);
  });
  return tags;
};
