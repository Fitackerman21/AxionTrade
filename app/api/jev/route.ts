import { NextResponse } from "next/server";

/**
 * Server-side proxy for the Jev battery on /jev. The key never reaches the
 * browser: without TYPESAFE_API_KEY (direct, one hop) or AI_GATEWAY_API_KEY
 * (Vercel AI Gateway, the route the PTQ prompt calls "the normal route"),
 * this reports `available: false` and the page runs its own labelled mock
 * decision client instead.
 *
 * The prompt's rule holds here too: Jev answers judgments, never
 * arithmetic. The state and the questions are built in lib/jev-loop.ts, and
 * nothing computes the answer client-side.
 */

const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const GATEWAY_URL = "https://ai-gateway.vercel.sh/typesafe/v1/systemone";

/** The loop treats a decision slower than this as late and holds. */
const DECISION_BUDGET_MS = 2000;

interface Resolved {
  url: string;
  key: string;
  model: string;
  route: string;
}

function resolveClient(): Resolved | null {
  const direct = process.env.TYPESAFE_API_KEY;
  if (direct) {
    return { url: TYPESAFE_URL, key: direct, model: "jev-latest", route: "TYPESAFE" };
  }
  const gateway = process.env.AI_GATEWAY_API_KEY;
  if (gateway) {
    return {
      url: GATEWAY_URL,
      key: gateway,
      model: "typesafe-ai/jev",
      route: "GATEWAY",
    };
  }
  return null;
}

export async function GET() {
  const client = resolveClient();
  return NextResponse.json(
    client
      ? { available: true, route: client.route, model: client.model }
      : { available: false, route: "MOCK", model: "mock-jev-0.1" },
    { headers: { "Cache-Control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const client = resolveClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, reason: "no decision key configured" },
      { headers: { "Cache-Control": "no-store" } },
    );
  }

  let body: { state?: unknown; questions?: unknown };
  try {
    body = (await request.json()) as { state?: unknown; questions?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad request body" });
  }
  if (!body.state || !body.questions) {
    return NextResponse.json({ ok: false, reason: "state and questions are required" });
  }

  const started = Date.now();
  try {
    const res = await fetch(client.url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${client.key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: client.model,
        state: body.state,
        questions: body.questions,
      }),
      signal: AbortSignal.timeout(DECISION_BUDGET_MS),
      cache: "no-store",
    });

    if (!res.ok) {
      // a 403 customer_verification_required on the gateway is the common
      // one: the team has no card on file yet, so the page falls back to mock
      const text = await res.text();
      return NextResponse.json({
        ok: false,
        reason: `HTTP ${res.status}: ${text.slice(0, 200)}`,
      });
    }

    const data = (await res.json()) as {
      answers?: unknown;
      model?: string;
      usage?: unknown;
    };
    if (!data.answers) {
      return NextResponse.json({ ok: false, reason: "response had no answers" });
    }

    return NextResponse.json({
      ok: true,
      answers: data.answers,
      model: data.model ?? client.model,
      route: client.route,
      latencyMs: Date.now() - started,
      usage: data.usage ?? {},
    });
  } catch (error) {
    const reason =
      error instanceof Error
        ? error.name === "TimeoutError"
          ? "decision exceeded the tick budget"
          : error.message
        : "decision failed";
    return NextResponse.json({ ok: false, reason });
  }
}
