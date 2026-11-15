/**
 * Colyseus adapter. Deliberately thin: it authenticates the socket, forwards messages to the
 * RoomRuntime and relays the runtime's per-player messages. No game or room logic lives here,
 * and Colyseus schema state sync is not used (see docs/adr/0001).
 */
import { type Ack, chatRequest, commandEnvelope, MSG } from "@apr/shared";
import { type Client, Room, ServerError } from "@colyseus/core";
import type { RoomManager } from "./RoomManager.ts";
import type { RoomRuntime } from "./RoomRuntime.ts";

/** Join option carrying our room id. (`roomId` itself is reserved by Colyseus.) */
export const PARTY_ID_OPTION = "partyId";
export const PARTY_ROOM_NAME = "party";

interface PartyAuth {
  playerId: string;
}

export function createPartyRoomClass(manager: RoomManager) {
  return class PartyRoom extends Room {
    // One player may have several tabs open; this is a connection cap, not a player cap.
    maxClients = 64;
    autoDispose = true;
    runtime!: RoomRuntime;
    readonly disconnectors = new Map<string, () => void>();

    async onCreate(options: Record<string, unknown>) {
      const partyId = options[PARTY_ID_OPTION];
      const runtime = typeof partyId === "string" ? await manager.get(partyId) : null;
      if (!runtime) throw new ServerError(404, "room not found");
      this.runtime = runtime;

      this.onMessage(MSG.chat, async (client: Client, payload: unknown): Promise<Ack> => {
        const parsed = chatRequest.safeParse(payload);
        if (!parsed.success) return { ok: false, error: "消息无效" };
        return runtime.handleChat((client.auth as PartyAuth).playerId, parsed.data.text, parsed.data.askAi === true);
      });

      this.onMessage(MSG.command, async (client: Client, payload: unknown): Promise<Ack> => {
        const parsed = commandEnvelope.safeParse(payload);
        if (!parsed.success) return { ok: false, error: "无效的操作" };
        return runtime.handleCommand((client.auth as PartyAuth).playerId, parsed.data);
      });
    }

    async onAuth(_client: Client, options: Record<string, unknown>): Promise<PartyAuth> {
      const playerId = await this.runtime.authenticate(options.token);
      if (!playerId) throw new ServerError(401, "invalid session");
      return { playerId };
    }

    onJoin(client: Client) {
      const { playerId } = client.auth as PartyAuth;
      this.disconnectors.set(
        client.sessionId,
        this.runtime.connect(
          playerId,
          (type, payload) => client.send(type, payload),
          () => client.leave(4003),
        ),
      );
    }

    // Reconnection is handled by our own session token (works across server restarts),
    // so a dropped socket is simply a disconnect; identity and submissions stay in the runtime.
    onDrop(client: Client) {
      this.release(client);
    }

    onLeave(client: Client) {
      this.release(client);
    }

    release(client: Client) {
      this.disconnectors.get(client.sessionId)?.();
      this.disconnectors.delete(client.sessionId);
    }
  };
}
