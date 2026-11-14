import { type FormEvent, useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "guess" | "bet" | "reveal" | "finished";
  participants: string[];
  question: { text: string; unit: string };
  submitted: string[];
  myGuess: number | null;
  guesses: { playerId: string; value: number }[] | null;
  myBet: string | null;
  deadlineAt: number | null;
  reveal: { answer: number; note?: string; closest: string[]; bets: Record<string, string> } | null;
}

export function WagerGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, setError, send } = useAct(act);
  const [value, setValue] = useState("");
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.participants.includes(me);

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the field each round
  useEffect(() => setValue(""), [v.round]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const n = Number(value);
    if (value.trim() === "" || !Number.isFinite(n)) return setError("请输入一个数字");
    void go({ type: "guess", value: n });
  }

  return (
    <div className="game">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      <h2 className="question">{v.question.text}</h2>
      {!playing && v.phase !== "reveal" && <p className="muted">你将从下一轮开始参与。</p>}

      {v.phase === "guess" && (
        <>
          {playing &&
            (v.myGuess != null ? (
              <p className="notice">
                你估的是 <strong>{v.myGuess}</strong> {v.question.unit}，等待其他人…
              </p>
            ) : (
              <form className="answer-row" onSubmit={submit}>
                <input
                  inputMode="decimal"
                  placeholder={`你的估计（${v.question.unit}）`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  disabled={paused}
                />
                <button type="submit" className="primary" disabled={paused}>
                  提交
                </button>
              </form>
            ))}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <p className="answer">
          答案：<strong>{v.reveal.answer}</strong> {v.question.unit}
          {v.reveal.note && <span className="muted">（{v.reveal.note}）</span>}
        </p>
      )}

      {(v.phase === "bet" || v.phase === "reveal") && v.guesses && (
        <>
          {v.phase === "bet" && <p className="muted">所有估计已公开。押一个你认为最接近答案的（可以押自己）。</p>}
          <ul className="describe-list">
            {v.guesses.map((g) => {
              const backers = Object.entries(v.reveal?.bets ?? {})
                .filter(([, on]) => on === g.playerId)
                .map(([p]) => p);
              return (
                <li
                  key={g.playerId}
                  className={v.reveal?.closest.includes(g.playerId) || v.myBet === g.playerId ? "picked" : ""}
                >
                  <span className="who">{name(g.playerId)}</span>
                  <span className="text">
                    <strong>{g.value}</strong> {v.question.unit}
                    {v.reveal && (
                      <>
                        <br />
                        <span className="muted small">
                          {backers.length > 0 ? `${backers.map(name).join("、")} 押了 TA` : "没人押"}
                        </span>
                      </>
                    )}
                  </span>
                  {v.phase === "bet" && playing && v.myBet == null && (
                    <button type="button" disabled={paused} onClick={() => go({ type: "bet", on: g.playerId })}>
                      押 TA
                    </button>
                  )}
                  {v.myBet === g.playerId && <span className="tag">已押</span>}
                  {v.reveal?.closest.includes(g.playerId) && <span className="tag">最接近</span>}
                </li>
              );
            })}
          </ul>
          {v.phase === "bet" && <Progress ids={v.participants} done={v.submitted} name={name} />}
        </>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "guess" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始下注
          </button>
        )}
        {v.phase === "bet" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            提前揭晓
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
