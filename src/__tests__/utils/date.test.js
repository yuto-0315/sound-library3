import { compareByNewest, formatDateJa, parseServerDate, toIsoDateString, toTimestamp } from '../../utils/date';

describe('parseServerDate', () => {
  test('MySQL の「日付 時刻」をこの端末の時刻として読む（Safari は空白区切りを読めない）', () => {
    const date = parseServerDate('2026-05-01 10:20:30');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(4);
    expect(date.getDate()).toBe(1);
    expect(date.getHours()).toBe(10);
    expect(date.getMinutes()).toBe(20);
    expect(date.getSeconds()).toBe(30);
  });

  test('日付だけ・T 区切り・秒なしも読める', () => {
    expect(parseServerDate('2026-05-01').getDate()).toBe(1);
    expect(parseServerDate('2026-05-01T08:05').getHours()).toBe(8);
    expect(parseServerDate(' 2026-12-31 23:59:59 ').getMonth()).toBe(11);
  });

  test('ISO 形式（この端末で作った日時）や数値はそのまま読む', () => {
    expect(parseServerDate('2026-04-01T00:00:00.000Z').getTime()).toBe(Date.UTC(2026, 3, 1));
    expect(parseServerDate(Date.UTC(2026, 0, 2)).getTime()).toBe(Date.UTC(2026, 0, 2));
    const now = new Date();
    expect(parseServerDate(now)).toBe(now);
  });

  test('読めない値は null', () => {
    [null, undefined, '', '   ', 'あした', {}, [], NaN, new Date('x'), '2026-13-45 99:99:99'].forEach((value) => {
      const result = parseServerDate(value);
      expect(result === null || !isNaN(result.getTime())).toBe(true);
    });
    expect(parseServerDate(null)).toBeNull();
    expect(parseServerDate('')).toBeNull();
    expect(parseServerDate('あした')).toBeNull();
    expect(parseServerDate({})).toBeNull();
    expect(parseServerDate(new Date('x'))).toBeNull();
    // 13 月や 25 時を次の年・日に繰り上げない
    expect(parseServerDate('2026-13-45 99:99:99')).toBeNull();
    expect(parseServerDate('2026-05-01 24:00:00')).toBeNull();
  });
});

describe('formatDateJa', () => {
  test('日本の日付の形で返し、読めなければ空文字', () => {
    expect(formatDateJa('2026-05-01 10:00:00')).toBe(new Date(2026, 4, 1).toLocaleDateString('ja-JP'));
    expect(formatDateJa('壊れた値')).toBe('');
    expect(formatDateJa(undefined)).toBe('');
  });
});

describe('並べ替え用の時刻（以前の版が Date のまま保存した作成日時も）', () => {
  test('文字列・Date・数値の時刻を比べられ、読めない値は 0', () => {
    expect(toTimestamp('2026-04-01T00:00:00Z')).toBe(Date.UTC(2026, 3, 1));
    expect(toTimestamp(new Date(Date.UTC(2025, 9, 16)))).toBe(Date.UTC(2025, 9, 16));
    expect(toTimestamp(Date.UTC(2025, 0, 1))).toBe(Date.UTC(2025, 0, 1));
    expect(toTimestamp(undefined)).toBe(0);
    expect(toTimestamp('こわれた値')).toBe(0);
  });

  test('新しい順: Date で保存された古い音が先頭に来ない', () => {
    const sounds = [
      { name: '2025 年の音（Date）', createdAt: new Date(Date.UTC(2025, 9, 16)) },
      { name: '2026 年 4 月', createdAt: '2026-04-01T00:00:00.000Z' },
      { name: '日時なし' },
      { name: '2026 年 5 月', createdAt: '2026-05-01T00:00:00Z' }
    ];
    expect([...sounds].sort(compareByNewest).map((s) => s.name)).toEqual(['2026 年 5 月', '2026 年 4 月', '2025 年の音（Date）', '日時なし']);
  });

  test('ISO 形式の文字列にそろえる', () => {
    expect(toIsoDateString(new Date(Date.UTC(2025, 9, 16)))).toBe('2025-10-16T00:00:00.000Z');
    expect(toIsoDateString('2026-04-01T00:00:00Z')).toBe('2026-04-01T00:00:00Z');
    expect(toIsoDateString(Date.UTC(2025, 0, 1))).toBe('2025-01-01T00:00:00.000Z');
    expect(toIsoDateString(undefined)).toBeUndefined();
  });
});
