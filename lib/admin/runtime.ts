/**
 * The runtime's one door into admin state.
 *
 * The forum never imports `lib/admin/store` directly — it asks this module, which
 * degrades to defaults when the admin tables are unreachable. That direction keeps
 * a dashboard outage from becoming a forum outage: the room has run without an
 * admin layer since long before one existed, and `DEFAULT_SETTINGS` is exactly the
 * room the config files describe.
 */

import { DEFAULT_SETTINGS, readAdminSettings } from "./store";
import type { AdminSettings } from "./store";

/**
 * Admin settings for the room's next turn. Never throws: a broken or missing
 * admin layer means "the room as configured", not "no room".
 */
export async function runtimeSettings(): Promise<AdminSettings> {
  try {
    return await readAdminSettings();
  } catch {
    return DEFAULT_SETTINGS;
  }
}
