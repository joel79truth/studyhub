import React, { memo } from 'react';

/**
 * GoogleLensIcon
 *
 * Vector icon matching the official Google Lens camera glyph:
 * - Camera viewfinder outline with top notch and side gaps
 * - Solid center aperture circle
 * - Solid lower-right dot
 *
 * Implements Lucide-compatible props: size, strokeWidth, color, className.
 */
export const GoogleLensIcon = memo(({
  size = 18,
  strokeWidth = 2.2,
  color = 'currentColor',
  className = '',
  ...props
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    stroke={color}
    strokeWidth={strokeWidth}
    strokeLinecap="round"
    strokeLinejoin="round"
    className={className}
    {...props}
  >
    {/* Upper camera body with flash/viewfinder notch */}
    <path d="M 3 11.5 V 7.5 A 4 4 0 0 1 7 3.5 H 8.5 L 10 1.8 H 14 L 15.5 3.5 H 17 A 4 4 0 0 1 21 7.5 V 14" />
    {/* Lower camera body corner */}
    <path d="M 3 15 V 17 A 4 4 0 0 0 7 21 H 13.5" />
    {/* Center lens circle (solid filled) */}
    <circle cx="12" cy="12.5" r="3.6" fill={color} stroke="none" />
    {/* Lower right sensor dot (solid filled) */}
    <circle cx="18.5" cy="18" r="1.8" fill={color} stroke="none" />
  </svg>
));

GoogleLensIcon.displayName = 'GoogleLensIcon';
export default GoogleLensIcon;
