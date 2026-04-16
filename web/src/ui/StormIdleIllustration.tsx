/**
 * Idle strip — bundled SVG. Layer order: cloud → lightning → rain (on top) → shimmer.
 * Rain motion via App.css (`.storm-idle-art__rain--*`).
 */
export function StormIdleIllustration() {
  return (
    <svg
      className="storm-idle-art"
      viewBox="0 0 300 140"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      focusable="false"
    >
      <defs>
        <linearGradient id="storm-idle-cloud-base" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f1f5f9" />
          <stop offset="55%" stopColor="#94a3b8" />
          <stop offset="100%" stopColor="#475569" />
        </linearGradient>
        <linearGradient id="storm-idle-cloud-top" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#f8fafc" />
          <stop offset="100%" stopColor="#cbd5e1" />
        </linearGradient>
        <linearGradient id="storm-idle-bolt" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="22%" stopColor="#fef9c3" />
          <stop offset="45%" stopColor="#fde047" />
          <stop offset="72%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#eab308" />
        </linearGradient>
        <linearGradient id="storm-idle-shimmer-band" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="120" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="38%" stopColor="#e0f2fe" stopOpacity="0.12" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.75" />
          <stop offset="62%" stopColor="#bae6fd" stopOpacity="0.2" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
        <clipPath id="storm-idle-rain-clip">
          <rect x="58" y="74" width="184" height="68" />
        </clipPath>
        <clipPath id="storm-idle-bolt-clip">
          <path d="M 148 14 L 122 54 L 148 54 L 112 118 L 138 66 L 106 66 L 148 14 Z" />
        </clipPath>
        <linearGradient id="storm-idle-intro-gleam" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="160" y2="0">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="38%" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.98" />
          <stop offset="62%" stopColor="#fefce8" stopOpacity="0.75" />
          <stop offset="100%" stopColor="#ffffff" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Cloud — sits behind bolt + rain */}
      <g className="storm-idle-art__cloud">
        <ellipse cx="150" cy="78" rx="94" ry="32" fill="url(#storm-idle-cloud-base)" opacity={0.98} />
        <ellipse cx="58" cy="68" rx="36" ry="30" fill="url(#storm-idle-cloud-top)" />
        <ellipse cx="112" cy="58" rx="42" ry="34" fill="#e2e8f0" />
        <ellipse cx="162" cy="60" rx="40" ry="32" fill="url(#storm-idle-cloud-top)" />
        <ellipse cx="208" cy="68" rx="34" ry="28" fill="#94a3b8" opacity={0.95} />
        <ellipse cx="238" cy="76" rx="24" ry="18" fill="#64748b" />
        <path
          d="M 44 90 Q 150 102 256 90 L 256 95 Q 150 108 44 96 Z"
          fill="#334155"
          opacity={0.38}
        />
      </g>

      {/* Lightning — under rain so drops read in front */}
      <path
        className="storm-idle-art__bolt-halo"
        d="M 148 14 L 122 54 L 148 54 L 112 118 L 138 66 L 106 66 L 148 14 Z"
        fill="#fde047"
        opacity={0.45}
      />
      <path
        className="storm-idle-art__bolt"
        d="M 148 14 L 122 54 L 148 54 L 112 118 L 138 66 L 106 66 L 148 14 Z"
        fill="url(#storm-idle-bolt)"
        stroke="#0f172a"
        strokeWidth={0.95}
        strokeLinejoin="round"
      />
      {/* One-shot intro gleam across bolt (timed in App.css) */}
      <g clipPath="url(#storm-idle-bolt-clip)" className="storm-idle-art__bolt-gleam-wrap">
        <rect
          className="storm-idle-art__bolt-gleam-rect"
          x="-180"
          y="0"
          width="140"
          height="140"
          fill="url(#storm-idle-intro-gleam)"
        />
      </g>

      {/* Rain — steeper diagonals (falling); bright strokes so they read on dark chrome */}
      <g className="storm-idle-art__rain storm-idle-art__rain--back" opacity={0.62}>
        <line x1="62" y1="86" x2="58" y2="106" stroke="#a5f3fc" strokeWidth={1.45} strokeLinecap="round" />
        <line x1="84" y1="84" x2="78" y2="106" stroke="#67e8f9" strokeWidth={1.35} strokeLinecap="round" />
        <line x1="108" y1="88" x2="102" y2="110" stroke="#cffafe" strokeWidth={1.4} strokeLinecap="round" />
        <line x1="138" y1="82" x2="132" y2="104" stroke="#a5f3fc" strokeWidth={1.32} strokeLinecap="round" />
        <line x1="176" y1="86" x2="170" y2="108" stroke="#67e8f9" strokeWidth={1.38} strokeLinecap="round" />
        <line x1="210" y1="84" x2="204" y2="106" stroke="#cffafe" strokeWidth={1.4} strokeLinecap="round" />
        <line x1="236" y1="88" x2="232" y2="110" stroke="#a5f3fc" strokeWidth={1.42} strokeLinecap="round" />
        <line x1="154" y1="90" x2="148" y2="112" stroke="#a5f3fc" strokeWidth={1.35} strokeLinecap="round" />
      </g>
      <g className="storm-idle-art__rain storm-idle-art__rain--front" opacity={0.98}>
        <line x1="64" y1="90" x2="58" y2="118" stroke="#e0f2fe" strokeWidth={2.2} strokeLinecap="round" />
        <line x1="88" y1="94" x2="80" y2="124" stroke="#67e8f9" strokeWidth={2.05} strokeLinecap="round" />
        <line x1="112" y1="92" x2="104" y2="122" stroke="#e0f2fe" strokeWidth={2.15} strokeLinecap="round" />
        <line x1="134" y1="96" x2="126" y2="124" stroke="#22d3ee" strokeWidth={2} strokeLinecap="round" />
        <line x1="158" y1="94" x2="152" y2="120" stroke="#cffafe" strokeWidth={1.95} strokeLinecap="round" />
        <line x1="182" y1="98" x2="176" y2="128" stroke="#e0f2fe" strokeWidth={2} strokeLinecap="round" />
        <line x1="206" y1="92" x2="200" y2="120" stroke="#67e8f9" strokeWidth={2.1} strokeLinecap="round" />
        <line x1="228" y1="96" x2="224" y2="124" stroke="#e0f2fe" strokeWidth={2.05} strokeLinecap="round" />
        <line x1="72" y1="100" x2="66" y2="130" stroke="#67e8f9" strokeWidth={2} strokeLinecap="round" />
        <line x1="96" y1="100" x2="90" y2="130" stroke="#e0f2fe" strokeWidth={2} strokeLinecap="round" />
        <line x1="120" y1="100" x2="114" y2="132" stroke="#22d3ee" strokeWidth={2} strokeLinecap="round" />
        <line x1="144" y1="96" x2="138" y2="126" stroke="#e0f2fe" strokeWidth={2.05} strokeLinecap="round" />
        <line x1="168" y1="102" x2="162" y2="132" stroke="#cffafe" strokeWidth={1.95} strokeLinecap="round" />
        <line x1="192" y1="98" x2="188" y2="128" stroke="#e0f2fe" strokeWidth={2.05} strokeLinecap="round" />
        <line x1="216" y1="100" x2="210" y2="132" stroke="#67e8f9" strokeWidth={2} strokeLinecap="round" />
      </g>

      <g clipPath="url(#storm-idle-rain-clip)">
        <g className="storm-idle-art__rain-shimmer-wrap">
          <rect
            className="storm-idle-art__rain-shimmer-bar"
            x="-140"
            y="72"
            width="140"
            height="72"
            fill="url(#storm-idle-shimmer-band)"
          />
        </g>
      </g>
    </svg>
  );
}
