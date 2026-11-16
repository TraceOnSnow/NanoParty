/** VNext batch 3: two ledgers, settlement, negotiated adjustments, party lifecycle, recap, preferences. */
import { and, eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel, AgentRunInput } from "../src/agent/model.ts";
import { adjustments, partyPoints, partySessions, scoreEvents } from "../src/db/schema.ts";
import { buildRecap, listParties } from "../src/rooms/recap.ts";
import { LIMITS, loadRuntime, makeWorld, seedRoom, TestClient, type World, waitFor } from "./helpers.ts";

let world: World | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

async function setup(
  n: number,
  scoring: "raw-v1" | "rank-v1" = "rank-v1",
  host: AgentModel | null = null,
  judge: AgentModel | null = null,
) {
  world = await makeWorld(host, LIMITS, judge);
  const { roomId, seats } = await seedRoom(world, n, scoring);
  const runtime = await loadRuntime(world, roomId);
  const clients = seats.map((s) => new TestClient(runtime, s.playerId));
  return { world, roomId, seats, runtime, clients };
}

const points = (c: TestClient) => Object.fromEntries(c.view.scoreboard.map((s) => [s.playerId, s.points]));

/** One round of 谁最可能 where everyone votes for `target`; voters matching the majority score 1 raw point. */
async function round(clients: TestClient[], votes: (TestClient | null)[]) {
  const host = clients[0] as TestClient;
  const picker = clients.find((c) => c.playerId === host.game.pick.picker) as TestClient;
  await picker.act({ type: "choose", step: picker.game.step, index: 0 });
  for (const [i, c] of clients.entries()) {
    const target = votes[i];
    if (target) await c.act({ type: "vote", step: c.game.step, target: target.playerId });
  }
  if (host.game.phase === "vote") await host.act({ type: "reveal", step: host.game.step });
}
const start = (host: TestClient, rounds = 0) =>
  host.cmd({ type: "startGame", gameId: "mostlikely", config: { rounds, pickSeconds: 0, voteSeconds: 0 } });

describe("settlement and the two ledgers (AC-17, AC-18)", () => {
  it("keeps raw results apart from party points and credits placement rewards exactly once", async () => {
    const { world, clients } = await setup(4);
    const [host, b, c, d] = clients as [TestClient, TestClient, TestClient, TestClient];
    await start(host, 1);
    // a, b, c vote for a (majority) → 1 raw point each; d votes for b → 0.
    await round(clients, [host, host, host, b]);
    expect(host.view.segment?.rawScores.map((s) => s.points)).toEqual([1, 1, 1]);
    expect(Object.values(points(host))).toEqual([0, 0, 0, 0]); // nothing on the party board yet

    await host.act({ type: "next", step: host.game.step }); // last round → the game is over
    expect(host.view.segment).toBeNull();
    const st = host.view.settlement;
    expect(st).toMatchObject({ gameId: "mostlikely", endedReason: "finished" });
    // Three tied for first share (10+7+3)/3 = 6.7; the fourth gets 0.
    expect(st?.rows.map((r) => [r.rank, r.tied, r.tenths])).toEqual([
      [1, true, 67],
      [1, true, 67],
      [1, true, 67],
      [4, false, 0],
    ]);
    expect(Object.values(points(host))).toEqual([0, 0, 0, 0]); // still only a forecast

    // Only the host confirms; a double click, a retry and a reconnect do not pay twice.
    const segmentId = st?.segmentId ?? "";
    expect(await b.cmd({ type: "confirmSettlement", segmentId, adjustmentId: null })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "startGame", gameId: "mostlikely" })).toMatchObject({ ok: false });
    const [first, second] = await Promise.all([
      host.cmd({ type: "confirmSettlement", segmentId, adjustmentId: null }),
      host.cmd({ type: "confirmSettlement", segmentId, adjustmentId: null }),
    ]);
    expect([first.ok, second.ok]).toEqual([true, false]);
    expect(points(host)).toEqual({ [host.playerId]: 6.7, [b.playerId]: 6.7, [c.playerId]: 6.7, [d.playerId]: 0 });
    const ledger = await world.handle.db.select().from(partyPoints);
    expect(ledger).toHaveLength(4);
    expect(host.view.party.gamesPlayed).toBe(1);
    // The raw record is untouched.
    expect(await world.handle.db.select().from(scoreEvents)).toHaveLength(3);
  });

  it("settles an endless game on what was completed, and gives nothing for an abandoned one", async () => {
    const { clients } = await setup(3);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    await start(host);
    await round(clients, [b, b, host]); // a and b match → 1 each
    await host.act({ type: "next", step: host.game.step });
    // Mid-way through the second round the host ends and settles: the finished round counts.
    expect(await b.cmd({ type: "endSegment", segmentId: b.view.segment?.id ?? "", mode: "settle" })).toMatchObject({
      ok: false,
    });
    await host.cmd({ type: "endSegment", segmentId: host.view.segment?.id ?? "", mode: "settle" });
    expect(host.view.settlement?.endedReason).toBe("ended");
    expect(host.view.settlement?.rows.map((r) => r.tenths)).toEqual([75, 75, 0]);
    await host.cmd({ type: "confirmSettlement", segmentId: host.view.settlement?.segmentId ?? "", adjustmentId: null });
    expect(points(host)[c.playerId]).toBe(0);

    // Ended before any scoring unit: no base reward, and the reason is stated.
    await start(host);
    await host.cmd({ type: "endSegment", segmentId: host.view.segment?.id ?? "", mode: "settle" });
    expect(host.view.settlement?.note).toContain("计分单元");
    expect(host.view.settlement?.rows.every((r) => r.tenths === 0)).toBe(true);
    await host.cmd({ type: "confirmSettlement", segmentId: host.view.settlement?.segmentId ?? "", adjustmentId: null });

    // Abandoned: straight back to the lobby, no settlement, totals unchanged.
    const before = points(host);
    await start(host);
    await round(clients, [b, b, b]);
    await host.cmd({ type: "endSegment", segmentId: host.view.segment?.id ?? "", mode: "abandon" });
    expect([host.view.segment, host.view.settlement]).toEqual([null, null]);
    expect(points(host)).toEqual(before);
  });

  it("survives a restart while waiting for the host's confirmation", async () => {
    const { world, roomId, seats, clients } = await setup(3);
    const [host, b] = clients as [TestClient, TestClient, TestClient];
    await start(host, 1);
    await round(clients, [b, b, b]);
    await host.act({ type: "next", step: host.game.step });
    const reloaded = await loadRuntime(world, roomId);
    const again = seats.map((s) => new TestClient(reloaded, s.playerId));
    const hostAgain = again[0] as TestClient;
    expect(hostAgain.view.settlement?.rows).toEqual(host.view.settlement?.rows);
    expect(
      await hostAgain.cmd({
        type: "confirmSettlement",
        segmentId: hostAgain.view.settlement?.segmentId ?? "",
        adjustmentId: null,
      }),
    ).toEqual({
      ok: true,
    });
  });

  it("leaves a legacy party on its old scoring and starts the next one on the new scoring (AC-25)", async () => {
    const { world, roomId, clients } = await setup(3, "raw-v1");
    const [host, b] = clients as [TestClient, TestClient, TestClient];
    expect(host.view.party.scoring).toBe("raw-v1");
    await start(host, 1);
    await round(clients, [b, b, b]);
    await host.act({ type: "next", step: host.game.step });
    // Old behaviour: raw points are the party total, no settlement step, no adjustments.
    expect(host.view.settlement).toBeNull();
    expect(Object.values(points(host))).toEqual([1, 1, 1]);
    expect(
      await host.cmd({ type: "proposeAdjustment", items: [{ playerId: b.playerId, points: 5 }], reason: "试试" }),
    ).toMatchObject({
      ok: false,
    });
    await host.cmd({ type: "endSession" });
    expect(host.view.party).toMatchObject({ scoring: "rank-v1", number: 2 });
    expect(Object.values(points(host))).toEqual([0, 0, 0]);
    // The old party's record is intact and labelled with its own scoring.
    const [old] = await listParties(world.handle.db, roomId);
    const recap = await buildRecap(world.handle.db, roomId, old?.sessionId ?? "");
    expect(recap).toMatchObject({ scoring: "raw-v1", status: "ended" });
    expect(recap?.ranking.map((r) => r.tenths)).toEqual([10, 10, 10]);
    expect(await world.handle.db.select().from(partyPoints)).toHaveLength(0);
  });
});

describe("negotiated adjustments (AC-19, AC-20)", () => {
  /** A host agent that turns the request into a proposal through the real tool. */
  class Negotiator implements AgentModel {
    results: string[] = [];
    constructor(
      private readonly plan: (input: AgentRunInput) => {
        items: { playerId: string; points: number }[];
        reason: string;
      },
    ) {}
    async run(input: AgentRunInput) {
      const tool = input.tools.find((t) => t.name === "propose_adjustment");
      if (!tool) throw new Error("no tool");
      this.results.push(await tool.run(tool.inputSchema.parse(this.plan(input))));
      return { text: "方案提了，等房主拍板。", inputTokens: 1, outputTokens: 1 };
    }
  }

  it("does not let the same player talk the host into one proposal after another", async () => {
    let target = "";
    const model = new Negotiator(() => ({ items: [{ playerId: target, points: 3 }], reason: "要了就给" }));
    const { runtime, clients } = await setup(3, "rank-v1", model);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    target = c.playerId;
    await runtime.handleChat(c.playerId, "加分", true);
    await waitFor(() => model.results.length === 1);
    expect(model.results[0]).toContain("等待房主确认");
    const first = host.view.adjustments[0]?.id;

    // Asking again right away: the tool refuses, and the pending proposal is not replaced.
    await runtime.handleChat(c.playerId, "再加", true);
    await waitFor(() => model.results.length === 2);
    expect(model.results[1]).toContain("没提");
    expect(host.view.adjustments.map((a) => a.id)).toEqual([first]);

    // Someone else's request is still served.
    target = b.playerId;
    await runtime.handleChat(b.playerId, "那我也要", true);
    await waitFor(() => model.results.length === 3);
    expect(model.results[2]).toContain("等待房主确认");
  });

  it("turns a player's request into a visible proposal that only the host's approval credits", async () => {
    let target = "";
    const model = new Negotiator(() => ({
      items: [
        { playerId: target, points: 5 },
        { playerId: "nobody", points: 1 },
      ],
      reason: "这把纯 C",
    }));
    const { world, runtime, clients } = await setup(3, "rank-v1", model);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    await start(host, 1);
    await round(clients, [b, b, b]);
    await host.act({ type: "next", step: host.game.step });
    const segmentId = host.view.settlement?.segmentId ?? "";

    // The tool refuses unknown players; a corrected proposal is shown to everyone, uncredited.
    target = c.playerId;
    await runtime.handleChat(c.playerId, "这把我纯 C，至少加五分", true);
    await waitFor(() => model.results.length === 1);
    expect(model.results[0]).toContain("失败");
    expect(host.view.adjustments).toEqual([]);
    const fixed = new Negotiator(() => ({
      items: [
        { playerId: c.playerId, points: 5 },
        { playerId: b.playerId, points: -1.5 },
      ],
      reason: "这把纯 C，b 交手续费",
    }));
    (world.agent as unknown as { model: AgentModel }).model = fixed;
    await runtime.handleChat(c.playerId, "再来", true);
    await waitFor(() => fixed.results.length === 1);
    expect(fixed.results[0]).toContain("等待房主确认");
    expect(b.view.adjustments).toMatchObject([
      { proposedBy: "AI 主持", segmentId, reason: "这把纯 C，b 交手续费", items: [{ tenths: 50 }, { tenths: -15 }] },
    ]);
    expect(Object.values(points(host))).toEqual([0, 0, 0]); // not credited

    // Nobody but the host can approve; the host approves it together with the settlement.
    const id = b.view.adjustments[0]?.id ?? "";
    expect(await c.cmd({ type: "decideAdjustment", adjustmentId: id, approve: true })).toMatchObject({ ok: false });
    expect(await c.cmd({ type: "confirmSettlement", segmentId, adjustmentId: id })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "confirmSettlement", segmentId, adjustmentId: id })).toEqual({ ok: true });
    // Base: three tied → 5 each. Then c +5, b −1.5.
    expect(points(host)).toEqual({ [host.playerId]: 5, [b.playerId]: 3.5, [c.playerId]: 10 });
    expect(host.view.adjustments).toEqual([]);
    // Approving again does nothing.
    expect(await host.cmd({ type: "decideAdjustment", adjustmentId: id, approve: true })).toMatchObject({ ok: false });
    expect(points(host)[c.playerId]).toBe(10);
    const rows = await world.handle.db.select().from(partyPoints).where(eq(partyPoints.kind, "adjust"));
    expect(rows.map((r) => [r.tenths, r.proposedBy, r.approvedBy, r.reason]).sort()).toEqual(
      [
        [-15, "agent", host.playerId, "这把纯 C，b 交手续费"],
        [50, "agent", host.playerId, "这把纯 C，b 交手续费"],
      ].sort(),
    );
  });

  it("allows big and negative totals, and refuses broken numbers, replaced, cancelled and expired proposals", async () => {
    const { world, clients } = await setup(3);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    const propose = (items: { playerId: string; points: number }[], reason = "理由", segmentId?: string) =>
      host.cmd({ type: "proposeAdjustment", items, reason, ...(segmentId ? { segmentId } : {}) });
    expect(
      await b.cmd({ type: "proposeAdjustment", items: [{ playerId: b.playerId, points: 99 }], reason: "我要" }),
    ).toMatchObject({
      ok: false,
    });
    for (const bad of [0, 1e9, -1e9])
      expect(await propose([{ playerId: b.playerId, points: bad }])).toMatchObject({ ok: false });
    expect(await propose([{ playerId: "ghost", points: 1 }])).toMatchObject({ ok: false });

    // Lobby-level adjustment (no game): a negative total is allowed.
    await propose([{ playerId: b.playerId, points: -42.5 }], "欠大家一顿饭");
    const first = host.view.adjustments[0]?.id ?? "";
    // A newer proposal replaces it; the old one can no longer be approved.
    await propose([{ playerId: b.playerId, points: -500 }], "涨价了");
    const second = host.view.adjustments[0]?.id ?? "";
    expect(host.view.adjustments).toHaveLength(1);
    expect(await host.cmd({ type: "decideAdjustment", adjustmentId: first, approve: true })).toMatchObject({
      ok: false,
    });
    expect(await host.cmd({ type: "decideAdjustment", adjustmentId: second, approve: true })).toEqual({ ok: true });
    expect(points(host)[b.playerId]).toBe(-500);

    // Cancelled → nothing happens, and it cannot be approved afterwards.
    await propose([{ playerId: c.playerId, points: 3 }]);
    const cancelled = host.view.adjustments[0]?.id ?? "";
    await host.cmd({ type: "decideAdjustment", adjustmentId: cancelled, approve: false });
    expect(await host.cmd({ type: "decideAdjustment", adjustmentId: cancelled, approve: true })).toMatchObject({
      ok: false,
    });
    expect(points(host)[c.playerId]).toBe(0);

    // A proposal left pending when the game is settled with the default result expires.
    await start(host, 1);
    await round(clients, [b, b, b]);
    await host.act({ type: "next", step: host.game.step });
    const segmentId = host.view.settlement?.segmentId ?? "";
    await propose([{ playerId: c.playerId, points: 7 }], "没人理的提议");
    const expired = host.view.adjustments[0]?.id ?? "";
    await host.cmd({ type: "confirmSettlement", segmentId, adjustmentId: null });
    expect(host.view.adjustments).toEqual([]);
    expect(await host.cmd({ type: "decideAdjustment", adjustmentId: expired, approve: true })).toMatchObject({
      ok: false,
    });
    const [row] = await world.handle.db.select().from(adjustments).where(eq(adjustments.id, expired));
    expect(row?.status).toBe("expired");

    // Correction of the settled game: a new ledger row, the original rows stay.
    const rankRows = () =>
      world.handle.db
        .select()
        .from(partyPoints)
        .where(and(eq(partyPoints.segmentId, segmentId), eq(partyPoints.kind, "rank")));
    const before = await rankRows();
    await propose([{ playerId: c.playerId, points: 2 }], "刚才漏算了", segmentId);
    await host.cmd({ type: "decideAdjustment", adjustmentId: host.view.adjustments[0]?.id ?? "", approve: true });
    expect(await rankRows()).toEqual(before);
    const fixes = await world.handle.db.select().from(partyPoints).where(eq(partyPoints.kind, "correction"));
    expect(fixes.map((r) => [r.playerId, r.tenths, r.segmentId])).toEqual([[c.playerId, 20, segmentId]]);
  });
});

describe("party lifecycle, recap and preferences (AC-01, AC-03, AC-21)", () => {
  it("archives a party with a full recap and starts the next one from zero; the summary never blocks", async () => {
    let fail = true;
    const writer: AgentModel = {
      run: async () => {
        if (fail) throw new Error("down");
        return { text: "这场主要靠 b 的嘴。", inputTokens: 1, outputTokens: 1 };
      },
    };
    const { world, roomId, seats, clients } = await setup(3, "rank-v1", null, writer);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    await start(host, 1);
    await round(clients, [b, b, host]);
    await host.act({ type: "next", step: host.game.step });
    await host.cmd({ type: "proposeAdjustment", items: [{ playerId: c.playerId, points: -2 }], reason: "乱投票" });
    const settlementId = host.view.settlement?.segmentId ?? "";

    // The party cannot end with an unsettled game, nor silently with open proposals.
    expect(await host.cmd({ type: "endSession" })).toMatchObject({ ok: false });
    await host.cmd({
      type: "confirmSettlement",
      segmentId: settlementId,
      adjustmentId: host.view.adjustments[0]?.id ?? null,
    });
    await host.cmd({
      type: "proposeAdjustment",
      items: [{ playerId: b.playerId, points: 100 }],
      reason: "没批准的提议",
    });
    expect(await b.cmd({ type: "endSession" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "endSession" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "endSession", discardPending: true })).toEqual({ ok: true });

    // New party: zero points, same people, the old one is reachable.
    expect(host.view.party).toMatchObject({ number: 2, gamesPlayed: 0 });
    const first = host.view.party.lastEndedSessionId ?? "";
    expect(Object.values(points(host))).toEqual([0, 0, 0]);
    expect(host.view.adjustments).toEqual([]);
    expect(host.view.members).toHaveLength(3);

    // The recap is complete right away although the AI summary failed.
    const recap = await buildRecap(world.handle.db, roomId, first);
    const standing = Object.fromEntries((recap?.ranking ?? []).map((r) => [r.playerId, [r.tenths, r.rank]]));
    expect(standing).toEqual({ [host.playerId]: [75, 1], [b.playerId]: [75, 1], [c.playerId]: [-20, 3] });
    expect(recap?.games).toMatchObject([
      { gameName: "谁最可能", status: "finished", rewards: [{ tenths: 75 }, { tenths: 75 }, { tenths: 0 }] },
    ]);
    expect(recap?.adjustments).toMatchObject([{ reason: "乱投票", proposedBy: "房主", items: [{ tenths: -20 }] }]);
    // A proposal that was never approved is not part of the story.
    expect(JSON.stringify(recap)).not.toContain("没批准的提议");
    expect(recap?.timeline.map((t) => t.label)).toEqual(["「谁最可能」名次奖励", "房主批准的调整：乱投票"]);
    expect(recap?.events.some((e) => e.text.includes("开始「谁最可能」"))).toBe(true);

    // Summary failed → retry works; meanwhile the next party was already playable.
    const status = async () =>
      (await world.handle.db.select().from(partySessions).where(eq(partySessions.id, first)))[0]?.summaryStatus;
    for (let i = 0; i < 50 && (await status()) !== "failed"; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await status()).toBe("failed");
    expect(await start(host, 1)).toEqual({ ok: true });
    fail = false;
    await host.cmd({ type: "retrySummary", sessionId: first });
    for (let i = 0; i < 50 && (await status()) !== "ok"; i++) await new Promise((r) => setTimeout(r, 20));
    expect((await buildRecap(world.handle.db, roomId, first))?.summary).toEqual({
      status: "ok",
      text: "这场主要靠 b 的嘴。",
    });

    // A restart keeps the party, the identities and the history.
    const reloaded = await loadRuntime(world, roomId);
    const again = new TestClient(reloaded, (seats[1] as { playerId: string }).playerId);
    expect(again.view.party).toMatchObject({ number: 2, lastEndedSessionId: first });
    expect(again.view.me.playerId).toBe(b.playerId);
  });

  it("lets everyone suggest and the host confirm preferences without touching scores or the topic in play", async () => {
    const { clients, runtime } = await setup(3);
    const [host, b] = clients as [TestClient, TestClient, TestClient];
    expect(host.view.prefs.hostMode).toBe("quirky");
    expect(await b.cmd({ type: "setPrefs", prefs: { hostMode: "normal" } })).toMatchObject({ ok: false });
    expect(await b.cmd({ type: "suggestPrefs", text: "想玩魂系主题" })).toEqual({ ok: true });
    expect(await b.cmd({ type: "suggestPrefs", text: "改主意了，来点动漫" })).toEqual({ ok: true });
    expect(host.view.prefs.suggestions).toEqual([{ playerId: b.playerId, text: "改主意了，来点动漫" }]);

    await start(host);
    const picker = clients.find((c) => c.playerId === host.game.pick.picker) as TestClient;
    await picker.act({ type: "choose", step: picker.game.step, index: 0 });
    const prompt = host.game.prompt;
    expect(await host.cmd({ type: "setPrefs", prefs: { hostMode: "normal", want: "动漫", avoid: "手机" } })).toEqual({
      ok: true,
    });
    expect(host.game.prompt).toBe(prompt); // the confirmed topic is untouched
    expect(b.view.prefs).toMatchObject({ hostMode: "normal", want: "动漫", avoid: "手机" });
    const context = runtime.agentContext();
    expect(context.mode).toBe("normal");
    expect(context.state).toContain("今天想玩：动漫");
    // Later candidates leave out what the group does not want.
    for (const c of clients) await c.act({ type: "vote", step: c.game.step, target: host.playerId });
    await host.act({ type: "next", step: host.game.step });
    for (let i = 0; i < 6; i++) {
      const p = clients.find((c) => c.playerId === host.game.pick.picker) as TestClient;
      expect(p.game.pick.candidates.join("")).not.toContain("手机");
      await p.act({ type: "refresh", step: p.game.step });
    }
  });

  it("transfers the host explicitly and never on someone's say-so", async () => {
    const { clients } = await setup(3);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    expect(await b.cmd({ type: "transferHost", playerId: b.playerId })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "transferHost", playerId: "ghost" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "transferHost", playerId: c.playerId })).toEqual({ ok: true });
    expect([host.view.me.isHost, c.view.me.isHost, c.view.inviteToken !== undefined]).toEqual([false, true, true]);
    expect(await host.cmd({ type: "endSession" })).toMatchObject({ ok: false });
  });
});
