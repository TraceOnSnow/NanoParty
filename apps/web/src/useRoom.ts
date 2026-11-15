import { type Ack, type ChatMessageView, type Command, MSG, type RoomView } from "@apr/shared";
import { Client, type Room } from "@colyseus/sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { REALTIME_URL } from "./api.ts";

export type ConnectionStatus = "connecting" | "connected" | "reconnecting" | "denied";

export interface RoomConnection {
  status: ConnectionStatus;
  view: RoomView | null;
  chat: ChatMessageView[];
  /** Sends a formal operation. The server acknowledges every command. */
  command(command: Command): Promise<Ack>;
  /** `askAi` posts the message and asks the AI host to act on it. */
  say(text: string, askAi?: boolean): Promise<Ack>;
}

const OFFLINE: Ack = { ok: false, error: "连接已断开，正在重连…" };

/**
 * Keeps one realtime connection to a room alive. Identity is the stored session token,
 * so after a refresh, a network drop or a server restart we simply join again and the
 * server sends a full snapshot. Colyseus' own reconnection is not used.
 */
export function useRoom(roomId: string, sessionToken: string | null): RoomConnection {
  const [status, setStatus] = useState<ConnectionStatus>(sessionToken ? "connecting" : "denied");
  const [view, setView] = useState<RoomView | null>(null);
  const [chat, setChat] = useState<ChatMessageView[]>([]);
  const roomRef = useRef<Room | null>(null);

  useEffect(() => {
    if (!sessionToken) return;
    let closed = false;
    let attempt = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    const scheduleRetry = () => {
      if (closed) return;
      setStatus("reconnecting");
      retry = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++));
    };

    async function connect() {
      try {
        const room = await new Client(REALTIME_URL).joinOrCreate("party", { partyId: roomId, token: sessionToken });
        if (closed) return void room.leave();
        room.reconnection.enabled = false;
        roomRef.current = room;
        attempt = 0;
        room.onMessage(MSG.view, (v: RoomView) => setView(v));
        room.onMessage(MSG.chatHistory, (h: ChatMessageView[]) => setChat(h));
        room.onMessage(MSG.chatMessage, (m: ChatMessageView) =>
          setChat((prev) => (prev.some((p) => p.id === m.id) ? prev : [...prev, m])),
        );
        room.onLeave(() => {
          if (roomRef.current === room) roomRef.current = null;
          scheduleRetry();
        });
        setStatus("connected");
      } catch (err) {
        const code = (err as { code?: number }).code;
        // 401 = unknown session, 404 = room gone: retrying cannot help.
        if (code === 401 || code === 404) return setStatus("denied");
        scheduleRetry();
      }
    }

    connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      roomRef.current?.leave();
      roomRef.current = null;
    };
  }, [roomId, sessionToken]);

  const request = useCallback((type: string, payload: unknown): Promise<Ack> => {
    const room = roomRef.current;
    if (!room) return Promise.resolve(OFFLINE);
    return new Promise((resolve) => {
      room.send(type, payload, (res: Ack | undefined, err?: Error) =>
        resolve(err || !res ? { ok: false, error: "操作未得到确认，请重试" } : res),
      );
    });
  }, []);

  const command = useCallback(
    (cmd: Command) => request(MSG.command, { cmdId: crypto.randomUUID(), command: cmd }),
    [request],
  );
  const say = useCallback(
    (text: string, askAi = false) => request(MSG.chat, askAi ? { text, askAi: true } : { text }),
    [request],
  );

  return { status, view, chat, command, say };
}
