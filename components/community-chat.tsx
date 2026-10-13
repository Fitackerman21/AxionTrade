"use client";

/**
 * Axion community chat — Telegram-style group chat, live edition.
 *
 * The transcript is the real room: turns come from `GET /api/forum/messages`,
 * which also wakes a lazy room via bounded catch-up, and are polled so the
 * conversation comes forward while the page is open. Sending a message POSTs to
 * the same endpoint, which records it as an external sender and reports the
 * pending reply. A reply is paced 30–60s out on its own clock (§9), so the
 * header shows who is "typing" and the page polls until the line lands — no
 * instant, obviously-scripted answer.
 *
 * The scripted replay from `lib/community-chat.ts` is the fallback: it seeds the
 * transcript when the room is empty, unreachable, or running on a host without
 * one, so the page never renders as broken.
 *
 * Bubble spec follows Telegram Web (tweb) night mode: solid bubbles, sender name
 * inside the bubble, time inline at the end of the text, avatar rendered only on
 * the last message of a group. The avatar is top-aligned to the bubble the way a
 * phone messenger draws it (WhatsApp), rather than bottom-aligned.
 *
 * Quoted replies work the way they do in a phone messenger: swipe a message to the
 * right (or hover it and use the arrow on a desktop) to answer that specific line,
 * the composer shows what you are replying to, and the answer renders with the
 * original quoted above it. The room's own lines carry the same quote, because
 * every reply in the log records the message it answered (`replyToSeq`).
 *
 * ## Why the transcript is a memoized subtree
 *
 * The page used to keep every piece of state — the draft, the swipe offset, the open
 * emoji palette — in the one component that also rendered every row, so each keystroke
 * and each pointermove re-rendered the whole transcript. With a few hundred rows that
 * is the input lag and the stuck swipe. Now the rows live in `Transcript`, memoized on
 * its data alone; `MessageRow` is memoized and owns its own swipe offset and palette, so
 * a drag re-renders one row and a keystroke re-renders none of them. The composer's
 * `draft` never crosses into the transcript.
 */

import { memo, useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import Link from "next/link";
import {
  ArrowRight,
  CheckCheck,
  CornerUpLeft,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
  Users,
  X,
} from "lucide-react";

import { BrandMark } from "@/components/brand";
import {
  PERSONAS,
  REPLAY_INDEXED,
  type ChatPersona,
} from "@/lib/community-chat";
import { REACTION_EMOJI } from "@/lib/forum/reactions";
import type { ForumMessage, MessageReactions } from "@/lib/forum/types";

/** The bundled roster is the fallback; the live roster (with admin profile
 * overrides) replaces it once fetched. */
let livePersonas: ChatPersona[] | null = null;
const byId = new Map(PERSONAS.map((p) => [p.id, p]));

/**
 * Who is watching the roster. The dashboard edits a profile (name, picture) and
 * the community page has to *show* it without a reload — so a roster read has to
 * re-render the page, not just swap a module-level variable nobody is observing.
 * `personaFor` still reads `byId` synchronously; the listeners are what make the
 * new entries reach the screen.
 */
type RosterListener = (personas: ChatPersona[]) => void;
const rosterListeners = new Set<RosterListener>();

function applyRoster(personas: ChatPersona[]): void {
  livePersonas = personas;
  byId.clear();
  for (const p of personas) byId.set(p.id, p);
  for (const listener of rosterListeners) listener(personas);
}

async function refreshPersonas(): Promise<void> {
  try {
    const response = await fetch("/api/admin/roster", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { personas?: ChatPersona[] };
    if (Array.isArray(body.personas) && body.personas.length > 0) {
      applyRoster(body.personas);
    }
  } catch {
    // the bundled roster stays in place — the room must render even if this fails
  }
}

/** "You" — the local sender. Its id is the external sender id the room records. */
const YOU: ChatPersona = {
  id: "human",
  name: "You",
  role: "Axion member",
  g1: "#2e90fa",
  g2: "#00c896",
  color: "#9fc6ff",
  online: true,
};

/** The community profile shown in the overview; the live read replaces it. */
interface CommunityProfile {
  name: string;
  description: string;
}

const DEFAULT_COMMUNITY: CommunityProfile = {
  name: "Axion Community",
  description:
    "The community room that ships with the Axion app: the people who trade on it, talking to each other.",
};

/** How often the open page refreshes the transcript while the room is idle. */
const POLL_MS = 6_000;
/** How often the open page re-reads the roster, so a dashboard edit shows up here. */
const ROSTER_POLL_MS = 20_000;
/** A faster tick while someone is typing, so the reply lands close to its due time. */
const TYPING_POLL_MS = 3_000;
/** A gap this long between messages breaks the avatar/name grouping. */
const GROUP_GAP_MS = 5 * 60_000;
/** The avatar column width, shared by the rows, the member rail and the typing bubble. */
const AVATAR_SIZE = 40;

interface Row {
  key: string;
  /** the room's seq, when this row came from the live log (swipe/quotes need it) */
  seq?: number;
  from: string;
  text: string;
  ticker?: string;
  /** epoch ms */
  at: number;
  system: boolean;
  /** the seq of the message this one answers */
  replyToSeq?: number;
  /** the reaction chips on this bubble, one per emoji */
  reactions?: MessageReactions[];
}

type Source = "live" | "demo" | "unavailable";

/** The room's report of a reply being composed for a person (§9). */
interface PendingReply {
  /** the persona expected to answer */
  sender: string;
  /** true when the engine will post a stage direction instead */
  system: boolean;
  dueAt: number;
  /**
   * When the typing bubble may appear. The room reads the message first and the read
   * scales with how long it is, so the indicator is not there in the same frame the
   * message lands — which is the thing no pair of thumbs can do (§9).
   */
  typingAt: number;
}

interface RoomResponse {
  messages?: ForumMessage[];
  pending?: PendingReply | null;
  error?: string;
  reply?: { status: string; chosen: string | null; dueAt?: number | null } | null;
  reaction?: { seq: number; emoji: string; on: boolean } | null;
}

function initials(name: string) {
  const chars = name.replace(/[^a-z0-9]/gi, "");
  const digit = chars.match(/\d/)?.[0];
  return (chars[0]?.toUpperCase() ?? "?") + (digit ?? chars[1]?.toUpperCase() ?? "");
}

/** A sender the roster does not know still needs a face. */
function personaFor(id: string): ChatPersona {
  if (id === YOU.id) return YOU;
  const known = byId.get(id);
  if (known) return known;
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    role: "Axion member",
    g1: "#64748b",
    g2: "#334155",
    color: "#cbd5e1",
    online: false,
  };
}

function clockOf(at: number): string {
  return new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** The scripted replay, retimed onto today so it groups and sorts like live turns. */
function replayRows(): Row[] {
  const base = new Date();
  base.setHours(8, 0, 0, 0);
  const start = base.getTime();
  return REPLAY_INDEXED.map((m) => ({
    key: `replay-${m.id}`,
    from: m.from,
    text: m.text,
    ticker: m.ticker,
    at: start + m.t * 60_000,
    system: false,
  }));
}

function liveRows(messages: readonly ForumMessage[]): Row[] {
  return messages.map((m) => ({
    key: m.id,
    seq: m.seq,
    from: m.sender,
    text: m.text,
    at: m.t,
    system: m.system,
    ...(m.replyToSeq === undefined ? {} : { replyToSeq: m.replyToSeq }),
    ...(m.reactions && m.reactions.length > 0 ? { reactions: m.reactions } : {}),
  }));
}

/** How far a message must be dragged before it counts as a reply. */
const SWIPE_TRIGGER_PX = 48;
const SWIPE_MAX_PX = 96;

/** Deterministic 0/1 so sticker arrows stay stable across renders. */
const up = (id: number) => id % 2 === 0;

function Avatar({ p, size = AVATAR_SIZE }: { p: ChatPersona; size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-[#071018]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${p.g1}, ${p.g2})`,
      }}
      aria-hidden
    >
      {p.picture ? (
        // Admin-set profile picture; the gradient stays behind it as the
        // loading placeholder and the online dot rides on top as before.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.picture} alt="" className="h-full w-full object-cover" loading="lazy" />
      ) : (
        initials(p.name)
      )}
      {p.online && (
        <span
          className="absolute right-0 bottom-0 rounded-full border-2 border-background bg-gain"
          style={{ height: size * 0.28, width: size * 0.28 }}
        />
      )}
    </span>
  );
}

function TickerChip({ ticker, id }: { ticker: string; id: number }) {
  const isUp = up(id);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ${
        isUp ? "bg-gain/15 text-gain" : "bg-loss/15 text-loss"
      }`}
    >
      {isUp ? "▲" : "▼"} {ticker}
    </span>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex items-center gap-0.5" aria-hidden>
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="inline-block h-1 w-1 animate-bounce rounded-full bg-brand"
          style={{ animationDelay: `${i * 120}ms` }}
        />
      ))}
    </span>
  );
}

/**
 * One message row.
 *
 * Memoized, and it owns the two pieces of state that move during an interaction: the
 * swipe offset and whether this row's emoji palette is open. Both used to live in the
 * page, which meant a drag re-rendered every row on screen and the swipe stuttered on a
 * long transcript. Here a drag re-renders this row and nothing else.
 */
const MessageRow = memo(function MessageRow({
  row,
  sender,
  first,
  last,
  outgoing,
  quoted,
  active,
  onJump,
  onReply,
  onReact,
  onOpenProfile,
}: {
  row: Row;
  sender: ChatPersona;
  first: boolean;
  last: boolean;
  outgoing: boolean;
  /** the message this one answers, when it is still on screen */
  quoted?: Row;
  /** true when this row is the message currently being replied to */
  active: boolean;
  onJump: (seq: number) => void;
  onReply: (row: Row) => void;
  onReact: (seq: number, emoji: string) => void;
  onOpenProfile: (p: ChatPersona) => void;
}) {
  // Telegram corner logic: 12px everywhere, except the avatar-side bottom
  // corner of the last bubble in a group which is squared to 4px.
  const radius = outgoing
    ? last
      ? "rounded-[12px] rounded-br-[4px]"
      : "rounded-[12px]"
    : last
      ? "rounded-[12px] rounded-bl-[4px]"
      : "rounded-[12px]";

  const [dx, setDx] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const dragRef = useRef<{ x0: number; dx: number } | null>(null);
  const frameRef = useRef<number | null>(null);

  const scheduleOffset = useCallback(() => {
    if (frameRef.current !== null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      setDx((current) => (dragRef.current ? Math.max(0, Math.min(SWIPE_MAX_PX, dragRef.current.dx)) : current));
    });
  }, []);

  useEffect(
    () => () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    },
    [],
  );

  return (
    <div
      data-seq={row.seq}
      data-testid="message"
      className={`group relative ${first ? "mt-3" : "mt-[2px]"} ${
        active ? "rounded-lg bg-brand/10" : ""
      }`}
      style={{
        transform: dx > 0 ? `translateX(${dx}px)` : undefined,
        transition: dx > 0 ? "none" : "transform 120ms ease-out",
        touchAction: "pan-y",
      }}
      // Swipe right to reply, the way a phone messenger does it. Mouse users get
      // the hover arrow below instead.
      onPointerDown={(event) => {
        if (event.pointerType === "mouse") return;
        dragRef.current = { x0: event.clientX, dx: 0 };
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = event.clientX - drag.x0;
        if (next <= 3) return;
        drag.dx = next;
        scheduleOffset();
      }}
      onPointerUp={() => {
        const drag = dragRef.current;
        dragRef.current = null;
        setDx(0);
        if (drag && drag.dx >= SWIPE_TRIGGER_PX) onReply(row);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        setDx(0);
      }}
    >
      {dx > 4 && (
        <span
          aria-hidden
          data-testid="swipe-reply"
          className="absolute top-1/2 left-1 -translate-y-1/2 text-brand"
          style={{ opacity: Math.min(1, dx / SWIPE_TRIGGER_PX) }}
        >
          <CornerUpLeft className="h-5 w-5" />
        </span>
      )}
      <div className={`flex items-start gap-2 ${outgoing ? "justify-end pl-12" : "justify-start pr-12"}`}>
        {!outgoing && (
          <span className="shrink-0" style={{ width: AVATAR_SIZE }}>
            {last && (
              <button
                type="button"
                aria-label={`${sender.name}'s profile`}
                onClick={() => onOpenProfile(sender)}
                className="rounded-full"
              >
                <Avatar p={sender} />
              </button>
            )}
          </span>
        )}
        <div
          className={`max-w-[min(560px,82%)] px-3 py-1.5 ${radius} ${
            outgoing
              ? "bg-[#2b5278] text-white"
              : "bg-surface-2 text-foreground shadow-[0_1px_1px_rgba(0,0,0,0.35)]"
          }`}
        >
          {!outgoing && first && (
            <p className="text-[13.5px] leading-tight font-semibold" style={{ color: sender.color }}>
              <button
                type="button"
                data-testid="sender-name"
                onClick={() => onOpenProfile(sender)}
                className="text-left hover:underline"
              >
                {sender.name}
              </button>
            </p>
          )}
          {quoted && (
            <button
              type="button"
              data-testid="quoted"
              onClick={() => quoted.seq !== undefined && onJump(quoted.seq)}
              className={`mb-1 flex w-full items-baseline gap-1.5 overflow-hidden rounded-md border-l-2 px-2 py-1 text-left ${
                outgoing ? "border-white/60 bg-black/20" : "border-brand bg-black/20"
              }`}
            >
              <span
                className="shrink-0 text-[12px] font-semibold"
                style={{ color: outgoing ? "#cfe3ff" : personaFor(quoted.from).color }}
              >
                {personaFor(quoted.from).name}
              </span>
              <span className="truncate text-[12px] opacity-80">{quoted.text}</span>
            </button>
          )}
          {row.ticker && (
            <div className="mt-1">
              <TickerChip ticker={row.ticker} id={row.at} />
            </div>
          )}
          <p data-testid="message-text" className="text-[14.5px] leading-[1.35] break-words">
            {row.text}
            <span
              className={`ml-2 inline-block translate-y-0.5 text-[11px] whitespace-nowrap ${
                outgoing ? "text-white/60" : "text-muted"
              }`}
            >
              {clockOf(row.at)}
              {outgoing && <CheckCheck className="ml-0.5 inline h-3.5 w-3.5 align-[-2px] text-white/70" />}
            </span>
          </p>
          {row.reactions && row.reactions.length > 0 && (
            <div data-testid="reactions" className="mt-1 flex flex-wrap items-center gap-1">
              {row.reactions.map((reaction) => {
                const mine = reaction.by.includes(YOU.id);
                return (
                  <button
                    key={reaction.emoji}
                    type="button"
                    data-testid={`reaction-${reaction.emoji}`}
                    aria-label={`${reaction.emoji} ${reaction.by.length}`}
                    onClick={() => row.seq !== undefined && onReact(row.seq, reaction.emoji)}
                    className={`flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] leading-none transition-colors ${
                      mine ? "bg-brand/35 ring-1 ring-brand/70" : "bg-black/20 hover:bg-black/30"
                    }`}
                  >
                    <span className="text-[13px]">{reaction.emoji}</span>
                    <span className="tabular-nums">{reaction.by.length}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {row.seq !== undefined && (
        <div
          className={`absolute top-1/2 flex -translate-y-1/2 flex-col gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100 ${
            outgoing ? "left-1" : "right-1"
          }`}
        >
          <button
            type="button"
            aria-label={`Reply to ${sender.name}`}
            data-testid="reply-action"
            onClick={() => onReply(row)}
            // Hover affordance for a mouse: a swipe needs a thumb.
            className="rounded-full bg-surface-2 p-1.5 text-muted"
          >
            <CornerUpLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            aria-label={`React to ${sender.name}`}
            data-testid="react-action"
            onClick={() => setPaletteOpen((open) => !open)}
            className="rounded-full bg-surface-2 p-1.5 text-muted"
          >
            <Smile className="h-4 w-4" />
          </button>
        </div>
      )}
      {paletteOpen && row.seq !== undefined && (
        <div
          data-testid="reaction-palette"
          className={`absolute -top-3 z-10 flex items-center gap-0.5 rounded-full border border-border bg-surface px-1.5 py-1 shadow-[0_8px_24px_-6px_rgba(0,0,0,0.7)] ${
            outgoing ? "right-1" : "left-1"
          }`}
        >
          {REACTION_EMOJI.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={`React with ${emoji}`}
              onClick={() => {
                setPaletteOpen(false);
                onReact(row.seq!, emoji);
              }}
              className="rounded-full px-1 text-[16px] leading-none transition-transform hover:scale-125"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/**
 * The transcript subtree.
 *
 * Memoized on its data alone: the composer's draft is deliberately *not* a prop, so
 * typing in the composer re-renders the composer and nothing in the scrollback.
 */
const Transcript = memo(function Transcript({
  rows,
  roster,
  replyToSeq,
  typing,
  source,
  notice,
  scrollRef,
  onJump,
  onReply,
  onReact,
  onOpenProfile,
}: {
  rows: Row[];
  roster: ChatPersona[] | null;
  replyToSeq?: number;
  typing: PendingReply | null;
  source: Source;
  notice: string | null;
  scrollRef: RefObject<HTMLDivElement | null>;
  onJump: (seq: number) => void;
  onReply: (row: Row) => void;
  onReact: (seq: number, emoji: string) => void;
  onOpenProfile: (p: ChatPersona) => void;
}) {
  // The roster reference is read so a profile edit (which swaps `roster`) forces the
  // senders to be recomputed here rather than left stale by the memo.
  void roster;

  /** Live rows by seq, so a quoted strip can resolve the message it points at. */
  const bySeq = useMemo(() => {
    const map = new Map<number, Row>();
    for (const row of rows) if (row.seq !== undefined) map.set(row.seq, row);
    return map;
  }, [rows]);

  return (
    <div ref={scrollRef} className="chat-wallpaper relative min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
      <div className="mb-3 flex justify-center">
        <span className="rounded-full bg-surface-2/90 px-3 py-1 text-[11px] font-medium text-muted">
          Today
        </span>
      </div>

      {rows.map((row, i) => {
        const sender = personaFor(row.from);
        const outgoing = row.from === YOU.id;
        const prev = i > 0 ? rows[i - 1] : null;
        const next = i < rows.length - 1 ? rows[i + 1] : null;
        const first = !prev || prev.from !== row.from || row.at - prev.at > GROUP_GAP_MS;
        const last = !next || next.from !== row.from || next.at - row.at > GROUP_GAP_MS;
        const quoted = row.replyToSeq === undefined ? undefined : bySeq.get(row.replyToSeq);

        return (
          <MessageRow
            key={row.key}
            row={row}
            sender={sender}
            first={first}
            last={last}
            outgoing={outgoing}
            quoted={quoted}
            active={row.seq !== undefined && row.seq === replyToSeq}
            onJump={onJump}
            onReply={onReply}
            onReact={onReact}
            onOpenProfile={onOpenProfile}
          />
        );
      })}

      {/* `items-center` on purpose: the transcript's message rows are matched by
          the e2e spec with `div.flex.items-start.gap-2`, and a typing bubble is not
          a message. */}
      {typing && source === "live" && (
        <div data-testid="typing-row" className="mt-3 flex items-center gap-2">
          <span className="shrink-0" style={{ width: AVATAR_SIZE }}>
            <Avatar p={personaFor(typing.sender)} />
          </span>
          <div className="rounded-[12px] rounded-bl-[4px] bg-surface-2 px-3 py-2 text-foreground shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
            <span className="text-[13px] font-semibold" style={{ color: personaFor(typing.sender).color }}>
              {personaFor(typing.sender).name}
            </span>
            <span className="ml-1.5 align-middle text-[12px] text-muted">is typing…</span>
            <span className="ml-2 inline-flex align-middle">
              <TypingDots />
            </span>
          </div>
        </div>
      )}

      {notice && (
        <div className="mt-3 flex justify-center">
          <span className="rounded-full bg-surface-2/90 px-3 py-1 text-[11px] font-medium text-muted">
            {notice}
          </span>
        </div>
      )}
    </div>
  );
});

function MemberRow({ p, onClick }: { p: ChatPersona; onClick?: () => void }) {
  const subtitle = p.bio ? p.bio : p.role;
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-surface-2/70"
    >
      <Avatar p={p} size={34} />
      <span className="min-w-0">
        <span className="block truncate text-[13px] font-medium" style={{ color: p.color }}>
          {p.name}
          {p.age ? <span className="ml-1 text-[11px] text-muted">· {p.age}</span> : null}
        </span>
        <span className="block truncate text-[11px] text-muted">{subtitle}</span>
      </span>
    </button>
  );
}

/** A member's bio and details, opened from their name, avatar, or the overview. */
function ProfilePanel({
  persona,
  messageCount,
  onClose,
}: {
  persona: ChatPersona;
  messageCount: number;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="profile-panel"
      className="absolute inset-0 z-30 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm overflow-hidden rounded-t-3xl border border-border/70 bg-surface shadow-[0_24px_64px_-16px_rgba(0,0,0,0.8)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex flex-col items-center gap-3 px-6 pt-8 pb-6"
          style={{ background: `linear-gradient(160deg, ${persona.g1}22, ${persona.g2}12)` }}
        >
          <Avatar p={persona} size={88} />
          <div className="text-center">
            <p className="text-lg font-semibold text-foreground">{persona.name}</p>
            <p className="text-[13px] text-muted">{persona.role}</p>
          </div>
          <div className="flex items-center gap-3 text-[11px] text-muted">
            <span className="flex items-center gap-1.5">
              <span className={`inline-block h-1.5 w-1.5 rounded-full ${persona.online ? "bg-gain" : "bg-muted"}`} />
              {persona.online ? "online" : "offline"}
            </span>
            {persona.age ? <span>{persona.age}</span> : null}
            <span>
              {messageCount} {messageCount === 1 ? "message" : "messages"}
            </span>
          </div>
        </div>
        <div className="border-t border-border/70 px-6 py-5">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">About</p>
          <p className="text-[13.5px] leading-relaxed text-foreground/90">
            {persona.bio ?? `${persona.name} trades from ${persona.role.split("·").slice(-1)[0]?.trim() ?? "here"}.`}
          </p>
        </div>
        <div className="flex justify-end border-t border-border/70 px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-surface-2 px-4 py-2 text-[13px] font-medium text-foreground hover:bg-border"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

/** The community overview: description and every member, opened from the header. */
function CommunityOverview({
  community,
  members,
  onClose,
  onOpenMember,
}: {
  community: CommunityProfile;
  members: ChatPersona[];
  onClose: () => void;
  onOpenMember: (p: ChatPersona) => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      data-testid="community-overview"
      className="absolute inset-0 z-20 flex items-stretch justify-center bg-black/55 backdrop-blur-sm sm:items-center sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex w-full max-w-lg flex-col overflow-hidden border border-border/70 bg-surface shadow-[0_24px_64px_-16px_rgba(0,0,0,0.8)] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="relative flex items-center gap-3 border-b border-border/70 px-5 py-4"
          style={{ background: "linear-gradient(135deg, #2e90fa18, #00c89612)" }}
        >
          <span
            className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full"
            style={{ background: "linear-gradient(135deg, #2e90fa, #00c896)" }}
          >
            <BrandMark size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-[16px] font-semibold text-foreground">{community.name}</h2>
            <p className="text-[12px] text-muted">
              {members.length} members · {members.filter((p) => p.online).length} online
            </p>
          </div>
          <button
            type="button"
            aria-label="Close overview"
            data-testid="overview-close"
            onClick={onClose}
            className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="border-b border-border/70 px-5 py-4">
          <p className="mb-1 text-[11px] font-semibold tracking-wide text-muted uppercase">About</p>
          <p className="text-[13.5px] leading-relaxed text-foreground/90">{community.description}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <p className="flex items-center gap-1.5 px-2 pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
            <Users className="h-3.5 w-3.5" /> Members
          </p>
          <div className="grid gap-0.5 sm:grid-cols-2">
            {members.map((p) => (
              <div key={p.id} data-testid="community-member" data-id={p.id}>
                <MemberRow p={p} onClick={() => onOpenMember(p)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function CommunityChat() {
  const [rows, setRows] = useState<Row[]>(replayRows);
  /** the roster the room is showing — the bundled one until the live read lands */
  const [roster, setRoster] = useState<ChatPersona[] | null>(livePersonas);
  const [community, setCommunity] = useState<CommunityProfile>(DEFAULT_COMMUNITY);
  const [source, setSource] = useState<Source>("demo");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState<PendingReply | null>(null);
  /** the message being answered, set by a swipe or the hover arrow */
  const [replyTo, setReplyTo] = useState<Row | null>(null);
  /** the profile panel's subject, if open */
  const [profile, setProfile] = useState<ChatPersona | null>(null);
  /** the community overview, if open */
  const [overviewOpen, setOverviewOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** The timer that shows the typing bubble once the room has finished reading. */
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Adopt the room's projection, holding the typing bubble until the read is done.
   *
   * The server owns "is someone typing" and clears it the moment the reply is
   * published, so a stale bubble cannot outlive the message it promised — but it also
   * sends when the read finishes (`typingAt`), and a person who just pressed send does
   * not see a bubble in the same frame. So the bubble is scheduled, not set: nothing on
   * screen changes until the message has been "read".
   */
  const adopt = useCallback((data: RoomResponse) => {
    if (data.messages && data.messages.length > 0) {
      setRows(liveRows(data.messages));
      setSource("live");
      const pending = data.pending ?? null;
      if (typingTimer.current) {
        clearTimeout(typingTimer.current);
        typingTimer.current = null;
      }
      const wait = pending ? pending.typingAt - Date.now() : 0;
      if (pending && wait > 0) {
        setTyping(null);
        typingTimer.current = setTimeout(() => setTyping(pending), wait);
      } else {
        setTyping(pending);
      }
      setNotice(null);
      return true;
    }
    setSource(data.error ? "unavailable" : "demo");
    setTyping(null);
    return false;
  }, []);

  useEffect(
    () => () => {
      if (typingTimer.current) clearTimeout(typingTimer.current);
    },
    [],
  );

  /**
   * Keep the roster current while the page is open. A profile edit on the
   * dashboard used to require a full reload to appear here — the roster was read
   * once at module load and a picture uploaded afterwards simply never reached the
   * screen. Now the fetch is subscribed to this component (so it re-renders), it
   * repeats on a slow tick, and it re-reads the moment the tab becomes visible
   * again — which is exactly the edit-here-then-look-there workflow.
   */
  useEffect(() => {
    rosterListeners.add(setRoster);
    void refreshPersonas();
    const timer = setInterval(() => void refreshPersonas(), ROSTER_POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshPersonas();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      rosterListeners.delete(setRoster);
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  /** The community's name and description, for the overview modal. */
  useEffect(() => {
    const loadCommunity = async () => {
      try {
        const response = await fetch("/api/community", { cache: "no-store" });
        if (!response.ok) return;
        const data = (await response.json()) as Partial<CommunityProfile>;
        if (typeof data.name === "string" && typeof data.description === "string") {
          setCommunity({ name: data.name, description: data.description });
        }
      } catch {
        // the default profile stays — the overview renders without the admin layer
      }
    };
    void loadCommunity();
    const onVisible = () => {
      if (document.visibilityState === "visible") void loadCommunity();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, []);

  /**
   * Reading refreshes *and* wakes: the endpoint's catch-up is what brings a paused
   * room forward, so polling while the page is open is the room's heartbeat. It is
   * also what lands a paced reply once its 30–60s window is up.
   */
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/forum/messages", { cache: "no-store" });
      adopt((await response.json()) as RoomResponse);
    } catch {
      setSource("unavailable");
    }
  }, [adopt]);

  // Both ticks run from timer callbacks rather than the effect body: the first is
  // deferred a task so the initial fetch cannot set state during the render commit.
  // While a reply is being composed the tick is faster, so the line shows up close
  // to when it was promised rather than up to a full poll later.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), typing ? TYPING_POLL_MS : POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load, typing]);

  // Start pinned to the newest message, and stay pinned as turns arrive.
  // Pinned by *which* row is newest, not by how many there are: a poll that appends
  // one message and retimes another leaves the length unchanged, and the live page
  // showed the consequence — the newest bubble sitting half under the composer.
  const newestKey = rows[rows.length - 1]?.key;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    const frame = requestAnimationFrame(pin);
    return () => cancelAnimationFrame(frame);
  }, [newestKey, rows.length, typing]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setNotice(null);
    // The quote is sent with the message, so the room knows what is being answered
    // and the bubble can render the strip above it.
    const quoted = replyTo?.seq;
    try {
      const response = await fetch("/api/forum/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(quoted === undefined ? { text } : { text, replyTo: quoted }),
      });
      const data = (await response.json()) as RoomResponse;

      if (!response.ok || data.error) {
        setNotice(data.error ?? "the room could not take that message");
        return;
      }

      setDraft("");
      setReplyTo(null);
      const live = adopt(data);
      // `deferred` is the normal path and is not worth a notice — the typing
      // indicator is the feedback. A notice only appears if the room took the
      // message but reported no reply and no pending one at all.
      if (live && !data.pending && data.reply?.status !== "published") {
        setNotice("sent — waiting for the room");
      }
    } catch {
      setNotice("could not reach the room");
    } finally {
      setSending(false);
    }
  };

  /**
   * Leave (or take back) a reaction on one bubble. It is a write like a message, so it
   * goes through the same endpoint and adopts the same projection back — the count on
   * the chip is the server's, never an optimistic guess.
   */
  const react = useCallback(async (seq: number, emoji: string) => {
    try {
      const response = await fetch("/api/forum/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reaction: { seq, emoji } }),
      });
      const data = (await response.json()) as RoomResponse;
      if (!response.ok || data.error) {
        setNotice(data.error ?? "the room could not take that reaction");
        return;
      }
      adopt(data);
    } catch {
      setNotice("could not reach the room");
    }
  }, [adopt]);

  /** The scrollback is memoized, so these callbacks must be stable across renders. */
  const onJump = useCallback((seq: number) => {
    scrollRef.current
      ?.querySelector(`[data-seq="${seq}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, []);
  const onReply = useCallback((row: Row) => setReplyTo(row), []);
  const onReact = useCallback((seq: number, emoji: string) => void react(seq, emoji), [react]);
  const onOpenProfile = useCallback((p: ChatPersona) => setProfile(p), []);

  const members = roster ?? PERSONAS;
  const label =
    source === "live"
      ? "live"
      : source === "demo"
        ? "demo replay · the room is quiet"
        : "room unavailable · demo replay";

  /** How many lines each member has, for the profile panel. */
  const messageCountFor = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (!row.system) counts.set(row.from, (counts.get(row.from) ?? 0) + 1);
    }
    return (id: string) => counts.get(id) ?? 0;
  }, [rows]);

  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col px-2 sm:px-4">
      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-surface/95 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.65)] backdrop-blur">
        {/* ---------- header ---------- */}
        <header className="flex items-center gap-3 border-b border-border/70 bg-surface px-4 py-2.5">
          <button
            type="button"
            data-testid="community-header"
            onClick={() => setOverviewOpen(true)}
            aria-label="Open community overview"
            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl text-left transition-colors hover:bg-surface-2/60"
          >
            <span
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
              style={{ background: "linear-gradient(135deg, #2e90fa, #00c896)" }}
            >
              <BrandMark size={28} />
            </span>
            <span className="min-w-0 flex-1">
              {/* a span, not an h1: the whole header is a button, and a heading is not
                  phrasing content */}
              <span className="block truncate text-[15px] font-semibold text-foreground">
                {community.name}
              </span>
              {typing && (
                <span
                  data-testid="typing"
                  className="flex items-center gap-1.5 text-xs font-medium text-brand"
                >
                  {personaFor(typing.sender).name} is typing
                  <TypingDots />
                </span>
              )}
              <span data-testid="room-status" className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  className={`inline-block h-1.5 w-1.5 rounded-full ${
                    source === "live" ? "bg-gain" : source === "demo" ? "bg-muted" : "bg-loss"
                  }`}
                  aria-hidden
                />
                {members.length} members · {members.filter((p) => p.online).length} online · {label}
              </span>
            </span>
          </button>
          {/* Start Trading — the room's exit into the product. It sits in the header
              so it is in view for the whole conversation, on every screen size. */}
          <Link
            href="/signin"
            data-testid="start-trading"
            className="group hidden shrink-0 items-center gap-1.5 rounded-full bg-gradient-to-r from-brand to-gain px-3.5 py-2 text-[13px] font-semibold text-[#071018] shadow-[0_6px_20px_-8px_rgba(46,144,250,0.6)] transition-transform active:scale-[0.98] sm:inline-flex"
          >
            Start trading
            <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
          </Link>
          <Link
            href="/signin"
            data-testid="start-trading-compact"
            aria-label="Start trading"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gradient-to-r from-brand to-gain text-[#071018] sm:hidden"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
          <div className="flex items-center gap-1 text-muted">
            {[Search, Phone, MoreVertical].map((Icon, i) => (
              <button
                key={i}
                type="button"
                aria-label="Chat action"
                className="rounded-full p-2 transition-colors hover:bg-surface-2 hover:text-foreground"
              >
                <Icon className="h-[18px] w-[18px]" />
              </button>
            ))}
          </div>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ---------- messages ---------- */}
          <Transcript
            rows={rows}
            roster={roster}
            replyToSeq={replyTo?.seq}
            typing={typing}
            source={source}
            notice={notice}
            scrollRef={scrollRef}
            onJump={onJump}
            onReply={onReply}
            onReact={onReact}
            onOpenProfile={onOpenProfile}
          />

          {/* ---------- members rail ---------- */}
          <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-border/70 bg-surface/60 px-2 py-3 xl:flex">
            <p className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Members
            </p>
            <MemberRow p={{ ...YOU, role: "you · online" }} />
            {[...members].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (
              <MemberRow key={p.id} p={p} onClick={() => setProfile(p)} />
            ))}
          </aside>
        </div>

        {/* ---------- composer ---------- */}
        {replyTo && (
          <div
            data-testid="reply-bar"
            className="flex items-center gap-2 border-t border-border/70 bg-surface-2/70 px-3 py-1.5 sm:px-4"
          >
            <CornerUpLeft className="h-4 w-4 shrink-0 text-brand" />
            <span className="text-[12px] font-semibold text-brand">
              Replying to {personaFor(replyTo.from).name}
            </span>
            <span className="min-w-0 flex-1 truncate text-[12px] text-muted">{replyTo.text}</span>
            <button
              type="button"
              aria-label="Cancel reply"
              data-testid="reply-cancel"
              onClick={() => setReplyTo(null)}
              className="rounded-full p-1 text-muted transition-colors hover:bg-surface hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        <footer className="flex items-center gap-1.5 border-t border-border/70 bg-surface px-3 py-2.5 sm:px-4">
          <button
            type="button"
            aria-label="Emoji"
            className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Smile className="h-5 w-5" />
          </button>
          <button
            type="button"
            aria-label="Attach"
            className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground"
          >
            <Paperclip className="h-5 w-5" />
          </button>
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            disabled={sending}
            placeholder={sending ? "Sending…" : "Message the community…"}
            className="h-10 min-w-0 flex-1 rounded-full border border-border bg-background/60 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-brand/60 disabled:opacity-60"
          />
          <button
            type="button"
            aria-label={draft.trim() ? "Send" : "Voice message"}
            onClick={() => void send()}
            className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all ${
              draft.trim()
                ? "bg-gradient-to-r from-brand to-gain text-[#071018] shadow-[0_6px_20px_-6px_rgba(46,144,250,0.6)]"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            }`}
          >
            {draft.trim() ? <Send className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
        </footer>

        {overviewOpen && (
          <CommunityOverview
            community={community}
            members={members}
            onClose={() => setOverviewOpen(false)}
            onOpenMember={(p) => setProfile(p)}
          />
        )}
        {profile && (
          <ProfilePanel
            persona={profile}
            messageCount={messageCountFor(profile.id)}
            onClose={() => setProfile(null)}
          />
        )}
      </div>
    </div>
  );
}
