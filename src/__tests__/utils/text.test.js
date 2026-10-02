import { matchesSearch, normalizeForSearch, normalizeRoomNumberInput, toHalfWidth, toTagList, toText } from '../../utils/text';

describe('toText / toTagList', () => {
  test('文字列と数字だけを文字にする', () => {
    expect(toText('あめ')).toBe('あめ');
    expect(toText(12)).toBe('12');
    expect(toText({ a: 1 }, 'なし')).toBe('なし');
    expect(toText(null)).toBe('');
    expect(toText(NaN, 'x')).toBe('x');
  });

  test('タグは文字列だけを、前後の空白を除いて重複なしで返す', () => {
    expect(toTagList([' 楽器 ', '楽器', 3, {}, null, ''])).toEqual(['楽器', '3']);
    expect(toTagList('楽器')).toEqual([]);
  });
});

describe('検索', () => {
  test('カタカナ・ひらがな、全角・半角、大文字・小文字を区別しない', () => {
    expect(normalizeForSearch('アメノオト')).toBe('あめのおと');
    expect(normalizeForSearch('ﾄﾞｱ')).toBe('どあ');
    expect(normalizeForSearch('ＡＢＣ')).toBe('abc');
    expect(matchesSearch('アメ', 'あめの音')).toBe(true);
    expect(matchesSearch('ﾄﾞｱ', 'ドアのしまる音')).toBe(true);
    expect(matchesSearch('しぜん', 'みずの音', ['シゼン'])).toBe(true);
  });

  test('何も入れていなければすべて当てはまる。当てはまらなければ false', () => {
    expect(matchesSearch('  ', 'たいこ')).toBe(true);
    expect(matchesSearch('すず', 'たいこ', ['楽器'])).toBe(false);
  });
});

describe('全角を半角に（iPad の日本語入力）', () => {
  test('全角の数字・英字・記号を半角にする', () => {
    expect(toHalfWidth('１０１')).toBe('101');
    expect(toHalfWidth('ＡＢＣ！')).toBe('ABC!');
    expect(toHalfWidth(undefined)).toBe('');
  });

  test('部屋番号の入力欄は、全角の数字を半角にして数字だけ残す', () => {
    expect(normalizeRoomNumberInput('１０１')).toBe('101');
    expect(normalizeRoomNumberInput(' 1a0２ ')).toBe('102');
    expect(normalizeRoomNumberInput('いち')).toBe('');
  });
});
