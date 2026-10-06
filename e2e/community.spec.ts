/**
 * Live test of the community page (P7 + P1 + §9): a person sends a message and
 * the room answers it through the real `/api/forum/messages` round trip.
 *
 * Deliberately end-to-end and not hermetic — it exercises the running room, the
 * Voice, the Gate and the paced reply exactly as a visitor would.
 * `npm run test:e2e`.
 *
 * The two properties this asserts, and that the earlier version could not:
 *  - a person's message is *always* answered (the old build could leave it in
 *    UNPUBLISHED, which looked like the room had died), and
 *  - the answer is paced 30–60s out with a visible typing indicator — in the room
 *    header and as a bubble in the transcript — not returned in the same instant,
 *  - the room quotes the line it answers, and a visitor can answer a specific line.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The bubble row wrapper; outgoing rows also carry `justify-end`. */
const MESSAGE_ROW = "div.flex.items-end.gap-2";

/** `allow["human"]` in data/forum/config.json — who may answer a person. */
const PERMITTED: Record<string, string> = {
  "Mara Okafor": "mara",
  Solene: "sol",
  "Dmitri V.": "dmitri",
  "Rafa Duarte": "rafa",
  "Jess T.": "jess",
};

/**
 * The visitor's line, varied per run — deliberately.
 *
 * This suite is not hermetic: it posts into the room it is testing. With a fixed
 * string every run appends another identical copy, and the live room had collected
 * "fair point — but what's the stop on that?" six times, which is more obviously
 * synthetic than anything the personas had said. The variation has to be plausible,
 * so it is the two things a person here actually types — the price on their screen
 * and the time — which is also why nobody quotes the same tenth of a dollar twice.
 */
function probe(prefix: string): string {
  const now = new Date();
  const price = (2400 + Math.random() * 40).toFixed(1);
  const clock = `${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  return `${prefix} ${price} on my screen, ${clock} UTC`;
}

const QUESTION = probe("Evening room — what's the read on gold into the close?");

interface Row {
  /** true for the visitor's own bubbles */
  outgoing: boolean;
  /** the rendered sender name, read from the bubble rather than parsed from text */
  name: string | null;
  /** `<avatar initials> <name> <message> <clock>` for a persona row */
  text: string;
  /**
   * The bubble's own line, without the avatar/name/clock — and without a quoted
   * strip. This is what makes "the room said something" a real assertion: a row that
   * only echoed the visitor's quoted words would otherwise pass.
   */
  own: string;
}

async function readRows(page: Page): Promise<Row[]> {
  return page.locator(MESSAGE_ROW).evaluateAll((rows) =>
    rows.map((row) => {
      const el = row as HTMLElement;
      // Only a persona bubble renders the sender name (components/community-chat.tsx).
      // Read the text node, not textContent: Jev's bubble appends the "AxAI" badge
      // span, which would otherwise make the name "JevAxAI".
      const nameEl = el.querySelector("p.font-semibold");
      return {
        outgoing: el.className.includes("justify-end"),
        name: nameEl?.childNodes[0]?.textContent?.trim() ?? null,
        text: el.innerText.replace(/\s+/g, " ").trim(),
        own: (el.querySelector('[data-testid="message-text"]')?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      };
    }),
  );
}

test("the live community page answers a person, after a visible composing pause", async ({
  page,
}) => {
  await page.goto("/community");

  // "live" in the status line means the transcript came from the room, not the
  // demo replay the page falls back to when the room is empty or unreachable.
  // Generous: the first read wakes a stale room via bounded catch-up.
  await expect(page.getByTestId("room-status")).toContainText("live", { timeout: 120_000 });

  const outgoingBefore = (await readRows(page)).filter((row) => row.outgoing).length;

  // Send as a visitor, and bind to the POST itself: waiting on the response (and
  // on the extra outgoing bubble it must produce) is what stops this test from
  // passing on a transcript that still holds an earlier run's identical question.
  await page.getByPlaceholder("Message the community…").fill(QUESTION);
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/forum/messages") && res.request().method() === "POST",
      { timeout: 120_000 },
    ),
    page.getByRole("button", { name: "Send" }).click(),
  ]);

  expect(response.ok()).toBe(true);
  const body = (await response.json()) as {
    accepted?: { seq: number; text: string };
    pending?: { sender: string; system: boolean; dueAt: number } | null;
    reply?: { status: string; chosen: string | null; dueAt?: number | null } | null;
    error?: string;
  };

  expect(body.error, `the room refused the message: ${body.error}`).toBeUndefined();
  expect(body.accepted?.text, "the room must record exactly what was sent").toBe(QUESTION);
  // The reply is paced now: the POST reports who is typing, it does not carry the
  // answer. `deferred` is the normal status.
  expect(
    body.pending?.sender,
    `the room must report who is composing a reply (reply: ${JSON.stringify(body.reply)})`,
  ).toBeTruthy();
  expect(["deferred", "lease-held", "published"]).toContain(body.reply?.status ?? "");

  await expect
    .poll(async () => (await readRows(page)).filter((row) => row.outgoing).length, {
      timeout: 30_000,
      message: "the message was never echoed into the transcript",
    })
    .toBe(outgoingBefore + 1);

  // The typing indicator is the visible sign the room is composing, not stalled —
  // in the profile header, and again inside the transcript the way a messenger
  // shows it (a bubble from the person who is composing).
  await expect(page.getByTestId("typing")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("typing")).toContainText("is typing");
  await expect(page.getByTestId("typing-row")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("typing-row")).toContainText("is typing");

  // Wait out the composing window: the reply lands once its 30–60s clock is up.
  await expect
    .poll(
      async () => {
        const rows = await readRows(page);
        const sent = rows.findLastIndex((row) => row.outgoing && row.text.includes(QUESTION));
        return sent < 0 ? -1 : rows.length - 1 - sent;
      },
      { timeout: 150_000, message: "the room never answered the message — this is the silence bug" },
    )
    .toBeGreaterThan(0);

  const rows = await readRows(page);
  const sent = rows.findLastIndex((row) => row.outgoing && row.text.includes(QUESTION));
  expect(sent, "the sent message should be on screen").toBeGreaterThanOrEqual(0);

  // A real line came back — never silence, never an empty bubble.
  const reply = rows[sent + 1];
  expect(reply, "the reply should be the row right after the message").toBeTruthy();
  expect(reply!.outgoing, "the reply must not be the visitor's own echo").toBe(false);

  const name = reply!.name;
  expect(
    Object.keys(PERMITTED),
    `the reply did not come from a permitted responder: ${JSON.stringify(reply!.text)}`,
  ).toContain(name);

  // The bubble's own line — not the quoted strip, not the name, not the clock.
  const message = reply!.own;
  expect(
    message.length,
    `the reply has no substance of its own: ${JSON.stringify(reply!.text)}`,
  ).toBeGreaterThan(15);
  expect(
    message.includes(QUESTION),
    `the reply is the visitor's own words echoed back: ${JSON.stringify(message)}`,
  ).toBe(false);

  // The room's own answer quotes the person's message, the way a messenger does.
  await expect(page.getByTestId("quoted").first()).toBeVisible({ timeout: 15_000 });

  // Once the reply has landed, the typing bubble is gone — in the header and in the
  // transcript, which is where a messenger shows it.
  await expect(page.getByTestId("typing")).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByTestId("typing-row")).toHaveCount(0, { timeout: 15_000 });

  console.log(
    `\n[community] You: ${QUESTION}\n[community] ${name} (${PERMITTED[name!]}) replied: ${message}\n`,
  );
});

test("a person can quote a message and the quote renders above their bubble", async ({ page }) => {
  await page.goto("/community");
  await expect(page.getByTestId("room-status")).toContainText("live", { timeout: 120_000 });

  // Pick a real room message and answer that specific line (the desktop path for a
  // swipe: the arrow that appears on hover). The row is pinned by its seq: the room
  // keeps talking, so `.last()` resolves to a *different* message a second later and
  // the quote would be asserted against a line that was never quoted.
  const lastRow = page.locator('[data-testid="message"]').last();
  const targetSeq = await lastRow.getAttribute("data-seq");
  expect(targetSeq, "a live message row should carry its seq").toBeTruthy();
  const target = page.locator(`[data-testid="message"][data-seq="${targetSeq}"]`);
  // Read the bubble's own line, not the row: a row also carries the avatar initials,
  // the sender name and — if it is itself a reply — its own quoted strip.
  const targetText = (await target.getByTestId("message-text").innerText())
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 30);
  await target.getByTestId("reply-action").click({ force: true });

  const bar = page.getByTestId("reply-bar");
  await expect(bar).toBeVisible({ timeout: 10_000 });
  await expect(bar).toContainText("Replying to");

  const QUOTE_REPLY = probe("fair point — but what's the stop on that?");
  await page.getByPlaceholder("Message the community…").fill(QUOTE_REPLY);
  const [response] = await Promise.all([
    page.waitForResponse(
      (res) => res.url().includes("/api/forum/messages") && res.request().method() === "POST",
      { timeout: 120_000 },
    ),
    page.getByRole("button", { name: "Send" }).click(),
  ]);

  const body = (await response.json()) as {
    accepted?: { seq: number; text: string; replyToSeq: number | null };
    error?: string;
  };
  expect(body.error, `the room refused the reply: ${body.error}`).toBeUndefined();
  expect(body.accepted?.text).toBe(QUOTE_REPLY);
  expect(body.accepted?.replyToSeq, "the quote must be stored on the message").toBeGreaterThan(0);

  // The composer clears once the message is taken.
  await expect(bar).toHaveCount(0, { timeout: 15_000 });

  // The person's own bubble now renders the quoted strip. Bound to the seq the POST
  // returned, not to the text: the room is persistent, so an earlier run's identical
  // message would otherwise satisfy the assertion.
  const quoted = page.locator(`[data-seq="${body.accepted?.seq}"] [data-testid="quoted"]`);
  await expect(quoted).toBeVisible({ timeout: 15_000 });
  expect(
    (await quoted.innerText()).replace(/\s+/g, " "),
    "the strip must carry the quoted message",
  ).toContain(targetText);

  console.log(`\n[community] quoted ${JSON.stringify(targetText)}… \n[community] You: ${QUOTE_REPLY}\n`);
});
