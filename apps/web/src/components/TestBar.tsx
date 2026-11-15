import { useState } from "react";
import { loadTestSeats, testApi } from "../api.ts";

/** Seat switcher for test rooms. Rendered only when this browser holds test seats for the room. */
export function TestBar({ roomId, me }: { roomId: string; me: string }) {
  const seats = loadTestSeats(roomId);
  const [note, setNote] = useState("");
  if (seats.length === 0) return null;
  return (
    <div className="test-bar">
      <strong>测试房间</strong>
      {seats.map((s, i) => (
        <a key={s.playerId} className={s.playerId === me ? "seat on" : "seat"} href={`/room/${roomId}?seat=${i}`}>
          {s.nickname}
        </a>
      ))}
      <button
        type="button"
        onClick={async () => {
          try {
            const { moves } = await testApi.autoplay(roomId, [me]);
            setNote(moves.length ? moves.map((m) => `${m.action}${m.ok ? "" : "✗"}`).join(" ") : "没有可代走的操作");
          } catch (e) {
            setNote(e instanceof Error ? e.message : "失败");
          }
        }}
      >
        其他人各走一步
      </button>
      <span className="muted small">{note}</span>
    </div>
  );
}
