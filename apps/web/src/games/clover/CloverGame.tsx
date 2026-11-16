import { type ReactNode, type PointerEvent as ReactPointerEvent, useEffect, useState } from "react";
import { Who } from "../../components/Avatar.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, Progress, useNames } from "../ui.tsx";

type Words = [string, string];
interface Placed {
  card: number;
  flipped: boolean;
}
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
    slots: (Placed | null)[];
    locked: boolean[];
    attempt: 1 | 2;
    points: number | null;
    answer: Words[] | null;
  } | null;
  total: number;
  deadlineAt: number | null;
}

const SLOT = [0, 1, 2, 3];
/** Where the four cards and the four clues sit on a 3×3 board, clockwise from the top left. */
const CARD_CELL = ["1 / 1", "1 / 3", "3 / 3", "3 / 1"];
const CLUE_CELL = ["1 / 2", "2 / 3", "3 / 2", "2 / 1"];
/** The edge each of a card's two words is written on, so that it faces the clue it belongs to. */
const EDGES: [string, string][] = [
  ["bottom", "right"],
  ["left", "bottom"],
  ["top", "left"],
  ["right", "top"],
];

/**
 * A card on the board: its two words sit on the edges that touch the neighbouring clues, and
 * each word carries the colour of the clue it faces (`to-<clue>`).
 */
function BoardCard({ words, slot, className = "" }: { words: Words; slot: number; className?: string }) {
  const [a, b] = EDGES[slot] as [string, string];
  return (
    <span className={`clover-card on-board ${className}`}>
      <span className={`edge ${a} to-${(slot + 3) % 4}`}>{words[0]}</span>
      <span className={`edge ${b} to-${slot}`}>{words[1]}</span>
    </span>
  );
}

interface Drag {
  card: number;
  x: number;
  y: number;
  words: Words;
}

export function CloverGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [clues, setClues] = useState(["", "", "", ""]);
  const [held, setHeld] = useState<number | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: drop the selection when the board changes
  useEffect(() => setHeld(null), [v.step]);
  const s = v.solve;
  const solving = v.phase === "solve" && s !== null && s.author !== me && v.participants.includes(me) && !paused;
  const trayWords = (id: number): Words => s?.tray.find((c) => c.id === id)?.words ?? ["?", "?"];
  const wordsOf = (placed: Placed): Words => {
    const w = trayWords(placed.card);
    return placed.flipped ? [w[1], w[0]] : w;
  };
  const slotOf = (card: number) => s?.slots.findIndex((x) => x?.card === card) ?? -1;

  const place = (slot: number, card: number) => {
    const from = slotOf(card);
    return go({ type: "place", slot, card, flipped: from >= 0 ? (s?.slots[from]?.flipped ?? false) : false });
  };
  const takeBack = (card: number) => {
    const from = slotOf(card);
    if (from >= 0) void go({ type: "place", slot: from, card: null });
  };
  const flip = (slot: number) => {
    const placed = s?.slots[slot];
    if (placed) void go({ type: "place", slot, card: placed.card, flipped: !placed.flipped });
  };

  /** Press and move to drag a card; press and release in place counts as a tap. */
  const grab = (card: number, onTap: () => void) => (e: ReactPointerEvent) => {
    if (!solving) return;
    e.preventDefault();
    const start = { x: e.clientX, y: e.clientY };
    const words = slotOf(card) >= 0 ? wordsOf(s?.slots[slotOf(card)] as Placed) : trayWords(card);
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
      moved = true;
      setDrag({ card, x: ev.clientX, y: ev.clientY, words });
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener("pointermove", move);
      setDrag(null);
      if (!moved) return onTap();
      const target = document
        .elementFromPoint(ev.clientX, ev.clientY)
        ?.closest("[data-drop]")
        ?.getAttribute("data-drop");
      if (target === "tray") takeBack(card);
      else if (target?.startsWith("slot:")) void place(Number(target.slice(5)), card);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };

  const board = (cell: (k: number) => ReactNode, clue: (k: number) => ReactNode, centre: ReactNode) => (
    <div className="clover-board">
      {SLOT.map((k) => (
        <div key={`c${k}`} className="clover-cell" style={{ gridArea: CARD_CELL[k] }}>
          {cell(k)}
        </div>
      ))}
      {SLOT.map((k) => (
        <div key={`q${k}`} className={`clover-clue side-${k}`} style={{ gridArea: CLUE_CELL[k] }}>
          {clue(k)}
        </div>
      ))}
      <div className="clover-centre">{centre}</div>
    </div>
  );

  return (
    <div className="game clover">
      <GameHead
        label={`团队累计 ${v.total} 分${v.phase === "write" ? "" : `　还剩 ${v.boardsLeft} 份`}`}
        deadlineAt={v.phase === "write" ? v.deadlineAt : null}
        paused={paused}
      />

      {v.phase === "write" && v.myCards && (
        <>
          <p className="muted">
            这是你的四叶。每个提示格两边各挨着一个同色的词，写一个能同时指向这两个词的提示（不能用卡上的词）。别让队友看到你的屏幕。
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!v.myClues && clues.every((c) => c.trim())) go({ type: "clues", clues: clues.map((c) => c.trim()) });
            }}
          >
            {board(
              (k) => (
                <BoardCard words={v.myCards?.[k] ?? ["?", "?"]} slot={k} />
              ),
              (k) =>
                v.myClues ? (
                  <strong>{v.myClues[k]}</strong>
                ) : (
                  <input
                    value={clues[k]}
                    maxLength={12}
                    placeholder="提示"
                    onChange={(e) => setClues((c) => c.map((x, i) => (i === k ? e.target.value : x)))}
                  />
                ),
              "🍀",
            )}
            {v.myClues ? (
              <p className="notice">已提交，等其他人写完。</p>
            ) : (
              <button type="submit" className="primary wide" disabled={paused || !clues.every((c) => c.trim())}>
                提交四条提示
              </button>
            )}
          </form>
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {s && v.phase !== "write" && (
        <>
          <p className="muted">
            <Who room={room} id={s.author} /> 的四叶
            {v.phase === "solve" &&
              (s.author === me
                ? "：队友正在还原，你不能提示。"
                : `：第 ${s.attempt} 次尝试。把卡拖到位置上，点一下卡可以调转方向；每条提示要同时对上两边同色的词。`)}
          </p>
          {board(
            (k) => {
              const placed = s.slots[k];
              const answer = v.phase === "result" ? s.answer?.[k] : undefined;
              if (answer) return <BoardCard words={answer} slot={k} className="answer" />;
              return (
                <button
                  type="button"
                  data-drop={`slot:${k}`}
                  className={`clover-slot${s.locked[k] ? " locked" : ""}${drag ? " target" : ""}${placed ? " filled" : ""}`}
                  disabled={!solving || s.locked[k]}
                  onPointerDown={placed && !s.locked[k] ? grab(placed.card, () => flip(k)) : undefined}
                  onClick={() => {
                    if (!placed && held !== null) {
                      void place(k, held);
                      setHeld(null);
                    }
                  }}
                >
                  {placed ? (
                    <BoardCard
                      words={wordsOf(placed)}
                      slot={k}
                      className={drag?.card === placed.card ? "lifted" : ""}
                    />
                  ) : (
                    <span className="muted">{held !== null ? "放这里" : "拖一张卡到这里"}</span>
                  )}
                  {s.locked[k] && <span className="lock">✓ 放对了</span>}
                </button>
              );
            },
            (k) => (
              <strong>{s.clues[k]}</strong>
            ),
            v.phase === "result" ? <span className="clover-points">+{s.points}</span> : "🍀",
          )}

          {v.phase === "solve" && (
            <div className={`clover-tray${drag ? " target" : ""}`} data-drop="tray">
              {s.tray
                .filter((c) => slotOf(c.id) < 0)
                .map((c) => (
                  <button
                    key={c.id}
                    type="button"
                    className={`clover-card in-tray${held === c.id ? " held" : ""}${drag?.card === c.id ? " lifted" : ""}`}
                    disabled={!solving}
                    onPointerDown={grab(c.id, () => setHeld(held === c.id ? null : c.id))}
                  >
                    <span>{c.words[0]}</span>
                    <span>{c.words[1]}</span>
                  </button>
                ))}
              {s.tray.every((c) => slotOf(c.id) >= 0) && <span className="muted">卡都摆上去了</span>}
            </div>
          )}
          {solving && (
            <button
              type="button"
              className="primary wide"
              disabled={s.slots.some((x) => x === null)}
              onClick={() => go({ type: "submit" })}
            >
              {s.slots.some((x) => x === null) ? "四个位置都要放上卡" : "提交摆法"}
            </button>
          )}
          {v.phase === "result" && <p className="notice">上面是正确的摆法，这一份得 {s.points} 分。</p>}
        </>
      )}

      {drag && (
        <span className="clover-card ghost" style={{ left: drag.x, top: drag.y }}>
          <span>{drag.words[0]}</span>
          <span>{drag.words[1]}</span>
        </span>
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
