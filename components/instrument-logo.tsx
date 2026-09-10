"use client";

import { useState } from "react";

const FMP_PNG = "https://financialmodelingprep.com/image-stock"; // verified 200 PNG per symbol
const PARQET_SVG = "https://assets.parqet.com/logos/symbol"; // verified 200 SVG per symbol
const CRYPTO_SVG = "https://cdn.jsdelivr.net/npm/cryptocurrency-icons@0.18.1/svg/color";
const CRYPTO_PNG = "https://assets.coincap.io/assets/icons";
const FLAG_PNG = "https://flagcdn.com/w80";

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

/** ISO-ish flag codes for fiat currencies (flagcdn) */
const CURRENCY_FLAG: Record<string, string> = {
  USD: "us", EUR: "eu", GBP: "gb", JPY: "jp", CHF: "ch",
  AUD: "au", CAD: "ca", NZD: "nz", CNY: "cn", SEK: "se",
  NOK: "no", TRY: "tr", ZAR: "za", MXN: "mx", SGD: "sg",
  HKD: "hk", PLN: "pl", BGN: "bg",
};

/** Styled badges for commodities (no logo CDN covers these reliably) */
const COMMODITY_BADGE: Record<string, { letter: string; color: string }> = {
  XAU: { letter: "Au", color: "#f0b90b" },
  XAG: { letter: "Ag", color: "#b8c0cc" },
  WTI: { letter: "O", color: "#ff9f2e" },
  BRENT: { letter: "B", color: "#ff7a2e" },
  NGAS: { letter: "G", color: "#36cfc9" },
  COPPER: { letter: "Cu", color: "#e07b39" },
};

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
 *   stocks/ETFs/index : FMP PNG -> Parqet SVG -> monogram
 *   crypto            : cryptocurrency-icons SVG -> coincap PNG -> FMP PNG -> monogram
 *   forex             : base-currency flag (flagcdn) -> monogram
 *   commodity         : styled element badge (Au, Ag, O…) — no CDN carries these
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
      ? [`${CRYPTO_SVG}/${sym.toLowerCase()}.svg`, `${CRYPTO_PNG}/${sym.toLowerCase()}@2x.png`, `${FMP_PNG}/${sym}.png`]
      : kind === "stock" || kind === "etf" || kind === "index"
        ? [`${FMP_PNG}/${sym}.png`, `${PARQET_SVG}/${sym}`]
        : kind === "forex"
          ? (() => {
              const base = sym.slice(0, 3);
              const flag = CURRENCY_FLAG[base];
              return flag ? [`${FLAG_PNG}/${flag}.png`] : [];
            })()
          : []; // commodity: badge, no img

  const showImg = step < urls.length;
  const bg = monogramBg(sym);

  // commodity badge
  if (kind === "commodity") {
    const meta = COMMODITY_BADGE[sym.slice(0, sym.length - 3)] ?? COMMODITY_BADGE[sym.slice(0, 3)];
    const letter = meta?.letter ?? initials(sym, kind);
    const color = meta?.color ?? bg;
    return (
      <span
        className={`relative inline-flex shrink-0 items-center justify-center rounded-full font-semibold ${className}`}
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${color}30, ${color}12)`,
          border: `1px solid ${color}55`,
          color,
          fontSize: Math.max(9, size * 0.36),
        }}
        aria-hidden
      >
        {letter}
      </span>
    );
  }

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
