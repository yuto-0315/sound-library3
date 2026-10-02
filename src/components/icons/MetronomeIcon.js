import React from 'react';

// lucide-react にメトロノームのアイコンが無いので、同じ線の太さ・大きさ（24×24）で描く
const MetronomeIcon = ({ size = 24, strokeWidth = 2, color = 'currentColor', ...props }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    <path d="M9.2 3h5.6l4.2 18H5L9.2 3z" />
    <path d="M7 16.5h10" />
    <path d="M12 16.5 16.5 6.5" />
    <circle cx="14.9" cy="10" r="1.3" />
  </svg>
);

export default MetronomeIcon;
