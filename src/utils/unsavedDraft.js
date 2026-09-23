// 保存する前にほかのページへ移動しても録音を失わないよう、アプリを開いている間だけ覚えておく。
// （ページを再読み込みしたり閉じたりすると消える）
let unsavedDraft = null;

export const keepUnsavedDraft = (draft) => {
  unsavedDraft = draft;
};

// 覚えていた録音を取り出す（取り出したら消える）
export const takeUnsavedDraft = () => {
  const draft = unsavedDraft;
  unsavedDraft = null;
  return draft;
};

export const hasUnsavedDraft = () => unsavedDraft !== null;
