/** VNext batch 2: the soup referee (Game AI) — secrecy, ordering, failure, correction, takeover, adaptation. */
import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel, AgentRunInput } from "../src/agent/model.ts";
import {
  LIMITS,
  loadRuntime,
  makeWorld,
  seedRoom,
  segmentState,
  sleep,
  TestClient,
  type World,
  waitFor,
} from "./helpers.ts";

let world: World | undefined;
afterEach(async () => {
  await world?.handle.close();
  world = undefined;
});

/** A stand-in referee: each call is answered by `reply` (JSON text, or a thrown error). */
class FakeJudge implements AgentModel {
  prompts: string[] = [];
  gate: Promise<void> = Promise.resolve();
  constructor(public reply: (input: AgentRunInput, n: number) => string) {}
  async run(input: AgentRunInput) {
    this.prompts.push(`${input.system}\n${input.prompt}`);
    const n = this.prompts.length;
    await this.gate;
    return { text: this.reply(input, n), inputTokens: 1, outputTokens: 1 };
  }
}

const config = { aiJudge: 1, rounds: 0, pickSeconds: 0, playSeconds: 0 };

async function setup(judge: AgentModel | null, n = 3, host: AgentModel | null = null) {
  world = await makeWorld(host, LIMITS, judge);
  const { roomId, seats } = await seedRoom(world, n);
  const runtime = await loadRuntime(world, roomId);
  const clients = seats.map((s) => new TestClient(runtime, s.playerId));
  return { world, roomId, seats, runtime, clients };
}

/** Starts an AI-hosted soup and has the picker take the first candidate. */
async function startSoup(clients: TestClient[]) {
  const host = clients[0] as TestClient;
  expect(await host.cmd({ type: "startGame", gameId: "soup", config })).toEqual({ ok: true });
  const picker = clients.find((c) => c.playerId === host.game.pick.picker) as TestClient;
  await picker.act({ type: "choose", step: picker.game.step, index: 0 });
  expect(host.game.phase).toBe("play");
  const state = await segmentState(world as World, host.view.segment?.id ?? "");
  return state.puzzle.solution as string;
}
const ask = (c: TestClient, text: string) => c.act({ type: "ask", step: c.game.step, text });
const entry = (c: TestClient, id: number) => c.game.log.find((e: { id: number }) => e.id === id);

describe("soup with the referee AI", () => {
  it("judges left-panel questions for everyone, in order, without the solution leaving the referee (AC-12)", async () => {
    const judge = new FakeJudge((_i, n) =>
      n === 1 ? '```json\n{"verdict":"yes","facts":[0]}\n```' : '{"verdict":"no","facts":[]}',
    );
    const { runtime, clients } = await setup(judge);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    const solution = await startSoup(clients);

    expect(host.game.mode).toBe("ai");
    expect(await ask(b, "和过去的经历有关吗？")).toEqual({ ok: true });
    expect(await ask(b, "第二个问题")).toMatchObject({ ok: false }); // one at a time per player
    expect(await ask(c, "是他杀吗？")).toEqual({ ok: true });
    await waitFor(() => entry(host, 2)?.status === "answered");
    expect([entry(c, 1).verdict, entry(c, 2).verdict]).toEqual(["yes", "no"]);
    expect(judge.prompts).toHaveLength(2);

    // The second judgement saw the first confirmed answer; both saw the solution.
    expect(judge.prompts[0]).toContain(solution);
    expect(judge.prompts[1]).toContain("和过去的经历有关吗？ → yes");
    // Nothing the players or the host agent receive contains it.
    for (const client of clients) expect(client.raw.join("")).not.toContain(solution);
    const agentSees = JSON.stringify(runtime.agentContext());
    expect(agentSees).not.toContain(solution);
    expect(agentSees).toContain("AI 裁判");
  });

  it("marks a failed judgement, retries it, and lets a player take over knowingly (AC-14)", async () => {
    let fail = true;
    const judge = new FakeJudge(() => {
      if (fail) throw new Error("model down");
      return '{"verdict":"irrelevant","facts":[]}';
    });
    const { clients } = await setup(judge);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    const solution = await startSoup(clients);
    await ask(b, "和天气有关吗？");
    await waitFor(() => entry(host, 1)?.status === "failed");
    expect(entry(host, 1).verdict).toBeNull(); // never an invented verdict

    // Someone else's failed question can only be retried by its asker or the host.
    expect(await c.act({ type: "rejudge", step: c.game.step, id: 1 })).toMatchObject({ ok: false });
    fail = false;
    expect(await b.act({ type: "rejudge", step: b.game.step, id: 1 })).toEqual({ ok: true });
    await waitFor(() => entry(host, 1)?.status === "answered");
    expect(entry(host, 1).verdict).toBe("irrelevant");

    // Takeover: c becomes the soup master, sees the solution; nobody else does.
    fail = true;
    await ask(b, "他是故意的吗？");
    await waitFor(() => entry(host, 2)?.status === "failed");
    expect(await c.act({ type: "takeover", step: c.game.step })).toEqual({ ok: true });
    expect([c.game.mode, c.game.master, c.game.solution]).toEqual(["human", c.playerId, solution]);
    expect(host.game.solution).toBeNull();
    expect(entry(c, 2).status).toBe("queued");
    expect(await ask(c, "我还能问吗？")).toMatchObject({ ok: false });
    expect(await c.act({ type: "answer", step: c.game.step, id: 2, verdict: "yes" })).toEqual({ ok: true });
    expect(entry(b, 2).verdict).toBe("yes");
    const calls = judge.prompts.length;
    await ask(b, "再问一个");
    await sleep(60);
    expect(judge.prompts).toHaveLength(calls); // the referee is out of the loop now
  });

  it("drops an answer that arrives after the soup has ended and never judges twice across a restart (AC-14)", async () => {
    let release = () => {};
    const judge = new FakeJudge(() => '{"verdict":"yes","facts":[]}');
    judge.gate = new Promise((r) => {
      release = r;
    });
    const { world, roomId, seats, clients } = await setup(judge);
    const [host, b] = clients as [TestClient, TestClient, TestClient];
    await startSoup(clients);
    await ask(b, "慢慢判的问题");
    await waitFor(() => entry(host, 1)?.status === "judging");

    // The host reveals and moves to the next soup while the referee is still thinking.
    await host.act({ type: "reveal", step: host.game.step });
    await host.act({ type: "next", step: host.game.step });
    const picker = clients.find((x) => x.playerId === host.game.pick.picker) as TestClient;
    await picker.act({ type: "choose", step: picker.game.step, index: 0 });
    await ask(b, "新汤的第一个问题");
    release();
    await waitFor(() => entry(host, 1)?.status === "answered");
    // Exactly one answer landed, on the new soup's question, from a prompt about the new soup.
    expect(entry(host, 1).text).toBe("新汤的第一个问题");
    expect(judge.prompts.at(-1)).toContain("新汤的第一个问题");
    expect(judge.prompts.at(-1)).not.toContain("慢慢判的问题");

    // Restart while a question is being judged: after the host resumes it is judged once.
    judge.gate = new Promise(() => {});
    await ask(b, "重启前的问题");
    await waitFor(() => entry(host, 2)?.status === "judging");
    const before = judge.prompts.length;
    judge.gate = Promise.resolve();
    const reloaded = await loadRuntime(world, roomId);
    const again = seats.map((s) => new TestClient(reloaded, s.playerId));
    const hostAgain = again[0] as TestClient;
    expect(hostAgain.view.segment?.status).toBe("paused");
    await hostAgain.cmd({ type: "resumeSegment", segmentId: hostAgain.view.segment?.id ?? "" });
    await waitFor(() => entry(hostAgain, 2)?.status === "answered");
    expect(judge.prompts.length).toBe(before + 1);
    expect(hostAgain.game.log.filter((e: { text: string }) => e.text === "重启前的问题")).toHaveLength(1);
  });

  it("keeps corrections on record and feeds them to later judgements (AC-13)", async () => {
    const judge = new FakeJudge((_i, n) => (n === 2 ? '{"verdict":"no","facts":[]}' : '{"verdict":"yes","facts":[]}'));
    const { clients } = await setup(judge);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    await startSoup(clients);
    await ask(b, "他认识那个人吗？");
    await waitFor(() => entry(host, 1)?.status === "answered");

    // A player reports it; only the host can ask for a re-judge; the old verdict stays on record.
    expect(await c.act({ type: "flag", step: c.game.step, id: 1 })).toEqual({ ok: true });
    expect(entry(host, 1).flagged).toEqual([c.playerId]);
    expect(await c.act({ type: "rejudge", step: c.game.step, id: 1 })).toMatchObject({ ok: false });
    expect(await host.act({ type: "rejudge", step: host.game.step, id: 1 })).toEqual({ ok: true });
    await waitFor(() => entry(host, 1)?.corrections.length === 1);
    expect(judge.prompts[1]).toContain("之前被判为 yes");
    expect(entry(b, 1)).toMatchObject({ verdict: "no", corrections: [{ from: "yes", to: "no", by: "ai" }] });

    // The host may look at the solution (and stops solving), then fix an answer by hand.
    expect(await host.act({ type: "correct", step: host.game.step, id: 1, verdict: "partly" })).toMatchObject({
      ok: false,
    });
    expect(await host.act({ type: "peek", step: host.game.step })).toEqual({ ok: true });
    expect(host.game.solution).toBeTruthy();
    expect(b.game.solution).toBeNull();
    expect(await ask(host, "我还能问吗")).toMatchObject({ ok: false });
    expect(
      await host.act({ type: "correct", step: host.game.step, id: 1, verdict: "partly", reason: "只认识一半" }),
    ).toEqual({
      ok: true,
    });
    expect(entry(b, 1).corrections.at(-1)).toMatchObject({
      from: "no",
      to: "partly",
      by: host.playerId,
      reason: "只认识一半",
    });

    await ask(c, "下一个问题");
    await waitFor(() => entry(host, 2)?.status === "answered");
    expect(judge.prompts.at(-1)).toContain("他认识那个人吗？ → partly（人工更正）");
  });

  it("ends the soup when the referee accepts a full solution, and records who found each key fact", async () => {
    const judge = new FakeJudge((input) =>
      input.system.includes("完整推理") ? '{"correct":true}' : '{"verdict":"yes","facts":[1]}',
    );
    const { clients } = await setup(judge);
    const [host, b, c] = clients as [TestClient, TestClient, TestClient];
    await startSoup(clients);
    await ask(b, "关键问题");
    await waitFor(() => entry(host, 1)?.status === "answered");
    await c.act({ type: "solve", step: c.game.step, text: "完整的推理" });
    await waitFor(() => host.game.phase === "reveal");
    expect(host.game.solver).toBe(c.playerId);
    expect(host.game.facts[1].by).toBe(b.playerId);
    expect(host.view.scoreboard.find((s) => s.playerId === c.playerId)?.points).toBeGreaterThan(0);
  });

  it("refuses AI hosting when no model is configured and still offers the human mode (OPS-02)", async () => {
    const { clients } = await setup(null);
    const [host] = clients as [TestClient, TestClient, TestClient];
    const refused = await host.cmd({ type: "startGame", gameId: "soup", config });
    expect(refused).toMatchObject({ ok: false });
    expect((refused as { error: string }).error).toContain("真人主持");
    expect(await host.cmd({ type: "startGame", gameId: "soup", config: { ...config, aiJudge: 0 } })).toEqual({
      ok: true,
    });
  });
});

describe("themed adaptation of soups (AC-15)", () => {
  it("accepts allowed word swaps as new candidates and rejects ones that touch the logic", async () => {
    // Proposal 1 per puzzle: swap the first adaptable word. Later: try to change a logic word.
    let mode: "good" | "bad" = "good";
    const judge = new FakeJudge((input) => {
      const words = /【可替换词】(.+)/.exec(input.prompt)?.[1]?.split("、") ?? [];
      return mode === "good"
        ? JSON.stringify({ replacements: [{ from: words[0], to: "召唤师峡谷来客" }] })
        : JSON.stringify({
            replacements: [
              { from: "汤", to: "药水" },
              { from: words[0], to: "英雄" },
            ],
          });
    });
    const { world, clients } = await setup(judge);
    const [host] = clients as [TestClient, TestClient, TestClient];
    await host.cmd({ type: "startGame", gameId: "soup", config });
    const picker = clients.find((c) => c.playerId === host.game.pick.picker) as TestClient;
    const outsider = clients.find((c) => c !== picker && c !== host) as TestClient | undefined;
    const segmentId = host.view.segment?.id ?? "";
    const before = [...picker.game.pick.candidates];
    if (outsider) {
      expect(await outsider.cmd({ type: "adaptContent", segmentId, theme: "英雄联盟" })).toMatchObject({ ok: false });
    }

    mode = "bad";
    expect(await picker.cmd({ type: "adaptContent", segmentId, theme: "英雄联盟" })).toEqual({ ok: true });
    await waitFor(() => host.chat.some((m) => m.text.includes("保留原题")));
    expect(picker.game.pick.candidates).toEqual(before);
    expect(host.chat.at(-1)?.text).toContain("不在可替换词里");

    mode = "good";
    expect(await picker.cmd({ type: "adaptContent", segmentId, theme: "英雄联盟" })).toEqual({ ok: true });
    await waitFor(() => host.chat.some((m) => m.text.includes("已放进候选")));
    const adapted: string[] = picker.game.pick.candidates;
    expect(adapted.length).toBeGreaterThan(0);
    expect(adapted).not.toEqual(before);
    // The originals are still there for the taking.
    await picker.act({ type: "history", step: picker.game.step });
    const labels = picker.game.pick.history.map((h: { label: string }) => h.label);
    for (const old of before) expect(labels).toContain(old);

    // The adapted puzzle keeps its logic words and remembers where it came from.
    await picker.act({ type: "choose", step: picker.game.step, index: 0 });
    const state = await segmentState(world, segmentId);
    expect(state.puzzle.surface + state.puzzle.solution).toContain("召唤师峡谷来客");
    for (const c of clients) expect(c.raw.join("")).not.toContain(state.puzzle.solution);
  });
});
