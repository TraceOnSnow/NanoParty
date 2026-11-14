import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface View {
  game: number;
  totalGames: number;
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: string[];
  card: number | null;
  pot: number;
  deckLeft: number;
  current: string;
  cards: Record<string, number[]>;
  myChips: number | null;
  final: { chips: Record<string, number>; scores: Record<string, number> } | null;
  winners: string[];
  deadlineAt: number | null;
}

export function NoThanksGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.phase === "play" && v.current === me;

  return (
    <div className="game">
      <GameHead
        label={`第 ${v.game} 局 / 共 ${v.totalGames} 局 · 牌堆剩 ${v.deckLeft} 张`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      {v.card !== null && v.phase === "play" && (
        <div className="offer">
          <span className="card-face big-card">
            <strong>{v.card}</strong>
          </span>
          <div>
            <p className="answer">
              牌上有 <strong>{v.pot}</strong> 个筹码
            </p>
            <p className="muted">{myTurn ? "轮到你：收下它，还是花一个筹码拒绝？" : `等 ${name(v.current)} 决定…`}</p>
            {myTurn && (
              <div className="host-row">
                <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "take" })}>
                  收下（+{v.pot} 筹码）
                </button>
                <button type="button" disabled={paused || (v.myChips ?? 0) <= 0} onClick={() => go({ type: "pass" })}>
                  不要（−1 筹码）
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {v.myChips !== null && <p className="notice">你手里有 {v.myChips} 个筹码（别人看不到）</p>}
      <table className="results">
        <tbody>
          {v.players.map((p) => (
            <tr
              key={p}
              className={v.winners.includes(p) ? "win" : p === v.current && v.phase === "play" ? "turn-row" : ""}
            >
              <td>{name(p)}</td>
              <td>{[...(v.cards[p] ?? [])].sort((a, b) => a - b).join(" ") || "—"}</td>
              <td className="muted">{v.final ? `筹码 ${v.final.chips[p]} · 总分 ${v.final.scores[p]}` : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {v.phase === "gameOver" && <p className="answer">这一局 {v.winners.map(name).join("、")} 总分最低！</p>}
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
