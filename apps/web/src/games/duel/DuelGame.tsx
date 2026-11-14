import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, useNames } from "../ui.tsx";

// Mirrors CARDS in @apr/games (display only).
const CARDS: Record<number, { name: string; text: string }> = {
  1: { name: "侦察", text: "猜中别人的点数，TA 出局" },
  2: { name: "窥探", text: "偷看一人手牌" },
  3: { name: "比拼", text: "私下比点数，小的出局" },
  4: { name: "护盾", text: "到你下回合前不受影响" },
  5: { name: "弃牌令", text: "让一人弃牌重摸" },
  6: { name: "交换", text: "和一人交换手牌" },
  7: { name: "顾问", text: "有 5 或 6 时必须打出" },
  8: { name: "王牌", text: "打出或被弃就出局" },
};
const NEEDS_TARGET = [1, 2, 3, 5, 6];

interface Log {
  by: string;
  card: number;
  target: string | null;
  guess: number | null;
  out: string[];
  discarded: number | null;
}
interface View {
  round: number;
  tokensToWin: number;
  step: number;
  phase: "play" | "roundOver" | "finished";
  players: string[];
  alive: string[];
  myHand: number[];
  deckLeft: number;
  discards: Record<string, number[]>;
  shielded: string[];
  current: string;
  log: Log[];
  mySeen: { about: string; card: number }[];
  tokens: Record<string, number>;
  roundWinners: string[];
  showdown: Record<string, number> | null;
  champion: string | null;
  deadlineAt: number | null;
}

export function DuelGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [card, setCard] = useState<number | null>(null);
  const [guess, setGuess] = useState(2);
  const myTurn = v.phase === "play" && v.current === me;
  const targets = card === null ? [] : v.alive.filter((p) => (card === 5 || p !== me) && !v.shielded.includes(p));
  const describe = (l: Log) =>
    `${name(l.by)} 打出 ${l.card}「${CARDS[l.card]?.name}」${l.target ? ` → ${name(l.target)}` : ""}${l.guess ? `（猜 ${l.guess}）` : ""}${l.discarded ? `，弃掉了 ${l.discarded}` : ""}${l.out.length ? `，${l.out.map(name).join("、")} 出局` : ""}`;

  function playSelected(target?: string) {
    if (card === null) return;
    void go({ type: "play", card, target, guess: card === 1 ? guess : undefined }).then((ok) => ok && setCard(null));
  }

  return (
    <div className="game">
      <GameHead
        label={`第 ${v.round} 轮 · 赢 ${v.tokensToWin} 轮获胜 · 牌堆剩 ${v.deckLeft}`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      <table className="results">
        <tbody>
          {v.players.map((p) => (
            <tr
              key={p}
              className={!v.alive.includes(p) ? "out-row" : p === v.current && v.phase === "play" ? "turn-row" : ""}
            >
              <td>
                {name(p)} {"♦".repeat(v.tokens[p] ?? 0)}
                {v.shielded.includes(p) ? " 🛡" : ""}
              </td>
              <td className="muted">弃牌：{(v.discards[p] ?? []).join(" ") || "—"}</td>
              <td>{v.showdown?.[p] ?? ""}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {v.myHand.length > 0 && (
        <div className="hand">
          {v.myHand.map((c, i) => (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: two equal cards are possible
              key={i}
              type="button"
              className={`card-face duel-card${card === c ? " selected" : ""}`}
              disabled={!myTurn || paused}
              onClick={() => setCard(c)}
            >
              <strong>{c}</strong>
              <span>{CARDS[c]?.name}</span>
            </button>
          ))}
        </div>
      )}
      {myTurn && card === null && <p className="muted">轮到你：选一张要打出的牌。</p>}
      {myTurn && card !== null && (
        <div className="card">
          <p>
            {card}「{CARDS[card]?.name}」：{CARDS[card]?.text}
          </p>
          {card === 1 && (
            <label className="answer-row">
              猜点数
              <input type="number" min={2} max={8} value={guess} onChange={(e) => setGuess(Number(e.target.value))} />
            </label>
          )}
          {NEEDS_TARGET.includes(card) && targets.length > 0 ? (
            <div className="host-row">
              {targets.map((p) => (
                <button key={p} type="button" className="primary" disabled={paused} onClick={() => playSelected(p)}>
                  对 {p === me ? "自己" : name(p)} 打出
                </button>
              ))}
            </div>
          ) : (
            <button type="button" className="primary" disabled={paused} onClick={() => playSelected()}>
              打出{NEEDS_TARGET.includes(card) ? "（没有可指定的人，无效果）" : ""}
            </button>
          )}
        </div>
      )}
      {!myTurn && v.phase === "play" && <p className="muted">等 {name(v.current)}…</p>}
      {v.mySeen.length > 0 && (
        <p className="notice">你知道：{v.mySeen.map((s) => `${name(s.about)} 拿着 ${s.card}`).join("；")}</p>
      )}
      <ul className="describe-list">
        {[...v.log]
          .reverse()
          .slice(0, 6)
          .map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: log is append-only
            <li key={i} className="muted small">
              {describe(l)}
            </li>
          ))}
      </ul>
      {v.phase === "roundOver" && (
        <p className="answer">
          本轮 {v.roundWinners.map(name).join("、")} 获胜{v.champion ? `，${name(v.champion)} 赢得对决！` : ""}
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "roundOver" ? "等待房主继续…" : undefined}>
        {v.phase === "roundOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.champion ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
