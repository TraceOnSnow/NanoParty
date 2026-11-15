import { bundledContent } from "@apr/games";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { AgentService } from "./agent/AgentService.ts";
import { GameAiService } from "./agent/GameAi.ts";
import { GeminiAgentModel } from "./agent/geminiModel.ts";
import { MockAgentModel } from "./agent/mockModel.ts";
import { type AgentModel, AnthropicAgentModel } from "./agent/model.ts";
import type { Config } from "./config.ts";
import { ContentService } from "./content/ContentService.ts";
import { openDb } from "./db/client.ts";
import { mountRoutes } from "./http/routes.ts";
import { createPartyRoomClass, PARTY_ID_OPTION, PARTY_ROOM_NAME } from "./rooms/PartyRoom.ts";
import { RoomManager } from "./rooms/RoomManager.ts";

export interface App {
  port: number;
  aiEnabled: boolean;
  dbKind: "postgres" | "pglite";
  close(): Promise<void>;
}

export interface AppOverrides {
  /** Replaces the real model (tests). `null` forces AI off. */
  agentModel?: AgentModel | null;
}

/** Wires the whole server. One process, one port: REST + WebSocket + static web app. */
export async function startApp(config: Config, overrides: AppOverrides = {}): Promise<App> {
  const dbHandle = await openDb({ databaseUrl: config.databaseUrl, pgliteDir: config.pgliteDir });
  const { db } = dbHandle;

  const content = new ContentService(db);
  await content.seed(bundledContent);

  const build = (name: string): AgentModel | null =>
    config.ai.mock
      ? new MockAgentModel()
      : !config.ai.apiKey
        ? null
        : config.ai.provider === "google"
          ? new GeminiAgentModel({ apiKey: config.ai.apiKey, baseUrl: config.ai.baseUrl, model: name })
          : new AnthropicAgentModel({
              apiKey: config.ai.apiKey,
              baseUrl: config.ai.baseUrl,
              model: name,
              effort: config.ai.effort,
              refusalFallback: config.ai.refusalFallback,
            });
  const model = overrides.agentModel !== undefined ? overrides.agentModel : build(config.ai.model);
  // The referee may use its own model (AI_JUDGE_MODEL); by default it shares the host's.
  const judgeModel =
    overrides.agentModel !== undefined || config.ai.judgeModel === config.ai.model
      ? model
      : build(config.ai.judgeModel);
  const agent = new AgentService(model, db, config.ai, config.ai.mock ? "模拟" : config.ai.model);

  const label = config.ai.mock ? "模拟" : config.ai.model;
  // Same model service, separate role: the referee gets game secrets, the host agent never does.
  const gameAi = new GameAiService(judgeModel, db, config.ai, config.ai.mock ? "模拟" : config.ai.judgeModel);

  const manager = new RoomManager({ db, content, agent, gameAi });

  const server = new Server({
    transport: new WebSocketTransport(),
    greet: false,
    gracefullyShutdown: false,
    express: (app) => mountRoutes(app, { config, db, agent, manager }),
  });
  server.define(PARTY_ROOM_NAME, createPartyRoomClass(manager)).filterBy([PARTY_ID_OPTION]);
  await server.listen(config.port);

  return {
    port: config.port,
    aiEnabled: agent.enabled,
    dbKind: dbHandle.kind,
    async close() {
      await server.gracefullyShutdown(false);
      await manager.disposeAll();
      await dbHandle.close();
    },
  };
}
