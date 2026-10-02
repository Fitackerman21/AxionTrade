/**
 * The companion permission matrix (spec §6.1, §6.3).
 *
 * `allow` is keyed by sender: who may reply to them. `deny` always wins. A
 * persona never replies to itself unless `allowSelfReply` is set.
 */

import type { ForumConfig, Persona, PersonaId } from "./types";

export interface PermissionLookup {
  /** personas the matrix permits to reply to `sender` */
  direct: PersonaId[];
  /**
   * `direct` plus the reciprocal set — personas whose own allow list contains
   * `sender`, i.e. who are permitted to address them. Used by the Director's
   * first escalation rung when nobody is directly permitted (spec §6.3).
   */
  widened: PersonaId[];
}

function deniedFor(sender: string, config: ForumConfig): Set<PersonaId> {
  return new Set(config.permissions.deny[sender] ?? []);
}

export function respondersFor(
  sender: string,
  config: ForumConfig,
  roster: readonly Persona[],
): PermissionLookup {
  const ids = roster.map((p) => p.id);
  const known = new Set(ids);
  const denied = deniedFor(sender, config);
  const { allowSelfReply } = config.permissions;

  const eligible = (id: PersonaId): boolean =>
    known.has(id) && !denied.has(id) && (allowSelfReply || id !== sender);

  const direct = (config.permissions.allow[sender] ?? []).filter(eligible);

  // Widening never overrides an explicit deny, but it does override the absence
  // of an allow entry — that is the whole point of the first rung.
  const reciprocal = ids.filter(
    (id) => eligible(id) && (config.permissions.allow[id] ?? []).includes(sender),
  );

  return {
    direct: [...new Set(direct)],
    widened: [...new Set([...direct, ...reciprocal])],
  };
}
