import { useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import { Slip, Slips, Stickers } from "../answers.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "vote" | "reveal" | "finished";
  participants: string[];
  prompt: string;
  submitted: string[];
  myVote: string | null;
  deadlineAt: number | null;
  reveal: { votes: Record<string, string>; top: string[] } | null;
}

export function MostLikelyGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const canVote = v.phase === "vote" && v.participants.includes(me) && v.myVote == null && !paused;
  const [chosen, setChosen] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means a new question
  useEffect(() => setChosen(null), [v.step]);
  const tally = v.participants
    .map((id) => ({
      id,
      voters: Object.entries(v.reveal?.votes ?? {})
        .filter(([, t]) => t === id)
        .map(([p]) => p),
    }))
    .sort((a, b) => a.voters.length - b.voters.length);

  return (
    <div className="game">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "vote" ? v.deadlineAt : null}
        paused={paused}
      />
      <h2 className="question">{v.prompt}</h2>

      {v.phase === "vote" && (
        <>
          {!v.participants.includes(me) && <p className="muted">你将从下一轮开始参与。</p>}
          <Slips people>
            {v.participants.map((id) => (
              <Slip
                key={id}
                selected={chosen === id || v.myVote === id}
                disabled={!canVote}
                stamp={v.myVote === id ? "我投的" : undefined}
                onClick={() => setChosen(id)}
              >
                <Avatar room={room} id={id} size="l" />
                {name(id)}
                {id === me ? "（我）" : ""}
              </Slip>
            ))}
          </Slips>
          {canVote && (
            <button
              type="button"
              className="primary wide"
              disabled={chosen === null}
              onClick={() => chosen !== null && go({ type: "vote", target: chosen })}
            >
              {chosen === null ? "点一个人" : `就是 ${name(chosen)}`}
            </button>
          )}
          {v.myVote != null && <p className="muted">投好了，等其他人…</p>}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <Slips people>
          {tally.map(({ id, voters }, i) => (
            <Slip
              key={id}
              order={i}
              tone={v.reveal?.top.includes(id) ? "good" : "plain"}
              stamp={v.reveal?.top.includes(id) ? "就是你" : undefined}
              foot={<Stickers room={room} ids={voters} label={`${voters.length} 票`} />}
            >
              <Avatar room={room} id={id} size="l" />
              {name(id)}
            </Slip>
          ))}
        </Slips>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "vote" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "reveal" })}>
            提前揭晓
          </button>
        )}
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
