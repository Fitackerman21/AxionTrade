/**
 * The shipped room definition, bundled rather than read from disk.
 *
 * On a serverless host the deployment filesystem is read-only *and* the
 * `data/forum` directory is not guaranteed to be traced into the function
 * bundle, so `fs.readFile("data/forum/config.json")` can fail with ENOENT at
 * runtime even though the file is in the repo. Importing the JSON makes the
 * roster, topic deck and world state part of the build, so the same room comes
 * up wherever the app runs.
 *
 * Only the *definition* is bundled. The mutable half of the room — the turn log,
 * the lease, the heartbeat — belongs to the store (see `pg-store.ts`).
 */

import config from "../../data/forum/config.json";
import personas from "../../data/forum/personas.json";
import topics from "../../data/forum/topics/deck.json";
import world from "../../data/forum/world/latest.json";
import type { ForumConfig, Persona, Topic, WorldState } from "./types";

export const ROOM_CONFIG = config as unknown as ForumConfig;
export const ROOM_PERSONAS = personas as unknown as Persona[];
export const ROOM_TOPICS = topics as unknown as Topic[];
export const ROOM_WORLD = world as unknown as WorldState;
