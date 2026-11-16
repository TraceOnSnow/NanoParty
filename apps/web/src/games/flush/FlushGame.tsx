import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { CardBack, Felt, PlayHand, Seats } from "../table.tsx";
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

const Face = ({ value, className = "" }: { value: number; className?: string }) => (
  <span className={`card-face ${className}`}>
    <strong>{value}</strong>
  </span>
);

/** Strength of every card on the table: its number times how many equal cards lie there. */
function strengths(table: Record<string, number | null>): Record<string, number> {
  const values = Object.values(table).filter((c): c is number => c != null);
  return Object.fromEntries(
    Object.entries(table).map(([p, c]) => [p, c == null ? 0 : c * values.filter((x) => x === c).length]),
  );
}

export function FlushGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.phase === "play" && v.current === me && !paused;
  const [aim, setAim] = useState<number | null>(null);
  const now = strengths(v.table);
  // What the table would look like after my card: display only, the server decides.
  const after = aim !== null && myTurn ? strengths({ ...v.table, [me]: aim }) : null;
  const knocked = after
    ? v.players.filter((p) => p !== me && v.table[p] != null && (after[p] ?? 0) < (after[me] ?? 0))
    : [];
  const sorted = [...v.myHand].sort((a, b) => a - b);

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.game} 局 / 共 ${v.totalGames} 局`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      <Felt>
        <Seats
          room={room}
          ids={v.players}
          current={v.phase === "play" ? v.current : null}
          win={v.winner ? [v.winner] : []}
          note={(p) => <span className="tag">手牌 {v.handSizes[p]}</span>}
        >
          {(p) =>
            v.table[p] != null ? (
              <>
                <Face value={v.table[p] as number} className={knocked.includes(p) ? "doomed" : ""} />
                <span className="strength">
                  强度 {now[p]}
                  {knocked.includes(p) ? " · 会被压掉" : ""}
                </span>
              </>
            ) : (
              <>
                <span className="card-face empty" />
                <span className="strength muted">面前没牌</span>
              </>
            )
          }
        </Seats>
        <p className="felt-note">
          <CardBack count={v.drawLeft} label="摸牌堆" />
          <span>
            强度 = 点数 × 桌上同点数的张数。打出的牌会压掉所有强度更低的牌，被压的人摸一张。先把手牌和面前都清空的人赢。
          </span>
        </p>
      </Felt>
      {v.last && (
        <p className="muted small">
          {name(v.last.playerId)} 打出 {v.last.card}
          {v.last.knocked.length > 0 ? `，压掉了 ${v.last.knocked.map(name).join("、")}（各摸一张）` : "，没压到人"}
        </p>
      )}
      {v.phase === "play" && (
        <>
          <p className="muted">
            {v.current === me
              ? after
                ? `打 ${aim}：强度 ${after[me]}，${knocked.length > 0 ? `压掉 ${knocked.map(name).join("、")}` : "压不到人"}。`
                : `轮到你${v.table[me] != null ? "（面前那张撑过一圈，先弃掉）" : ""}：点一张看效果，或者直接拖到桌上。`
              : `等 ${name(v.current)} 出牌…`}
          </p>
          <PlayHand
            cards={sorted}
            face={(c) => <Face value={c} />}
            enabled={myTurn}
            confirm={(c) => `打出 ${c}`}
            onSelect={(c) => setAim(c)}
            onPlay={(c) => void go({ type: "play", card: c })}
            resetKey={v.step}
          />
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
