/**
 * The room's published projection (spec §13.3).
 *
 * Reading this is what "wakes" the room: when no worker holds a heartbeat, the
 * handler runs a bounded catch-up before answering, so opening /community brings
 * the conversation forward instead of showing a room that stopped hours ago.
 * `?catchup=0` reads without advancing, and `?since=<seq>` returns only what is
 * new.
 *
 * Only published messages cross this boundary. Prompts, character sheets, world
 * state, gate verdicts and costs never do (spec §13.2).
 */

import { NextResponse } from "next/server";

import { advance, previewHumanReply } from "@/lib/forum/advance";
import { catchUp, roomMode } from "@/lib/forum/catchup";
import { nextTurnAt } from "@/lib/forum/clock";
import { messagesFromTurns, openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";
/**
 * A reply is composed after a person's 30–60s "typing" window, and the Voice can
 * spend a few seconds on it. The default function budget is too tight for that
 * tail, so the room is given the longest budget Vercel allows on this plan.
 */
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** The external sender id every human message carries (spec §9). */
const HUMAN_SENDER = "human";
/** Roughly a long chat message; the room's own posts are far shorter. */
const MAX_HUMAN_CHARS = 600;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const since = Number(url.searchParams.get("since") ?? "0");
  const shouldWake = url.searchParams.get("catchup") !== "0";
  const store = openForumStore();

  try {
    const now = Date.now();
    const config = await store.readConfig();

    const report = shouldWake ? await catchUp(store, { now }) : null;

    const turns = await store.readTurns(Number.POSITIVE_INFINITY);
    const last = turns[turns.length - 1] ?? null;
    const messages = messagesFromTurns(turns).filter(
      (message) => message.seq > (Number.isFinite(since) ? since : 0),
    );

    // Who is "typing" at a person, if anyone. Only rendered while a reply is owed.
    const pending = await previewHumanReply(store, now);

    return NextResponse.json(
      {
        mode: report?.mode ?? "lazy",
        roomId: config.roomId,
        seq: last?.seq ?? 0,
        lastTurnAt: last?.t ?? null,
        nextExpectedAt: pending ? pending.dueAt : last ? nextTurnAt(last.t, config.scheduling.gapSec) : null,
        pending,
        messages,
        catchUp: report
          ? {
              owed: report.owed,
              ran: report.ran,
              skipped: report.skipped,
              recapped: report.recapped,
              reason: report.reason,
              dueAt: report.dueAt ?? null,
            }
          : null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    // No room on this host: report it instead of failing the page.
    return NextResponse.json(
      {
        mode: "unavailable",
        messages: [],
        error: error instanceof Error ? error.message : "the room is unavailable",
      },
      { status: 200, headers: NO_STORE },
    );
  }
}

/**
 * A person speaks (spec §9, §13.3).
 *
 * The message is appended first, which puts it at the head of the log as an
 * external sender. That alone is enough for the agenda: its first rule is "a
 * person spoke and is owed a reply" (§4).
 *
 * The reply is not returned here. It is paced 30–60s out on its own clock (§9),
 * so this handler records the message and reports the pending reply (who is
 * typing, and when it is due); the client shows a typing bubble and polls `GET`
 * until the reply lands. A room configured with a zero-length window replies
 * inline instead.
 *
 * `replyTo` (a message seq) is optional and is what the UI sends when somebody
 * quotes an earlier message: it is stored on the message and echoed back, so the
 * bubble renders the quoted strip and the responder is told what it is answering.
 *
 * Safe alongside a worker: `advance()` takes the turn lease, so a worker already
 * driving the room simply wins and the reply arrives on its next tick.
 */
export async function POST(request: Request) {
  const store = openForumStore();
  const now = Date.now();

  try {
    let body: unknown = null;
    try {
      body = await request.json();
    } catch {
      body = null;
    }

    const text =
      typeof (body as { text?: unknown } | null)?.text === "string"
        ? ((body as { text: string }).text ?? "").trim()
        : "";

    if (text === "") {
      return NextResponse.json({ error: "a message needs text" }, { status: 400, headers: NO_STORE });
    }
    if (text.length > MAX_HUMAN_CHARS) {
      return NextResponse.json(
        { error: `a message must be ${MAX_HUMAN_CHARS} characters or fewer` },
        { status: 400, headers: NO_STORE },
      );
    }

    const config = await store.readConfig();
    const topics = await store.readTopics();
    const topic = topics[0];
    if (!topic) throw new Error("forum: the topic deck is empty");

    // A quote must point at a message that exists: anything else is dropped rather
    // than stored as a dangling reference the UI cannot resolve.
    const requestedReplyTo = Number((body as { replyTo?: unknown } | null)?.replyTo);
    const lastTurn = await store.readLastTurn();
    const replyToSeq =
      Number.isInteger(requestedReplyTo) &&
      requestedReplyTo > 0 &&
      requestedReplyTo <= (lastTurn?.seq ?? 0)
        ? requestedReplyTo
        : undefined;

    const accepted = await store.appendHumanMessage({
      text,
      sender: HUMAN_SENDER,
      t: now,
      topicId: topic.id,
      replyToSeq,
    });

    // This almost always returns `deferred`: a person's reply is paced 30–60s out
    // (§9), so the client shows a typing bubble and polls until it lands. It still
    // runs so a room configured with a zero-length window replies inline.
    const reply = await advance(store, { now: now + 1, driver: "human" });
    const turns = await store.readTurns(Number.POSITIVE_INFINITY);
    const last = turns[turns.length - 1] ?? null;
    const pending = await previewHumanReply(store, now + 1);

    return NextResponse.json(
      {
        mode: await roomMode(store, now),
        roomId: config.roomId,
        seq: last?.seq ?? 0,
        lastTurnAt: last?.t ?? null,
        nextExpectedAt: pending ? pending.dueAt : last ? nextTurnAt(last.t, config.scheduling.gapSec) : null,
        pending,
        accepted: { seq: accepted.seq, text, replyToSeq: replyToSeq ?? null },
        reply: {
          status: reply.status,
          chosen: reply.record?.chosen ?? null,
          dueAt: reply.dueAt ?? pending?.dueAt ?? null,
        },
        messages: messagesFromTurns(turns),
        catchUp: null,
      },
      { headers: NO_STORE },
    );
  } catch (error) {
    return NextResponse.json(
      {
        mode: "unavailable",
        messages: [],
        reply: null,
        error: error instanceof Error ? error.message : "the room is unavailable",
      },
      { status: 200, headers: NO_STORE },
    );
  }
}
