import { type FormEvent, useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useCountdown } from "../shared.ts";

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
  const name = (id: string) => room.members.find((m) => m.id === id)?.nickname ?? "?";
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
          <ul className="chips">
            {v.participants.map((id) => (
              <li key={id} className={v.submitted.includes(id) ? "chip done" : "chip"}>
                {name(id)} {v.submitted.includes(id) ? "✓" : "…"}
              </li>
            ))}
          </ul>
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
          <table className="results">
            <tbody>
              {v.reveal.results.map((r) => (
                <tr key={r.playerId} className={r.points > 0 ? "win" : ""}>
                  <td>{name(r.playerId)}</td>
                  <td>{r.guess}</td>
                  <td className="muted">差 {Number(r.diff.toFixed(3))}</td>
                  <td>{r.points > 0 ? `+${r.points}` : ""}</td>
                </tr>
              ))}
              {v.reveal.results.length === 0 && (
                <tr>
                  <td className="muted">本轮没有人作答</td>
                </tr>
              )}
            </tbody>
          </table>
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
