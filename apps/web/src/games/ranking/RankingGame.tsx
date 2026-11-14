import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "write" | "order" | "reveal" | "finished";
  participants: string[];
  captain: string;
  scenario: { text: string; low: string; high: string };
  myNumber: number | null;
  myAnswer: string | null;
  submitted: string[];
  answers: { playerId: string; text: string }[] | null;
  deadlineAt: number | null;
  reveal: { placed: string[]; numbers: Record<string, number>; slips: number; points: number } | null;
}

export function RankingGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const isCaptain = v.captain === me;
  const writers = v.participants.filter((p) => p !== v.captain);
  const [order, setOrder] = useState<string[]>([]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: start from the presented order each time ordering opens
  useEffect(() => setOrder(v.answers?.map((a) => a.playerId) ?? []), [v.step]);

  const move = (index: number, delta: number) =>
    setOrder((current) => {
      const next = [...current];
      const target = index + delta;
      if (target < 0 || target >= next.length) return current;
      [next[index], next[target]] = [next[target] as string, next[index] as string];
      return next;
    });
  const textOf = (id: string) => v.answers?.find((a) => a.playerId === id)?.text ?? "";

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · 队长：${name(v.captain)}`}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      <h2 className="question">{v.scenario.text}</h2>
      <p className="scale-line">
        <span>1 = {v.scenario.low}</span>
        <span>10 = {v.scenario.high}</span>
      </p>

      {v.phase === "write" && (
        <>
          {v.myNumber != null ? (
            <>
              <p className="notice">
                你的秘密数字是 <strong className="big">{v.myNumber}</strong>。写一个程度相当的回答，不要写出数字。
              </p>
              {v.myAnswer ? (
                <p className="notice">
                  你的回答：<strong>{v.myAnswer}</strong>
                </p>
              ) : (
                <TextForm
                  placeholder="你的回答（最多 40 字）"
                  button="提交"
                  maxLength={40}
                  disabled={paused}
                  resetKey={v.step}
                  onSubmit={(text) => go({ type: "answer", text })}
                />
              )}
            </>
          ) : (
            <p className="muted">{isCaptain ? "你是本轮队长，等大家写完后由你排序。" : "你将从下一轮开始参与。"}</p>
          )}
          <Progress ids={writers} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "order" &&
        (isCaptain ? (
          <>
            <p className="muted">把回答从低（上）到高（下）排好，然后确认。</p>
            <ul className="describe-list">
              {order.map((id, i) => (
                <li key={id}>
                  <span className="who">{name(id)}</span>
                  <span className="text">{textOf(id)}</span>
                  <button type="button" disabled={paused || i === 0} onClick={() => move(i, -1)} aria-label="上移">
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={paused || i === order.length - 1}
                    onClick={() => move(i, 1)}
                    aria-label="下移"
                  >
                    ↓
                  </button>
                </li>
              ))}
            </ul>
            <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "order", order })}>
              确认排序
            </button>
          </>
        ) : (
          <>
            <p className="muted">队长 {name(v.captain)} 正在排序。语音里别报数字。</p>
            <ul className="describe-list">
              {v.answers?.map((a) => (
                <li key={a.playerId}>
                  <span className="who">{name(a.playerId)}</span>
                  <span className="text">{a.text}</span>
                </li>
              ))}
            </ul>
          </>
        ))}

      {v.phase === "reveal" && v.reveal && (
        <>
          <p className="answer">
            {v.reveal.placed.length < 2
              ? "回答不足两个，本轮不计分。"
              : v.reveal.slips === 0
                ? "全部排对！"
                : `排反了 ${v.reveal.slips} 对。`}
            {v.reveal.points > 0 && <strong>　全员 +{v.reveal.points}</strong>}
          </p>
          <ul className="describe-list">
            {v.reveal.placed.map((id, i) => {
              const n = v.reveal?.numbers[id] ?? 0;
              const prev = v.reveal?.placed[i - 1];
              const wrong = prev !== undefined && (v.reveal?.numbers[prev] ?? 0) > n;
              return (
                <li key={id} className={wrong ? "wrong" : ""}>
                  <strong className="big">{n}</strong>
                  <span className="who">{name(id)}</span>
                  <span className="text">{textOf(id)}</span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "write" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始排序
          </button>
        )}
        {v.phase === "order" && !isCaptain && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            队长不在，按当前顺序揭晓
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
