import type { ApiError, CreateRoomRequest, InviteInfo, JoinResponse, JoinRoomRequest } from "@apr/shared";

/**
 * Realtime endpoint. In production the server serves this app, so it is the page origin.
 * In `vite dev` the game server runs on its own port (override with VITE_SERVER_URL).
 */
export const REALTIME_URL: string =
  import.meta.env.VITE_SERVER_URL ??
  (import.meta.env.DEV ? `${location.protocol}//${location.hostname}:3000` : location.origin);

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, init);
  } catch {
    throw new Error("无法连接服务器");
  }
  const body = (await res.json().catch(() => ({ error: "服务器返回了无法识别的内容" }))) as T | ApiError;
  if (!res.ok) throw new Error((body as ApiError).error ?? `请求失败（${res.status}）`);
  return body as T;
}

const post = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const api = {
  createRoom: (body: CreateRoomRequest) => post<JoinResponse>("/rooms", body),
  join: (body: JoinRoomRequest) => post<JoinResponse>("/join", body),
  invite: (token: string) => request<InviteInfo>(`/invites/${encodeURIComponent(token)}`),
};

// --- Player session storage -------------------------------------------------
// The session token is this browser's identity in a room. It stays in localStorage
// (never in URLs) so a refresh or reconnect resumes the same player.

const key = (roomId: string) => `apr:session:${roomId}`;

export function saveSession(seat: JoinResponse) {
  localStorage.setItem(key(seat.roomId), seat.sessionToken);
}

export function loadSession(roomId: string): string | null {
  return localStorage.getItem(key(roomId));
}

export function clearSession(roomId: string) {
  localStorage.removeItem(key(roomId));
}
