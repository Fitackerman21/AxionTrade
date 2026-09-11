import { NextResponse } from "next/server";

export const revalidate = 300;

export async function GET() {
  try {
    const res = await fetch("https://api.alternative.me/fng/?limit=1", {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) throw new Error("upstream");
    const j = (await res.json()) as { data?: Array<{ value: string; value_classification: string }> };
    const d = j.data?.[0];
    if (!d) throw new Error("no data");
    return NextResponse.json(
      { value: Number(d.value), label: d.value_classification },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=300" } }
    );
  } catch {
    return NextResponse.json({ value: null, label: null }, { headers: { "Cache-Control": "no-store" } });
  }
}
