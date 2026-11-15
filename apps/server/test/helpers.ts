import { bundledContent } from "@apr/games";
import type { Ack, ChatMessageView, Command, RoomView } from "@apr/shared";
import { MSG } from "@apr/shared";
import { eq } from "drizzle-orm";
import { AgentService } from "../src/agent/AgentService.ts";
import { GameAiService } from "../src/agent/GameAi.ts";
import type { AgentModel } from "../src/agent/model.ts";
import { ContentService } from "../src/content/ContentService.ts";
import { type DbHandle, openDb } from "../src/db/client.ts";
import { partySessions, players, rooms, segments } from "../src/db/schema.ts";
import { RoomRuntime, type RuntimeDeps } from "../src/rooms/RoomRuntime.ts";
import { newId, randomToken, sha256 } from "../src/util/tokens.ts";

export const LIMITS = { timeoutMs: 2000, maxConcurrency: 2, roomCallsPerMinute: 100, dailyCallLimit: 1000 };

export interface World {
  handle: DbHandle;
  deps: RuntimeDeps;
  agent: AgentService;
}

/** `judge` = the model behind the Game AI (referee); defaults to none. */
export async function makeWorld(
  model: AgentModel | null = null,
  limits = LIMITS,
  judge: AgentModel | null = null,
): Promise<World> {
  const handle = await openDb({});
  const content = new ContentService(handle.db);
  await content.seed(bundledContent);
  const agent = new AgentService(model, handle.db, limits);
  const gameAi = new GameAiService(judge, handle.db, limits);
  return { handle, agent, deps: { db: handle.db, content, agent, gameAi } };
}

export interface Seat {
  playerId: string;
  token: string;
}

/** Creates a room with a host and `n - 1` guests directly in the database. */
export async function seedRoom(world: World, n: number): Promise<{ roomId: string; seats: Seat[] }> {
  const { db } = world.handle;
  const roomId = newId("room");
  const seats: Seat[] = Array.from({ length: n }, () => ({ playerId: newId("p"), token: randomToken() }));
  const host = seats[0] as Seat;
  await db
    .insert(rooms)
    .values({ id: roomId, name: "测试房", inviteToken: randomToken(), hostPlayerId: host.playerId });
  for (const [i, s] of seats.entries()) {
    await db.insert(players).values({
      id: s.playerId,
      roomId,
      nickname: `玩家${i + 1}`,
      sessionTokenHash: sha256(s.token),
      createdAt: new Date(Date.now() + i),
    });
  }
  await db.insert(partySessions).values({ id: newId("ses"), roomId, status: "active" });
  return { roomId, seats };
}

let nextCmd = 0;

/** A fake connected client: records what the server sent to this player. */
export class TestClient {
  view!: RoomView;
  chat: ChatMessageView[] = [];
  readonly raw: string[] = [];
  disconnect: () => void;

  constructor(
    readonly runtime: RoomRuntime,
    readonly playerId: string,
  ) {
    this.disconnect = runtime.connect(playerId, (type, payload) => {
      this.raw.push(JSON.stringify(payload));
      if (type === MSG.view) this.view = payload as RoomView;
      if (type === MSG.chatHistory) this.chat = [...(payload as ChatMessageView[])];
      if (type === MSG.chatMessage) this.chat.push(payload as ChatMessageView);
    });
  }

  cmd(command: Command, cmdId = `cmd-${this.playerId}-${nextCmd++}`): Promise<Ack> {
    return this.runtime.handleCommand(this.playerId, { cmdId, command });
  }

  act(action: unknown): Promise<Ack> {
    return this.cmd({ type: "gameAction", segmentId: this.view.segment?.id ?? "none", action });
  }

  // biome-ignore lint/suspicious/noExplicitAny: game views are game-specific
  get game(): any {
    return this.view.segment?.view;
  }
}

export async function loadRuntime(world: World, roomId: string): Promise<RoomRuntime> {
  const rt = await RoomRuntime.load(world.deps, roomId);
  if (!rt) throw new Error("room not found");
  return rt;
}

/** Reads the authoritative (secret) state straight from the database. */
// biome-ignore lint/suspicious/noExplicitAny: raw game state, shape depends on the game
export async function segmentState(world: World, segmentId: string): Promise<any> {
  const [row] = await world.handle.db.select().from(segments).where(eq(segments.id, segmentId));
  return row?.state;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor(check: () => boolean, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("waitFor timed out");
    await sleep(10);
  }
}
