import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface View {
  game: number;
  totalGames: number;
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: string[];
  table: Record<string, number | null>;
  current: string;
  last: { playerId: string; card: number; knocked: string[] } | null;
  winner: string | null;
  myHand: number[];
  handSizes: Record<string, number>;
  drawLeft: number;
  deadlineAt: number | null;
}

export function FlushGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.phase === "play" && v.current === me;

  return (
    <div className="game">
      <GameHead
        label={`第 ${v.game} 局 · 摸牌堆剩 ${v.drawLeft} 张`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      <table className="results">
        <tbody>
          {v.players.map((p) => (
            <tr key={p} className={p === v.current && v.phase === "play" ? "turn-row" : p === v.winner ? "win" : ""}>
              <td>{name(p)}</td>
              <td className="muted">手牌 {v.handSizes[p]}</td>
              <td>
                {v.table[p] != null ? (
                  <span className="card-face">
                    <strong>{v.table[p]}</strong>
                  </span>
                ) : (
                  <span className="muted">—</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {v.last && (
        <p className="muted small">
          {name(v.last.playerId)} 打出 {v.last.card}
          {v.last.knocked.length > 0 ? `，压掉了 ${v.last.knocked.map(name).join("、")}（各摸一张）` : ""}
        </p>
      )}
      {v.phase === "play" && (
        <>
          <p className="muted">{myTurn ? "轮到你：打一张牌到面前。" : `等 ${name(v.current)} 出牌…`}</p>
          <div className="hand">
            {v.myHand.map((c, i) => (
              <button
                // biome-ignore lint/suspicious/noArrayIndexKey: duplicate values are allowed
                key={i}
                type="button"
                className="card-face"
                disabled={!myTurn || paused}
                onClick={() => go({ type: "play", card: c })}
              >
                <strong>{c}</strong>
              </button>
            ))}
          </div>
        </>
      )}
      {v.phase === "gameOver" && v.winner && <p className="answer">{name(v.winner)} 最先出清手牌！</p>}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "gameOver" ? "等待房主继续…" : undefined}>
        {v.phase === "gameOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.game >= v.totalGames ? "结束并回到大厅" : "下一局"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
