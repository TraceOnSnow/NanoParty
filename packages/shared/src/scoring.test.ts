import { describe, expect, it } from "vitest";
import { formatTenths, placeRewards, settle, toTenths } from "./scoring.ts";

describe("party scoring (rank-v1)", () => {
  it("uses the documented reward table", () => {
    expect(placeRewards(2)).toEqual([100, 0]);
    expect(placeRewards(4)).toEqual([100, 70, 30, 0]);
    expect(placeRewards(8)).toEqual([100, 90, 70, 60, 40, 30, 10, 0]);
    expect(placeRewards(1)).toEqual([]);
  });

  it("ranks by raw result and splits rewards between tied players", () => {
    const s = settle(["a", "b", "c", "d"], { a: 5, b: 5, c: 2, d: 0 }, true);
    expect(s.rows.map((r) => [r.playerId, r.rank, r.tied, formatTenths(r.tenths)])).toEqual([
      ["a", 1, true, "8.5"],
      ["b", 1, true, "8.5"],
      ["c", 3, false, "3"],
      ["d", 4, false, "0"],
    ]);
    expect(s.note).toBeNull();
  });

  it("treats a team result or missing evidence as a shared place, without inventing an order", () => {
    const coop = settle(["a", "b", "c"], { a: 3, b: 3, c: 3 }, true);
    expect(coop.rows.every((r) => r.rank === 1 && r.tenths === 50)).toBe(true);
    expect(coop.note).toContain("尚无可靠区分");
    const teams = settle(["a", "b", "c", "d"], { a: 3, c: 3 }, true);
    expect(teams.rows.map((r) => r.tenths)).toEqual([85, 85, 15, 15]);
  });

  it("gives no base reward without a result or with a single participant", () => {
    expect(settle(["a", "b"], {}, false)).toMatchObject({
      rows: [{ tenths: 0 }, { tenths: 0 }],
      note: expect.stringContaining("计分单元"),
    });
    expect(settle(["a"], { a: 9 }, true)).toMatchObject({
      rows: [{ tenths: 0 }],
      note: expect.stringContaining("不足 2 人"),
    });
  });

  it("accepts negative and large adjustments but not broken numbers", () => {
    expect([toTenths(2), toTenths(-3.5), toTenths(500)]).toEqual([20, -35, 5000]);
    expect([
      toTenths(Number.NaN),
      toTenths(Number.POSITIVE_INFINITY),
      toTenths(0),
      toTenths(1e9),
      toTenths("5"),
    ]).toEqual([null, null, null, null, null]);
    expect([formatTenths(-5), formatTenths(100), formatTenths(85)]).toEqual(["-0.5", "10", "8.5"]);
  });
});
