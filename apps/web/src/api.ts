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
  // Test rooms: `?seat=N` picks one of the test players created for this browser.
  const seat = new URLSearchParams(location.search).get("seat");
  const seats = loadTestSeats(roomId);
  if (seat !== null && seats[Number(seat)]) return (seats[Number(seat)] as TestSeat).sessionToken;
  return localStorage.getItem(key(roomId));
}

// --- Parties and recaps (members only; authenticated with the room's session token) ----------

export interface PartyListItem {
  sessionId: string;
  number: number;
  status: "active" | "ended";
  startedAt: number;
  endedAt: number | null;
  games: number;
}

/** Mirrors Recap in apps/server/src/rooms/recap.ts. */
export interface Recap {
  sessionId: string;
  number: number;
  status: "active" | "ended";
  scoring: "raw-v1" | "rank-v1";
  startedAt: number;
  endedAt: number | null;
  names: Record<string, string>;
  ranking: { playerId: string; tenths: number; rank: number }[];
  games: {
    segmentId: string;
    gameName: string;
    status: "finished" | "aborted";
    raw: { playerId: string; points: number }[];
    rewards: { playerId: string; rank: number; tied: boolean; tenths: number }[];
    note: string | null;
  }[];
  adjustments: {
    segmentId: string | null;
    kind: "adjust" | "correction";
    items: { playerId: string; tenths: number }[];
    reason: string;
    proposedBy: string;
    approvedBy: string;
  }[];
  timeline: { at: number; label: string; totals: Record<string, number> }[];
  events: { at: number; text: string }[];
  summary: { status: "none" | "pending" | "ok" | "failed"; text: string | null };
}

const authed = <T>(roomId: string, path: string) =>
  request<T>(`/rooms/${roomId}${path}`, { headers: { authorization: `Bearer ${loadSession(roomId) ?? ""}` } });

export const partyApi = {
  list: (roomId: string) => authed<{ parties: PartyListItem[] }>(roomId, "/parties"),
  recap: (roomId: string, sessionId: string) => authed<Recap>(roomId, `/parties/${sessionId}`),
};

// --- Test rooms (only usable when the server runs with TEST_MODE=true) ------

export interface TestSeat {
  playerId: string;
  nickname: string;
  sessionToken: string;
}

const seatsKey = (roomId: string) => `apr:test-seats:${roomId}`;

export function loadTestSeats(roomId: string): TestSeat[] {
  try {
    return JSON.parse(localStorage.getItem(seatsKey(roomId)) ?? "[]") as TestSeat[];
  } catch {
    return [];
  }
}

export const testApi = {
  health: () => request<{ ok: boolean; ai: boolean; testMode?: boolean }>("/health"),
  async createRoom(players: number): Promise<string> {
    const { roomId, seats } = await post<{ roomId: string; seats: TestSeat[] }>("/test/rooms", { players });
    localStorage.setItem(seatsKey(roomId), JSON.stringify(seats));
    return roomId;
  },
  autoplay: (roomId: string, except: string[]) =>
    post<{ moves: { playerId: string; action: string; ok: boolean; error?: string }[] }>(
      `/test/rooms/${roomId}/autoplay`,
      { except },
    ),
};

export function clearSession(roomId: string) {
  localStorage.removeItem(key(roomId));
}
