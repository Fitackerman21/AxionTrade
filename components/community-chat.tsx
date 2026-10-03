"use client";

/**
 * Axion community chat — Telegram-style group chat, live edition.
 *
 * The transcript is the real room: turns come from `GET /api/forum/messages`,
 * which also wakes a lazy room via bounded catch-up, and are polled so the
 * conversation comes forward while the page is open. Sending a message POSTs to
 * the same endpoint, which appends it as an external sender and advances once —
 * the agenda's first rule is "a person spoke and is owed a reply" — so a reply
 * arrives immediately rather than after the room's 45–180s cadence.
 *
 * The scripted replay from `lib/community-chat.ts` is the fallback: it seeds the
 * transcript when the room is empty, unreachable, or running on a host without
 * one, so the page never renders as broken.
 *
 * Bubble spec follows Telegram Web (tweb) night mode: solid bubbles, sender name
 * inside the bubble, time inline at the end of the text, avatar rendered only on
 * the last message of a group and bottom-aligned, last bubble in a group gets the
 * squared avatar-side corner.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Bot,
  CheckCheck,
  Mic,
  MoreVertical,
  Paperclip,
  Phone,
  Search,
  Send,
  Smile,
} from "lucide-react";

import { BrandMark } from "@/components/brand";
import {
  ONLINE_COUNT,
  PERSONAS,
  REPLAY,
  type ChatPersona,
} from "@/lib/community-chat";
import type { ForumMessage } from "@/lib/forum/types";

const byId = new Map(PERSONAS.map((p) => [p.id, p]));

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

/** How often the open page refreshes the transcript while the room advances. */
const POLL_MS = 6_000;
/** A gap this long between messages breaks the avatar/name grouping. */
const GROUP_GAP_MS = 5 * 60_000;

interface Row {
  key: string;
  from: string;
  text: string;
  ticker?: string;
  /** epoch ms */
  at: number;
  system: boolean;
}

type Source = "live" | "demo" | "unavailable";

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
  return REPLAY.map((m) => ({
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
    from: m.sender,
    text: m.text,
    at: m.t,
    system: m.system,
  }));
}

/** Deterministic 0/1 so sticker arrows stay stable across renders. */
const up = (id: number) => id % 2 === 0;

function Avatar({ p, size = 34 }: { p: ChatPersona; size?: number }) {
  return (
    <span
      className="relative flex shrink-0 items-center justify-center rounded-full font-semibold text-[#071018]"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.36,
        background: `linear-gradient(135deg, ${p.g1}, ${p.g2})`,
      }}
      aria-hidden
    >
      {p.bot ? <Bot className="h-1/2 w-1/2 text-[#071018]" /> : initials(p.name)}
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
}: {
  row: Row;
  sender: ChatPersona;
  first: boolean;
  last: boolean;
  outgoing: boolean;
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
            {sender.bot && (
              <span className="ml-1.5 rounded bg-brand/25 px-1 py-px align-middle text-[10px] font-medium text-brand">
                AxAI
              </span>
            )}
          </p>
        )}
        {row.system && (
          <p className="text-[11px] font-medium tracking-wide text-muted uppercase">engine</p>
        )}
        {row.ticker && (
          <div className="mt-1">
            <TickerChip ticker={row.ticker} id={row.at} />
          </div>
        )}
        <p className="text-[14.5px] leading-[1.35] break-words">
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
      </div>
    </div>
  );
}

function MemberRow({ p }: { p: ChatPersona }) {
  return (
    <div className="flex items-center gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2/70">
      <Avatar p={p} size={32} />
      <div className="min-w-0">
        <p className="truncate text-[13px] font-medium" style={{ color: p.color }}>
          {p.name}
        </p>
        <p className="truncate text-[11px] text-muted">{p.role}</p>
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
  const scrollRef = useRef<HTMLDivElement>(null);

  const adopt = useCallback((data: { messages?: ForumMessage[]; error?: string }) => {
    if (data.messages && data.messages.length > 0) {
      setRows(liveRows(data.messages));
      setSource("live");
      setNotice(null);
      return true;
    }
    setSource(data.error ? "unavailable" : "demo");
    return false;
  }, []);

  /**
   * Reading refreshes *and* wakes: the endpoint's catch-up is what brings a paused
   * room forward, so polling while the page is open is the room's heartbeat.
   */
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/forum/messages", { cache: "no-store" });
      adopt((await response.json()) as { messages?: ForumMessage[]; error?: string });
    } catch {
      setSource("unavailable");
    }
  }, [adopt]);

  // Both ticks run from timer callbacks rather than the effect body: the first is
  // deferred a task so the initial fetch cannot set state during the render commit.
  useEffect(() => {
    const first = setTimeout(() => void load(), 0);
    const timer = setInterval(() => void load(), POLL_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [load]);

  // Start pinned to the newest message, and stay pinned as turns arrive.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [rows.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    setNotice(null);
    try {
      const response = await fetch("/api/forum/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = (await response.json()) as {
        messages?: ForumMessage[];
        error?: string;
        reply?: { status: string; chosen: string | null } | null;
      };

      if (!response.ok || data.error) {
        setNotice(data.error ?? "the room could not take that message");
        return;
      }

      setDraft("");
      const live = adopt(data);
      if (live && !data.reply) setNotice("sent — waiting for the room");
      else if (live && data.reply?.status !== "published") {
        setNotice(`sent — no reply this turn (${data.reply?.status ?? "unknown"})`);
      }
    } catch {
      setNotice("could not reach the room");
    } finally {
      setSending(false);
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
            <p className="flex items-center gap-1.5 text-xs text-muted">
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${
                  source === "live" ? "bg-gain" : source === "demo" ? "bg-muted" : "bg-loss"
                }`}
                aria-hidden
              />
              {PERSONAS.length} members · {ONLINE_COUNT} online · {label}
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
              return (
                <div key={row.key} className={first ? "mt-3" : "mt-[2px]"}>
                  <Bubble row={row} sender={sender} first={first} last={last} outgoing={outgoing} />
                </div>
              );
            })}

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
            {[...PERSONAS].sort((a, b) => Number(b.online) - Number(a.online)).map((p) => (
              <MemberRow key={p.id} p={p} />
            ))}
          </aside>
        </div>

        {/* ---------- composer ---------- */}
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
