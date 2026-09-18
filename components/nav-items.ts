import { CircleUser, Compass, House, PieChart, Zap } from "lucide-react";

export type NavKey = "home" | "markets" | "trade" | "holdings" | "account";

export interface NavItem {
  key: NavKey;
  href: string;
  label: string;
  /** longer label for the drawer / rail tooltips */
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
}

/**
 * Order matters: Trade sits third so it lands dead centre in the five-slot
 * mobile bottom bar. Every navigation surface renders this same list, so
 * wayfinding is the same shape at every width and there is exactly one route
 * per destination (no duplicate tabs).
 */
export const NAV_ITEMS: NavItem[] = [
  { key: "home", href: "/", label: "Home", blurb: "Overview & activity", icon: House },
  { key: "markets", href: "/markets", label: "Markets", blurb: "Every instrument, live", icon: Compass },
  { key: "trade", href: "/trade", label: "Trade", blurb: "Terminal & AxAI engine", icon: Zap },
  { key: "holdings", href: "/holdings", label: "Holdings", blurb: "Positions & allocation", icon: PieChart },
  { key: "account", href: "/account", label: "Account", blurb: "Cash, cards & statement", icon: CircleUser },
];

/** True when `href` is the active section for the current pathname. */
export function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  // the terminal owns the legacy /ai alias too
  if (href === "/trade") return pathname.startsWith("/trade") || pathname.startsWith("/ai");
  return pathname.startsWith(href);
}
