/** VNext: the play report export is complete, anonymised and free of credentials and secrets (AC-22, DATA-02/04). */
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentModel } from "../src/agent/model.ts";
import { players, rooms } from "../src/db/schema.ts";
import { exportParty } from "../src/reportExport.ts";
import { LIMITS, loadRuntime, makeWorld, seedRoom, segmentState, TestClient, type World, waitFor } from "./helpers.ts";

let world: World | undefined;
let dir: string | undefined;
afterEach(async () => {
  await world?.handle.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
  world = undefined;
});

const all = (root: string): string =>
  readdirSync(root, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => readFileSync(join(e.parentPath, e.name), "utf8"))
    .join("\n");

describe("play report export", () => {
  it("gives a summary, an index and details, without names, credentials or secrets", async () => {
    const judge: AgentModel = {
      run: async () => ({ text: '{"verdict":"yes","facts":[]}', inputTokens: 11, outputTokens: 3 }),
    };
    world = await makeWorld(null, LIMITS, judge);
    const { roomId, seats } = await seedRoom(world, 3, "rank-v1");
    const runtime = await loadRuntime(world, roomId);
    const [host, b, c] = seats.map((s) => new TestClient(runtime, s.playerId)) as [TestClient, TestClient, TestClient];
    const sessionId = host.view.party.sessionId;

    // An AI-hosted soup: a question, a rejected action, a piece of feedback, chat.
    await host.cmd({
      type: "startGame",
      gameId: "soup",
      config: { aiJudge: 1, rounds: 1, pickSeconds: 0, playSeconds: 0 },
    });
    const picker = [host, b, c].find((x) => x.playerId === host.game.pick.picker) as TestClient;
    await picker.act({ type: "choose", step: picker.game.step, index: 0 });
    const solution: string = (await segmentState(world, host.view.segment?.id ?? "")).puzzle.solution;
    await b.act({ type: "ask", step: b.game.step, text: "和海有关吗？" });
    await waitFor(() => host.game.log[0]?.status === "answered");
    await c.act({ type: "peek", step: c.game.step }); // rejected: only the host may
    await c.cmd({ type: "feedback", kind: "ai-judgement", note: "这条判得不对吧", entryId: 1 });
    await runtime.handleChat(b.playerId, "我的昵称是玩家2，这是聊天内容");
    await host.act({ type: "reveal", step: host.game.step });
    await host.act({ type: "next", step: host.game.step });
    await host.cmd({ type: "confirmSettlement", segmentId: host.view.settlement?.segmentId ?? "", adjustmentId: null });
    await new Promise((r) => setTimeout(r, 100)); // let the event log settle

    dir = mkdtempSync(join(tmpdir(), "np-report-"));
    const { dir: out } = await exportParty(world.handle.db, sessionId, dir);
    const index = JSON.parse(readFileSync(join(out, "index.json"), "utf8"));
    expect(index.contains).toEqual({ chat: false, gameState: false, credentials: false });
    expect(index.files.map((f: { file: string }) => f.file)).toEqual(
      expect.arrayContaining([
        "summary.md",
        "recap.json",
        "events.jsonl",
        "rejected.json",
        "feedback.json",
        "ai-calls.json",
      ]),
    );
    const summary = readFileSync(join(out, "summary.md"), "utf8");
    expect(summary).toContain("反馈 1 条");
    expect(summary).toContain("ai-judgement「这条判得不对吧」@soup");
    expect(summary).toContain("被拒绝的操作 1 次");
    expect(summary).toContain("模型调用 1 次");
    expect(JSON.parse(readFileSync(join(out, "feedback.json"), "utf8"))[0]).toMatchObject({
      player: "P3",
      kind: "ai-judgement",
      gameId: "soup",
      context: { entryId: 1, phase: "play" },
    });
    expect(JSON.parse(readFileSync(join(out, "rejected.json"), "utf8"))[0]).toMatchObject({
      actor: "P3",
      action: "peek",
    });
    expect(JSON.parse(readFileSync(join(out, "ai-calls.json"), "utf8"))[0]).toMatchObject({
      purpose: "judge",
      status: "ok",
      inputTokens: 11,
    });

    // Nothing identifying or secret in the default report.
    const text = all(out);
    const [room] = await world.handle.db.select().from(rooms).where(eq(rooms.id, roomId));
    const people = await world.handle.db.select().from(players).where(eq(players.roomId, roomId));
    expect(text).not.toContain(room?.inviteToken);
    for (const p of people) {
      expect(text).not.toContain(p.sessionTokenHash);
      expect(text).not.toContain(p.id);
      expect(text).not.toContain(p.nickname);
    }
    for (const s of seats) expect(text).not.toContain(s.token);
    expect(text).not.toContain(solution);
    expect(text).not.toContain("这是聊天内容");

    // The controlled debug pack says what it contains — and does contain it.
    const debug = await exportParty(world.handle.db, sessionId, join(dir, "debug"), {
      withChat: true,
      withState: true,
    });
    expect(JSON.parse(readFileSync(join(debug.dir, "index.json"), "utf8")).contains).toMatchObject({
      chat: true,
      gameState: true,
    });
    const debugText = all(debug.dir);
    expect(debugText).toContain(solution);
    expect(debugText).toContain("这是聊天内容");
    expect(debugText).not.toContain(room?.inviteToken);
  });
});
