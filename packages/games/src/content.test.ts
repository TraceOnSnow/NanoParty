import { describe, expect, it } from "vitest";
import { contentTypes } from "./contentTypes.ts";
import { bundledContent, retiredContentIds } from "./index.ts";

describe("bundled content", () => {
  it("does not ship an item that was withdrawn", () => {
    const shipped = new Set(bundledContent.map((c) => c.id));
    expect(retiredContentIds.filter((id) => shipped.has(id))).toEqual([]);
  });

  it("has unique ids", () => {
    const seen = new Set<string>();
    const twice = bundledContent.filter((item) => seen.size === seen.add(item.id).size).map((item) => item.id);
    expect(twice).toEqual([]);
  });

  it("matches the payload shape of its type and says where it came from", () => {
    const bad = bundledContent.filter((item) => {
      const type = contentTypes[item.type];
      return !type || !type.schema.safeParse(item.payload).success || item.source.trim() === "";
    });
    expect(bad.map((item) => item.id)).toEqual([]);
  });

  it("does not repeat a question, word or pair within a type", () => {
    const seen = new Set<string>();
    const twice: string[] = [];
    for (const item of bundledContent) {
      const p = item.payload as Record<string, unknown>;
      const key =
        item.type === "word-pair"
          ? [p.a, p.b].sort().join("|")
          : item.type === "scale-scenario"
            ? `${p.text}|${p.low}|${p.high}`
            : String(p.word ?? p.text ?? p.surface ?? p.name ?? (p.left ? `${p.left}|${p.right}` : item.id));
      // The same target word may be both a plain guess word and a taboo card.
      const full = `${item.type}:${key}`;
      if (seen.has(full)) twice.push(`${item.id} (${key})`);
      seen.add(full);
    }
    expect(twice).toEqual([]);
  });
});
