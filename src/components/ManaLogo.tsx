import React from 'react'

interface ManaLogoProps {
  size?: number
  className?: string
}

/**
 * Custom Mana AI Brand Emblem.
 * An original, futuristic geometric 'M' icon with cyan and purple gradient,
 * completely distinct from Gemini's 4-point star.
 */
export const ManaLogo: React.FC<ManaLogoProps> = ({ size = 24, className }) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <defs>
        <linearGradient id="manaGradient1" x1="2" y1="2" x2="30" y2="30" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#8b5cf6" />
          <stop offset="50%" stopColor="#6366f1" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="manaGradient2" x1="16" y1="6" x2="16" y2="26" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#38bdf8" />
          <stop offset="100%" stopColor="#a855f7" />
        </linearGradient>
      </defs>

      {/* Outer Stylized M-Wings */}
      <path
        d="M6 24V11L11.5 19L16 13L20.5 19L26 11V24"
        stroke="url(#manaGradient1)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Central Radiant Pulse Node */}
      <circle cx="16" cy="8" r="2.5" fill="#38bdf8" />
      <circle cx="16" cy="8" r="4.5" stroke="#06b6d4" strokeWidth="0.8" opacity="0.6" />
    </svg>
  )
}
