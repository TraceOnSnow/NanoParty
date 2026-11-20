import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface Event {
  by: string;
  number: number;
  hit: boolean;
  roll?: number;
}
interface View {
  round: number;
  step: number;
  phase: "play" | "roundOver" | "gameOver" | "finished";
  target: number;
  players: string[];
  current: string;
  life: Record<string, number>;
  hands: Record<string, number[]>;
  myCount: number | null;
  supplyLeft: number;
  secretLeft: number;
  myTaken: number[];
  takenCount: Record<string, number>;
  board: Record<string, number>;
  floor: number;
  casts: number;
  points: Record<string, number>;
  gained: Record<string, number> | null;
  roundWinner: string | null;
  log: Event[];
  winners: string[];
  deadlineAt: number | null;
}

const SPELLS: { n: number; name: string; text: string }[] = [
  { n: 1, name: "古龙", text: "掷骰（1–3），其他人各掉这么多" },
  { n: 2, name: "夜行者", text: "其他人各掉 1，你回 1" },
  { n: 3, name: "美梦", text: "掷骰（1–3），你回这么多" },
  { n: 4, name: "夜莺", text: "拿一块秘密石，只有你知道是几" },
  { n: 5, name: "雷暴", text: "上家和下家各掉 1" },
  { n: 6, name: "暴雪", text: "下家掉 1" },
  { n: 7, name: "火球", text: "上家掉 1" },
  { n: 8, name: "药水", text: "你回 1" },
];
const spellName = (n: number) => SPELLS[n - 1]?.name ?? "";

export function SpellGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const live = v.phase === "play";
  const over = v.phase === "roundOver" || v.phase === "gameOver";
  const myTurn = live && v.current === me && !paused;
  // What the viewer can count: stones on the board plus everyone else's.
  const seen = (n: number) =>
    (v.board[n] ?? 0) +
    Object.entries(v.hands).reduce((sum, [p, hand]) => sum + (p === me ? 0 : hand.filter((x) => x === n).length), 0) +
    v.myTaken.filter((x) => x === n).length;

  const line = (e: Event) =>
    e.hit
      ? `${name(e.by)} 喊 ${e.number}「${spellName(e.number)}」——中了！${e.roll ? `骰子 ${e.roll}。` : ""}`
      : `${name(e.by)} 喊 ${e.number}「${spellName(e.number)}」——没有这块石头，掉 ${e.roll ?? 1} 点生命。`;

  return (
    <div className="game wide spell">
      <GameHead
        label={`第 ${v.round} 轮 · 先到 ${v.target} 分`}
        deadlineAt={live ? v.deadlineAt : null}
        paused={paused}
      />

      <Seats
        room={room}
        ids={v.players}
        current={live ? v.current : null}
        out={v.players.filter((p) => (v.life[p] ?? 0) <= 0)}
        win={v.winners.length ? v.winners : v.roundWinner ? [v.roundWinner] : []}
        note={(p) => (
          <span className="tag">
            ♥ {v.life[p] ?? 0} · {v.points[p] ?? 0} 分{over && v.gained ? `（+${v.gained[p] ?? 0}）` : ""}
            {(v.takenCount[p] ?? 0) > 0 ? ` · 秘密石 ${v.takenCount[p]}` : ""}
          </span>
        )}
      >
        {(p) =>
          v.hands[p] ? (
            v.hands[p].length === 0 ? (
              <span className="muted small">石头喊完了</span>
            ) : (
              [...v.hands[p]]
                .sort((a, b) => a - b)
                .map((n, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: identical stones
                  <span key={i} className="stone">
                    {n}
                  </span>
                ))
            )
          ) : (
            Array.from({ length: v.myCount ?? 0 }, (_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: identical hidden stones
              <span key={i} className="stone hidden" title="你自己的石头，只有别人看得到">
                ?
              </span>
            ))
          )
        }
      </Seats>

      <div className="spell-book">
        {SPELLS.map((s) => {
          const allowed = myTurn && s.n >= v.floor;
          const left = s.n - seen(s.n);
          return (
            <button
              key={s.n}
              type="button"
              className={`spell-row${allowed ? "" : " off"}`}
              disabled={!allowed}
              onClick={() => go({ type: "cast", number: s.n })}
            >
              <strong>{s.n}</strong>
              <span className="spell-name">{s.name}</span>
              <span className="spell-text">{s.text}</span>
              <span className="spell-count" title="共几块 / 你还没看到的有几块">
                共 {s.n} 块 · 你没见到 {left}
              </span>
            </button>
          );
        })}
      </div>
      {live && (
        <p className="muted">
          {myTurn
            ? v.casts > 0
              ? `中了 ${v.casts} 次。可以接着喊 ${v.floor} 或更大的数字，或者收手。`
              : "轮到你：点一条咒语喊出它的数字。你面前有这块石头就生效，没有就掉血。"
            : `等 ${name(v.current)} 念咒…`}
          {myTurn && v.casts > 0 && (
            <>
              {" "}
              <button type="button" onClick={() => go({ type: "end" })}>
                收手（补满石头）
              </button>
            </>
          )}
        </p>
      )}
      <p className="muted small">
        「你没见到」= 这个数字的总数减去桌面上和别人面前你能看到的：剩下的要么在你面前，要么在牌堆（{v.supplyLeft}{" "}
        块）或秘密石（
        {v.secretLeft} 块）里。
        {v.myTaken.length > 0 && ` 你拿到的秘密石：${v.myTaken.join("、")}。`}
      </p>

      <div className="spell-board">
        <span className="muted small">已经用掉、摆在桌面上的：</span>
        {SPELLS.map((s) => (
          <span key={s.n} className={`stone${(v.board[s.n] ?? 0) === 0 ? " none" : ""}`}>
            {s.n}
            <em>×{v.board[s.n] ?? 0}</em>
          </span>
        ))}
      </div>
      <ul className="flip-log">
        {[...v.log]
          .reverse()
          .slice(0, 4)
          .map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a short rolling log
            <li key={i} className={i === 0 ? "" : "muted small"}>
              {line(e)}
            </li>
          ))}
      </ul>
      {v.phase === "roundOver" && (
        <p className="answer">
          这一轮结束{v.roundWinner ? `：${name(v.roundWinner)} 拿下这一轮（+3）。` : "：活着的人各得 1 分。"}
        </p>
      )}
      {v.phase === "gameOver" && (
        <p className="answer">
          {v.winners.map(name).join("、")} 先到 {v.target} 分，赢了！
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={over ? "等待房主继续…" : undefined}>
        {over && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.phase === "gameOver" ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
