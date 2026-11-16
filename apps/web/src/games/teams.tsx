import type { RoomView } from "@apr/shared";
import { Avatar } from "../components/Avatar.tsx";

/** Two-team header shared by the team games. */
export const TEAM = ["红队", "蓝队"] as const;

export function TeamBar(props: {
  teams: [string[], string[]];
  name(id: string): string;
  /** Extra text after a team's name, e.g. a score. */
  note?: [string, string];
  /** Marks special members, e.g. the captain. */
  badge?(id: string): string | null;
  active?: 0 | 1 | null;
  /** With the room, members are shown with their pictures. */
  room?: RoomView;
  me?: string;
}) {
  return (
    <div className="team-bar">
      {([0, 1] as const).map((t) => (
        <div
          key={t}
          className={`team team-${t}${props.active === t ? " active" : ""}${props.me && props.teams[t].includes(props.me) ? " mine" : ""}`}
        >
          <strong>
            {TEAM[t]}
            {props.me && props.teams[t].includes(props.me) ? "（你的队）" : ""}
            {props.note ? `　${props.note[t]}` : ""}
          </strong>
          <span className="team-members">
            {props.teams[t].map((p) => {
              const badge = props.badge?.(p);
              return (
                <span key={p} className="who-tag">
                  {props.room && <Avatar room={props.room} id={p} size="s" />}
                  {props.name(p)}
                  {badge && <em className="team-badge">{badge}</em>}
                </span>
              );
            })}
          </span>
        </div>
      ))}
    </div>
  );
}
