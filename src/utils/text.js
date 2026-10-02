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

// 検索用にそろえる: 全角・半角（ＡＢＣ→abc、ｶﾀｶﾅ→カタカナ）、大文字・小文字、カタカナ・ひらがなを区別しない。
// （「アメ」で「あめの音」が、「ﾄﾞｱ」で「ドアの音」が見つかるように）
export const normalizeForSearch = (value) => {
  let text = toText(value);
  if (typeof text.normalize === 'function') text = text.normalize('NFKC');
  return text
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (char) => String.fromCharCode(char.charCodeAt(0) - 0x60));
};

export const matchesSearch = (query, ...fields) => {
  const needle = normalizeForSearch(query).trim();
  if (!needle) return true;
  return fields.flat().some((field) => normalizeForSearch(field).includes(needle));
};
