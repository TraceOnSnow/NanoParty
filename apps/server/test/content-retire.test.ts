/** Withdrawn bundled items must stop being drawn from a database that was seeded before. */
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { contentItems } from "../src/db/schema.ts";
import { makeWorld, type World } from "./helpers.ts";

let world: World | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

const item = (id: string, text: string) => ({
  id,
  version: 1,
  type: "numeric-fact",
  theme: "测试",
  source: "测试",
  verification: "unverified" as const,
  payload: { text, unit: "个", answer: 1 },
});

describe("retiring bundled content", () => {
  it("keeps the row but never draws it again, even after the next seed", async () => {
    const w = await makeWorld();
    world = w;
    const { content, db } = w.deps;
    await content.seed([item("old-1", "已经在库里的旧题"), item("keep-1", "留下的题")]);
    expect((await content.pool("numeric-fact", "s1")).map((i) => i.id)).toContain("old-1");

    await content.retire(["old-1", "never-existed"]);
    await content.seed([item("old-1", "已经在库里的旧题")]);

    const ids = (await content.pool("numeric-fact", "s1")).map((i) => i.id);
    expect(ids).not.toContain("old-1");
    expect(ids).toContain("keep-1");
    const rows = await db.select().from(contentItems).where(eq(contentItems.id, "old-1"));
    expect(rows.map((r) => r.status)).toEqual(["retired"]);
  });
});
