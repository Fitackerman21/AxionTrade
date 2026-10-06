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
 *  - the answer is paced 30–60s out with a visible typing indicator, not returned
 *    in the same instant.
 */

import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The bubble row wrapper; outgoing rows also carry `justify-end`. */
const MESSAGE_ROW = "div.flex.items-end.gap-2";

/** `allow["human"]` in data/forum/config.json — who may answer a person. */
const PERMITTED: Record<string, string> = {
  Jev: "jev",
  "Mara Okafor": "mara",
  Solene: "sol",
  "Dmitri V.": "dmitri",
};

const QUESTION = "Evening room — what's the read on gold into the close?";

interface Row {
  /** true for the visitor's own bubbles */
  outgoing: boolean;
  /** the rendered sender name, read from the bubble rather than parsed from text */
  name: string | null;
  /** `<avatar initials> <name> <message> <clock>` for a persona row */
  text: string;
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

  // The typing indicator is the visible sign the room is composing, not stalled.
  await expect(page.getByTestId("typing")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("typing")).toContainText("is typing");

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

  // Strip the avatar initials, the "AxAI" badge, the name and the trailing clock;
  // what is left is the message itself.
  const message = reply!.text
    .replace(/^[A-Z]{2}\s*/, "")
    .replace("AxAI", "")
    .replace(name!, "")
    .replace(/\d{2}:\d{2}.*$/, "")
    .trim();
  expect(message.length, `the reply has no substance: ${JSON.stringify(reply!.text)}`).toBeGreaterThan(
    15,
  );

  // Once the reply has landed, the typing bubble is gone.
  await expect(page.getByTestId("typing")).toHaveCount(0, { timeout: 15_000 });

  console.log(
    `\n[community] You: ${QUESTION}\n[community] ${name} (${PERMITTED[name!]}) replied: ${message}\n`,
  );
});
