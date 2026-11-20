import { describe, expect, it } from "vitest";
import { botAction } from "../bots.ts";
import { as, host, makeCtx, Table } from "../testkit.ts";
import {
  meldGame as game,
  MELD_HAND,
  type MeldState,
  type MeldTile,
  meldFindSets,
  meldHandValue,
  meldShape,
} from "./game.ts";

/** "红5" → a red 5; "百搭" → a wild tile. The id defaults to the text itself. */
const tile = (text: string, id = text): MeldTile =>
  text.startsWith("百搭") ? { id, color: "", n: 0 } : { id, color: text[0] as string, n: Number(text.slice(1)) };
const tiles = (text: string) => text.split(" ").map((t) => tile(t));
const faces = (set: MeldTile[] | undefined) => set?.map((t) => (t.n ? `${t.color}${t.n}` : "百搭")).join(" ");
const shape = (text: string) => meldShape(tiles(text));

/** Three players with known racks; `a` moves first. */
function table(hands: Record<string, string>, onTable: string[] = [], pool = "黑1 黑2") {
  const t = new Table(game, makeCtx(["a", "b", "c"], [], Math.random));
  Object.assign(t.state as MeldState, {
    hands: Object.fromEntries(Object.entries(hands).map(([p, text]) => [p, tiles(text)])),
    table: onTable.map(tiles),
    pool: tiles(pool),
    current: "a",
  });
  return t;
}
const HANDS = { a: "红10 红11 红12 蓝3 蓝4 蓝5 黄7", b: "黄10 黑10 蓝10 黑4", c: "黑9 黑13" };

describe("meld shapes", () => {
  it("reads runs and groups whatever order the tiles come in", () => {
    expect(shape("红5 红3 红4")).toMatchObject({ kind: "run", value: 12 });
    expect(faces(shape("红5 红3 红4")?.tiles)).toBe("红3 红4 红5");
    expect(shape("黑7 红7 黄7")).toMatchObject({ kind: "group", value: 21 });
    expect(shape("黑7 红7 黄7 蓝7")?.kind).toBe("group");
  });

  it("rejects short sets, mixed colours in a run, repeated colours in a group and wrapping past 13", () => {
    expect(shape("红5 红6")).toBeNull();
    expect(shape("红5 蓝6 红7")).toBeNull();
    expect(meldShape([tile("红7", "x"), tile("红7", "y"), tile("蓝7")])).toBeNull();
    expect(shape("红12 红13 红1")).toBeNull();
    expect(shape("红3 红4 红6")).toBeNull();
    expect(meldShape([...tiles("黑7 红7 黄7 蓝7"), tile("百搭")])).toBeNull();
  });

  it("lets a wild tile fill a gap or extend an end, and counts it as the number it stands for", () => {
    expect(faces(shape("红3 百搭 红5")?.tiles)).toBe("红3 百搭 红5");
    expect(shape("红3 百搭 红5")?.value).toBe(12);
    // A spare wild tile goes on the high end, unless the run already stops at 13.
    expect(faces(shape("百搭 红5 红6")?.tiles)).toBe("红5 红6 百搭");
    expect(shape("百搭 红5 红6")?.value).toBe(18);
    expect(faces(shape("百搭 红12 红13")?.tiles)).toBe("百搭 红12 红13");
    expect(shape("黑9 百搭 红9")).toMatchObject({ kind: "group", value: 27 });
    expect(meldShape([tile("红13"), tile("百搭", "w1"), tile("百搭", "w2")])).toMatchObject({
      kind: "group",
      value: 39,
    });
  });

  it("finds sets a rack can lay on its own", () => {
    const found = meldFindSets(tiles("红10 蓝4 红12 蓝5 红11 黄7 蓝3 黑7 蓝7 百搭"));
    expect(found.map(faces)).toEqual(["红10 红11 红12", "蓝3 蓝4 蓝5", "蓝7 黄7 黑7"]);
    expect(meldFindSets(tiles("红7 黄7 黑7 红8")).map(faces)).toEqual(["红7 黄7 黑7"]);
  });
});

describe("meld", () => {
  it("has 106 tiles, deals fourteen each and gives ids that say nothing", () => {
    const s = new Table(game, makeCtx(["a", "b", "c", "d"], [], Math.random)).state as MeldState;
    const all = [...s.pool, ...Object.values(s.hands).flat()];
    expect([all.length, s.hands.a?.length]).toEqual([106, MELD_HAND]);
    expect(all.filter((t) => t.color === "红" && t.n === 9).length).toBe(2);
    expect(all.filter((t) => t.n === 0).length).toBe(2);
    expect(new Set(all.map((t) => t.id)).size).toBe(106);
    expect(all.every((t) => /^m\d+$/.test(t.id))).toBe(true);
  });

  it("needs two to four players", () => {
    expect(game.setup(game.configSchema.parse({}), makeCtx(["a"], [])).ok).toBe(false);
    expect(game.setup(game.configSchema.parse({}), makeCtx(["a", "b", "c", "d", "e"], [])).ok).toBe(false);
  });

  it("shows a player their own rack and only the size of the others'", () => {
    const t = table(HANDS);
    const view = t.view("b");
    expect(faces(view.myHand ?? [])).toBe("黄10 黑10 蓝10 黑4");
    expect([view.counts, view.hands, view.poolLeft]).toEqual([{ a: 7, b: 4, c: 2 }, null, 2]);
    const wire = t.wire("b");
    for (const hidden of ["红11", "黄7", "黑13", "黑2"]) expect(wire).not.toContain(hidden);
  });

  it("an opening play must come from the rack alone and reach 30 points", () => {
    const t = table(HANDS, ["黑5 黑6 黑7"]);
    expect(t.try(as("b"), { type: "draw" })).toMatchObject({ ok: false, error: "还没轮到你" });
    // 蓝3 蓝4 蓝5 is only 12 points.
    expect(
      t.try(as("a"), {
        type: "meld",
        sets: [
          ["黑5", "黑6", "黑7"],
          ["蓝3", "蓝4", "蓝5"],
        ],
      }),
    ).toMatchObject({
      ok: false,
      error: "第一次出牌要合计至少 30 点，现在只有 12 点",
    });
    // Adding to a set on the table is not allowed before opening.
    expect(
      t.rejects(as("a"), {
        type: "meld",
        sets: [
          ["黑5", "黑6", "黑7", "蓝4"],
          ["红10", "红11", "红12"],
        ],
      }),
    ).toBe(true);
    t.do(as("a"), {
      type: "meld",
      sets: [
        ["红12", "红10", "红11"],
        ["黑5", "黑6", "黑7"],
      ],
    });
    expect(t.state.opened).toEqual({ a: true, b: false, c: false });
    expect(t.state.table.map(faces)).toEqual(["红10 红11 红12", "黑5 黑6 黑7"]);
    expect([faces(t.state.hands.a), t.state.lastPlayed, t.state.current]).toEqual([
      "蓝3 蓝4 蓝5 黄7",
      ["红12", "红10", "红11"],
      "b",
    ]);
  });

  it("after opening, the table can be taken apart as long as every set stands and nothing leaves it", () => {
    const t = table(HANDS, ["红10 红11 红12 红13", "黑5 黑6 黑7"]);
    Object.assign(t.state.opened, { a: true, b: true });
    t.do(as("a"), { type: "draw" });
    expect([t.state.hands.a?.length, t.state.pool.length, t.state.current]).toEqual([8, 1, "b"]);
    // b splits the red run to make a group of tens and hangs 黑4 on the black run.
    expect(
      t.rejects(as("b"), {
        type: "meld",
        sets: [
          ["红11", "红12", "红13"],
          ["黑5", "黑6", "黑7", "黑4"],
        ],
      }),
    ).toBe(true);
    expect(
      t.rejects(as("b"), {
        type: "meld",
        sets: [
          ["红10", "红11", "红12", "红13"],
          ["黑5", "黑6", "黑7"],
        ],
      }),
    ).toBe(true);
    expect(
      t.rejects(as("b"), {
        type: "meld",
        sets: [
          ["红10", "红11", "红12", "红13"],
          ["黑5", "黑6", "黑7"],
          ["黄10", "黑10", "红9"],
        ],
      }),
    ).toBe(true);
    expect(
      t.rejects(as("b"), {
        type: "meld",
        sets: [
          ["红10", "红11", "红12", "红13", "红10"],
          ["黑5", "黑6", "黑7"],
        ],
      }),
    ).toBe(true);
    t.do(as("b"), {
      type: "meld",
      sets: [
        ["红11", "红12", "红13"],
        ["红10", "黄10", "黑10", "蓝10"],
        ["黑4", "黑5", "黑6", "黑7"],
      ],
    });
    expect(t.state.table.map(faces)).toEqual(["红11 红12 红13", "红10 蓝10 黄10 黑10", "黑4 黑5 黑6 黑7"]);
    expect([t.state.phase, t.state.ended, t.state.winners]).toEqual(["gameOver", "out", ["b"]]);
    expect(faces(t.view("c").hands?.a)).toContain("蓝3");
    expect(t.rejects(as("c"), { type: "draw" })).toBe(true);
    expect(t.rejects(as("b"), { type: "next" })).toBe(true);
    t.do(host, { type: "next" });
    // c holds 22 points, a holds more: the winner gets 3 and the lightest other rack 1.
    expect([t.finished, t.points("b"), t.points("c"), t.points("a")]).toEqual([true, 3, 1, 0]);
  });

  it("draws on a timeout, and ends on the lightest rack once the pool is empty and everyone passes", () => {
    const t = table({ a: "红1 红2", b: "百搭 黑1", c: "黑9 黑13" }, [], "黄3");
    t.timeout();
    expect([faces(t.state.hands.a), t.state.pool.length, t.state.current]).toEqual(["红1 红2 黄3", 0, "b"]);
    t.do(as("b"), { type: "draw" });
    t.do(as("c"), { type: "draw" });
    expect([t.state.passes, t.state.phase]).toEqual([2, "play"]);
    t.do(as("a"), { type: "draw" });
    expect([t.state.ended, t.state.winners]).toEqual(["stuck", ["a"]]);
    expect(meldHandValue(t.state.hands.b ?? [])).toBe(31);
    t.do(host, { type: "next" });
    expect([t.points("a"), t.points("c"), t.points("b")]).toEqual([3, 1, 0]);
  });

  it("rejects a move made for an earlier step", () => {
    const t = table(HANDS);
    expect(game.apply(structuredClone(t.state), { type: "draw", step: 0 }, as("a"), t.ctx)).toMatchObject({
      ok: false,
      error: "该操作已过期",
    });
  });

  it("test players can play a whole game through the normal action path", () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const t = new Table(game, makeCtx(["a", "b", "c"], [], random));
    let melds = 0;
    for (let i = 0; i < 600 && t.state.phase === "play"; i++) {
      const me = t.state.current;
      const action = botAction("meld", t.view(me), me);
      expect(action).not.toBeNull();
      if (action?.type === "meld") melds += 1;
      const r = game.apply(structuredClone(t.state), action as never, as(me), t.ctx);
      if (!r.ok) throw new Error(r.error);
      t.state = r.state;
    }
    expect(t.state.phase).toBe("gameOver");
    expect(melds).toBeGreaterThan(0);
    // Nothing is lost or copied along the way.
    const all = [...t.state.pool, ...t.state.table.flat(), ...Object.values(t.state.hands).flat()];
    expect(new Set(all.map((x) => x.id)).size).toBe(106);
  });
});
