import React from 'react'

interface ManaLogoProps {
  size?: number
  className?: string
  color?: string
}

/**
 * Custom Mana AI Brand Emblem.
 * An original, minimalist geometric 'M' icon that seamlessly adopts
 * the Minimal Black & White aesthetic.
 */
export const ManaLogo: React.FC<ManaLogoProps> = ({ size = 24, className, color = 'currentColor' }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      {/* Outer Stylized M-Wings */}
      <path
        d="M6 24V11L11.5 19L16 13L20.5 19L26 11V24"
        stroke={color}
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Central Radiant Pulse Node */}
      <circle cx="16" cy="7.5" r="2.5" fill={color} />
      <circle cx="16" cy="7.5" r="4.5" stroke={color} strokeWidth="0.8" opacity="0.4" />
    </svg>
  )
}
