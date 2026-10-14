import React from 'react';
import {
  BookOpen,
  Copy,
  FolderOpen,
  GripVertical,
  Headphones,
  History,
  Keyboard,
  Play,
  Plus,
  Redo2,
  Save,
  Send,
  Square,
  TabletSmartphone,
  Trash2,
  Undo2,
  Volume2,
  X
} from 'lucide-react';
import Icon from '../Icon';
import Modal from '../Modal';
import MetronomeIcon from '../icons/MetronomeIcon';

// 「使い方」（以前はページのいちばん下にあり、画面いっぱいの表示では見えなくなるので、ダイアログにした）
const HelpDialog = ({ onClose }) => (
  <Modal titleId="daw-help-title" onClose={onClose} className="modal-dialog-wide">
    <div className="modal-header">
      <h3 id="daw-help-title"><Icon icon={BookOpen} /> 音楽づくりの使い方</h3>
      <button type="button" className="modal-close-btn" onClick={onClose} aria-label="使い方を閉じる">
        <Icon icon={X} />
      </button>
    </div>

    <div className="modal-body daw-help">
      <section>
        <h4>音をならべる</h4>
        <ul>
          <li><Icon icon={GripVertical} /> 左の「音素材」を、トラック（横に長い列）までドラッグして置きます。iPad では指で横にすべらせるか、左はしのつまみを持って動かします。</li>
          <li><Icon icon={Plus} /> 音素材の「＋」を押すと、選んでいるトラックの<strong>再生位置</strong>に置かれ、再生位置はその音の後ろに進みます。続けて押すと、音が順番に並びます。</li>
          <li>置いた音は、ドラッグで別の場所・別のトラックに動かせます。</li>
          <li>音をタップして選ぶと、上に<strong>「きく」「複製」「削除」</strong>のボタンが出ます。<Icon icon={Copy} /> 複製を続けて押すと、同じ音をくり返せます。</li>
          <li><Icon icon={Undo2} /> 元に戻す / <Icon icon={Redo2} /> やり直す で、まちがえた操作を取り消せます。</li>
        </ul>
      </section>

      <section>
        <h4>拍に合わせる</h4>
        <ul>
          <li>うすい線が 1 拍、こい線と上の数字が小節です。「置き方」が「拍に合わせる」のときは、音が拍の頭にくっつきます。</li>
          <li><strong>テンポ</strong>（♩= の数）を変えると音楽の速さが変わります。並べた音は同じ拍の上に残ります（音の長さは変わりません）。</li>
          <li><strong>拍子</strong>は 2・3・4 拍子から選べます。</li>
          <li><Icon icon={MetronomeIcon} /> メトロノームをオンにすると、再生中に拍の音が鳴ります（書き出す音楽には入りません）。</li>
        </ul>
      </section>

      <section>
        <h4>きく</h4>
        <ul>
          <li><Icon icon={Play} /> 再生、<Icon icon={Square} /> 停止（先頭に戻る）。上の小節の数字を押すと、そこから再生できます。</li>
          <li><Icon icon={Volume2} /> トラックのスピーカーのボタンで、そのトラックの音を鳴らさないようにできます（ミュート）。</li>
          <li>音が出ないときは、iPad の音量とマナーモード（消音スイッチ）を確かめてください。</li>
        </ul>
      </section>

      <section>
        <h4>保存する・送る</h4>
        <ul>
          <li><strong>自動保存機能:</strong> 作業内容は自動で保存されます（上に「保存済み」と出ます）。ほかのページに移動したり、ページを読み込み直したりしても残ります。</li>
          <li><Icon icon={Send} /> 先生に送る: 曲を先生のページに届けます。</li>
          <li><Icon icon={FolderOpen} /> ファイル: <Icon icon={Save} /> ファイルに保存 / ファイルを開く / <Icon icon={Headphones} /> WAV ファイルに書き出す / 新しく作る（リセット） / <Icon icon={History} /> 1つ前の作業に戻す</li>
          <li>「新しく作る」や「ファイルを開く」の前の作業内容は 1 つだけ残っていて、「1つ前の作業に戻す」で戻せます。</li>
        </ul>
      </section>

      <section>
        <h4><Icon icon={Keyboard} /> キーボード</h4>
        <ul>
          <li>スペース: 再生 / 一時停止、⌘Z（Ctrl+Z）: 元に戻す、⇧⌘Z（Ctrl+Y）: やり直す</li>
          <li>置いた音を選んで ← → : 拍ごとに動かす、↑ ↓ : となりのトラックへ、<Icon icon={Trash2} /> Delete: 削除</li>
          <li>上の小節の目盛りを選んで ← → : 再生位置を拍ごとに動かす（Home で先頭へ）</li>
        </ul>
      </section>

      <section>
        <h4><Icon icon={TabletSmartphone} /> iPad のコツ</h4>
        <ul>
          <li>横向きにすると、音素材とタイムラインを並べて使えます。</li>
          <li>ドラッグ中に画面のはしに近づけると、タイムラインが動きます。</li>
        </ul>
      </section>
    </div>

    <div className="modal-footer">
      <button type="button" className="button-primary" onClick={onClose}>閉じる</button>
    </div>
  </Modal>
);

export default HelpDialog;
