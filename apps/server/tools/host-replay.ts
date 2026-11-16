/**
 * Rebuilds what the host model would be sent at a moment of a past party, using the current
 * prompt code, so different prompts and models can be compared on the same real moment.
 * Not part of `pnpm check`; it calls no model and writes no database.
 *
 *   pnpm host-replay <report-dir> <HH:MM:SS> [--names P1=昵称,P2=昵称] [--mode quirky|normal] [--note 文本]
 *
 * <report-dir> is one party folder pulled with `tools/pull-report.sh ... --party <id> --with-chat`.
 * The moment is the time (UTC, as in chat.json) of the player message to answer; the last
 * player message at or before it is used. The request is written next to the report, under
 * `replay/`, which stays out of git together with the rest of `reports/pulled/`.
 *
 * What cannot be rebuilt from an anonymised report is approximated and says so in the output:
 * the game's own public summary (only the game's name is known) and the host's note.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { contentTypes, games } from "@apr/games";
import { type AgentRoomContext, AgentService } from "../src/agent/AgentService.ts";
import { buildPrompt, type ChatLine, shapeChat, systemPrompt } from "../src/agent/prompt.ts";

interface ChatRow {
  at: string;
  sender: string;
  text: string;
}
interface Recap {
  ranking: { playerId: string }[];
  games: { gameId: string; gameName: string; startedAt: number; endedAt: number | null }[];
  timeline: { at: number; totals: Record<string, number> }[];
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = args.filter((a, i) => !a.startsWith("--") && !args[i - 1]?.startsWith("--"));
const [dirArg, time] = positional;
if (!dirArg || !time || !/^\d\d:\d\d:\d\d$/.test(time)) {
  console.error(
    "usage: pnpm host-replay <report-dir> <HH:MM:SS> [--names P1=昵称,...] [--mode quirky|normal] [--note 文本]",
  );
  process.exit(2);
}
const dir = resolve(process.env.INIT_CWD ?? process.cwd(), dirArg);
const chat = JSON.parse(readFileSync(resolve(dir, "chat.json"), "utf8")) as ChatRow[];
const recap = JSON.parse(readFileSync(resolve(dir, "recap.json"), "utf8")) as Recap;
const names = new Map(
  (flag("names") ?? "")
    .split(",")
    .filter(Boolean)
    .map((p) => p.split("=") as [string, string]),
);
const nameOf = (id: string) => names.get(id) ?? id;
const mode = flag("mode") === "normal" ? "normal" : "quirky";

const isPlayer = (m: ChatRow) => m.sender !== "agent" && m.sender !== "system";
const trigger = chat.findLast((m) => isPlayer(m) && m.at.slice(11, 19) <= time);
if (!trigger) {
  console.error(`no player message at or before ${time}`);
  process.exit(1);
}
const at = Date.parse(trigger.at);
// What the host had in front of it: everything up to the message, without its own later replies.
const lines: ChatLine[] = chat
  .filter((m) => Date.parse(m.at) <= at)
  .map((m) => ({
    kind: m.sender === "agent" ? "agent" : m.sender === "system" ? "system" : "player",
    speaker: m.sender === "agent" ? "AI" : m.sender === "system" ? "系统" : nameOf(m.sender),
    text: m.text,
  }));

const players = recap.ranking.map((r) => r.playerId);
const totals = recap.timeline.findLast((t) => t.at <= at)?.totals ?? {};
const running = recap.games.find((g) => g.startedAt <= at && (g.endedAt === null || g.endedAt > at));
const state = [
  `房间，成员：${players.map(nameOf).join("、")}`,
  `本场累计积分：${
    players
      .map((p) => ({ p, t: totals[p] ?? 0 }))
      .sort((a, b) => b.t - a.t)
      .map((s) => `${nameOf(s.p)} ${s.t / 10}`)
      .join("，") || "暂无"
  }`,
  `主持模式：${mode === "quirky" ? "搞怪" : "普通"}`,
  running
    ? `当前游戏：${running.gameName}，进行中（回放近似：没有当时的轮次和阶段）`
    : "当前在大厅，没有进行中的游戏。",
].join("\n");

const module = running ? games[running.gameId] : undefined;
const contentType = module?.meta.contentType;
const guide = contentType ? contentTypes[contentType]?.guide : undefined;

const context: AgentRoomContext = {
  state,
  members: players.map((p) => ({ id: p, nickname: nameOf(p), isHost: false })),
  canvas: "（回放近似：不知道当时主面板上有没有互动）",
  note: flag("note") ?? null,
  content: running
    ? module?.offer && contentType && guide
      ? { gameAcceptsOffers: true, type: contentType, guide }
      : { gameAcceptsOffers: false }
    : null,
  recentChat: shapeChat(lines),
  mode,
  games: Object.values(games).map((g) => g.meta),
};
const tools = AgentService.toolSummary()
  .map((t) => `- ${t.name}：${t.description}`)
  .join("\n");
const request = [
  `===== SYSTEM =====\n${systemPrompt(mode)}`,
  `===== 可用工具 =====\n${tools}`,
  `===== USER =====\n${buildPrompt(context, [
    { kind: "mention", playerId: trigger.sender, nickname: nameOf(trigger.sender), text: trigger.text },
  ])}`,
].join("\n\n");

const outDir = resolve(dir, "replay");
mkdirSync(outDir, { recursive: true });
const file = resolve(outDir, `${trigger.at.slice(11, 19).replaceAll(":", "")}-${mode}.txt`);
writeFileSync(file, `${request}\n`);
console.log(`${trigger.at.slice(11, 19)} ${nameOf(trigger.sender)}：${trigger.text}`);
console.log(`request (${request.length} chars): ${file}`);
