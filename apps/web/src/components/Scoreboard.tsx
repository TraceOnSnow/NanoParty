import type { Ack, Command, RoomView } from "@apr/shared";
import { Avatar, AvatarPicker } from "./Avatar.tsx";

export function Scoreboard({ view, command }: { view: RoomView; command(c: Command): Promise<Ack> }) {
  const member = (id: string) => view.members.find((m) => m.id === id);
  const top = Math.max(...view.scoreboard.map((s) => s.points), 0);
  return (
    <div className="scoreboard">
      <h3>
        第 {view.party.number} 场派对积分
        {view.party.scoring === "raw-v1" && <span className="tag">旧计分</span>}
      </h3>
      <ul>
        {view.scoreboard.map((s) => {
          const m = member(s.playerId);
          const mine = s.playerId === view.me.playerId;
          return (
            <li key={s.playerId} className={`${m?.connected ? "" : "offline"}${mine ? " me" : ""}`}>
              {mine ? <AvatarPicker room={view} command={command} /> : <Avatar room={view} id={s.playerId} />}
              <span className="nick">
                {m?.nickname ?? "?"}
                {m?.isHost && <span className="tag">房主</span>}
                {mine && <span className="tag">我</span>}
              </span>
              {top > 0 && s.points === top && <span className="crown">👑</span>}
              <strong>{s.points}</strong>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
