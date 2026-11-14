import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { TEAM, TeamBar } from "../teams.tsx";
import { GameHead, HostControls, lastRound, Progress, roundLabel, useNames } from "../ui.tsx";

type Pair<T> = [T, T];
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "vote" | "hunt" | "reveal" | "finished";
  teams: Pair<string[]>;
  myTeam: 0 | 1 | null;
  text: string;
  options: string[];
  voted: string[];
  myVote: number | null;
  opened: { option: number; team: 0 | 1; count: number }[];
  turn: 0 | 1;
  lives: Pair<number>;
  points: Pair<number>;
  counts: number[] | null;
  deadlineAt: number | null;
}

export function PollMineGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const canVote = v.phase === "vote" && v.myTeam !== null && v.myVote === null;
  const canOpen = v.phase === "hunt" && v.myTeam === v.turn;

  return (
    <div className="game">
      <GameHead label={roundLabel(v.round, v.totalRounds)} deadlineAt={v.deadlineAt} paused={paused} />
      <TeamBar
        teams={v.teams}
        name={name}
        note={
          [0, 1].map(
            (t) => `${v.points[t as 0 | 1]} 分 · ${"♥".repeat(v.lives[t as 0 | 1]) || "没命了"}`,
          ) as Pair<string>
        }
        active={v.phase === "hunt" ? v.turn : null}
      />
      <h2 className="question">{v.text}</h2>
      {v.phase === "vote" && (
        <p className="muted">{canVote ? "秘密选出你自己的答案（不会公开是谁选的）。" : "等其他人作答…"}</p>
      )}
      {v.phase === "hunt" && (
        <p className="muted">
          {canOpen ? "轮到你们：翻一个「有人选了」的选项。" : `等${TEAM[v.turn]}翻选项…`}
          没人选的选项会扣一条命。
        </p>
      )}

      <div className="poll-options">
        {v.options.map((o, i) => {
          const opened = v.opened.find((x) => x.option === i);
          const count = opened?.count ?? v.counts?.[i];
          return (
            <button
              key={o}
              type="button"
              className={`poll-option${opened ? (opened.count > 0 ? ` hit team-${opened.team}` : " miss") : ""}${v.myVote === i ? " mine" : ""}`}
              disabled={paused || !(canVote || (canOpen && !opened))}
              onClick={() => go({ type: canVote ? "vote" : "open", option: i })}
            >
              <span>{o}</span>
              {count !== undefined && <strong>{count} 人</strong>}
              {v.myVote === i && <span className="tag">我选的</span>}
            </button>
          );
        })}
      </div>
      {v.phase === "vote" && <Progress ids={v.teams.flat()} done={v.voted} name={name} />}
      {v.phase === "reveal" && (
        <p className="notice">
          本轮 {v.points[0]} : {v.points[1]}，
          {v.points[0] === v.points[1] ? "打平" : `${TEAM[v.points[0] > v.points[1] ? 0 : 1]}获胜`}。
        </p>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "vote" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始翻选项
          </button>
        )}
        {v.phase === "hunt" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            直接结算这一轮
          </button>
        )}
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "advance" })}>
            {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
