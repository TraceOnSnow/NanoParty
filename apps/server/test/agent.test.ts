import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel, AgentRunInput } from "../src/agent/model.ts";
import { LIMITS, loadRuntime, makeWorld, seedRoom, sleep, TestClient, type World, waitFor } from "./helpers.ts";

let world: World;
afterEach(async () => {
  await world?.handle.close();
});

/** Scriptable stand-in for the LLM. */
class FakeModel implements AgentModel {
  calls: AgentRunInput[] = [];
  constructor(private readonly script: (input: AgentRunInput, n: number) => Promise<string>) {}
  async run(input: AgentRunInput) {
    this.calls.push(input);
    return { text: await this.script(input, this.calls.length), inputTokens: 10, outputTokens: 5 };
  }
}

async function setup(model: AgentModel | null, limits = LIMITS) {
  world = await makeWorld(model, limits);
  const { roomId, seats } = await seedRoom(world, 2);
  const runtime = await loadRuntime(world, roomId);
  const [host, b] = seats.map((s) => new TestClient(runtime, s.playerId)) as [TestClient, TestClient];
  return { runtime, host, b };
}

const texts = (c: TestClient, kind: string) => c.chat.filter((m) => m.sender.kind === kind).map((m) => m.text);

describe("shared host agent", () => {
  it("degrades without a model: one notice, manual play unaffected", async () => {
    const { runtime, host, b } = await setup(null);
    expect(host.view.ai).toMatchObject({ enabled: false });
    await runtime.handleChat(b.playerId, "@AI 推荐个游戏");
    await runtime.handleChat(b.playerId, "@AI 在吗");
    expect(await b.cmd({ type: "askAgent", kind: "recommend" })).toMatchObject({ ok: false });
    await waitFor(() => texts(host, "system").length > 0);
    await sleep(30);
    expect(texts(host, "system")).toHaveLength(1);
    expect(await host.cmd({ type: "startGame", gameId: "estimate" })).toEqual({ ok: true });
  });

  it("only calls the model on explicit triggers and replies in chat", async () => {
    const model = new FakeModel(async () => "来一局估数字吧！");
    const { runtime, host, b } = await setup(model);
    await runtime.handleChat(b.playerId, "今天玩什么");
    await sleep(30);
    expect(model.calls).toHaveLength(0);

    await runtime.handleChat(b.playerId, "@AI 今天玩什么");
    await waitFor(() => texts(host, "agent").length === 1);
    expect(model.calls).toHaveLength(1);
    expect(model.calls[0]?.prompt).toContain("玩家2 在群聊里 @你");
    expect(host.view.ai.state).toBe("idle");
  });

  it("acts only through controlled tools: suggestions need the host, and fail truthfully mid-game", async () => {
    const outcomes: string[] = [];
    const model = new FakeModel(async (input) => {
      const tool = input.tools.find((t) => t.name === "suggest_game");
      outcomes.push(await (tool?.run({ gameId: "estimate", reason: "人数正好" }) ?? Promise.resolve("no tool")));
      outcomes.push(await (tool?.run({ gameId: "not-a-game", reason: "x" }) ?? Promise.resolve("no tool")));
      return "推荐好了";
    });
    const { host, b } = await setup(model);
    expect(await b.cmd({ type: "askAgent", kind: "recommend" })).toEqual({ ok: true });
    await waitFor(() => texts(host, "agent").length === 1);
    expect(outcomes[0]).toContain("等待房主");
    expect(outcomes[1]).toContain("失败");
    expect(b.view.suggestion).toEqual({ gameId: "estimate", reason: "人数正好" });
    // The suggestion started nothing; a non-host cannot act on it.
    expect(b.view.segment).toBeNull();
    expect(await b.cmd({ type: "startGame", gameId: "estimate" })).toMatchObject({ ok: false });
    expect(await host.cmd({ type: "startGame", gameId: "estimate" })).toEqual({ ok: true });
    expect(host.view.suggestion).toBeNull();

    await b.cmd({ type: "askAgent", kind: "recommend" });
    await waitFor(() => texts(host, "agent").length === 2);
    expect(outcomes[2]).toContain("失败");
    expect(host.view.suggestion).toBeNull();
  });

  it("never exposes unrevealed answers or guesses to the model", async () => {
    const model = new FakeModel(async () => "加油");
    const { runtime, host, b } = await setup(model);
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 1, answerSeconds: 0 } });
    await b.act({ type: "submit", round: 1, value: 31337.25 });
    await runtime.handleChat(host.playerId, "@AI 给点提示");
    await waitFor(() => model.calls.length === 1);
    const seen = `${model.calls[0]?.system}\n${model.calls[0]?.prompt}`;
    expect(seen).not.toContain("31337.25");
    expect(seen).toContain("未公开");
  });

  it("merges triggers that arrive while a run is in flight; none are lost", async () => {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const model = new FakeModel(async (_input, n) => {
      if (n === 1) await gate;
      return `回复${n}`;
    });
    const { runtime, host, b } = await setup(model);
    await runtime.handleChat(b.playerId, "@AI 第一个问题");
    await waitFor(() => model.calls.length === 1);
    expect(host.view.ai.state).toBe("thinking");
    await runtime.handleChat(host.playerId, "@AI 第二个问题");
    await runtime.handleChat(b.playerId, "@AI 第三个问题");
    release();
    await waitFor(() => texts(host, "agent").length === 2);
    await sleep(30);
    expect(model.calls).toHaveLength(2);
    expect(model.calls[1]?.prompt).toContain("第二个问题");
    expect(model.calls[1]?.prompt).toContain("第三个问题");
  });

  it("survives model failures and enforces rate and budget limits without touching the game", async () => {
    const failing = new FakeModel(async () => {
      throw new Error("boom");
    });
    const { runtime, host, b } = await setup(failing);
    await host.cmd({ type: "startGame", gameId: "estimate", config: { rounds: 1, answerSeconds: 0 } });
    await runtime.handleChat(b.playerId, "@AI 你好");
    await waitFor(() => host.view.ai.state === "unavailable");
    expect(texts(host, "system")).toHaveLength(1);
    expect(await b.act({ type: "submit", round: 1, value: 1 })).toEqual({ ok: true });
    await world.handle.close();

    const ok = new FakeModel(async () => "好的");
    const limited = await setup(ok, { ...LIMITS, roomCallsPerMinute: 1, dailyCallLimit: 1000 });
    await limited.runtime.handleChat(limited.b.playerId, "@AI 一");
    await waitFor(() => texts(limited.host, "agent").length === 1);
    await limited.runtime.handleChat(limited.b.playerId, "@AI 二");
    await waitFor(() => texts(limited.host, "system").length === 1);
    expect(ok.calls).toHaveLength(1);
    await world.handle.close();

    const budget = new FakeModel(async () => "好的");
    const capped = await setup(budget, { ...LIMITS, dailyCallLimit: 1 });
    await capped.runtime.handleChat(capped.b.playerId, "@AI 一");
    await waitFor(() => texts(capped.host, "agent").length === 1);
    await capped.runtime.handleChat(capped.b.playerId, "@AI 二");
    await waitFor(() => capped.host.view.ai.note === "今日 AI 额度已用完");
    expect(budget.calls).toHaveLength(1);
  });
});
