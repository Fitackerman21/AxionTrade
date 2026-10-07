/**
 * Admin: persona profiles.
 *
 * GET  /api/admin/personas — the roster with every display override applied, plus
 *      per-persona memory thread counts (so the inspector can link to them).
 * POST /api/admin/personas — update one persona's public profile: name, role,
 *      bio, age, picture (URL), avatar gradient and colours, online flag. Stored
 *      as an override row, so the bundled roster stays the source of truth and a
 *      bad edit is one DELETE away from gone.
 */

import { checkAdminAuth, adminDenied, adminJson } from "@/lib/admin/auth";
import {
  readPersonaOverrides,
  writePersonaOverride,
  logAction,
  type PersonaDisplayOverride,
} from "@/lib/admin/store";
import { openForumStore } from "@/lib/forum/store";

export const dynamic = "force-dynamic";

function clean(value: unknown, max: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.slice(0, max);
}

function cleanColor(value: unknown): string | undefined {
  const v = clean(value, 9);
  return v && /^#[0-9a-fA-F]{3,8}$/.test(v) ? v : undefined;
}

export async function GET(request: Request) {
  const auth = checkAdminAuth(request, { mutation: false });
  if (!auth.ok) return adminDenied(auth);

  const store = openForumStore();
  const [personas, overrides] = await Promise.all([store.readPersonas(), readPersonaOverrides()]);
  const withOverrides = personas.map((p) => ({
    ...p,
    ...(overrides[p.id] ?? {}),
    overridden: overrides[p.id] !== undefined,
  }));
  return adminJson({ personas: withOverrides });
}

export async function POST(request: Request) {
  const auth = checkAdminAuth(request, { mutation: true });
  if (!auth.ok) return adminDenied(auth);

  const body = (await request.json().catch(() => null)) as
    | { persona?: string; display?: Record<string, unknown> }
    | null;
  const persona = body?.persona?.trim();
  if (!persona || !body?.display) return adminJson({ error: "a persona and a display object are required" }, 400);

  const store = openForumStore();
  const roster = await store.readPersonas();
  if (!roster.some((p) => p.id === persona)) {
    return adminJson({ error: `unknown persona "${persona}"` }, 400);
  }

  // Layer the new edit over what is already stored, so saving one field does not
  // erase the others.
  const existing = (await readPersonaOverrides())[persona] ?? {};
  const display: PersonaDisplayOverride = {
    ...existing,
    name: clean(body.display.name, 60) ?? existing.name,
    role: clean(body.display.role, 80) ?? existing.role,
    bio: clean(body.display.bio, 400) ?? existing.bio,
    age:
      body.display.age === null
        ? null
        : Number.isFinite(Number(body.display.age)) && Number(body.display.age) > 0
          ? Math.floor(Number(body.display.age))
          : existing.age,
    picture:
      body.display.picture === null
        ? null
        : clean(body.display.picture, 500) ?? existing.picture,
    g1: cleanColor(body.display.g1) ?? existing.g1,
    g2: cleanColor(body.display.g2) ?? existing.g2,
    color: cleanColor(body.display.color) ?? existing.color,
    online: typeof body.display.online === "boolean" ? body.display.online : existing.online,
  };

  await writePersonaOverride(persona, display, "admin");
  return adminJson({ ok: true, persona, display });
}
