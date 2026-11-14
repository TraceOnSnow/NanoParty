import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "write" | "vote" | "reveal" | "finished";
  participants: string[];
  prompt: string;
  submitted: string[];
  myAnswer: string | null;
  options: { index: number; text: string; mine: boolean }[] | null;
  myVote: number | null;
  deadlineAt: number | null;
  reveal: { playerId: string; text: string; voters: string[]; points: number }[] | null;
}

export function QuipGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.participants.includes(me);

  return (
    <div className="game">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      <h2 className="question">{v.prompt}</h2>
      {!playing && v.phase !== "reveal" && <p className="muted">你将从下一轮开始参与。</p>}

      {v.phase === "write" && (
        <>
          {playing &&
            (v.myAnswer ? (
              <p className="notice">
                你的回答：<strong>{v.myAnswer}</strong>
              </p>
            ) : (
              <TextForm
                placeholder="写下你的回答（最多 60 字）"
                button="提交"
                maxLength={60}
                disabled={paused}
                resetKey={v.step}
                onSubmit={(text) => go({ type: "answer", text })}
              />
            ))}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "vote" && v.options && (
        <>
          <p className="muted">回答已匿名展示，投给你最喜欢的一个（不能投自己的）。</p>
          <ul className="describe-list">
            {v.options.map((o) => (
              <li key={o.index} className={v.myVote === o.index ? "picked" : ""}>
                <span className="text">{o.text}</span>
                {o.mine ? (
                  <span className="tag">我写的</span>
                ) : v.myVote === o.index ? (
                  <span className="tag">已投</span>
                ) : (
                  playing &&
                  v.myVote == null && (
                    <button type="button" disabled={paused} onClick={() => go({ type: "vote", index: o.index })}>
                      投这个
                    </button>
                  )
                )}
              </li>
            ))}
          </ul>
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <ul className="describe-list">
          {v.reveal.length === 0 && <li className="muted">这一轮没有人作答。</li>}
          {v.reveal.map((r) => (
            <li key={r.playerId} className={r.points > r.voters.length ? "picked" : ""}>
              <span className="who">{name(r.playerId)}</span>
              <span className="text">
                {r.text}
                <br />
                <span className="muted small">
                  {r.voters.length > 0 ? `${r.voters.map(name).join("、")} 投了 TA` : "没有人投"}
                </span>
              </span>
              {r.points > 0 && <strong className="plus">+{r.points}</strong>}
            </li>
          ))}
        </ul>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "write" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始投票
          </button>
        )}
        {v.phase === "vote" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            结束投票
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
