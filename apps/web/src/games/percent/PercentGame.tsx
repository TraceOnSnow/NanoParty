import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, useNames } from "../ui.tsx";

type Side = "higher" | "lower";
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "answer" | "guess" | "bet" | "reveal" | "finished";
  participants: string[];
  guesser: string;
  prompt: string;
  answered: string[];
  myAnswer: boolean | null;
  guess: number | null;
  betters: string[];
  myBet: Side | null;
  reveal: { answered: number; yes: number; bets: Record<string, Side> } | null;
  deadlineAt: number | null;
}

const SIDE = { higher: "更高", lower: "更低" };
const pct = (n: number, of: number) => (of > 0 ? `${Math.round((n / of) * 100)}%` : "—");

export function PercentGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.participants.includes(me);
  const guessing = me === v.guesser;
  const total = v.reveal?.answered ?? v.answered.length;
  const others = v.participants.filter((p) => p !== v.guesser);

  return (
    <div className="game">
      <GameHead label={roundLabel(v.round, v.totalRounds)} deadlineAt={v.deadlineAt} paused={paused} />
      <p className="muted">
        竞猜者：<strong>{name(v.guesser)}</strong>　数字只来自在场各位的真实回答，个人回答不会公开。
      </p>
      <h2 className="question">{v.prompt}</h2>

      {v.phase === "answer" && (
        <>
          {!playing ? (
            <p className="muted">你将从下一轮开始参与。</p>
          ) : v.myAnswer === null ? (
            <div className="host-row">
              <button
                type="button"
                className="primary"
                disabled={paused}
                onClick={() => go({ type: "answer", yes: true })}
              >
                是
              </button>
              <button type="button" disabled={paused} onClick={() => go({ type: "answer", yes: false })}>
                否
              </button>
            </div>
          ) : (
            <p className="notice">你答了「{v.myAnswer ? "是" : "否"}」。</p>
          )}
          <Progress ids={v.participants} done={v.answered} name={name} />
        </>
      )}

      {v.phase === "guess" &&
        (guessing ? (
          <>
            <p className="muted">{total} 个人作答了。你猜有几个人答「是」？</p>
            <div className="host-row">
              {Array.from({ length: total + 1 }, (_, n) => n).map((n) => (
                <button key={n} type="button" disabled={paused} onClick={() => go({ type: "guess", count: n })}>
                  {n} 人（{pct(n, total)}）
                </button>
              ))}
            </div>
          </>
        ) : (
          <p className="muted">等 {name(v.guesser)} 猜比例…</p>
        ))}

      {(v.phase === "bet" || v.phase === "reveal") && v.guess !== null && (
        <p className="notice">
          {name(v.guesser)} 猜：<strong className="big-clue">{pct(v.guess, total)}</strong>（{v.guess} / {total}{" "}
          人答「是」）
        </p>
      )}
      {v.phase === "bet" && (
        <>
          {guessing || !playing ? (
            <p className="muted">等其他人押注…</p>
          ) : v.myBet ? (
            <p className="muted">你押了「{SIDE[v.myBet]}」。</p>
          ) : (
            <div className="host-row">
              <span>实际比这个</span>
              {(["higher", "lower"] as const).map((side) => (
                <button key={side} type="button" disabled={paused} onClick={() => go({ type: "bet", side })}>
                  {SIDE[side]}
                </button>
              ))}
            </div>
          )}
          <Progress ids={others} done={v.betters} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <div className="card">
          <h2>
            实际：{pct(v.reveal.yes, v.reveal.answered)}（{v.reveal.yes} / {v.reveal.answered} 人答「是」）
          </h2>
          {v.guess === null ? (
            <p className="muted">这一轮没有形成竞猜，不计分。</p>
          ) : (
            <ul className="chips">
              {Object.entries(v.reveal.bets).map(([p, side]) => {
                const yes = v.reveal?.yes ?? 0;
                const right = side === "higher" ? yes > (v.guess ?? 0) : yes < (v.guess ?? 0);
                return (
                  <li key={p} className={right ? "chip done" : "chip"}>
                    {name(p)}：{SIDE[side]} {right ? "✓" : "✗"}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "answer" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始竞猜
          </button>
        )}
        {(v.phase === "guess" || v.phase === "bet") && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            直接揭晓
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
