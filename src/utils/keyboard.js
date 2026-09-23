// 日本語入力の「変換確定」の Enter かどうか。
// これを無視しないと、変換途中の文字でタグが追加されてしまう。
// (Safari は確定時に keyCode 229 を送る)
export const isImeComposing = (event) =>
  !!(event && ((event.nativeEvent && event.nativeEvent.isComposing) || event.isComposing || event.keyCode === 229));

// IME 変換中を除いた Enter キーの押下か
export const isEnterKey = (event) => event.key === 'Enter' && !isImeComposing(event);
