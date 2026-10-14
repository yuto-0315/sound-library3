// 日本語入力の「変換確定」の Enter かどうか。
// これを無視しないと、変換途中の文字でタグが追加されてしまう。
// (Safari は確定時に keyCode 229 を送る)
export const isImeComposing = (event) =>
  !!(event && ((event.nativeEvent && event.nativeEvent.isComposing) || event.isComposing || event.keyCode === 229));

// IME 変換中を除いた Enter キーの押下か
export const isEnterKey = (event) => event.key === 'Enter' && !isImeComposing(event);

// Enter で次の入力欄へ移る（日本語入力の確定の Enter は除く）。最後の欄ではキーボードを閉じる。
// iPad のキーボードの「次へ」「改行」を押しただけでフォームが送られないように、送るのはボタンだけにする
// （以前は「先生に送る」で曲名を入れて「次へ」を押すと、名前も班も無いまま送られていた）
const NOT_TEXT_INPUT_TYPES = ['hidden', 'radio', 'checkbox', 'submit', 'button', 'reset', 'file', 'image', 'range', 'color'];

export const focusNextFieldOnEnter = (event) => {
  if (!isEnterKey(event)) return;
  event.preventDefault();
  const current = event.currentTarget;
  const form = current && current.form;
  if (!form) return;
  const fields = Array.from(form.elements).filter((element) => (
    element.tagName === 'INPUT' &&
    !element.disabled &&
    element.tabIndex !== -1 &&
    !NOT_TEXT_INPUT_TYPES.includes(element.type)
  ));
  const next = fields[fields.indexOf(current) + 1];
  if (next) next.focus();
  else if (typeof current.blur === 'function') current.blur();
};
