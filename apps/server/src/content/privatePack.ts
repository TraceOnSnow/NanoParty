/**
 * Private content packs: JSON files in a directory on the server (`CONTENT_DIR`) that are
 * loaded into the library at start-up and never live in the repository. Meant for a group's
 * own in-jokes. Each file is an array of `{ id, type, payload, version?, theme? }`.
 *
 * Like bundled content, an (id, version) that is already in the library is left untouched:
 * to change an item, raise its `version`.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type BundledContent, contentTypes } from "@apr/games";
import { z } from "zod";

/** Per-server names and remarks for games; not a content pack. */
export const GAME_NOTES_FILE = "game-notes.json";
const notesSchema = z.record(
  z.string(),
  z.object({ alias: z.string().min(1).max(16).optional(), note: z.string().min(1).max(40).optional() }),
);
export type GameNotes = z.infer<typeof notesSchema>;

/**
 * `game-notes.json` in the private directory: `{ "<game id>": { "alias"?: ..., "note"?: ... } }`.
 * Shown in this server's lobby only; nothing here changes a rule or a record.
 */
export function loadGameNotes(dir: string | undefined): GameNotes {
  if (!dir) return {};
  try {
    const parsed = notesSchema.safeParse(JSON.parse(readFileSync(join(dir, GAME_NOTES_FILE), "utf8")));
    if (parsed.success) return parsed.data;
    console.warn(`[content] ${GAME_NOTES_FILE}: wrong shape, ignored`);
  } catch {
    // No file: the games keep their own names.
  }
  return {};
}

const itemSchema = z.object({
  id: z.string().min(1).max(80),
  version: z.number().int().min(1).default(1),
  type: z.string(),
  theme: z.string().max(40).default("私有"),
  payload: z.unknown(),
});

export function loadPrivatePacks(dir: string | undefined): BundledContent[] {
  if (!dir) return [];
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".json") && f !== GAME_NOTES_FILE);
  } catch {
    return [];
  }
  const out: BundledContent[] = [];
  for (const file of files.sort()) {
    let rows: unknown;
    try {
      rows = JSON.parse(readFileSync(join(dir, file), "utf8"));
    } catch {
      console.warn(`[content] ${file}: not valid JSON, skipped`);
      continue;
    }
    if (!Array.isArray(rows)) {
      console.warn(`[content] ${file}: expected an array of items, skipped`);
      continue;
    }
    let bad = 0;
    for (const row of rows) {
      const item = itemSchema.safeParse(row);
      const payload = item.success ? contentTypes[item.data.type]?.schema.safeParse(item.data.payload) : undefined;
      if (!item.success || !payload?.success) {
        bad += 1;
        continue;
      }
      out.push({ ...item.data, payload: payload.data, source: "私有内容包", verification: "unverified" });
    }
    // Counts only: the pack's text does not belong in the log.
    console.log(`[content] ${file}: ${rows.length - bad} item(s) loaded${bad ? `, ${bad} rejected` : ""}`);
  }
  return out;
}
