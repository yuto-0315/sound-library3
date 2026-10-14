import React from 'react';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import Icon from './Icon';

// ページ内で予期しないエラーが起きても、アプリ全体が真っ白にならないようにする。
// 保存済みのデータ（IndexedDB）はそのまま残っているので、再読み込みで元に戻れる。
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
    this.handleRetry = this.handleRetry.bind(this);
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, info) {
    console.error('画面の表示中にエラーが発生しました:', error, info && info.componentStack);
  }

  componentDidUpdate(prevProps) {
    // 別のページに移動したら表示を戻す
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ hasError: false });
    }
  }

  handleRetry() {
    window.location.reload();
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="error-boundary" role="alert">
          <h2><Icon icon={TriangleAlert} /> 問題が発生しました</h2>
          <p>画面を表示できませんでした。作った音や音楽は保存されています。</p>
          <button type="button" className="button-primary" onClick={this.handleRetry}>
            <Icon icon={RefreshCw} /> ページを再読み込みする
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;
