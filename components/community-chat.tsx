"use client";

/**
 * Axion community chat — Telegram-style group chat, demo edition.
 * Ten hardcoded personas (lib/community-chat.ts) replay a trading-day
 * conversation; the composer appends your own messages locally so the
 * outgoing bubble style is visible. No backend.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
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

const byId = new Map(PERSONAS.map((p) => [p.id, p]));

/** "You" — the local demo sender, not part of the fake member list. */
const YOU: ChatPersona = {
  id: "you",
  name: "You",
  role: "Axion member",
  g1: "#2e90fa",
  g2: "#00c896",
  color: "#9fc6ff",
  online: true,
};

function initials(name: string) {
  const chars = name.replace(/[^a-z0-9]/gi, "");
  const digit = chars.match(/\d/)?.[0];
  return (chars[0]?.toUpperCase() ?? "?") + (digit ?? chars[1]?.toUpperCase() ?? "");
}

/** Deterministic 0/1 so sticker arrows stay stable across renders. */
const up = (id: number) => id % 2 === 0;

function Avatar({ p, size = 38 }: { p: ChatPersona; size?: number }) {
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
      className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-semibold ${
        isUp ? "border-gain/25 bg-gain/10 text-gain" : "border-loss/25 bg-loss/10 text-loss"
      }`}
    >
      {isUp ? "▲" : "▼"} {ticker}
    </span>
  );
}

function Bubble({
  msg,
  sender,
  time,
  first,
  last,
  outgoing,
}: {
  msg: { id: number; text: string; ticker?: string };
  sender: ChatPersona;
  time: string;
  first: boolean;
  last: boolean;
  outgoing: boolean;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={`flex w-full items-end gap-2.5 ${outgoing ? "justify-end" : "justify-start"}`}
    >
      {!outgoing && (
        <span className="w-[38px] shrink-0">
          {last && <Avatar p={sender} />}
        </span>
      )}
      <div
        className={`glass max-w-[78%] rounded-2xl px-3.5 py-2 sm:max-w-[62%] ${
          outgoing
            ? `rounded-br-md ${first ? "rounded-tr-md" : "rounded-tr-2xl"}`
            : `rounded-bl-md ${first ? "rounded-tl-md" : "rounded-tl-2xl"}`
        }`}
      >
        {!outgoing && first && (
          <p className="text-[13px] leading-none font-semibold" style={{ color: sender.color }}>
            {sender.name}
            {sender.bot && (
              <span className="ml-1.5 rounded bg-brand/15 px-1 py-0.5 text-[10px] font-medium text-brand">
                AxAI
              </span>
            )}
          </p>
        )}
        {msg.ticker && (
          <div className={first && !outgoing ? "mt-1.5" : "mt-1"}>
            <TickerChip ticker={msg.ticker} id={msg.id} />
          </div>
        )}
        <p className="mt-1 text-[14.5px] leading-snug break-words text-foreground">{msg.text}</p>
        <p className="mt-0.5 flex items-center justify-end gap-1 text-[11px] text-muted">
          {time}
          {outgoing && <CheckCheck className="h-3.5 w-3.5 text-brand" />}
        </p>
      </div>
    </motion.div>
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

interface ReplayMessage {
  id: number;
  from: string;
  text: string;
  ticker?: string;
  /** absolute minute-of-day */
  t: number;
}

export function CommunityChat() {
  const [extra, setExtra] = useState<ReplayMessage[]>([]);
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const base = REPLAY;

  const all = useMemo(() => {
    const lastT = base[base.length - 1]?.t ?? 8 * 60;
    return [...base, ...extra.map((m, i) => ({ ...m, t: lastT + 1 + i * 2 }))];
  }, [base, extra]);

  // start pinned to the newest message
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [all.length]);

  const send = () => {
    const text = draft.trim();
    if (!text) return;
    setExtra((x) => [...x, { id: 1000 + x.length, from: YOU.id, text, t: 0 }]);
    setDraft("");
  };

  return (
    <div className="relative mx-auto flex h-full w-full max-w-6xl flex-col px-2 sm:px-4">
      <div className="glass flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
        {/* ---------- header ---------- */}
        <header className="flex items-center gap-3 border-b border-border/70 px-4 py-3">
          <span
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full"
            style={{ background: "linear-gradient(135deg, #2e90fa, #00c896)" }}
          >
            <BrandMark size={30} />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[15px] font-semibold text-foreground">Axion Community</h1>
            <p className="text-xs text-muted">
              {PERSONAS.length} members · {ONLINE_COUNT} online · demo replay
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
          <div
            ref={scrollRef}
            className="bg-grid relative min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 py-4 sm:px-5"
          >
            <div className="mb-4 flex justify-center">
              <span className="rounded-full border border-border bg-surface/80 px-3 py-1 text-[11px] font-medium text-muted backdrop-blur">
                Today
              </span>
            </div>

            {all.map((m, i) => {
              const sender = m.from === YOU.id ? YOU : byId.get(m.from)!;
              const outgoing = m.from === YOU.id;
              const prev = i > 0 ? all[i - 1] : null;
              const next = i < all.length - 1 ? all[i + 1] : null;
              const first = !prev || prev.from !== m.from || m.t - prev.t > 5;
              const last = !next || next.from !== m.from || next.t - m.t > 5;
              const time = `${String(Math.floor(m.t / 60) % 24).padStart(2, "0")}:${String(m.t % 60).padStart(2, "0")}`;
              return (
                <Bubble
                  key={m.id}
                  msg={m}
                  sender={sender}
                  time={time}
                  first={first}
                  last={last}
                  outgoing={outgoing}
                />
              );
            })}
          </div>

          {/* ---------- members rail ---------- */}
          <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-l border-border/70 px-2 py-3 xl:flex">
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
        <footer className="flex items-center gap-2 border-t border-border/70 px-3 py-3 sm:px-4">
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
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Message the community…"
            className="h-11 min-w-0 flex-1 rounded-full border border-border bg-surface/70 px-4 text-sm text-foreground outline-none transition-colors placeholder:text-muted/70 focus:border-brand/60"
          />
          <button
            type="button"
            aria-label={draft ? "Send" : "Voice message"}
            onClick={draft.trim() ? send : undefined}
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full transition-all ${
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
