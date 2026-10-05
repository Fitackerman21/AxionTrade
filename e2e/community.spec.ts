/**
 * Live test of the community page (P7 + P1): a person sends a message and the
 * room answers it through the real `/api/forum/messages` round trip.
 *
 * Deliberately end-to-end and not hermetic — it exercises the running room, the
 * Voice and the Gate exactly as a visitor would. `npm run test:e2e`.
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

test("the live community page takes a message and the room answers it", async ({ page }) => {
  await page.goto("/community");

  // "live" in the header means the transcript came from the room, not the demo
  // replay the page falls back to when the room is empty or unreachable.
  // Generous: the first read wakes a stale room via bounded catch-up.
  await expect(page.locator("header p")).toContainText("live", { timeout: 120_000 });

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
    reply?: { status: string; chosen: string | null } | null;
    error?: string;
  };

  expect(body.error, `the room refused the message: ${body.error}`).toBeUndefined();
  expect(body.accepted?.text, "the room must record exactly what was sent").toBe(QUESTION);

  await expect
    .poll(async () => (await readRows(page)).filter((row) => row.outgoing).length, {
      timeout: 30_000,
      message: "the message was never echoed into the transcript",
    })
    .toBe(outgoingBefore + 1);

  const rows = await readRows(page);
  const sent = rows.findLastIndex((row) => row.outgoing && row.text.includes(QUESTION));
  expect(sent, "the sent message should be on screen").toBeGreaterThanOrEqual(0);

  if (body.reply?.status !== "published") {
    // The room can legitimately decline: a rejected draft is recorded, never
    // shown, and the page says so rather than dead-ending silently (spec §8.4).
    await expect(page.getByText(/no reply this turn/)).toBeVisible({ timeout: 30_000 });
    console.log(
      `\n[community] You: ${QUESTION}\n[community] no reply this turn (${body.reply?.status}, chosen: ${body.reply?.chosen}) — the Gate rejected the draft\n`,
    );
    return;
  }

  // The POST advances the room once, so the reply is the very next row.
  const reply = rows[sent + 1];
  expect(reply, "the reply should be the row right after the message").toBeTruthy();
  expect(reply!.outgoing, "the reply must not be the visitor's own echo").toBe(false);

  const name = reply!.name;
  expect(
    Object.keys(PERMITTED),
    `the reply did not come from a permitted responder: ${JSON.stringify(reply!.text)}`,
  ).toContain(name);

  // A real line came back, not a placeholder or an empty bubble. Strip the avatar
  // initials, the "AxAI" badge, the name and the trailing clock; what is left is
  // the message itself.
  const message = reply!.text
    .replace(/^[A-Z]{2}\s*/, "")
    .replace("AxAI", "")
    .replace(name!, "")
    .replace(/\d{2}:\d{2}.*$/, "")
    .trim();
  expect(message.length, `the reply has no substance: ${JSON.stringify(reply!.text)}`).toBeGreaterThan(
    15,
  );

  console.log(
    `\n[community] You: ${QUESTION}\n[community] ${name} (${PERMITTED[name!]}) replied: ${message}\n`,
  );
});
