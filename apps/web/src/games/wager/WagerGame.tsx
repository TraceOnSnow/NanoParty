import { type FormEvent, useEffect, useState } from "react";
import { Avatar, Who } from "../../components/Avatar.tsx";
import { useDragDrop } from "../drag.tsx";
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
  const [pick, setPick] = useState<string | null>(null);
  const canBet = v.phase === "bet" && playing && v.myBet == null && !paused;
  const { dragging, grab, ghost } = useDragDrop<string>((_, target) => setPick(target));

  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the field each round
  useEffect(() => {
    setValue("");
    setPick(null);
  }, [v.round]);

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
          <div className="bet-mat">
            {[...v.guesses]
              .sort((x, y) => x.value - y.value)
              .map((g) => {
                const backers = Object.entries(v.reveal?.bets ?? {})
                  .filter(([, on]) => on === g.playerId)
                  .map(([p]) => p);
                const closest = v.reveal?.closest.includes(g.playerId);
                const mine = (v.myBet ?? pick) === g.playerId;
                return (
                  <button
                    key={g.playerId}
                    type="button"
                    data-drop={g.playerId}
                    className={`bet-card${closest ? " closest" : ""}${mine ? " picked" : ""}${dragging ? " target" : ""}`}
                    disabled={!canBet}
                    onClick={() => setPick(pick === g.playerId ? null : g.playerId)}
                  >
                    <Who room={room} id={g.playerId} />
                    <strong>{g.value}</strong>
                    <span className="muted small">{v.question.unit}</span>
                    <span className="bet-chips">
                      {mine && !v.reveal && <Avatar room={room} id={me} size="s" />}
                      {backers.map((p) => (
                        <Avatar key={p} room={room} id={p} size="s" />
                      ))}
                    </span>
                    {closest && <span className="stamp ok">最接近</span>}
                  </button>
                );
              })}
          </div>
          {canBet && (
            <div className="bet-hand">
              <button
                type="button"
                className="bet-chip"
                onPointerDown={grab(me, <Avatar room={room} id={me} size="l" />)}
              >
                <Avatar room={room} id={me} size="l" />
              </button>
              <span className="muted small">把你的筹码拖到一个估计上，或者直接点那张卡。</span>
              <button
                type="button"
                className="primary"
                disabled={pick === null}
                onClick={() => pick && go({ type: "bet", on: pick })}
              >
                {pick ? `押 ${name(pick)}` : "先选一个"}
              </button>
            </div>
          )}
          {v.phase === "bet" && playing && v.myBet != null && <p className="notice">已下注，等其他人…</p>}
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
      {ghost}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
