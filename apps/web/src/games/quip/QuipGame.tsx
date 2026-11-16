import { useEffect, useState } from "react";
import { Who } from "../../components/Avatar.tsx";
import { Slip, Slips, Stickers } from "../answers.tsx";
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
  const [chosen, setChosen] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means new options
  useEffect(() => setChosen(null), [v.step]);
  const canVote = v.phase === "vote" && playing && v.myVote == null && !paused;
  // Fewest votes first, so the favourite is the last one to appear.
  const revealed = [...(v.reveal ?? [])].sort((a, b) => a.voters.length - b.voters.length || a.points - b.points);
  const best = Math.max(0, ...revealed.map((r) => r.voters.length));

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
          <p className="muted">
            {v.myVote != null ? "投好了，等其他人…" : "回答是匿名的。点你最喜欢的一个，再确认（不能投自己的）。"}
          </p>
          <Slips>
            {v.options.map((o) => (
              <Slip
                key={o.index}
                selected={chosen === o.index || v.myVote === o.index}
                disabled={!canVote || o.mine}
                stamp={o.mine ? "我写的" : v.myVote === o.index ? "已投" : undefined}
                onClick={() => setChosen(o.index)}
              >
                {o.text}
              </Slip>
            ))}
          </Slips>
          {canVote && (
            <button
              type="button"
              className="primary wide"
              disabled={chosen === null}
              onClick={() => chosen !== null && go({ type: "vote", index: chosen })}
            >
              {chosen === null ? "点一张最好笑的" : "投这个"}
            </button>
          )}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <Slips>
          {revealed.length === 0 && <p className="muted">这一轮没有人作答。</p>}
          {revealed.map((r, i) => (
            <Slip
              key={r.playerId}
              order={i}
              tone={best > 0 && r.voters.length === best ? "good" : "plain"}
              stamp={r.points > 0 ? `+${r.points}` : undefined}
              foot={
                <>
                  <Who room={room} id={r.playerId} />
                  <Stickers room={room} ids={r.voters} label={`${r.voters.length} 票`} />
                </>
              }
            >
              {r.text}
            </Slip>
          ))}
        </Slips>
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
