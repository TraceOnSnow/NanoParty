/**
 * Scenario runner for multi-player testing over the REAL paths: rooms are created and joined
 * through the HTTP API, every test player holds its own session token and WebSocket connection,
 * and every action is a normal command checked by the server. Nothing here touches game state.
 *
 *   pnpm tester tools/scenarios/<name>.json [--base http://localhost:3000] [--out reports/artifacts/x.json]
 *
 * Output is a short summary (one line per step, failures in full). The complete trace — each
 * step, acknowledgement and the players' views at the end — is written to --out for when it is needed.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import { botAction } from "@apr/games";
import { type Ack, type ChatMessageView, type Command, MSG, type RoomView } from "@apr/shared";
import { Client, type Room } from "@colyseus/sdk";

type Who = number | "host" | "picker";
interface Step {
  /** Free-text label shown in the summary. */
  note?: string;
  as?: Who;
  /** Platform command. `segmentId` is filled in when omitted. */
  cmd?: Record<string, unknown>;
  /** Game action. `step` / `round` binding is filled in from the player's current view. */
  act?: Record<string, unknown>;
  say?: string;
  askAi?: boolean;
  /** The step is expected to be rejected by the server (permission / stale / duplicate cases). */
  fails?: boolean;
  /** Let test players make plain legal moves from their own views (indices to leave out). */
  bots?: { except?: number[]; rounds?: number };
  /** Wait until a dotted path in a player's view equals a value. */
  wait?: { as?: Who; path: string; equals: unknown; timeoutMs?: number };
  expect?: { as?: Who; path: string; equals?: unknown; contains?: string; absent?: string };
  /** Drop and re-open a player's connection (same session token). */
  reconnect?: number;
}
interface Scenario {
  name: string;
  players: number;
  steps: Step[];
}

class Player {
  view!: RoomView;
  chat: ChatMessageView[] = [];
  room!: Room;
  constructor(
    readonly base: string,
    readonly roomId: string,
    readonly playerId: string,
    readonly token: string,
  ) {}
  async connect() {
    this.room = await new Client(this.base).joinOrCreate("party", { partyId: this.roomId, token: this.token });
    this.room.reconnection.enabled = false;
    this.room.onMessage(MSG.view, (v: RoomView) => {
      this.view = v;
    });
    this.room.onMessage(MSG.chatHistory, (h: ChatMessageView[]) => {
      this.chat = h;
    });
    this.room.onMessage(MSG.chatMessage, (m: ChatMessageView) => this.chat.push(m));
    await until(() => this.view !== undefined, 5000);
  }
  request(type: string, payload: unknown): Promise<Ack> {
    return new Promise((resolve) =>
      this.room.send(type, payload, (res: Ack | undefined) => resolve(res ?? { ok: false, error: "no ack" })),
    );
  }
  command(command: Command) {
    return this.request(MSG.command, { cmdId: crypto.randomUUID(), command });
  }
  get game(): Record<string, unknown> | undefined {
    return this.view.segment?.view as Record<string, unknown> | undefined;
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(check: () => boolean, timeoutMs: number) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) return false;
    await sleep(25);
  }
  return true;
}
const dig = (obj: unknown, path: string): unknown =>
  path.split(".").reduce<unknown>((o, k) => (o == null ? undefined : (o as Record<string, unknown>)[k]), obj);

async function post(base: string, path: string, body: unknown) {
  const res = await fetch(`${base}/api${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = (await res.json()) as Record<string, string>;
  if (!res.ok) throw new Error(`${path}: ${json.error ?? res.status}`);
  return json;
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
  const file = args.find((a) => a.endsWith(".json") && args[args.indexOf(a) - 1] !== "--out");
  if (!file) throw new Error("usage: tester <scenario.json> [--base URL] [--out file]");
  // pnpm runs the script from the package folder; paths are meant relative to where the user is.
  const at = (p: string) => resolvePath(process.env.INIT_CWD ?? process.cwd(), p);
  const scenario = JSON.parse(readFileSync(at(file), "utf8")) as Scenario;
  const base = flag("--base") ?? `http://localhost:${process.env.PORT ?? 3000}`;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) throw new Error("ADMIN_PASSWORD is not set (run with the project's .env)");

  // Real room + real joins: each player gets an independent session.
  const hostSeat = await post(base, "/rooms", { adminPassword, roomName: `测试·${scenario.name}`, nickname: "玩家1" });
  const players = [
    new Player(base, hostSeat.roomId as string, hostSeat.playerId as string, hostSeat.sessionToken as string),
  ];
  await (players[0] as Player).connect();
  const inviteToken = (players[0] as Player).view.inviteToken as string;
  for (let i = 1; i < scenario.players; i++) {
    const seat = await post(base, "/join", { inviteToken, nickname: `玩家${i + 1}` });
    const p = new Player(base, seat.roomId as string, seat.playerId as string, seat.sessionToken as string);
    await p.connect();
    players.push(p);
  }

  const host = players[0] as Player;
  const resolve = (who: Who | undefined): Player => {
    if (who === undefined || who === "host") return host;
    if (who === "picker") {
      const g = host.game as { pick?: { picker?: string }; giver?: string } | undefined;
      const id = g?.pick?.picker ?? g?.giver;
      return players.find((p) => p.playerId === id) ?? host;
    }
    return players[who] ?? host;
  };
  const bind = (p: Player, action: Record<string, unknown>) => {
    const g = p.game ?? {};
    return typeof g.step === "number" ? { step: g.step, ...action } : { round: g.round, ...action };
  };

  const trace: unknown[] = [];
  const failures: string[] = [];
  for (const [index, step] of scenario.steps.entries()) {
    const label = `#${index + 1} ${step.note ?? Object.keys(step).filter((k) => k !== "as" && k !== "note")[0]}`;
    const p = resolve(step.as);
    let outcome = "ok";
    let detail: unknown;
    try {
      if (step.cmd || step.act || step.say !== undefined) {
        const segmentId = p.view.segment?.id ?? "none";
        const ack =
          step.say !== undefined
            ? await p.request(MSG.chat, { text: step.say, ...(step.askAi ? { askAi: true } : {}) })
            : await p.command(
                (step.act
                  ? { type: "gameAction", segmentId, action: bind(p, step.act) }
                  : { ...(step.cmd?.type === "startGame" ? {} : { segmentId }), ...step.cmd }) as Command,
              );
        detail = ack;
        if (ack.ok === (step.fails === true)) {
          outcome = step.fails ? "FAIL: expected a rejection, but it was accepted" : `FAIL: ${ack.ok ? "" : ack.error}`;
        } else if (!ack.ok) outcome = `rejected as expected: ${ack.error}`;
        await sleep(40);
      } else if (step.bots) {
        const moves: string[] = [];
        for (let round = 0; round < (step.bots.rounds ?? 1); round++) {
          for (const [i, bot] of players.entries()) {
            if (step.bots.except?.includes(i) || !bot.view.segment) continue;
            const action = botAction(bot.view.segment.gameId, bot.game, bot.playerId);
            if (!action) continue;
            const ack = await bot.command({ type: "gameAction", segmentId: bot.view.segment.id, action });
            moves.push(`${i}:${action.type}${ack.ok ? "" : `✗(${ack.error})`}`);
            await sleep(30);
          }
        }
        detail = moves;
        outcome = `moves ${moves.join(" ") || "none"}`;
      } else if (step.wait) {
        const w = step.wait;
        const target = resolve(w.as);
        const ok = await until(() => dig(target.view, w.path) === w.equals, w.timeoutMs ?? 5000);
        detail = dig(target.view, w.path);
        if (!ok) outcome = `FAIL: ${w.path} stayed ${JSON.stringify(detail)}, wanted ${JSON.stringify(w.equals)}`;
      } else if (step.expect) {
        const e = step.expect;
        const value = dig(resolve(e.as).view, e.path);
        detail = value;
        const text = JSON.stringify(value) ?? "undefined";
        if ("equals" in e && JSON.stringify(e.equals) !== text) outcome = `FAIL: ${e.path} = ${text}`;
        if (e.contains !== undefined && !text.includes(e.contains)) outcome = `FAIL: ${e.path} lacks ${e.contains}`;
        if (e.absent !== undefined && text.includes(e.absent)) outcome = `FAIL: ${e.path} leaks ${e.absent}`;
      } else if (step.reconnect !== undefined) {
        const target = players[step.reconnect] as Player;
        await target.room.leave();
        await target.connect();
      }
    } catch (err) {
      outcome = `FAIL: ${err instanceof Error ? err.message : String(err)}`;
    }
    if (outcome.startsWith("FAIL")) failures.push(`${label} → ${outcome}`);
    trace.push({ step: index + 1, label, as: p.playerId, outcome, detail });
    console.log(`${outcome.startsWith("FAIL") ? "✗" : "✓"} ${label}${outcome === "ok" ? "" : ` — ${outcome}`}`);
  }

  const out = flag("--out");
  if (out) {
    writeFileSync(
      at(out),
      JSON.stringify(
        {
          scenario: scenario.name,
          base,
          roomId: host.roomId,
          failures,
          trace,
          // Final per-player snapshots: exactly what each client received, for leak checks.
          // The invite token is a credential and is left out.
          views: players.map((p) => ({
            playerId: p.playerId,
            view: { ...p.view, inviteToken: undefined },
            chat: p.chat.map((m) => m.text),
          })),
        },
        null,
        2,
      ),
    );
  }
  console.log(
    `\n${scenario.name}: ${scenario.steps.length - failures.length}/${scenario.steps.length} steps ok, room ${host.roomId}${out ? `, trace → ${out}` : ""}`,
  );
  for (const p of players) await p.room.leave();
  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`tester failed: ${err instanceof Error ? err.message : err}`);
  process.exit(2);
});
