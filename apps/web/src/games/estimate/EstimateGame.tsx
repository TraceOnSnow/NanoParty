import { type CSSProperties, type FormEvent, useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import type { GameProps } from "../registry.tsx";
import { useCountdown } from "../shared.ts";
import { Progress, useNames } from "../ui.tsx";

// Mirrors EstimateView in @apr/games (kept local so the web app does not bundle game rules).
interface EstimateView {
  round: number;
  totalRounds: number;
  phase: "answering" | "reveal" | "finished";
  participants: string[];
  question: { text: string; unit: string };
  submitted: string[];
  myGuess: number | null;
  deadlineAt: number | null;
  reveal: {
    answer: number;
    note?: string;
    results: { playerId: string; guess: number; diff: number; points: number }[];
  } | null;
}

export function EstimateGame({ view, room, paused, act }: GameProps) {
  const v = view as EstimateView;
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const seconds = useCountdown(paused ? null : v.deadlineAt);
  const name = useNames(room);
  const me = room.me.playerId;
  const participating = v.participants.includes(me);

  // A new round starts with an empty input.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset is keyed on the round number
  useEffect(() => {
    setValue("");
    setError(null);
  }, [v.round]);

  async function send(action: object) {
    const ack = await act({ ...action, round: v.round });
    setError(ack.ok ? null : ack.error);
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return setError("请输入一个数字");
    void send({ type: "submit", value: n });
  }

  return (
    <div className="game">
      <div className="game-head">
        <span className="tag">
          第 {v.round} 轮{v.totalRounds > 0 ? ` / 共 ${v.totalRounds} 轮` : ""}
        </span>
        {v.phase === "answering" && seconds != null && <span className="tag timer">{seconds}s</span>}
      </div>
      <h2 className="question">{v.question.text}</h2>

      {v.phase === "answering" && (
        <>
          {!participating ? (
            <p className="muted">你将从下一轮开始参与，本轮可以先围观。</p>
          ) : v.myGuess != null ? (
            <p className="notice">
              你已提交：<strong>{v.myGuess}</strong> {v.question.unit}，等待其他人…
            </p>
          ) : (
            <form className="answer-row" onSubmit={submit}>
              <input
                inputMode="decimal"
                placeholder={`你的答案（${v.question.unit}）`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                disabled={paused}
              />
              <button type="submit" className="primary" disabled={paused}>
                提交
              </button>
            </form>
          )}
          <Progress ids={v.participants} done={v.submitted} name={name} />
          {room.me.isHost && (
            <div className="host-row">
              <button type="button" onClick={() => send({ type: "reveal" })} disabled={paused}>
                提前揭晓
              </button>
              <button type="button" onClick={() => send({ type: "skip" })} disabled={paused}>
                跳过这题
              </button>
            </div>
          )}
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <>
          <p className="answer">
            答案：<strong>{v.reveal.answer}</strong> {v.question.unit}
            {v.reveal.note && <span className="muted">（{v.reveal.note}）</span>}
          </p>
          <div className="number-line">
            {[...v.reveal.results]
              .sort((x, y) => x.guess - y.guess)
              .flatMap((r, i, all) => {
                const pin = (
                  <span
                    key={r.playerId}
                    className={r.points > 0 ? "pin win" : "pin"}
                    style={{ animationDelay: `${i * 0.3}s` } as CSSProperties}
                  >
                    <Avatar room={room} id={r.playerId} />
                    <b>{r.guess}</b>
                    <span className="small">{name(r.playerId)}</span>
                    <span className="muted small">差 {Number(r.diff.toFixed(3))}</span>
                    {r.points > 0 && <em>+{r.points}</em>}
                  </span>
                );
                const answer = v.reveal?.answer ?? 0;
                const flagHere = r.guess <= answer && (all[i + 1] === undefined || (all[i + 1]?.guess ?? 0) > answer);
                const flag = (
                  <span
                    key="answer"
                    className="pin flag"
                    style={{ animationDelay: `${all.length * 0.3 + 0.3}s` } as CSSProperties}
                  >
                    <span className="flag-mark">🚩</span>
                    <b>{answer}</b>
                    <span className="small">正确答案</span>
                  </span>
                );
                if (i === 0 && r.guess > answer) return [flag, pin];
                return flagHere ? [pin, flag] : [pin];
              })}
            {v.reveal.results.length === 0 && <p className="muted">本轮没有人作答</p>}
          </div>
          <p className="muted small">从小到大排开，离旗子越近越准。</p>
          {room.me.isHost ? (
            <button type="button" className="primary" onClick={() => send({ type: "next" })} disabled={paused}>
              {v.totalRounds > 0 && v.round >= v.totalRounds ? "结束并回到大厅" : "下一轮"}
            </button>
          ) : (
            <p className="muted">等待房主继续…</p>
          )}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
