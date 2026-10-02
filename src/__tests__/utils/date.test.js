import { formatDateJa, parseServerDate } from '../../utils/date';

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
