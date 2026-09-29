import Image from "next/image";

/**
 * Brand assets are generated from the uploaded axion.png lockup by
 * tools/make-logo-assets.mjs (dark ink recoloured for the dark UI):
 *   /brand/axion-mark-sm.png   glyph crop, light ink, 128px wide
 *   /brand/axion-lockup.png    full lockup, light ink, 890x660
 *   /brand/axion-lockup-white.png  full lockup, white ink
 *   /brand/meta.json           crop geometry
 * The site brand is "Axion" — just Axion.
 */

const MARK_ASPECT = 643 / 451; // w/h of the glyph crop
const LOCKUP_ASPECT = 890 / 660; // w/h of the full lockup

export function BrandMark({ size = 36 }: { size?: number }) {
  return (
    <Image
      src="/brand/axion-mark-sm.png"
      alt=""
      aria-hidden
      width={Math.round(size * MARK_ASPECT)}
      height={size}
      priority={false}
      className="shrink-0"
    />
  );
}

export function BrandWordmark({ compact = false }: { compact?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <BrandMark size={compact ? 24 : 28} />
      <span className={`font-semibold tracking-tight ${compact ? "text-lg" : "text-xl"}`}>
        <span className="text-gradient">Axion</span>
      </span>
    </span>
  );
}

/** Full lockup (glyph + "Axion" wordmark) for hero-scale display. */
export function BrandLockup({
  className = "",
  white = false,
  priority = false,
}: {
  className?: string;
  white?: boolean;
  priority?: boolean;
}) {
  return (
    <Image
      src={white ? "/brand/axion-lockup-white.png" : "/brand/axion-lockup.png"}
      alt="Axion"
      width={Math.round(660 * LOCKUP_ASPECT)}
      height={660}
      priority={priority}
      className={className}
    />
  );
}
