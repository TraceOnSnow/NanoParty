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
  const canVote = v.phase === "vote" && v.participants.includes(me) && v.myVote == null;

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
          <div className="pick-grid">
            {v.participants.map((id) => (
              <button
                key={id}
                type="button"
                className={v.myVote === id ? "pick picked" : "pick"}
                disabled={paused || !canVote}
                onClick={() => go({ type: "vote", target: id })}
              >
                {name(id)}
                {id === me ? "（我）" : ""}
              </button>
            ))}
          </div>
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <table className="results">
          <tbody>
            {v.participants
              .map((id) => ({
                id,
                voters: Object.entries(v.reveal?.votes ?? {})
                  .filter(([, t]) => t === id)
                  .map(([p]) => p),
              }))
              .sort((a, b) => b.voters.length - a.voters.length)
              .map(({ id, voters }) => (
                <tr key={id} className={v.reveal?.top.includes(id) ? "win" : ""}>
                  <td>{name(id)}</td>
                  <td className="muted">{voters.map(name).join("、") || "—"}</td>
                  <td>{voters.length} 票</td>
                </tr>
              ))}
          </tbody>
        </table>
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
