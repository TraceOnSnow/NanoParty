import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
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

function Card({
  value,
  onClick,
  disabled,
  selected,
}: {
  value: number;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
}) {
  const penalty = penaltyOf(value);
  const className = `card-face p${penalty}${selected ? " selected" : ""}`;
  const body = (
    <>
      <strong>{value}</strong>
      <span>{"●".repeat(penalty)}</span>
    </>
  );
  return onClick ? (
    <button
      type="button"
      className={className}
      onClick={onClick}
      disabled={disabled}
      aria-label={`出 ${value}（罚 ${penalty} 分）`}
    >
      {body}
    </button>
  ) : (
    <span className={className}>{body}</span>
  );
}

export function RowCardsGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.players.includes(me);

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.hand} 局${v.totalHands > 1 ? ` / 共 ${v.totalHands} 局` : ""} · 第 ${Math.min(v.trick, 10)} 墩`}
        deadlineAt={v.phase === "choose" ? v.deadlineAt : null}
        paused={paused}
      />

      <div className="card-rows">
        {v.rows.map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional
          <div key={i} className="card-row">
            {row.map((c) => (
              <Card key={c} value={c} />
            ))}
            {Array.from({ length: 5 - row.length }, (_, k) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: empty slots are positional
              <span key={`e${k}`} className="card-face empty" />
            ))}
            <span className="card-face danger" title="放下第六张的人收走这一行">
              ✕
            </span>
          </div>
        ))}
      </div>

      {v.lastTrick.length > 0 && (
        <p className="muted small">
          上一墩：
          {v.lastTrick
            .map(
              (p) =>
                `${name(p.playerId)} 出 ${p.card}${p.took ? `，收走第 ${p.row + 1} 行（${p.took.reduce((s, c) => s + penaltyOf(c), 0)} 罚分）` : ""}`,
            )
            .join("；")}
        </p>
      )}

      {v.phase === "choose" && (
        <>
          {playing ? (
            <>
              <p className="muted">
                {v.myCard != null ? "已出牌，等其他人…" : "选一张牌暗出。所有人出完后从小到大依次放置。"}
              </p>
              <div className="hand">
                {v.myHand.map((c) => (
                  <Card
                    key={c}
                    value={c}
                    selected={v.myCard === c}
                    disabled={paused || v.myCard != null}
                    onClick={() => go({ type: "play", card: c })}
                  />
                ))}
              </div>
            </>
          ) : (
            <p className="muted">这一局开始时你还没加入，下一局开始参与。</p>
          )}
          <Progress ids={v.players} done={v.submitted} name={name} />
        </>
      )}

      <table className="results">
        <tbody>
          {[...v.players]
            .sort((a, b) => (v.penalties[a] ?? 0) - (v.penalties[b] ?? 0))
            .map((id) => (
              <tr key={id} className={v.winners.includes(id) ? "win" : ""}>
                <td>{name(id)}</td>
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
