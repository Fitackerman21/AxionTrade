export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" fill="none" aria-hidden>
      <defs>
        <linearGradient id="axion-g" x1="6" y1="6" x2="42" y2="42" gradientUnits="userSpaceOnUse">
          <stop stopColor="#2e90fa" />
          <stop offset="1" stopColor="#00c896" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="12" fill="url(#axion-g)" opacity="0.14" />
      <rect x="2.5" y="2.5" width="43" height="43" rx="11.5" stroke="url(#axion-g)" strokeWidth="1.5" opacity="0.55" />
      {/* A forming an upward arrow — trade axis going up */}
      <path d="M12 34 L24 12 L36 34" stroke="url(#axion-g)" strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M17.5 27.5 H30.5" stroke="url(#axion-g)" strokeWidth="3" strokeLinecap="round" opacity="0.85" />
      <circle cx="36" cy="16" r="3.4" fill="#00c896" />
    </svg>
  );
}

export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={compact ? 28 : 34} />
      <span className={`font-semibold tracking-tight ${compact ? "text-lg" : "text-xl"}`}>
        <span className="text-foreground">Axion</span>
        <span className="text-gradient">Trade</span>
      </span>
    </span>
  );
}
