/** Provider adapter tests — hermetic, using an injected `fetch`. */

import assert from "node:assert/strict";
import { test } from "node:test";

import {
  FallbackProvider,
  JSON_INSTRUCTION,
  OpenRouterProvider,
  ProviderError,
  modelFamily,
  openRouterKey,
  openRouterKeys,
  resolveJudgeProvider,
  sameFamily,
} from "./provider";
import type { ChatProvider } from "./provider";

function fetchReturning(body: unknown, status = 200): typeof fetch {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return (async () =>
    new Response(text, { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

const REQUEST = { messages: [{ role: "user" as const, content: "hello" }] };

test("a chat completion is parsed into text, upstream and usage", async () => {
  const provider = new OpenRouterProvider({
    apiKey: "sk-test",
    model: "qwen/qwen3.8-27b",
    fetchImpl: fetchReturning({
      id: "gen-1",
      model: "qwen/qwen3.8-27b",
      provider: "Wafer",
      choices: [{ message: { role: "assistant", content: "\n\nOK", reasoning: "scratchpad" } }],
      usage: { prompt_tokens: 57, completion_tokens: 12, cost: 0.0000536 },
    }),
  });

  const response = await provider.chat(REQUEST);
  assert.equal(response.text, "OK", "reasoning and surrounding whitespace are stripped");
  assert.equal(response.model, "qwen/qwen3.8-27b");
  assert.equal(response.upstream, "Wafer");
  assert.deepEqual(response.usage, { tokensIn: 57, tokensOut: 12, cost: 0.0000536 });
  assert.equal(provider.id, "openrouter");
  assert.equal(provider.family, "qwen");
});

test("the JSON instruction is appended to the system prompt when asked", async () => {
  let sent: string | null = null;
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    sent = String(init.body);
    return new Response(JSON.stringify({ choices: [{ message: { content: "{}" } }] }), { status: 200 });
  }) as unknown as typeof fetch;

  const provider = new OpenRouterProvider({ apiKey: "k", model: "m/x", fetchImpl });
  await provider.chat({ ...REQUEST, system: "be brief", json: true });

  const body = JSON.parse(sent ?? "{}") as { messages: Array<{ role: string; content: string }> };
  assert.equal(body.messages[0]?.role, "system");
  assert.match(body.messages[0]?.content ?? "", /be brief/);
  assert.match(body.messages[0]?.content ?? "", new RegExp(JSON_INSTRUCTION.slice(0, 20)));
});

test("provider errors carry the status and code from the body", async () => {
  const provider = new OpenRouterProvider({
    apiKey: "bad",
    model: "qwen/qwen3.8-27b",
    fetchImpl: fetchReturning({ error: { code: 401, message: "No auth credentials found" } }, 401),
  });

  await assert.rejects(
    () => provider.chat(REQUEST),
    (error: unknown) =>
      error instanceof ProviderError && error.status === 401 && error.code === 401,
  );

  const limited = new OpenRouterProvider({
    apiKey: "k",
    model: "qwen/qwen3.8-27b",
    fetchImpl: fetchReturning({ error: { code: 429, message: "rate limited" } }, 429),
  });
  await assert.rejects(
    () => limited.chat(REQUEST),
    (error: unknown) => error instanceof ProviderError && error.status === 429,
  );
});

test("an empty completion is an error, not an empty message", async () => {
  const provider = new OpenRouterProvider({
    apiKey: "k",
    model: "qwen/qwen3.8-27b",
    fetchImpl: fetchReturning({ choices: [{ message: { content: "   ", refusal: "nope" } }] }),
  });
  await assert.rejects(() => provider.chat(REQUEST), /empty completion/);
});

test("model families are read from the id, and judge/voice equality is exact", () => {
  assert.equal(modelFamily("qwen/qwen3.8-27b"), "qwen");
  assert.equal(modelFamily("openai/gpt-4o-mini"), "openai");
  assert.equal(modelFamily("gemini-2.0-flash"), "gemini-2.0-flash");
  assert.equal(modelFamily(""), "");
  assert.equal(sameFamily("qwen/qwen3.8-27b", "qwen/qwen3-max"), true);
  assert.equal(sameFamily("qwen/qwen3.8-27b", "openai/gpt-4o-mini"), false);
  assert.equal(sameFamily("", "qwen/x"), false, "an unset voice family must not match");
});

test("the reasoning budget is sent only when a caller asks for one", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    bodies.push(JSON.parse(String(init.body)) as Record<string, unknown>);
    return new Response(JSON.stringify({ choices: [{ message: { content: "ok" } }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const provider = new OpenRouterProvider({ apiKey: "k", model: "qwen/qwen3.8-27b", fetchImpl });

  await provider.chat(REQUEST);
  assert.equal("reasoning" in (bodies[0] ?? {}), false, "omitted by default");

  await provider.chat({ ...REQUEST, reasoning: "off" });
  assert.deepEqual(bodies[1]?.reasoning, { enabled: false });

  await provider.chat({ ...REQUEST, reasoning: "low" });
  assert.deepEqual(bodies[2]?.reasoning, { effort: "low" });
});

/** A response whose headers resolve but whose body never finishes on its own. */
function fetchWithHangingBody(): typeof fetch {
  return (async (_url: string, init?: RequestInit) => {
    const signal = init?.signal;
    return {
      ok: true,
      status: 200,
      text: () =>
        new Promise<string>((_resolve, reject) => {
          signal?.addEventListener("abort", () => {
            const error = new Error("aborted");
            error.name = "AbortError";
            reject(error);
          });
        }),
    } as unknown as Response;
  }) as unknown as typeof fetch;
}

test("the timeout covers the response body, not just the headers", async () => {
  const provider = new OpenRouterProvider({
    apiKey: "k",
    model: "qwen/qwen3.8-27b",
    fetchImpl: fetchWithHangingBody(),
  });

  await assert.rejects(
    () => provider.chat({ ...REQUEST, timeoutMs: 20 }),
    (error: unknown) =>
      error instanceof ProviderError && /timed out after 20ms/.test(error.message),
  );
});

/* --------------------------------------------------------------- the judge chain */

/** Snapshot and restore every OPENROUTER_API_KEY* variable, so tests stay hermetic. */
function withKeys(keys: Record<string, string>, fn: () => void): void {
  const live = Object.keys(process.env).filter((name) => name.startsWith("OPENROUTER_API_KEY"));
  const saved = live.map((name) => [name, process.env[name]!] as const);

  for (const name of live) delete process.env[name];
  for (const [name, value] of Object.entries(keys)) process.env[name] = value;
  try {
    fn();
  } finally {
    for (const name of Object.keys(process.env)) {
      if (name.startsWith("OPENROUTER_API_KEY")) delete process.env[name];
    }
    for (const [name, value] of saved) process.env[name] = value;
  }
}

test("every configured key is collected, and nothing else is", () => {
  withKeys(
    { OPENROUTER_API_KEY: "primary", OPENROUTER_API_KEY_2: "spare", OPENROUTER_API_KEY_LING: "ling" },
    () => {
      assert.deepEqual(openRouterKeys(), ["primary", "spare", "ling"]);

      process.env.OPENROUTER_KEYS = "nope";
      try {
        assert.equal(openRouterKeys().includes("nope"), false, "a near-miss name is not a key");
      } finally {
        delete process.env.OPENROUTER_KEYS;
      }
    },
  );
});

test("several judge models condense into one judge", () => {
  withKeys({ OPENROUTER_API_KEY: "k1", OPENROUTER_API_KEY_2: "k2" }, () => {
    const judge = resolveJudgeProvider({
      models: ["inclusionai/ling-3.0-flash-sante:free", "dots-studio/dots-3-note-preview:free"],
    });
    assert.equal(judge?.id, "fallback");
    assert.equal(judge?.model, "inclusionai/ling-3.0-flash-sante:free");
    assert.equal(judge?.family, "inclusionai");
  });
});

test("the ordered list wins over the legacy single model", () => {
  withKeys({ OPENROUTER_API_KEY: "k1" }, () => {
    const judge = resolveJudgeProvider({
      model: "qwen/qwen3.8-27b",
      models: ["dots-studio/dots-3:x"],
    });
    assert.equal(judge?.model, "dots-studio/dots-3:x");
    assert.equal(judge?.id, "openrouter", "a single model needs no chain");
  });
});

test("a judge from the voice's own family is skipped, never used", () => {
  withKeys({ OPENROUTER_API_KEY: "k1" }, () => {
    const judge = resolveJudgeProvider(
      { models: ["qwen/qwen3.8-27b", "inclusionai/ling:x"] },
      "qwen/qwen3.8-27b",
    );
    assert.equal(judge?.model, "inclusionai/ling:x", "the chain falls through to another family");

    assert.equal(
      resolveJudgeProvider({ models: ["qwen/a", "qwen/b"] }, "qwen/qwen3.8-27b"),
      undefined,
      "no judge is better than a self-judging one",
    );
  });
});

test("a fallback judge answers with the first member that works", async () => {
  const calls: string[] = [];
  const member = (model: string, fail: boolean): ChatProvider => ({
    id: "fake",
    model,
    family: modelFamily(model),
    chat: async () => {
      calls.push(model);
      if (fail) throw new ProviderError("rate limited", 429);
      return { text: "{}", model, usage: { tokensIn: 1, tokensOut: 1, cost: 0 } };
    },
  });

  const chain = new FallbackProvider([member("a/x", true), member("b/y", false), member("c/z", false)]);
  const response = await chain.chat(REQUEST);

  assert.equal(response.model, "b/y");
  assert.deepEqual(calls, ["a/x", "b/y"], "members after the first success are never called");
});

test("a fallback judge names every failure when no member answers", async () => {
  const failing = (model: string): ChatProvider => ({
    id: "fake",
    model,
    family: modelFamily(model),
    chat: async () => {
      throw new ProviderError("upstream failed", 502);
    },
  });

  await assert.rejects(
    () => new FallbackProvider([failing("a/x"), failing("b/y")]).chat(REQUEST),
    (error: unknown) =>
      error instanceof ProviderError &&
      /all 2 judges failed/.test(error.message) &&
      error.message.includes("a/x") &&
      error.message.includes("b/y"),
  );
});

test("a fallback judge with no members is a construction error", () => {
  assert.throws(() => new FallbackProvider([]), /at least one provider/);
});

test("the judge provider is only built when a key and model are both present", () => {
  const previous = process.env.OPENROUTER_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  try {
    assert.equal(openRouterKey(), undefined);
    assert.equal(resolveJudgeProvider({ model: "qwen/qwen3.8-27b" }), undefined);

    process.env.OPENROUTER_API_KEY = "sk-test";
    assert.equal(resolveJudgeProvider({ model: undefined }), undefined);
    const provider = resolveJudgeProvider({ model: "qwen/qwen3.8-27b" });
    assert.equal(provider?.family, "qwen");
  } finally {
    if (previous === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = previous;
  }
});
