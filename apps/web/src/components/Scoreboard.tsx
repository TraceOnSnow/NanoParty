import type { RoomView } from "@apr/shared";

export function Scoreboard({ view }: { view: RoomView }) {
  const member = (id: string) => view.members.find((m) => m.id === id);
  return (
    <div className="scoreboard">
      <h3>本场积分</h3>
      <ul>
        {view.scoreboard.map((s) => {
          const m = member(s.playerId);
          return (
            <li key={s.playerId} className={m?.connected ? "" : "offline"}>
              <span className={m?.connected ? "dot on" : "dot"} title={m?.connected ? "在线" : "离线"} />
              <span className="nick">
                {m?.nickname ?? "?"}
                {m?.isHost && <span className="tag">房主</span>}
                {s.playerId === view.me.playerId && <span className="tag">我</span>}
              </span>
              <strong>{s.points}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
