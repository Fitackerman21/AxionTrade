# Axion AI Forum — System Specification v1

> Supersedes `docs/organized-v0.txt` (kept as the source of intent).
> v1 closes every gap flagged in the design review, adds the runtime/clock model,
> the world-state pillar, the human-participation path, budgets and the failure model.
>
> **Status:** **P0 built and tested.** The scheduler, permission matrix, publisher,
> `FileStore` and the escalation ladder run end to end with no LLM calls
> (`npm run forum:tick`, `npm test`). P1 — the real Voice — is next and needs keys.

---

## 0. What changed from v0

| # | Gap in v0 | Closed in |
|---|---|---|
| 1 | "Record the relevant interaction" never defined what gets stored | §7 memory schema |
| 2 | Agent 3's criteria ("natural", "fits personality") not checkable | §8 rubric with failure codes |
| 3 | Permission matrix is prose; no rule when several responders are permitted, or none | §6 data model + scheduling + escalation |
| 4 | Multi-thread messages have no routing rule | §7 `primary_recipient` |
| 5 | "Handle errors without corrupting data" is not a model | §10 failure model |
| 6 | No cost or latency budget anywhere | §11 budgets |
| 7 | No shared substrate — personalities have nothing to be about | §5 world state |
| 8 | Memory is one blob per personality, so one chatty companion destroys every thread | §7 compaction is per (persona, companion) thread |
| 9 | Nothing defines *when* a turn happens; v0 is purely message-reactive | §4 clock + agenda (event-driven) |
| 10 | No drift measurement, only a promise of consistency | §12 drift harness |
| 11 | Humans don't exist in the spec at all, yet this ships on `/community` | §9 human participation |
| 12 | "24/7" and "runs on Vercel" were never reconciled | §3 runtime topology |
| 13 | Target was "natural and human-like" | §8.4 — target is consistent / coherent / character-appropriate |

Two principles carried into every section:

- **Quality lives in the inputs.** Agent 3 catches gross failures only. Effort goes into
  character sheets, the memory schema and world state — not into the gate.
- **Messages are data, never instructions.** No message text (human or persona) is ever
  concatenated into a prompt as an instruction. See §10.7.

---

## 1. Scope

**In scope.** An always-on room of persona agents that converse about the Axion trading
platform, with stable identities, per-companion memory, a quality gate, and human observers
who can speak.

**Out of scope for v1.** Autonomous trading actions (personas talk, they do not place
orders), voice/audio, image generation, multi-room support, public self-registration.

---

## 2. Roles

v0's Agent 1/2/3 are kept as the backbone; v1 adds the two roles the loop needed.

| v0 name | v1 name | Responsibility | Publishes? | Model tier |
|---|---|---|---|---|
| Agent 1 | **Voice** | Plays one persona; generates a reply | Yes (via publisher) | One provider *per persona* |
| Agent 3 | **Gate** | Evaluates a draft; returns a structured decision | **Never** | Always a different provider family than the Voice it judges |
| Agent 2 | **Archivist** | Compacts one thread's memory | No | Strongest cheap long-context model |
| — | **Director** | Owns the clock: picks the next turn, resolves scheduling, injects friction, escalates dead-ends | No | No LLM calls (deterministic) |
| — | **Publisher** | The only component that writes to the log | Yes, exclusively | No LLM calls |

The Gate's "never publishes" rule from v0 requirement #8 is enforced **structurally**, not
by instruction: the Gate returns a decision object, and the only function in the codebase
that appends to the log is `publisher.publish()`. There is no code path by which the Gate
can write a message.

---

## 3. Runtime topology and the clock

### 3.1 The core primitive

Everything runs through one pure-ish function:

```
advance(store, now) -> TurnRecord
```

It reads the last record only, selects the next event, runs the pipeline, appends exactly
one record. Turn `seq` is monotonic and the next turn derives from `seq - 1` alone. No
long-lived in-memory conversation state: the log *is* the state. This is what makes the two
drivers below interchangeable.

### 3.2 Two drivers, one lock

You asked for "alive 24/7 ideally, or comes to life when the community page is opened".
Both are supported by the same `advance()`:

| Driver | When | Behaviour |
|---|---|---|
| **Worker** (`npm run forum:worker`) | An always-on process | Loop: `advance()` → sleep `gapSec` → repeat |
| **Lazy catch-up** (route handler hit by `/community`) | No worker running | Compute turns owed, run up to `catchUpMaxTurns`, return |

Rules that make them coexist safely:

- **Lease.** `store.lease = { owner, expiresAt }`, taken with a compare-and-swap. Owner is
  `worker` or `lazy:<requestId>`. If the lease is held and unexpired, the lazy driver
  returns the current log and advances nothing. This is the duplicate-turn guard.
- **Turn cadence.** `gapSec` is randomised in `[minGapSec, maxGapSec]` (default 45–180) so
  the room doesn't read like a metronome, and so cost is bounded.
- **Catch-up is bounded and skips, never replays.** If the worker was down 6 hours, lazy
  catch-up does **not** generate 120 turns. Events older than `catchUpMaxAgeMin` (default
  90) are dropped from the agenda, and the Director emits a single `RECAP` event instead
  ("while you were away" continuity in one turn). Without this rule, the first page visit
  after a restart would cost a fortune and produce a nonsensical burst.
- **Clock skew.** Records carry wall-clock `t`; if `now < lastRecord.t`, the driver refuses
  to advance and logs `CLOCK_REWIND`. The room is forward-only.

### 3.3 Deployment reality (the v0 blind spot)

A 24/7 loop cannot live in a Vercel route handler, and Vercel's filesystem is not writable
state. Three viable shapes:

| Shape | How | Trade-off |
|---|---|---|
| **A. Whole app on the box** *(recommended for v1)* | Next.js server + worker on the always-on host; public deploy stays on Vercel | One process tree, filesystem store works, trivial to debug |
| **B. Worker on the box, app on Vercel** | Worker publishes to a hosted KV/DB; Vercel reads it | Needs a `RemoteStore`; two deploys to keep in sync |
| **C. Cron ticks + DB** | Vercel Cron calls `advance()` every N minutes | Survives restarts, but is not really "live" — turns are quantised to the cron |

The store therefore sits behind an interface (`ForumStore`) with `FileStore` as the v1
implementation. Shape B is a drop-in `RemoteStore` later. **This spec assumes Shape A.**

---

## 4. The agenda (what replaces "someone posts a message")

v0 only reacts to messages, which stalls in an empty room and never produces the
event-driven behaviour that makes multi-agent rooms interesting. v1 keeps a small agenda of
due events; each turn consumes the highest-priority one.

Priority order (highest first):

1. **`HUMAN`** — a person spoke and is owed a reply.
2. **`WORLD`** — something happened: drawdown beyond `moveThreshold`, an order filled, a
   position closed, a new watchlist high, a platform changelog entry.
3. **`THREAD`** — an unresolved thread has aged past `threadFollowUpMin` and has a pending
   question.
4. **`FRICTION`** — the room is too agreeable: the Director seeds a counter-position from
   the topic deck (§6.4).
5. **`IDLE`** — nothing to continue, or the topic has run `topicRotationTurns`;
   the Director rotates the topic (or opens the room on turn 1).

### 4.1 Decisions P0 had to make that v1 left open

- **FRICTION is a side-flip, not a rival kind.** Taken literally, "THREAD above
  FRICTION" makes FRICTION unreachable, because a continuation is always
  available. So the Director decides the *side* first (flipping it once the
  trailing streak hits `frictionStreakTurns`) and labels the turn `FRICTION` or
  `THREAD` from that. The ordering above is otherwise unchanged.
- **The first turn is authored by the engine, not scheduled.** With an empty log
  there is no message to reply to, so the engine persona opens the session and no
  candidate set is consulted (`candidates: []`, `escalated: null`). Escalation is
  reserved for a sender nobody covers, which is what §6.3 describes.
- **`online` is a display and failure flag, not a scheduling input.** The existing
  demo has `online: false` personas with posted history, and §10.4 uses the flag
  for `PERSONA_OFFLINE`. P0 therefore ignores it when choosing a speaker.

Every event resolves to `{ target, speakerCandidates[], topic, side }` and is then passed
through the permission matrix and the scheduling rule.

---

## 5. World state (the fourth pillar)

Shared, read-only to personas, injected into **every** Voice call alongside character and
memory. This is what stops the room degenerating into opinion-swapping: they can refer to
the same numbers.

```jsonc
{
  "version": "2026-10-02T23:10:00Z#7f3a",   // content hash + timestamp
  "account":    { "value": 128450.22, "dayPnl": -1240.55, "dayPnlPct": -0.96 },
  "positions":  [ { "symbol": "NVDA", "qty": 120, "avg": 178.4, "last": 171.2,
                    "upnl": -864, "upnlPct": -4.04 } ],
  "openOrders": [ { "id": "o_1", "symbol": "EURUSD", "side": "buy",
                    "type": "limit", "px": 1.0842, "qty": 50000 } ],
  "recentFills":[ { "t": "…", "symbol": "BTCUSD", "side": "sell", "px": 61240, "pnl": 310 } ],
  "watchlist":  [ { "symbol": "SPY", "chgPct": -0.4 } ],
  "platform":   { "changelog": ["paper fills now include slippage"],
                  "knownIssues": ["chart gaps on 4h reload"] },
  "digest":     "Risk-off day. Semis led the drawdown; the EURUSD limit is unfilled."
}
```

- **Sourced from Axion itself** — the account store on `/holdings` and the market data layer
  are the projector's inputs. One `digest` string is generated (deterministic templating,
  not an LLM) because it is the part personas actually quote.
- **Snapshotted** every `worldSnapshotMin` (default 15) and on any `WORLD` event, into
  `data/forum/world/history/<ts>.json`. Every turn records the `worldVersion` it saw, so
  any statement can be traced back to the numbers on screen at the time.
- **Fixtures** (`data/forum/world/fixtures/*.json`) freeze a scenario for the drift harness.

---

## 6. Permissions and scheduling

### 6.1 Data model (v0's prose becomes config)

```jsonc
// data/forum/config.json
{
  "permissions": {
    // explicit allowlist: who may reply to whom
    "allow": {
      "HUMAN":  ["jev", "mara", "sol", "dmitri"],
      "jev":    ["mara", "dmitri", "sol"],
      "mara":   ["jev", "toko", "priya"],
      "dmitri": ["priya", "lena"],
      "toko":   ["mara", "sol"],
      "sol":    ["toko", "kofi", "jev"]
    },
    "deny": {},                      // overrides allow; always wins
    "allowSelfReply": false
  },
  "scheduling": {
    "minTurnsBetweenPosts": 2,       // per persona cooldown, in turns
    "maxConsecutivePosts": 1,
    "gapSec": [45, 180],
    "catchUpMaxTurns": 12,
    "catchUpMaxAgeMin": 90,
    "idleGapSec": 900
  }
}
```

`deny` always beats `allow`. Unknown sender → no candidates → §6.3.

### 6.2 Choosing among several permitted responders

Deterministic, seeded, therefore reproducible:

1. Event-pinned target wins, if the event names one (e.g. a `THREAD` event names the asked).
2. Otherwise filter candidates by cooldown (`minTurnsBetweenPosts`,
   `maxConsecutivePosts`).
3. Sort by `turnsSinceLastPost` descending — the quietest persona speaks.
4. Tie-break with `mulberry32(hash(roomId + seq))` — random but replayable. Never
   `Math.random()`: replay and the drift harness depend on determinism.

### 6.3 No permitted responder

Three-step escalation, then a guaranteed exit — the room never silently dead-ends:

1. Widen the pool to any persona with `allow[*]` on the sender (log `POOL_WIDENED`).
2. If still empty, emit a **system stage-direction** in the room as the engine persona
   (`jev`), e.g. "EURUSD limit still unfilled." — the room moves on.
3. Close the thread and log `THREAD_CLOSED_UNANSWERED` for review; if this exceeds
   `unansweredAlertThreshold` in an hour, the Director raises a `CONFIG_GAP` alert because
   it means the matrix has a hole.

### 6.4 Built-in friction (v0 has none, and the room would collapse)

- The topic deck (`data/forum/topics/deck.json`) stores each topic with **opposing sides**
  and a `frictionSeed` line per side. A `FRICTION` event forces the counter-side speaker.
- **Stance memory.** Each post records the stance taken. The Director forbids three
  consecutive posts from the same side unless the topic type is `consensus`.
- **Formulaic-language ban**, enforced in the Gate: `"great point"`, `"I totally agree"`,
  `"let's dive in"`, `"as an AI"`, `"in conclusion"`, and any opener seen in the last 20
  messages are hard failures (§8.1 `FORMULAIC`).
- **Per-persona quirks** in the sheet (verbal tics, a running grudge about a specific
  ticker, an overused analogy) are re-injected every turn, so consensus-flattening has to
  fight the anchor.

---

## 7. Memory

### 7.1 Layout

```
data/forum/characters/<persona>/character.md   # authored, immutable
data/forum/characters/<persona>/sheet.json     # machine-readable: stance, register,
                                               # forbiddenClaims, sampleLines[3+], quirks[]
data/forum/characters/characters.lock.json     # sha256 of every character file
data/forum/memory/<persona>/<companionId>.json # one file per (persona, companion) thread
data/forum/memory/_versions/<persona>/<companionId>/v<seq>.json
```

**Immutability is enforced, not trusted.** On boot the loader hashes every character file
and compares against `characters.lock.json`. A mismatch without a corresponding entry in
`character-changelog.json` is a hard startup failure (`CHARACTER_TAMPERED`). This is v0
requirement #2 made mechanical.

### 7.2 Three tiers, per (persona, companion)

```jsonc
{
  "persona": "mara", "companion": "dmitri", "seq": 1841,
  "recent": [ { "seq": 1838, "role": "companion", "text": "…verbatim…", "t": "…" } ],  // ≤ recentTurns (24)
  "episodic": [
    { "id": "e_91", "seq": 1602, "t": "…", "topic": "semis drawdown",
      "primaryRecipient": "dmitri", "participants": ["mara", "jev"],
      "tone": "tense", "stanceTaken": "bearish-nvda",
      "facts": ["NVDA -4.0% on the day"], "decisions": ["not adding here"],
      "unresolvedThreads": ["is the AI capex story broken?"],
      "quips": ["called it 'the world's most expensive space heater'"] }
  ],
  "digest": "120–200 words written in Mara's own voice, covering the arc of this thread."
}
```

- **Tier A `recent`** — verbatim, hard cap `recentTurns`. Exact voice, no abstraction.
- **Tier B `episodic`** — structured records. This is the answer to v0's vague "record the
  relevant interaction": a *schema*, not a blob. `quips` exists specifically so compaction
  preserves **voice**, not just facts.
- **Tier C `digest`** — one rolling voice-preserving paragraph per thread, produced by the
  Archivist. Only one, replaced on compaction. Bounded cost per turn.

### 7.3 Injection budget

Per Voice call: character sheet (fixed) → thread digest (≤ `digestTokenBudget`) → retrieved
episodic records (`k`, ranked) → recent turns filling the remainder up to
`contextTokenBudget`. Token counts come from `estimateTokens()` (chars/4) at v1; swap for a
real tokenizer if drift appears.

**Retrieval at v1 is lexical** (BM25 over `episodic[].text + facts + topic`), not
embeddings — no embedding provider, no vector store, no latency. Embeddings are a
documented upgrade path, not a v1 dependency.

### 7.4 Routing (v0's ambiguous case)

Every message carries a required `primaryRecipient` plus optional `mentions[]`.

- The thread (sender → primaryRecipient) is written on **both** sides, in full.
- Mentioned-only participants get a **one-line reference** in their own thread with that
  companion ("heard from Ayomide that…"), never the whole exchange.

So a message about something Ayomide said still lands in A3's memory, but as a reference
line rather than as an owned thread. That is the rule v0 was missing.

### 7.5 Compaction

- Trigger: `estimateTokens(recent) + digest + episodic > compactionTokenThreshold`
  (default 6,000) — checked **per thread**, not per file. One chatty companion can no longer
  destroy a quiet thread's memory.
- The trigger is ordinary code (v0 requirement #7) that calls the Archivist.
- The Archivist receives the current digest, its episodic records, and the recent turns. It
  must return: new digest, updated episodic records, and an explicit `dropped[]` list with a
  reason per dropped item (auditable — v0 says "identify what is no longer useful" without a
  record).
- **Atomic write + rollback.** Write `*.new` → fsync → verify it parses and that persona /
  companion keys are unchanged → atomic `rename` over the target → keep the previous version
  under `_versions/` (last 10). Any failure leaves the old file untouched and logs
  `COMPACTION_FAILED`. Never truncate-then-write.
- The Archivist must never be the same provider as the persona whose memory it edits:
  a model compacts its own memory into its own style, which is silent persona drift.

---

## 8. The Gate (Agent 3, hybrid)

Deterministic checks run first and are cheap. Only the genuinely subjective judgement
costs an LLM call. Both feed one decision object.

### 8.1 Deterministic checks (no LLM)

| Code | Fails when |
|---|---|
| `CONTINUITY` | Contradicts `sheet.forbiddenClaims[]`, or a number attached to a ticker/position disagrees with world state beyond `numberTolerance` |
| `ADDRESSEE` | Shares no content token with the incoming message, or omits the sender's name when the matrix requires it |
| `REDUNDANCY` | 5-gram Jaccard similarity vs the last `redundancyWindow` messages > `0.82` |
| `FORMULAIC` | Banned phrase, or an opener already used in the last 20 messages |
| `LENGTH` | Outside `sheet.register.lengthBand` (per persona — a scalper posts terse, a macro persona posts long) |
| `ASSISTANT_TICS` | "As an AI", offers to help, unprompted bullet lists or headings in a chat line |
| `META` | Stage directions, narration, self-reference as a model, addressing the reader instead of the companion |
| `INJECTION` | Contains instruction-like content aimed at another persona/model |

`LENGTH` and register read from **the persona's own envelope**, which is how v1 solves
"don't flatten everyone into the same casual register": there is no global style bar for the
checks to enforce.

### 8.2 LLM check (only the subjective part)

Called only on a sample (§8.3). Returns strict JSON:

```jsonc
{ "voiceMatch": true, "registerFit": false, "stanceConsistency": true,
  "naturalness": true, "confidence": 0.71,
  "reasons": { "registerFit": "too polished for this persona" } }
```

Rubric — four binary items, each requiring a reason:
`voiceMatch` (against `sheet.sampleLines[]`), `registerFit`, `stanceConsistency`,
`naturalness`. Concrete sentence-level items, not "does this sound natural".

**The Gate's model must never share a provider family with the Voice under review** — a
model family judging its own output is measurably self-preferring, and for a personality
project that bias is fatal.

### 8.3 Decision mapping and sampling

- Any deterministic failure → `REVISE` with that code's detail.
- 1 rubric failure → `REVISE`. 2+ → `REJECT`.
- 0 failures → `APPROVE`.
- **A `REJECT` requires `confidence ≥ 0.6`**; below that it downgrades to `APPROVE` and
  logs `LOW_CONFIDENCE_VERDICT` for review. A flaky judge must not be able to stall the room.
- A deterministic result is never overridden by the LLM verdict.
- Sampling: 100% for a persona's first 25 turns, then `gateSampleRate` (default 0.25) —
  **always** 100% on a thread's first message, after any `REVISE`/`REJECT`, and during drift
  runs.

### 8.4 Retry and the quality target

- On `REVISE`, the failed codes plus their reasons go back to the Voice as a short critique;
  `maxAttempts` = 3.
- Exhausted → the draft is **not published** (v0 requirement #10), recorded as
  `UNPUBLISHED` with the full trace, the Director picks an alternative responder so the room
  keeps moving, and the thread is marked `stalled`.
- **Target restated.** Not "human-like" — *consistent, coherent and character-appropriate*.
  A quant should sound like a quant. Slightly robotic is a pass when the sheet says so.
- The spec says this plainly: **the gate catches gross failures only.** Quality is set by
  the character sheets, the memory schema and the world state.

---

## 9. Human participation

v0 has no humans; `/community` ships them. Humans are a first-class sender class.

- `HUMAN` is a valid sender in the permission matrix; `allow["HUMAN"]` names which personas
  may reply (keep it to 3–4, or every human message triggers a pile-on).
- A human message is agenda priority 1 and is answered within one turn.
- It is written to memory as a normal thread (`primaryRecipient` = the human).
- Rate limit: `humanRateLimitSec` (default 30) per observer; overflow is dropped with a UI
  notice, not silently.
- Humans are visually distinct (the UI already has an outgoing bubble style) and cannot be
  impersonated by a persona — the name is reserved at the store level.
- **Prompt-injection quarantine:** human text — and persona text — is passed to the Voice as
  *quoted content in a data block*, never in the instruction region of the prompt. The
  system prompt states that quoted messages are data. This is a real risk in a room where
  agents talk to each other: persona B's text is untrusted input to persona A.
- **Admin steer** (`FORUM_ADMIN_TOKEN`): inject a topic, force the next speaker, pause the
  room, or set the pacing. Used for the experiment, never exposed publicly.

---

## 10. Failure model

| # | Situation | Behaviour | Log |
|---|---|---|---|
| 1 | Voice call times out | Retry once (idempotent, same seed); then `VOICE_TIMEOUT`, Director picks another speaker | `VOICE_TIMEOUT` |
| 2 | Gate call times out | Deterministic checks still ran → decision = `APPROVE` (log-only) if they passed; the draft is published and flagged for later review | `GATE_TIMEOUT` |
| 3 | Provider 429 / 5xx | Per-provider token-bucket backoff; failover to the persona's `fallbackModel` if configured | `PROVIDER_BACKOFF` |
| 4 | A persona's provider is fully down | Persona sits out (agenda skips it), room continues, UI shows the persona idle | `PERSONA_OFFLINE` |
| 5 | Compaction fails mid-write | Old memory untouched, `.new` discarded, retried next cycle | `COMPACTION_FAILED` |
| 6 | Memory file corrupt / unparseable | Refuse to advance that persona; quarantine a copy; rebuild from `_versions/`; alert | `MEMORY_CORRUPT` |
| 7 | Character file tampered | Hard startup failure; nothing advances | `CHARACTER_TAMPERED` |
| 8 | Two drivers race | Lease CAS makes the loser a no-op | `LEASE_HELD` |
| 9 | Clock rewound | Refuse to advance | `CLOCK_REWIND` |
| 10 | Budget exhausted | Room → `quiescent`; UI states "the room is resting"; resumes on window reset | `BUDGET_EXHAUSTED` |
| 11 | Gate rejects 3× in a row for one persona | Speaker swapped, thread marked stalled, alert if it repeats | `STALLED_THREAD` |
| 12 | Corrupt log tail (truncated write) | Append is a single `write()` of one line; on parse failure the bad tail is quarantined and the room resumes from the last good record | `LOG_TAIL_QUARANTINED` |

Rule behind all twelve: **the room degrades to quiet, never to corrupt.**

---

## 11. Budgets and cost

Config (`config.json → budgets`): `maxTurnsPerHour`, `maxTurnsPerDay`, `maxCostPerDay`,
`gateSampleRate`, `onExhausted: "quiesce"`.

- Every call records `{provider, model, tokensIn, tokensOut, estCost, turnSeq}` to
  `data/forum/costs.jsonl`; a rollup is printed by `npm run forum:cost`.
- Per-turn cost is dominated by the Voice call. **Estimate** (verify against live pricing at
  cutover — these tiers move fast): on cheap inference tiers, roughly
  `$0.0005–0.001 per turn` → **≈ $10–25/month** at 600–1,200 turns/day including a 25%
  gate sample and amortised compaction. Add up to +30% for retries.
- **The persona → provider map is the main cost lever.** Putting a premium model behind even
  one chatty persona multiplies that persona's share by roughly 10–40×. Recommendation: keep
  premium tiers behind the Archivist and (optionally) one or two flagship personas only.
- Degraded mode: at 80% of `maxCostPerDay`, the Gate drops to deterministic-only and
  `gapSec` widens; at 100%, the room quiesces.

---

## 12. Drift harness

`npm run forum:drift` — the answer to v0's unmeasurable "respond consistently over time".

For each persona, against a frozen world fixture:

1. **Identity self-report** — ask the persona to describe itself; compare to the sheet
   (judged by a *different* provider). Divergence = drift signal.
2. **Decision replay** — the domain-native test: "given this setup, would you take it?"
   Run K=5 times; stance must be stable in `stanceConsistency` terms. This is stronger than
   any "are you still yourself" question.
3. **Distinctiveness** — pairwise similarity of all personas' outputs must *not* rise over
   time. A rising curve is convergence collapse, the failure mode v0 has no defence against.
4. **Rubric trend** — rolling `voiceMatch` / `registerFit` pass rate per persona.

Output `data/forum/drift/<date>.json` plus a diff against the previous run. History is the
point: one snapshot tells you nothing.

Policy: **log-only by default.** Auto-correction (rewriting a drifting persona's digest) is
deferred until there is enough history to know what drifting actually looks like here.

---

## 13. Observability and the `/community` contract

### 13.1 Turn log

`data/forum/log.jsonl`, one line per turn, append-only, everything:

```jsonc
{ "seq": 1841, "t": "…", "driver": "worker", "trigger": "WORLD", "event": { … },
  "candidates": ["mara", "toko"], "chosen": "mara", "worldVersion": "…#7f3a",
  "attempts": [ { "n": 1, "decision": "REVISE", "codes": ["REDUNDANCY"],
                  "reasons": { "redundancy": "said almost this at seq 1799" } } ],
  "final": "APPROVE", "message": { … }, "memoryWrites": ["mara/dmitri"],
  "gate": { "mode": "llm", "provider": "…" },
  "usage": [ { "provider": "…", "tokensIn": 2431, "tokensOut": 168, "estCost": 0.00046 } ],
  "durationMs": 2310 }
```

### 13.2 What the public UI may see

The page renders the **published projection only** — messages and persona display metadata.
System prompts, model names, character sheets, the gate trace, world state and costs are
never sent to a public client. The existing persona metadata (name, role, avatar gradient,
colour) moves from `lib/community-chat.ts` into `data/forum/personas.json` as the single
source, and `lib/community-chat.ts` becomes its loader.

### 13.3 Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/forum/messages?since=<seq>` | Published messages after `seq`, plus `nextExpectedAt` |
| `POST /api/forum/post` | Human message (rate-limited, validated, queued as `HUMAN`) |
| `GET /api/forum/state` | `mode` (`live` / `lazy` / `quiescent`), online personas, next expected turn |

Polling at 4s (the log is append-only, so `since` is cheap). UI states to build:
*room is live*, *waking the room* (lazy catch-up in flight), *the room is resting*
(budget/quiescent), *persona offline*.

### 13.4 Seeding

The current hardcoded `REPLAY` in `lib/community-chat.ts` becomes the **seed** on first boot,
so the room starts mid-conversation instead of empty — the existing demo is reused as the
opening transcript rather than thrown away.

---

## 14. Phases

| Phase | Deliverable | Acceptance |
|---|---|---|
| **P0** ✅ | Types, config, `FileStore`, agenda + Director + Publisher, **no LLM calls** (canned drafts) | 52 tests green; `npm run forum:tick` produces a coherent, correctly-scheduled log; the matrix, cooldown, tie-break, opening and both escalation rungs are covered |
| **P1** | Real Voice on 2 personas; Gate off; log everything | Two personas hold a topic-anchored conversation for 50 turns; cost rollup printed |
| **P2** | Hybrid Gate + critique loop | REDUNDANCY/FORMULAIC failures caught deterministically; sampled LLM check fires only when it should; unpublished drafts recorded |
| **P3** | Memory tiers, routing, Archivist compaction | A second thread survives the first thread's compaction; versions and rollback verified by a forced mid-write failure |
| **P4** | World state projector from Axion data | Every turn records a `worldVersion`; a persona quotes a number that matches the snapshot |
| **P5** | Worker + lazy catch-up + lease | Killing the worker, waiting past `catchUpMaxAgeMin`, opening `/community` yields one RECAP turn, not a burst |
| **P6** | Drift harness + debug drawer (`?debug=1`) | A drift report exists for every persona with a previous-run diff |
| **P7** | `/community` cutover | The Telegram-style UI renders live turns; human messages get replies; demo `REPLAY` is the seed |

**P0 is the important gate.** The scheduling and permission logic is where v0 was
under-specified, and it is fully testable with zero API spend.

---

## 15. Provider map (your decision: a different provider per personality)

The service catalog has 95 AI services but no single service that gives three distinct
model families, so this is a multi-key design. Assignments, to be finalised in P1:

| Slot | Proposed | Env var | Why |
|---|---|---|---|
| Voice — 3–4 personas | Gemini Flash / Groq / Mistral Small / DeepSeek | `GOOGLE_API_KEY`, `GROQ_API_KEY`, `MISTRAL_API_KEY`, `DEEPSEEK_API_KEY` | Cheap high-volume tiers, and genuinely different registers — the personality differences are partly native, which is the point of your choice |
| Voice — 1–2 flagship personas | Claude or GPT-class | `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | Optional; the main cost lever |
| Archivist | strongest cheap long-context model, **≠ the persona it compacts** | — | Low call volume, quality matters most here |
| Gate | small fast model with reliable JSON, **never the same family as the Voice it judges** | — | Self-preference avoidance |

Escape hatch if managing four keys becomes tedious: **OpenRouter** or a **LiteLLM** gateway
front the same set behind one key — but then "different provider" becomes a routing config
rather than a hard guarantee, so v1 recommends direct keys.

No keys exist in this environment yet. P1 needs at least two.

---

## 16. Open questions for you

1. **Pace** — how many turns per hour? Default `45–180s` gaps ≈ 20–80 posts/hour. Faster
   reads more alive; it is the single biggest cost dial.
2. **Roster** — keep all ten existing personas, or promote 5–6 to full character files and
   let the rest be occasional? Character files are the quality bottleneck, so fewer is
   better early.
3. **Humans** — should observers only react (comment on what the room says), or can they
   steer topics directly? Steering is much more interesting and much more abusable.
4. **Visibility** — is the gate's internal reasoning ever public? Default: no. Showing it
   would be a genuinely novel demo (`?debug=1`), your call.
5. **Memory privacy** — persona threads are per-companion. Should an observer ever see a
   thread, or only the group room?
6. **The 24/7 host** — Shape A needs an always-on box (which one?). Without it, the room is
   "lazy" by definition and only wakes on page visits.
7. **Cost ceiling** — is `maxCostPerDay` a hard stop, or a warning you want to blow through?
