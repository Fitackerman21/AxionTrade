/**
 * Chat-probe: drive the live room as a casual newcomer and record the exchanges.
 *
 * Writes each exchange to the output file as it lands, so progress is watchable and
 * a partial run is still evidence. Selectors are the ones the Playwright spec already
 * proved against this page (row wrapper, `p.font-semibold` for the sender name,
 * `[data-testid="message-text"]` for the bubble's own line).
 */
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = process.env.BASE_URL || "https://axiontrade.vercel.app";
const OUT = process.env.OUT || "/tmp/chat-probe.json";
const REPLY_TIMEOUT_MS = 180_000;
const BETWEEN_MS = 6_000;

/** Resume index: message 1 was already sent by the previous run. */
const START = Number(process.env.START || 0);

/** A newcomer who does not know the platform: social, off-topic, product, and one market line. */
const MESSAGES = [
  "yo, just joined. what is this place 😅",
  "wait so is this a real trading room or is it the app's own chat?",
  "how do i put money in btw? cant find the deposit thing",
  "lol im new to all this, started trading like last week. am i gonna lose everything",
  "gold looks like its stuck. feels like it just sits there all day",
  "everyone in here seems to know each other lol. who talks the most?",
];

const ROW = "div.flex.items-end.gap-2";

async function readRows(page) {
  return page.locator(ROW).evaluateAll((rows) =>
    rows.map((row) => {
      const el = row;
      const nameEl = el.querySelector("p.font-semibold");
      return {
        outgoing: el.className.includes("justify-end"),
        typing: /is typing/.test(el.innerText),
        name: nameEl?.childNodes[0]?.textContent?.trim() ?? null,
        own: (el.querySelector('[data-testid="message-text"]')?.textContent ?? "")
          .replace(/\s+/g, " ")
          .trim(),
        text: el.innerText.replace(/\s+/g, " ").trim(),
      };
    }),
  );
}

function save(state) {
  fs.writeFileSync(OUT, JSON.stringify(state, null, 2));
}

(async () => {
  const state = { base: BASE, startedAt: new Date().toISOString(), exchanges: [], posts: [], tail: [], error: null };
  save(state);
  const browser = await chromium.launch({ args: ["--no-sandbox"] });
  const page = await browser.newPage();

  page.on("response", async (res) => {
    if (res.url().includes("/api/forum/messages") && res.request().method() === "POST") {
      try {
        state.posts.push({ at: new Date().toISOString(), status: res.status(), body: await res.json() });
      } catch {
        state.posts.push({ at: new Date().toISOString(), status: res.status(), body: null });
      }
      save(state);
    }
  });

  try {
    await page.goto(`${BASE}/community`, { waitUntil: "domcontentloaded" });
    // "live" means the transcript came from the room, not the demo replay.
    await page.waitForFunction(
      () => /live/.test(document.querySelector('[data-testid="room-status"]')?.textContent ?? ""),
      null,
      { timeout: 120_000 },
    );

    for (const mine of MESSAGES.slice(START)) {
      const entry = { mine, sentAt: new Date().toISOString(), reply: null, ms: null, composerError: null };
      const t0 = Date.now();
      try {
        await page.getByPlaceholder("Message the community…").fill(mine);
        await page.getByRole("button", { name: "Send" }).click();
      } catch (e) {
        entry.composerError = e.message;
        state.exchanges.push(entry);
        save(state);
        continue;
      }

      // Wait for the room's answer: the first non-outgoing, non-typing row after my own.
      let reply = null;
      while (Date.now() - t0 < REPLY_TIMEOUT_MS) {
        const rows = await readRows(page);
        // An outgoing bubble has no `[data-testid="message-text"]`, so its `own` is
        // empty — the row's whole text is what identifies it (the spec matches this way
        // for the same reason).
        const mine_idx = rows.findLastIndex((r) => r.outgoing && r.text.includes(mine));
        if (mine_idx >= 0) {
          const after = rows.slice(mine_idx + 1).filter((r) => !r.typing);
          if (after.length > 0) {
            reply = after[0];
            break;
          }
        }
        await page.waitForTimeout(2_500);
      }
      entry.reply = reply;
      entry.ms = Date.now() - t0;
      state.exchanges.push(entry);
      save(state);
      console.log(
        `\n[${state.exchanges.length}/${MESSAGES.length}] me: ${mine}\n` +
          (reply
            ? `    ${reply.name} (${(entry.ms / 1000).toFixed(0)}s): ${reply.own}`
            : `    NO REPLY within ${REPLY_TIMEOUT_MS / 1000}s`),
      );
      await page.waitForTimeout(BETWEEN_MS);
    }

    state.tail = (await readRows(page)).filter((r) => !r.typing);
  } catch (e) {
    state.error = e.message;
  }
  save(state);
  await browser.close();
  console.log(`\nwrote ${OUT}`);
})().catch((e) => {
  console.error("PROBE_FAIL:", e.message);
  process.exit(1);
});
