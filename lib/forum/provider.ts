/**
 * Provider adapters — the only place in the forum that talks to a model (spec §15).
 *
 * Both the Voice (P1) and the Gate (§8.2) go through this interface, which is what
 * makes "the judge must never share a family with the voice" a checkable rule
 * rather than a comment: `family` is part of the provider contract.
 *
 * OpenRouter is the first adapter because one key reaches several model families,
 * which is exactly what a room with per-persona providers needs while it is small.
 */

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export type ReasoningLevel = "off" | "minimal" | "low" | "medium" | "high";

export interface ChatRequest {
  messages: ChatMessage[];
  /** prepended as a system message; with `json` the JSON rule is appended to it */
  system?: string;
  maxTokens?: number;
  temperature?: number;
  /** ask for machine-readable output (prompt-level; parsed leniently by callers) */
  json?: boolean;
  /**
   * Reasoning budget for models that expose one. "off" is what the Gate asks for:
   * a rubric is a bounded classification, not a thing to think hard about, and a
   * reasoning model left on spends most of its output budget on a scratchpad —
   * which made long judge prompts come back truncated or empty. Measured against
   * `qwen/qwen3.8-27b`, "off" was ~5x faster and ~2.5x cheaper than "low" with
   * equally sensible verdicts.
   */
  reasoning?: ReasoningLevel;
  /** abort the request after this long (spec §10.1, §10.2) */
  timeoutMs?: number;
}

export interface ChatUsage {
  tokensIn: number;
  tokensOut: number;
  cost: number;
}

export interface ChatResponse {
  text: string;
  model: string;
  /** the upstream provider the gateway routed to, when it reports one */
  upstream?: string;
  usage: ChatUsage;
}

export interface ChatProvider {
  /** adapter id, e.g. "openrouter" */
  readonly id: string;
  readonly model: string;
  /** model family, e.g. "qwen" — used by the self-preference guard (§8.2) */
  readonly family: string;
  chat(request: ChatRequest): Promise<ChatResponse>;
}

/** Appended when a caller asks for JSON, so the contract is explicit to the model. */
export const JSON_INSTRUCTION =
  "Return a single JSON object and nothing else — no prose, no code fences.";

/** A provider call failed. `status` is the HTTP status, or 0 when there was none. */
export class ProviderError extends Error {
  readonly status: number;
  readonly code: number | null;

  constructor(message: string, status: number, code: number | null = null) {
    super(message);
    this.name = "ProviderError";
    this.status = status;
    this.code = code;
  }
}

/** The family part of a model id: "qwen/qwen3.8-27b" -> "qwen". */
export function modelFamily(model: string): string {
  const base = model.split(":")[0] ?? model;
  const slash = base.indexOf("/");
  return (slash === -1 ? base : base.slice(0, slash)).trim().toLowerCase();
}

/** Would a model be judging its own family? (spec §8.2) */
export function sameFamily(a: string, b: string): boolean {
  const fa = modelFamily(a);
  return fa.length > 0 && fa === modelFamily(b);
}

export const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

interface OpenRouterChoice {
  message?: { content?: string | null; refusal?: string | null } | null;
}

interface OpenRouterBody {
  model?: string;
  provider?: string;
  choices?: OpenRouterChoice[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
  error?: { code?: number; message?: string };
}

export interface OpenRouterOptions {
  apiKey: string;
  model: string;
  /** attribution headers OpenRouter uses for its dashboard */
  appName?: string;
  referer?: string;
  /** injectable for tests, so no test ever hits the network */
  fetchImpl?: typeof fetch;
}

export class OpenRouterProvider implements ChatProvider {
  readonly id = "openrouter";
  readonly model: string;
  readonly family: string;

  private readonly apiKey: string;
  private readonly appName: string;
  private readonly referer: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OpenRouterOptions) {
    if (!options.apiKey) throw new Error("openrouter: an API key is required");
    if (!options.model) throw new Error("openrouter: a model id is required");
    this.apiKey = options.apiKey;
    this.model = options.model;
    this.family = modelFamily(options.model);
    this.appName = options.appName ?? "Axion AI forum";
    this.referer = options.referer ?? "https://axiontrade.vercel.app";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  /**
   * POST the body with the timeout covering both the headers *and* the body.
   *
   * OpenRouter can send headers as soon as the upstream connects and then stream
   * the completion in, so a timer cleared when `fetch` resolves only guards the
   * headers — a stalled body would sit past the budget indefinitely (§10.1).
   */
  private async post(
    body: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<{ ok: boolean; status: number; raw: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const timeout = (status: number): ProviderError =>
      new ProviderError(`openrouter: timed out after ${timeoutMs}ms`, status);

    try {
      let response: Response;
      try {
        response = await this.fetchImpl(OPENROUTER_URL, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            "Content-Type": "application/json",
            "HTTP-Referer": this.referer,
            "X-Title": this.appName,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") throw timeout(0);
        throw new ProviderError(`openrouter: request failed (${(error as Error).message})`, 0);
      }

      try {
        const raw = await response.text();
        return { ok: response.ok, status: response.status, raw };
      } catch (error) {
        if ((error as Error).name === "AbortError") throw timeout(response.status);
        throw new ProviderError(
          `openrouter: could not read response (${(error as Error).message})`,
          response.status,
        );
      }
    } finally {
      clearTimeout(timer);
    }
  }

  async chat(request: ChatRequest): Promise<ChatResponse> {
    const system = request.system
      ? request.json
        ? `${request.system}\n\n${JSON_INSTRUCTION}`
        : request.system
      : undefined;

    const messages: ChatMessage[] = system
      ? [{ role: "system", content: system }, ...request.messages]
      : request.messages;

    const body: Record<string, unknown> = { model: this.model, messages };
    if (request.maxTokens !== undefined) body.max_tokens = request.maxTokens;
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (request.reasoning !== undefined) {
      body.reasoning =
        request.reasoning === "off" ? { enabled: false } : { effort: request.reasoning };
    }

    const { ok, status, raw } = await this.post(body, request.timeoutMs ?? 30_000);

    let parsed: OpenRouterBody | null = null;
    try {
      parsed = JSON.parse(raw) as OpenRouterBody;
    } catch {
      parsed = null;
    }

    if (!ok) {
      // Failures come back as {"error":{"code","message"}} (see the model's llms.txt).
      const code = parsed?.error?.code ?? null;
      const message = parsed?.error?.message ?? raw.slice(0, 300) ?? "no body";
      throw new ProviderError(`openrouter ${status}: ${message}`, status, code);
    }

    if (!parsed) {
      throw new ProviderError(
        `openrouter: response was not JSON (${raw.slice(0, 200)})`,
        status,
      );
    }

    const choice = parsed.choices?.[0];
    // The model may put scratchpad text in `reasoning`; only `content` is the line.
    const text = (choice?.message?.content ?? "").trim();
    if (!text) {
      const refusal = choice?.message?.refusal;
      throw new ProviderError(
        `openrouter: empty completion${refusal ? ` (${refusal})` : ""}`,
        status,
      );
    }

    return {
      text,
      model: parsed.model ?? this.model,
      upstream: parsed.provider,
      usage: {
        tokensIn: parsed.usage?.prompt_tokens ?? 0,
        tokensOut: parsed.usage?.completion_tokens ?? 0,
        cost: parsed.usage?.cost ?? 0,
      },
    };
  }
}

/** The OpenRouter key, when one is configured. Never logged. */
export function openRouterKey(): string | undefined {
  const key = process.env.OPENROUTER_API_KEY?.trim();
  return key ? key : undefined;
}

/**
 * Build the judge provider from config + env (spec §8.2, §15). Returns undefined
 * when there is no key or no model, which makes the Gate fall back to its
 * deterministic checks instead of failing the turn.
 */
export function resolveJudgeProvider(gate: { model?: string }): ChatProvider | undefined {
  const apiKey = openRouterKey();
  const model = gate.model?.trim();
  if (!apiKey || !model) return undefined;
  return new OpenRouterProvider({ apiKey, model });
}
