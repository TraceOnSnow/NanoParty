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
}) {
  return (
    <div className="team-bar">
      {([0, 1] as const).map((t) => (
        <div key={t} className={`team team-${t}${props.active === t ? " active" : ""}`}>
          <strong>
            {TEAM[t]}
            {props.note ? `　${props.note[t]}` : ""}
          </strong>
          <span>
            {props.teams[t]
              .map((p) => {
                const badge = props.badge?.(p);
                return badge ? `${props.name(p)}（${badge}）` : props.name(p);
              })
              .join("、")}
          </span>
        </div>
      ))}
    </div>
  );
}
