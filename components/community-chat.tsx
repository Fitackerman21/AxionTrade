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
 * the last message of a group and bottom-aligned, last bubble in a group gets the
 * squared avatar-side corner.
 *
 * Quoted replies work the way they do in a phone messenger: swipe a message to the
 * right (or hover it and use the arrow on a desktop) to answer that specific line,
 * the composer shows what you are replying to, and the answer renders with the
 * original quoted above it. The room's own lines carry the same quote, because
 * every reply in the log records the message it answered (`replyToSeq`).
 *
 * The "… is typing" indicator appears in two places on purpose: in the header, and
 * as a bubble at the end of the transcript, which is where a messenger puts it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCheck,
  CornerUpLeft,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
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

async function refreshPersonas(): Promise<void> {
  try {
    const response = await fetch("/api/admin/roster", { cache: "no-store" });
    if (!response.ok) return;
    const body = (await response.json()) as { personas?: ChatPersona[] };
    if (Array.isArray(body.personas) && body.personas.length > 0) {
      livePersonas = body.personas;
      byId.clear();
      for (const p of body.personas) byId.set(p.id, p);
    }
  } catch {
    // the bundled roster stays in place — the room must render even if this fails
  }
}
void refreshPersonas();

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

/** How often the open page refreshes the transcript while the room is idle. */
const POLL_MS = 6_000;
/** A faster tick while someone is typing, so the reply lands close to its due time. */
const TYPING_POLL_MS = 3_000;
/** A gap this long between messages breaks the avatar/name grouping. */
const GROUP_GAP_MS = 5 * 60_000;

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

function Avatar({ p, size = 34 }: { p: ChatPersona; size?: number }) {
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
        <span className="absolute right-0 bottom-0 h-2.5 w-2.5 rounded-full border-2 border-background bg-gain" />
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

function Bubble({
  row,
  sender,
  first,
  last,
  outgoing,
  quoted,
  onJump,
  onReact,
}: {
  row: Row;
  sender: ChatPersona;
  first: boolean;
  last: boolean;
  outgoing: boolean;
  /** the message this one answers, when it is still on screen */
  quoted?: Row;
  onJump?: (seq: number) => void;
  onReact?: (seq: number, emoji: string) => void;
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

  return (
    <div
      className={`flex items-end gap-2 ${outgoing ? "justify-end pl-12" : "justify-start pr-12"}`}
    >
      {!outgoing && (
        <span className="w-[34px] shrink-0">{last && <Avatar p={sender} />}</span>
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
            {sender.name}
          </p>
        )}
        {quoted && (
          <button
            type="button"
            data-testid="quoted"
            onClick={() => quoted.seq !== undefined && onJump?.(quoted.seq)}
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
                  onClick={() => row.seq !== undefined && onReact?.(row.seq, reaction.emoji)}
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

function MemberRow({ p }: { p: ChatPersona }) {
  const subtitle = p.bio ? p.bio : p.role;
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2/70">
      <Avatar p={p} size={32} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium" style={{ color: p.color }}>
          {p.name}
          {p.age ? <span className="ml-1 text-[11px] text-muted">· {p.age}</span> : null}
        </p>
        <p className="truncate text-[11px] text-muted">{subtitle}</p>
      </div>
    </div>
  );
}

export function CommunityChat() {
  const [rows, setRows] = useState<Row[]>(replayRows);
  const [source, setSource] = useState<Source>("demo");
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [typing, setTyping] = useState<PendingReply | null>(null);
  /** the seq whose emoji palette is open, if any */
  const [reacting, setReacting] = useState<number | null>(null);
  /** the message being answered, set by a swipe or the hover arrow */
  const [replyTo, setReplyTo] = useState<Row | null>(null);
  /** the in-progress swipe: which row, and how far it has been dragged */
  const [swipe, setSwipe] = useState<{ key: string; dx: number } | null>(null);
  const dragRef = useRef<{ key: string; x0: number } | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  /** Live rows by seq, so a quoted strip can resolve the message it points at. */
  const bySeq = useMemo(() => {
    const map = new Map<number, Row>();
    for (const row of rows) if (row.seq !== undefined) map.set(row.seq, row);
    return map;
  }, [rows]);

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
  //
  // Pinned by *which* row is newest, not by how many there are: a poll that appends
  // one message and retimes another leaves the length unchanged, and the live page
  // showed the consequence — the newest bubble sitting half under the composer, so
  // the last thing the room said was the one thing a visitor could not read.
  const newestKey = rows[rows.length - 1]?.key;
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const pin = () => {
      el.scrollTop = el.scrollHeight;
    };
    pin();
    // Again after the frame that laid the new row out, because a message bubble and
    // the mobile viewport both settle after the effect runs.
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
  const react = async (seq: number, emoji: string) => {
    setReacting(null);
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
  };

  const label =
    source === "live"
      ? "live"
      : source === "demo"
        ? "demo replay · the room is quiet"
        : "room unavailable · demo replay";

  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col px-2 sm:px-4">
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-border/70 bg-surface/95 shadow-[0_24px_64px_-16px_rgba(0,0,0,0.65)] backdrop-blur">
        {/* ---------- header ---------- */}
        <header className="flex items-center gap-3 border-b border-border/70 bg-surface px-4 py-2.5">
          <span
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
            style={{ background: "linear-gradient(135deg, #2e90fa, #00c896)" }}
          >
            <BrandMark size={28} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-foreground">Axion Community</h1>
            {typing && (
              <p
                data-testid="typing"
                className="flex items-center gap-1.5 text-xs font-medium text-brand"
              >
                {personaFor(typing.sender).name} is typing
                <TypingDots />
              </p>
            )}
            <p
              data-testid="room-status"
              className="flex items-center gap-1.5 text-xs text-muted"
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  source === "live" ? "bg-gain" : source === "demo" ? "bg-muted" : "bg-loss"
                }`}
                aria-hidden
              />
              {(livePersonas ?? PERSONAS).length} members · {(livePersonas ?? PERSONAS).filter((p) => p.online).length} online · {label}
            </p>
          </div>
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
          <div ref={scrollRef} className="bg-grid relative min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-5">
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
              const dragging = swipe?.key === row.key ? swipe.dx : 0;

              return (
                <div
                  key={row.key}
                  data-seq={row.seq}
                  data-testid="message"
                  className={`group relative ${first ? "mt-3" : "mt-[2px]"} ${
                    row.seq !== undefined && row.seq === replyTo?.seq ? "rounded-lg bg-brand/10" : ""
                  }`}
                  style={{
                    transform: dragging ? `translateX(${dragging}px)` : undefined,
                    transition: dragging ? "none" : "transform 120ms ease-out",
                    touchAction: "pan-y",
                  }}
                  // Swipe right to reply, the way a phone messenger does it.
                  onPointerDown={(event) => {
                    if (event.pointerType === "mouse") return;
                    dragRef.current = { key: row.key, x0: event.clientX };
                  }}
                  onPointerMove={(event) => {
                    const drag = dragRef.current;
                    if (!drag || drag.key !== row.key) return;
                    const dx = Math.max(0, Math.min(SWIPE_MAX_PX, event.clientX - drag.x0));
                    if (dx > 4) setSwipe({ key: row.key, dx });
                  }}
                  onPointerUp={() => {
                    const dx = swipe?.key === row.key ? swipe.dx : 0;
                    dragRef.current = null;
                    setSwipe(null);
                    if (dx >= SWIPE_TRIGGER_PX) setReplyTo(row);
                  }}
                  onPointerCancel={() => {
                    dragRef.current = null;
                    setSwipe(null);
                  }}
                >
                  {dragging > 4 && (
                    <span
                      aria-hidden
                      data-testid="swipe-reply"
                      className="absolute top-1/2 left-1 -translate-y-1/2 text-brand"
                      style={{ opacity: Math.min(1, dragging / SWIPE_TRIGGER_PX) }}
                    >
                      <CornerUpLeft className="h-5 w-5" />
                    </span>
                  )}
                  <Bubble
                    row={row}
                    sender={sender}
                    first={first}
                    last={last}
                    outgoing={outgoing}
                    quoted={quoted}
                    onJump={(seq) =>
                      scrollRef.current
                        ?.querySelector(`[data-seq="${seq}"]`)
                        ?.scrollIntoView({ block: "center", behavior: "smooth" })
                    }
                    onReact={(seq, emoji) => void react(seq, emoji)}
                  />
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
                        onClick={() => setReplyTo(row)}
                        // Hover affordance for a mouse: a swipe needs a thumb.
                        className="rounded-full bg-surface-2 p-1.5 text-muted"
                      >
                        <CornerUpLeft className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        aria-label={`React to ${sender.name}`}
                        data-testid="react-action"
                        onClick={() =>
                          setReacting(reacting === row.seq ? null : (row.seq ?? null))
                        }
                        className="rounded-full bg-surface-2 p-1.5 text-muted"
                      >
                        <Smile className="h-4 w-4" />
                      </button>
                    </div>
                  )}
                  {reacting === row.seq && row.seq !== undefined && (
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
                          onClick={() => void react(row.seq!, emoji)}
                          className="rounded-full px-1 text-[16px] leading-none transition-transform hover:scale-125"
                        >
                          {emoji}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {/* `items-center` on purpose: the transcript's message rows are matched by
                the e2e spec with `div.flex.items-end.gap-2`, and a typing bubble is not
                a message. */}
            {typing && source === "live" && (
              <div data-testid="typing-row" className="mt-3 flex items-center gap-2">
                <span className="w-[34px] shrink-0">
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

          {/* ---------- members rail ---------- */}
          <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-border/70 bg-surface/60 px-2 py-3 xl:flex">
            <p className="px-2 pb-2 text-[11px] font-semibold tracking-wide text-muted uppercase">
              Members
            </p>
            <MemberRow p={{ ...YOU, role: "you · online" }} />
            {[...(livePersonas ?? PERSONAS)].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (
              <MemberRow key={p.id} p={p} />
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
      </div>
    </div>
  );
}
