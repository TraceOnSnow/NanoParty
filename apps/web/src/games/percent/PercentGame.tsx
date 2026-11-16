import { type CSSProperties, useEffect, useState } from "react";
import { Stickers } from "../answers.tsx";
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

/** A ladder from 0 to everyone: press a rung to choose it; `fill` lights the rungs up to the real count. */
function Meter(props: {
  total: number;
  fill?: number | null;
  mark?: number | null;
  pending?: number | null;
  onPick?: (n: number) => void;
}) {
  const { total, fill, mark, pending } = props;
  return (
    <div className="meter">
      {Array.from({ length: total + 1 }, (_, n) => n).map((n) => (
        <button
          key={n}
          type="button"
          className={`meter-step${fill != null && n <= fill && (n > 0 || fill === 0) ? " full" : ""}${fill === n ? " top" : ""}${
            mark === n ? " mark" : ""
          }${pending === n ? " pending" : ""}`}
          style={fill != null ? ({ animationDelay: `${n * 0.25}s` } as CSSProperties) : undefined}
          disabled={!props.onPick}
          onClick={() => props.onPick?.(n)}
        >
          <b>{n} 人</b>
          <span>{pct(n, total)}</span>
          {mark === n && <em>猜的</em>}
          {fill === n && <em className="real">实际</em>}
        </button>
      ))}
    </div>
  );
}

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
  const [pending, setPending] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means a new choice
  useEffect(() => setPending(null), [v.step]);
  const betsOn = (side: Side) =>
    Object.entries(v.reveal?.bets ?? {})
      .filter(([, x]) => x === side)
      .map(([p]) => p);
  const actual = v.reveal?.yes ?? 0;
  const won = (side: Side) => v.guess !== null && (side === "higher" ? actual > v.guess : actual < v.guess);

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
            <div className="yes-no">
              <button type="button" className="yes" disabled={paused} onClick={() => go({ type: "answer", yes: true })}>
                是
              </button>
              <button type="button" className="no" disabled={paused} onClick={() => go({ type: "answer", yes: false })}>
                否
              </button>
            </div>
          ) : (
            <p className="notice">你答了「{v.myAnswer ? "是" : "否"}」，只有你自己知道。</p>
          )}
          <Progress ids={v.participants} done={v.answered} name={name} />
        </>
      )}

      {v.phase === "guess" &&
        (guessing ? (
          <>
            <p className="muted">{total} 个人作答了。你猜有几个人答「是」？点一格，再确认。</p>
            <Meter total={total} pending={pending} onPick={paused ? undefined : setPending} />
            <button
              type="button"
              className="primary wide"
              disabled={paused || pending === null}
              onClick={() => pending !== null && go({ type: "guess", count: pending })}
            >
              {pending === null ? "先点一格" : `就猜 ${pending} 人（${pct(pending, total)}）`}
            </button>
          </>
        ) : (
          <p className="muted">等 {name(v.guesser)} 猜比例…</p>
        ))}

      {v.phase === "bet" && v.guess !== null && (
        <>
          <p className="notice">
            {name(v.guesser)} 猜：<strong className="big-clue">{pct(v.guess, total)}</strong>（{v.guess} / {total}{" "}
            人答「是」）
          </p>
          <Meter total={total} mark={v.guess} />
        </>
      )}
      {v.phase === "bet" && (
        <>
          {guessing || !playing ? (
            <p className="muted">等其他人押注…</p>
          ) : v.myBet ? (
            <p className="muted">你押了「{SIDE[v.myBet]}」。</p>
          ) : (
            <div className="yes-no">
              {(["lower", "higher"] as const).map((side) => (
                <button
                  key={side}
                  type="button"
                  className={side}
                  disabled={paused}
                  onClick={() => go({ type: "bet", side })}
                >
                  {side === "lower" ? "◀ 实际更低" : "实际更高 ▶"}
                </button>
              ))}
            </div>
          )}
          <Progress ids={others} done={v.betters} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <>
          <Meter total={v.reveal.answered} fill={v.reveal.yes} mark={v.guess} />
          <p className="answer">
            实际 <strong>{pct(v.reveal.yes, v.reveal.answered)}</strong>（{v.reveal.yes} / {v.reveal.answered}{" "}
            人答「是」）
            {v.guess !== null &&
              (v.guess === v.reveal.yes
                ? `，${name(v.guesser)} 猜得分毫不差！`
                : `，${name(v.guesser)} 猜的是 ${v.guess} 人。`)}
          </p>
          {v.guess === null ? (
            <p className="muted">这一轮没有形成竞猜，不计分。</p>
          ) : (
            <div className="bet-sides">
              {(["lower", "higher"] as const).map((side) => (
                <span key={side} className={won(side) ? "side won" : "side"}>
                  <b>
                    押{SIDE[side]} {won(side) ? "✓" : "✗"}
                  </b>
                  <Stickers room={room} ids={betsOn(side)} />
                </span>
              ))}
            </div>
          )}
        </>
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
