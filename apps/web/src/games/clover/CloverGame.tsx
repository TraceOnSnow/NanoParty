import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, Progress, useNames } from "../ui.tsx";

type Words = [string, string];
interface View {
  step: number;
  phase: "write" | "solve" | "result" | "finished";
  participants: string[];
  myCards: Words[] | null;
  myClues: string[] | null;
  submitted: string[];
  boardsLeft: number;
  solve: {
    author: string;
    clues: string[];
    tray: { id: number; words: Words }[];
    slots: ({ card: number; flipped: boolean } | null)[];
    locked: boolean[];
    attempt: 1 | 2;
    points: number | null;
    answer: Words[] | null;
  } | null;
  total: number;
  deadlineAt: number | null;
}

const SLOT = [0, 1, 2, 3];

export function CloverGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [clues, setClues] = useState(["", "", "", ""]);
  const [held, setHeld] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: drop the selection when the board changes
  useEffect(() => setHeld(null), [v.step]);
  const s = v.solve;
  const solving = v.phase === "solve" && s !== null && s.author !== me && v.participants.includes(me);
  const wordsOf = (placed: { card: number; flipped: boolean }): Words => {
    const w = s?.tray.find((c) => c.id === placed.card)?.words ?? ["?", "?"];
    return placed.flipped ? [w[1], w[0]] : w;
  };

  return (
    <div className="game">
      <GameHead
        label={`团队累计 ${v.total} 分${v.phase === "write" ? "" : `　还剩 ${v.boardsLeft} 份`}`}
        deadlineAt={v.phase === "write" ? v.deadlineAt : null}
        paused={paused}
      />

      {v.phase === "write" && v.myCards && (
        <>
          <p className="muted">
            你的 4 张卡围成一圈。为每一对「挨着的两个词」写一条提示（一个词，不能用卡上的词）。别让队友看到你的屏幕。
          </p>
          {v.myClues ? (
            <p className="notice">已提交：{v.myClues.join(" ／ ")}</p>
          ) : (
            <form
              className="card"
              onSubmit={(e) => {
                e.preventDefault();
                if (clues.every((c) => c.trim())) go({ type: "clues", clues: clues.map((c) => c.trim()) });
              }}
            >
              {SLOT.map((k) => (
                <label key={k} className="answer-row">
                  <span className="pair">
                    {v.myCards?.[k]?.[1]} ＋ {v.myCards?.[(k + 1) % 4]?.[0]}
                  </span>
                  <input
                    value={clues[k]}
                    maxLength={12}
                    placeholder="提示"
                    onChange={(e) => setClues((c) => c.map((x, i) => (i === k ? e.target.value : x)))}
                  />
                </label>
              ))}
              <button type="submit" className="primary" disabled={paused}>
                提交四条提示
              </button>
            </form>
          )}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {s && v.phase !== "write" && (
        <>
          <p className="muted">
            <strong>{name(s.author)}</strong> 的四叶
            {v.phase === "solve" &&
              (s.author === me
                ? "：队友正在还原，你不能提示。"
                : `：第 ${s.attempt} 次尝试。先点下面的卡，再点一个位置放上去；点位置上的卡可以调转方向。`)}
          </p>
          <div className="clover-ring">
            {SLOT.map((k) => {
              const placed = s.slots[k];
              return (
                <div key={k} className="clover-step">
                  <button
                    type="button"
                    className={`clover-slot${s.locked[k] ? " locked" : ""}`}
                    disabled={!solving || paused || s.locked[k]}
                    onClick={() => {
                      if (held !== null) {
                        go({ type: "place", slot: k, card: held, flipped: false });
                        setHeld(null);
                      } else if (placed) go({ type: "place", slot: k, card: placed.card, flipped: !placed.flipped });
                    }}
                  >
                    {placed ? wordsOf(placed).join(" ｜ ") : `位置 ${k + 1}`}
                  </button>
                  <span className="clover-clue">
                    ↕ {s.clues[k]}
                    {k === 3 && "（连回位置 1）"}
                  </span>
                </div>
              );
            })}
          </div>
          {v.phase === "solve" && (
            <div className="hand">
              {s.tray
                .filter((c) => !s.slots.some((x) => x?.card === c.id))
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={held === c.id ? "primary" : ""}
                    disabled={!solving || paused}
                    onClick={() => setHeld(held === c.id ? null : c.id)}
                  >
                    {c.words.join(" ｜ ")}
                  </button>
                ))}
            </div>
          )}
          {solving && (
            <div className="host-row">
              <button
                type="button"
                className="primary"
                disabled={paused || s.slots.some((x) => x === null)}
                onClick={() => go({ type: "submit" })}
              >
                提交摆法
              </button>
              {SLOT.filter((k) => s.slots[k] && !s.locked[k]).length > 0 && (
                <button
                  type="button"
                  disabled={paused}
                  onClick={() => {
                    const k = SLOT.find((i) => s.slots[i] && !s.locked[i]);
                    if (k !== undefined) go({ type: "place", slot: k, card: null });
                  }}
                >
                  拿回一张
                </button>
              )}
            </div>
          )}
          {v.phase === "result" && s.answer && (
            <p className="notice">
              得 <strong>{s.points}</strong> 分。正确摆法：{s.answer.map((w) => w.join("｜")).join(" → ")}
            </p>
          )}
        </>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "result" ? "等待房主继续…" : undefined}>
        {v.phase === "write" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始还原
          </button>
        )}
        {v.phase === "result" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "advance" })}>
            {v.boardsLeft === 0 ? "结束并回到大厅" : "下一份"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
