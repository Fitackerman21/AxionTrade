"use client";

import { useState } from "react";

export interface GlassButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "ghost";
  loading?: boolean;
}

export function GlassButton({
  variant = "primary",
  loading = false,
  className = "",
  children,
  disabled,
  ...props
}: GlassButtonProps) {
  const [glow, setGlow] = useState(false);

  if (variant === "ghost") {
    return (
      <button
        {...props}
        disabled={disabled || loading}
        className={`inline-flex h-10 items-center justify-center rounded-xl border border-border bg-surface/60 px-4 text-sm font-medium text-foreground transition-colors hover:border-muted/40 hover:bg-surface ${className}`}
      >
        {children}
      </button>
    );
  }

  return (
    <button
      {...props}
      disabled={disabled || loading}
      onMouseEnter={() => setGlow(true)}
      onMouseLeave={() => setGlow(false)}
      className={`group relative inline-flex h-11 w-full items-center justify-center overflow-hidden rounded-xl bg-gradient-to-r from-brand to-gain text-sm font-semibold text-[#071018] shadow-[0_8px_28px_-8px_rgba(46,144,250,0.55)] transition-transform active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60 ${className}`}
    >
      {/* sheen sweep */}
      <span className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/35 to-transparent transition-transform duration-700 group-hover:translate-x-full" />
      {glow && (
        <span className="pointer-events-none absolute inset-0 shadow-[0_0_32px_rgba(0,200,150,0.4)]" />
      )}
      {loading ? (
        <span className="flex items-center gap-2">
          <svg className="h-4 w-4 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden>
            <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
            <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
          </svg>
          Signing in…
        </span>
      ) : (
        children
      )}
    </button>
    );
}
