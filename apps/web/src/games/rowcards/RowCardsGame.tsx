import { useState } from "react";
import { Avatar, Who } from "../../components/Avatar.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { CardBack, Felt, PlayHand } from "../table.tsx";
import { GameHead, HostControls, Progress, useNames } from "../ui.tsx";

interface Placement {
  playerId: string;
  card: number;
  row: number;
  took: number[] | null;
}

interface View {
  hand: number;
  totalHands: number;
  trick: number;
  step: number;
  phase: "choose" | "handOver" | "finished";
  players: string[];
  rows: number[][];
  myHand: number[];
  myCard: number | null;
  submitted: string[];
  penalties: Record<string, number>;
  lastTrick: Placement[];
  winners: string[];
  deadlineAt: number | null;
}

// Mirrors penaltyOf in @apr/games (display only; the server does the scoring).
const penaltyOf = (card: number) => (card % 11 === 0 ? 5 : card % 10 === 0 ? 3 : card % 5 === 0 ? 2 : 1);

function Card({ value, selected }: { value: number; selected?: boolean }) {
  const penalty = penaltyOf(value);
  return (
    <span className={`card-face p${penalty}${selected ? " selected" : ""}`}>
      <strong>{value}</strong>
      <span>{"●".repeat(penalty)}</span>
    </span>
  );
}

const ROW_LIMIT = 5;
const rowPenalty = (row: number[]) => row.reduce((s, c) => s + penaltyOf(c), 0);

/** Where a card would land if it were placed right now (display only; other cards may go first). */
function landing(rows: number[][], card: number): { row: number; takes: boolean } {
  let row = -1;
  rows.forEach((r, i) => {
    const last = r.at(-1) as number;
    if (last < card && (row === -1 || last > (rows[row]?.at(-1) as number))) row = i;
  });
  if (row >= 0) return { row, takes: (rows[row] as number[]).length >= ROW_LIMIT };
  row = 0;
  rows.forEach((r, i) => {
    if (rowPenalty(r) < rowPenalty(rows[row] as number[])) row = i;
  });
  return { row, takes: true };
}

export function RowCardsGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.players.includes(me);
  const [aim, setAim] = useState<number | null>(null);
  const canPlay = v.phase === "choose" && playing && v.myCard == null && !paused;
  const target = aim !== null && canPlay ? landing(v.rows, aim) : null;

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.hand} 局${v.totalHands > 1 ? ` / 共 ${v.totalHands} 局` : ""} · 第 ${Math.min(v.trick, 10)} 墩`}
        deadlineAt={v.phase === "choose" ? v.deadlineAt : null}
        paused={paused}
      />

      <Felt>
        <div className="card-rows">
          {v.rows.map((row, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
            <div key={i} className={`card-row${target?.row === i ? (target.takes ? " aim bad" : " aim") : ""}`}>
              {row.map((c) => (
                <Card key={c} value={c} />
              ))}
              {Array.from({ length: ROW_LIMIT - row.length }, (_, k) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: empty slots are positional
                <span key={`e${k}`} className="card-face empty" />
              ))}
              <span className="card-face danger" title="放下第六张的人收走这一行">
                第六张
              </span>
              <span className="row-cost">这行 {rowPenalty(row)} 罚分</span>
            </div>
          ))}
        </div>
        {target && (
          <p className="felt-note">
            {target.takes
              ? `现在放 ${aim} 会收走第 ${target.row + 1} 行（${rowPenalty(v.rows[target.row] ?? [])} 罚分）`
              : `现在放 ${aim} 会接在第 ${target.row + 1} 行后面`}
            。别人的牌更小的话会先放。
          </p>
        )}
      </Felt>

      {v.lastTrick.length > 0 && (
        <div className="trick-strip">
          <span className="muted small">上一墩</span>
          {v.lastTrick.map((p) => (
            <span key={p.playerId} className={`trick-play${p.took ? " took" : ""}`}>
              <Avatar room={room} id={p.playerId} size="s" />
              <b>{p.card}</b>
              {p.took && (
                <em>
                  收走第 {p.row + 1} 行 −{rowPenalty(p.took)}
                </em>
              )}
            </span>
          ))}
        </div>
      )}

      {v.phase === "choose" &&
        (playing ? (
          <>
            <p className="muted">
              {v.myCard != null
                ? "你的牌已经盖在桌上，等其他人…"
                : "挑一张暗出：点一下看它会落在哪行，再确认；也可以直接拖到桌上。"}
            </p>
            {v.myCard != null && (
              <div className="hand">
                <CardBack label="已出" />
                <Card value={v.myCard} selected />
              </div>
            )}
            <PlayHand
              cards={v.myHand.filter((c) => c !== v.myCard)}
              face={(c) => <Card value={c} />}
              enabled={canPlay}
              confirm={(c) => `暗出 ${c}`}
              onSelect={(c) => setAim(c)}
              onPlay={(c) => void go({ type: "play", card: c })}
              resetKey={v.step}
            />
            <Progress ids={v.players} done={v.submitted} name={name} />
          </>
        ) : (
          <p className="muted">这一局开始时你还没加入，下一局开始参与。</p>
        ))}

      <table className="results">
        <tbody>
          {[...v.players]
            .sort((a, b) => (v.penalties[a] ?? 0) - (v.penalties[b] ?? 0))
            .map((id) => (
              <tr key={id} className={v.winners.includes(id) ? "win" : ""}>
                <td>
                  <Who room={room} id={id} />
                </td>
                <td className="muted">罚分 {v.penalties[id] ?? 0}</td>
                <td>{v.winners.includes(id) ? "+3" : ""}</td>
              </tr>
            ))}
        </tbody>
      </table>
      {v.phase === "handOver" && <p className="answer">本局结束，罚分最少的是 {v.winners.map(name).join("、")}。</p>}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "handOver" ? "等待房主继续…" : undefined}>
        {v.phase === "choose" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了（没出牌的人自动出最小的牌）
          </button>
        )}
        {v.phase === "handOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "advance" })}>
            {v.hand >= v.totalHands ? "结束并回到大厅" : "下一局"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
