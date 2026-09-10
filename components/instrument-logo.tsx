"use client";

import { useState } from "react";

const FMP_SVG = "https://financialmodelingprep.com/image-stock";
const FMP_PNG = "https://financialmodelingprep.com/new-image-stock";
const CRYPTO_SVG =
  "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";
const CRYPTO_PNG = "https://assets.coincap.io/assets/icons";

export type InstrumentKind =
  | "stock"
  | "etf"
  | "index"
  | "crypto"
  | "forex"
  | "commodity";

export interface InstrumentLogoProps {
  symbol: string;
  kind?: InstrumentKind;
  size?: number;
  className?: string;
}

const PALETTE = [
  "#2e90fa", "#00c896", "#f6465d", "#f0b90b", "#9a6aff",
  "#00b8d9", "#ff9f2e", "#36cfc9", "#f759ab", "#7cc47c",
];

function monogramBg(symbol: string) {
  let h = 0;
  for (let i = 0; i < symbol.length; i++) h = (h * 31 + symbol.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

function initials(symbol: string, kind: InstrumentKind) {
  if (kind === "crypto" || kind === "forex") return symbol.slice(0, 3).toUpperCase();
  const letters = symbol.replace(/[^A-Za-z]/g, "");
  return letters.slice(0, 2).toUpperCase();
}

/**
 * Exact brand logo for an instrument with a resilient fallback chain:
 *   stocks/ETFs : FMP SVG -> FMP PNG -> monogram
 *   crypto      : cryptocurrency-icons SVG -> coincap PNG -> monogram
 */
export function InstrumentLogo({
  symbol,
  kind = "stock",
  size = 32,
  className = "",
}: InstrumentLogoProps) {
  const sym = symbol.toUpperCase().replace(/\^/g, "");
  const [step, setStep] = useState(0);

  const urls: string[] =
    kind === "crypto"
      ? [`${CRYPTO_SVG}/${sym.toLowerCase()}.svg`, `${CRYPTO_PNG}/${sym.toLowerCase()}@2x.png`]
      : kind === "stock" || kind === "etf" || kind === "index"
        ? [`${FMP_SVG}/${sym}.svg`, `${FMP_PNG}/${sym}.png`]
        : []; // forex/commodity: no reliable free logo CDN — monogram directly

  const showImg = step < urls.length;
  const bg = monogramBg(sym);

  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full ${className}`}
      style={{ width: size, height: size, backgroundColor: showImg ? "transparent" : `${bg}26` }}
      aria-hidden
    >
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={urls[step]}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          className="h-full w-full object-contain"
          onError={() => setStep((s) => s + 1)}
        />
      ) : (
        <span
          className="font-semibold tracking-tight"
          style={{ color: bg, fontSize: Math.max(9, size * 0.34) }}
        >
          {initials(sym, kind)}
        </span>
      )}
    </span>
  );
}
