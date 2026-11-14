import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel, AgentRunInput } from "../src/agent/model.ts";
import { contentItems, contentUsage } from "../src/db/schema.ts";
import { loadRuntime, makeWorld, seedRoom, TestClient, type World, waitFor } from "./helpers.ts";

let world: World;
afterEach(async () => {
  await world?.handle.close();
});

type Step = (input: AgentRunInput, call: (tool: string, args: unknown) => Promise<string>) => Promise<string>;

/** A model whose behaviour is a list of steps: one per run, in order (the last one repeats). */
class ScriptedModel implements AgentModel {
  calls: AgentRunInput[] = [];
  toolResults: string[] = [];
  constructor(private readonly steps: Step[]) {}
  async run(input: AgentRunInput) {
    this.calls.push(input);
    const step = this.steps[Math.min(this.calls.length, this.steps.length) - 1] as Step;
    const call = async (name: string, args: unknown) => {
      const tool = input.tools.find((t) => t.name === name);
      if (!tool) throw new Error(`no tool ${name}`);
      const out = await tool.run(tool.inputSchema.parse(args));
      this.toolResults.push(out);
      return out;
    };
    return { text: await step(input, call), inputTokens: 1, outputTokens: 1 };
  }
}

async function setup(n: number, model: AgentModel | null = null) {
  world = await makeWorld(model);
  const { roomId, seats } = await seedRoom(world, n);
  const runtime = await loadRuntime(world, roomId);
  return { roomId, seats, runtime, clients: seats.map((s) => new TestClient(runtime, s.playerId)) };
}

const spectrumNoTimers = { rounds: 0, pickSeconds: 0, clueSeconds: 0, guessSeconds: 0 };
const current = (c: TestClient) => c.view.canvas.current;
const respond = (c: TestClient, value: string | boolean) =>
  c.cmd({ type: "respond", interactionId: current(c)?.id ?? "none", value });

describe("topic choice in the spectrum game", () => {
  it("lets the clue giver refresh freely and write their own scale; only confirmed content counts as used", async () => {
    const { clients } = await setup(2);
    const [host, b] = clients as [TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "spectrum", config: spectrumNoTimers });
    const segmentId = host.view.segment?.id as string;
    expect(host.game.phase).toBe("pick");
    expect(host.game.candidates).toHaveLength(3);
    expect(host.view.segment?.skip).toBeNull(); // changing the topic before the start is not a skip

    const first = JSON.stringify(host.game.candidates);
    for (let i = 0; i < 4; i++) expect(await host.act({ type: "refresh", round: 1 })).toEqual({ ok: true });
    expect(JSON.stringify(host.game.candidates)).not.toBe(first);
    expect(await b.act({ type: "refresh", round: 1 })).toMatchObject({ ok: false });
    expect(await world.handle.db.select().from(contentUsage).where(eq(contentUsage.segmentId, segmentId))).toEqual([]);

    expect(await host.act({ type: "custom", round: 1, left: "青铜", right: "王者" })).toEqual({ ok: true });
    expect(b.game.phase).toBe("clue");
    expect(b.game.scale).toEqual({ left: "青铜", right: "王者" });
    const [saved] = await world.handle.db.select().from(contentItems).where(eq(contentItems.source, "玩家自拟：玩家1"));
    expect(saved).toMatchObject({
      type: "spectrum",
      verification: "unverified",
      payload: { left: "青铜", right: "王者" },
    });
    const usage = await world.handle.db.select().from(contentUsage).where(eq(contentUsage.segmentId, segmentId));
    expect(usage.map((u) => u.contentId)).toEqual([saved?.id]);
  });
});

describe("dynamic canvas", () => {
  it("runs a multi-step flow the agent composes: collect → vote → write candidates → the game uses them", async () => {
    const model = new ScriptedModel([
      // 1. A player asks for a themed round: gather ideas from everyone.
      async (input, call) => {
        expect(input.prompt).toContain("当前游戏接受你提供的候选内容");
        await call("note_plan", { text: "收集主题→投票→写 3 条刻度→交给游戏" });
        await call("create_interaction", {
          interaction: { kind: "collect", title: "这轮想玩什么主题？", maxLength: 20 },
        });
        return "来，每人报一个主题！";
      },
      // 2. Ideas are in: put them to a vote.
      async (input, call) => {
        expect(input.prompt).toContain("你的备忘\n收集主题→投票");
        const finished = input.prompt.split("## 本次需要你处理的事")[1] ?? "";
        const ideas = [...finished.matchAll(/玩家\d：([^；\n]+)/g)].map((m) => m[1] as string);
        await call("create_interaction", {
          interaction: {
            kind: "choose",
            title: "投票选主题",
            options: ideas.map((label, i) => ({ id: `o${i}`, label })),
          },
        });
        return "";
      },
      // 3. Vote is in: write themed candidates and hand them to the game.
      async (input, call) => {
        const theme = /得票最高：([^\n。]+)/.exec(input.prompt.split("## 本次需要你处理的事")[1] ?? "")?.[1] ?? "?";
        const saved = await call("save_content", {
          contentType: "spectrum",
          theme,
          items: [
            { left: `${theme}里最弱`, right: `${theme}里最强` },
            { left: "脆皮", right: "坦克" },
            { wrong: "shape" },
          ],
        });
        const ids = /id：([^。]+)/.exec(saved)?.[1]?.split(", ") ?? [];
        await call("offer_content", { contentIds: ids });
        await call("note_plan", { text: "" });
        return `按「${theme}」出了两张题卡，下一位提示者可以挑。`;
      },
    ]);
    const { clients, runtime } = await setup(3, model);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "spectrum", config: spectrumNoTimers });
    await host.act({ type: "choose", round: 1, index: 0 });
    await host.act({ type: "clue", round: 1, text: "提示" });

    // Asked mid-round: the agent works in the background, the interaction waits for a gap.
    await runtime.handleChat(b.playerId, "@AI 下一轮想玩自定主题，先让大家报主题再投票");
    await waitFor(() => host.view.canvas.queued === 1);
    expect(current(b)).toBeNull();
    expect(model.toolResults.at(-1)).toContain("已排队");
    await b.act({ type: "guess", round: 1, value: 50 });
    await c.act({ type: "guess", round: 1, value: 60 });
    expect(host.game.phase).toBe("reveal");
    expect(current(b)).toMatchObject({ kind: "collect", title: "这轮想玩什么主题？", canRespond: true });

    // One response each; no double submissions.
    expect(await respond(host, "英雄联盟")).toEqual({ ok: true });
    expect(await respond(host, "改主意了")).toMatchObject({ ok: false });
    expect(await respond(b, "")).toMatchObject({ ok: false });
    expect(await respond(b, "火锅")).toEqual({ ok: true });
    expect(current(c)?.responded).toHaveLength(2);
    expect(await respond(c, "宝可梦")).toEqual({ ok: true });

    // Step 2 was composed from the collected result.
    await waitFor(() => current(host)?.kind === "choose");
    expect(current(host)?.options?.map((o) => o.label)).toEqual(["英雄联盟", "火锅", "宝可梦"]);
    expect(await respond(host, "nope")).toMatchObject({ ok: false });
    await respond(host, "o0");
    await respond(b, "o0");
    await respond(c, "o1");

    // Step 3: generated content reaches the game and waits for the next pick.
    await waitFor(() => model.calls.length === 3 && host.chat.at(-1)?.sender.kind === "agent");
    expect(model.toolResults.find((r) => r.includes("已保存 2 条"))).toContain("第 3 条格式不对");
    expect(model.toolResults.find((r) => r.includes("下一轮选题时展示"))).toBeTruthy();
    await host.act({ type: "next", round: 1 });
    expect(b.game.phase).toBe("pick");
    expect(b.game.candidates).toEqual([
      { left: "英雄联盟里最弱", right: "英雄联盟里最强" },
      { left: "脆皮", right: "坦克" },
    ]);
    // The player, not the agent, makes the final choice; the usage is recorded against the AI-written item.
    expect(await b.act({ type: "choose", round: 2, index: 0 })).toEqual({ ok: true });
    expect(host.game.scale.left).toBe("英雄联盟里最弱");
    const rows = await world.handle.db.select().from(contentItems).where(eq(contentItems.theme, "英雄联盟"));
    expect(rows).toHaveLength(2);
    expect(rows[0]?.source).toContain("AI 生成");
    const used = await world.handle.db
      .select()
      .from(contentUsage)
      .where(eq(contentUsage.segmentId, host.view.segment?.id as string));
    expect(used.some((u) => rows.some((r) => r.id === u.contentId))).toBe(true);
  });

  it("executes an approved effect exactly as proposed, once, and only for the addressed approver", async () => {
    const model = new ScriptedModel([
      async (_input, call) => {
        await call("propose_start_game", { gameId: "wager", config: { rounds: 2 }, reason: "大家想玩短一点的" });
        return "已请房主确认。";
      },
      async () => "好的。",
    ]);
    const { clients, runtime } = await setup(3, model);
    const [host, b] = clients as [TestClient, TestClient];
    await runtime.handleChat(b.playerId, "@AI 开一局两轮的估数下注");
    await waitFor(() => current(host)?.kind === "confirm");
    expect(current(host)).toMatchObject({ canRespond: true, effectSummary: "批准后将立即开始「估数下注」（轮数 2）" });
    expect(current(b)?.canRespond).toBe(false);
    expect(await respond(b, true)).toMatchObject({ ok: false });
    expect(host.view.segment).toBeNull();

    expect(await respond(host, true)).toEqual({ ok: true });
    expect(host.view.segment?.gameId).toBe("wager");
    expect(host.game.totalRounds).toBe(2);
    expect(current(host)?.result).toEqual({ kind: "confirm", approved: true, outcome: "已开始「估数下注」" });
    expect(await respond(host, true)).toMatchObject({ ok: false });
    // The agent hears the truthful outcome.
    await waitFor(() => model.calls.length === 2);
    expect(model.calls[1]?.prompt).toContain("已批准：已开始「估数下注」");
  });

  it("survives a restart, lets the host close an interaction early, and stops a runaway flow", async () => {
    let n = 0;
    const model = new ScriptedModel([
      async (_input, call) => {
        await call("create_interaction", { interaction: { kind: "collect", title: `问题 ${++n}` } });
        return "";
      },
    ]);
    const { clients, runtime, roomId, seats } = await setup(2, model);
    const [host, b] = clients as [TestClient, TestClient];
    await runtime.handleChat(host.playerId, "@AI 问大家一个问题");
    await waitFor(() => current(b)?.title === "问题 1");
    await respond(b, "我的回答");

    // Restart: the open interaction and the response already given are still there.
    const rt2 = await loadRuntime(world, roomId);
    const [h2, b2] = seats.map((s) => new TestClient(rt2, s.playerId)) as [TestClient, TestClient];
    expect(current(b2)).toMatchObject({ title: "问题 1", myResponse: "我的回答", canRespond: false });
    expect(await b2.cmd({ type: "closeInteraction", interactionId: current(b2)?.id as string })).toMatchObject({
      ok: false,
    });

    // The host stops waiting; each close wakes the agent, which keeps asking — until the step cap.
    for (let i = 0; i < 12; i++) {
      const open = current(h2);
      if (open?.status !== "open") break;
      await h2.cmd({ type: "closeInteraction", interactionId: open.id });
      await waitFor(() => current(h2)?.id !== open.id || h2.chat.at(-1)?.text.includes("连续自动") === true);
      if (h2.chat.at(-1)?.text.includes("连续自动")) break;
    }
    expect(h2.chat.at(-1)?.text).toContain("连续自动进行了 6 步");
    expect(model.calls).toHaveLength(7); // the player's request + 6 self-initiated steps
    expect(h2.chat.some((m) => m.text.includes("「问题 1」收到：玩家2：我的回答"))).toBe(true);
  });
});
