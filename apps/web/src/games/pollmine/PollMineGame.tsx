import { useEffect, useState } from "react";
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
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [chosen, setChosen] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means the board changed
  useEffect(() => setChosen(null), [v.step]);
  const canVote = v.phase === "vote" && v.myTeam !== null && v.myVote === null && !paused;
  const canOpen = v.phase === "hunt" && v.myTeam === v.turn && !paused;
  const people = v.teams.flat().length;
  const last = v.opened.at(-1);

  return (
    <div className="game pollmine">
      <GameHead label={roundLabel(v.round, v.totalRounds)} deadlineAt={v.deadlineAt} paused={paused} />
      <TeamBar
        teams={v.teams}
        name={name}
        room={room}
        me={me}
        note={[0, 1].map((t) => `${v.points[t as 0 | 1]} 分`) as Pair<string>}
        active={v.phase === "hunt" ? v.turn : null}
      />
      <div className="lives-row">
        {([0, 1] as const).map((t) => (
          <span key={t} className={`lives team-${t}`}>
            {v.lives[t] > 0 ? "❤️".repeat(v.lives[t]) : "💀 没命了"}
          </span>
        ))}
      </div>
      <h2 className="question">{v.text}</h2>
      {v.phase === "vote" && (
        <p className={canVote ? "turn-line mine" : "turn-line"}>
          {canVote
            ? "先悄悄选出你自己的答案（不会公开是谁选的）。"
            : v.myVote !== null
              ? "选好了，等其他人…"
              : "等其他人作答…"}
        </p>
      )}
      {v.phase === "hunt" && (
        <p className={canOpen ? "turn-line mine" : "turn-line"}>
          {canOpen ? "轮到你们：翻一个「有人选了」的选项。" : `等${TEAM[v.turn]}翻选项…`}
          翻到没人选的会掉一条命。
          {last &&
            `　刚才${TEAM[last.team]}翻开「${v.options[last.option]}」：${last.count > 0 ? `${last.count} 人选了` : "没人选，掉一条命"}`}
        </p>
      )}

      <div className="poll-options">
        {v.options.map((o, i) => {
          const opened = v.opened.find((x) => x.option === i);
          const count = opened?.count ?? v.counts?.[i];
          const live = canVote || (canOpen && !opened);
          return (
            <button
              key={o}
              type="button"
              className={`poll-option${opened ? (opened.count > 0 ? ` hit team-${opened.team}` : " miss") : ""}${
                v.myVote === i ? " mine" : ""
              }${chosen === i ? " selected" : ""}${count === undefined ? " closed" : " open"}${
                last?.option === i && v.phase === "hunt" ? " fresh" : ""
              }`}
              disabled={!live}
              onClick={() => setChosen(chosen === i ? null : i)}
            >
              <span className="poll-text">{o}</span>
              {count === undefined ? (
                v.phase === "hunt" && <span className="poll-back">？</span>
              ) : count > 0 ? (
                <span className="poll-count">
                  <span className="poll-dots">
                    {Array.from({ length: people }, (_, k) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
                      <i key={k} className={k < count ? "on" : ""} />
                    ))}
                  </span>
                  <strong>{count} 人</strong>
                </span>
              ) : (
                <span className="poll-count">
                  <strong>{opened ? "💥 没人选" : "0 人"}</strong>
                </span>
              )}
              {v.myVote === i && <span className="tag">我选的</span>}
              {opened && <span className={`poll-by team-${opened.team}`}>{TEAM[opened.team]}翻的</span>}
            </button>
          );
        })}
      </div>
      {chosen !== null && (canVote || canOpen) && (
        <button
          type="button"
          className="primary wide"
          onClick={() => go({ type: canVote ? "vote" : "open", option: chosen })}
        >
          {canVote ? `我选「${v.options[chosen]}」` : `翻开「${v.options[chosen]}」`}
        </button>
      )}
      {v.phase === "vote" && <Progress ids={v.teams.flat()} done={v.voted} name={name} />}
      {v.phase === "reveal" && (
        <p className="answer">
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
