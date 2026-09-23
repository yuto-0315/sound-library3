import React from 'react';

// lucide-react のアイコンを表示する。
// label を渡すと読み上げ用の名前が付いた画像（role="img"）になる。渡さなければ装飾として読み上げない。
// 大きさは周りの文字に合わせる（1em 基準）。
const Icon = ({ icon: IconComponent, label, size = '1.15em', strokeWidth = 2.25, className = '', ...svgProps }) => {
  const svg = (
    <IconComponent
      size={size}
      strokeWidth={strokeWidth}
      aria-hidden="true"
      focusable="false"
      className="app-icon-svg"
      {...svgProps}
    />
  );

  if (label) {
    return (
      <span role="img" aria-label={label} className={`app-icon ${className}`.trim()}>
        {svg}
      </span>
    );
  }
  return (
    <span className={`app-icon ${className}`.trim()} aria-hidden="true">
      {svg}
    </span>
  );
};

export default Icon;
