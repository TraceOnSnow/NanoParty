import { useDragDrop } from "../drag.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { CardBack, Felt, Seats } from "../table.tsx";
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

/** Cards grouped into runs of consecutive numbers; only the lowest of a run costs points. */
function runs(cards: number[]): number[][] {
  const out: number[][] = [];
  for (const c of [...cards].sort((a, b) => a - b)) {
    const last = out.at(-1);
    if (last && c === (last.at(-1) as number) + 1) last.push(c);
    else out.push([c]);
  }
  return out;
}
const faceCost = (cards: number[]) => runs(cards).reduce((s, r) => s + (r[0] as number), 0);

export function NoThanksGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.phase === "play" && v.current === me && !paused;
  const chips = v.myChips ?? 0;
  const { dragging, grab, ghost } = useDragDrop<"chip" | "card">((item, target) => {
    if (item === "chip" && target === "table") void go({ type: "pass" });
    if (item === "card" && target === `seat:${me}`) void go({ type: "take" });
  });
  const big = (
    <span className="card-face big-card">
      <strong>{v.card}</strong>
    </span>
  );

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.game} 局 / 共 ${v.totalGames} 局`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      {v.card !== null && v.phase === "play" && (
        <Felt hot={dragging === "chip"} className="offer">
          <CardBack count={v.deckLeft} label="牌堆" />
          <button
            type="button"
            className={`hand-slot${dragging === "card" ? " carried" : ""}`}
            disabled={!myTurn}
            onPointerDown={grab("card", big, undefined, myTurn)}
          >
            {big}
          </button>
          <div className="pot">
            <span className="pot-chips">
              {Array.from({ length: Math.min(v.pot, 12) }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: identical chips
                <i key={i} className="token" />
              ))}
              {v.pot === 0 && <span className="felt-note">还没人放筹码</span>}
            </span>
            <span className="felt-note">
              <span>
                牌上 <b>{v.pot}</b> 个筹码{v.pot > 0 ? `，收下等于只花 ${Math.max(0, v.card - v.pot)} 分` : ""}
              </span>
            </span>
          </div>
        </Felt>
      )}
      {v.phase === "play" && (
        <p className="muted">
          {myTurn
            ? "轮到你：收下这张牌（连同筹码），或者放一个筹码上去说不要。也可以把筹码拖到桌上、把牌拖到自己面前。"
            : `等 ${name(v.current)} 决定…`}
        </p>
      )}
      {v.phase === "play" && v.myChips !== null && (
        <div className="chip-tray">
          <button
            type="button"
            className={`hand-slot${dragging === "chip" ? " carried" : ""}`}
            disabled={!myTurn || chips <= 0}
            onPointerDown={grab("chip", <i className="token big" />, undefined, myTurn && chips > 0)}
            aria-label="拖一个筹码到桌上"
          >
            <span className="pot-chips mine">
              {Array.from({ length: Math.min(chips, 15) }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: identical chips
                <i key={i} className="token" />
              ))}
            </span>
          </button>
          <span>
            你有 <b>{chips}</b> 个筹码<span className="muted small">（别人看不到，结算时每个 −1 分）</span>
          </span>
          {myTurn && (
            <span className="host-row">
              <button type="button" className="primary" onClick={() => go({ type: "take" })}>
                收下 {v.card}（+{v.pot} 筹码）
              </button>
              <button type="button" disabled={chips <= 0} onClick={() => go({ type: "pass" })}>
                {chips > 0 ? "不要（放 1 个筹码）" : "没筹码了，只能收下"}
              </button>
            </span>
          )}
        </div>
      )}

      <Seats
        room={room}
        ids={v.players}
        current={v.phase === "play" ? v.current : null}
        win={v.winners}
        note={(p) => (
          <span className="tag">
            {v.final
              ? `总分 ${v.final.scores[p]}（筹码 ${v.final.chips[p]}）`
              : `牌面 ${faceCost(v.cards[p] ?? [])} 分`}
          </span>
        )}
      >
        {(p) =>
          (v.cards[p] ?? []).length === 0 ? (
            <span className="muted small">还没收牌</span>
          ) : (
            runs(v.cards[p] ?? []).map((run) => (
              <span key={run[0]} className="run">
                {run.map((c, i) => (
                  <span key={c} className={`mini-card${i > 0 ? " free" : ""}`}>
                    {c}
                  </span>
                ))}
              </span>
            ))
          )
        }
      </Seats>
      <p className="muted small">连着的数字只算最小的那张，灰掉的牌不计分。分数越低越好。</p>
      {v.phase === "gameOver" && <p className="answer">这一局 {v.winners.map(name).join("、")} 总分最低！</p>}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "gameOver" ? "等待房主继续…" : undefined}>
        {v.phase === "gameOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.game >= v.totalGames ? "结束并回到大厅" : "下一局"}
          </button>
        )}
      </HostControls>
      {ghost}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
