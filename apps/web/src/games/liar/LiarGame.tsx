import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, lastRound, roundLabel, useNames } from "../ui.tsx";

interface Bid {
  by: string;
  quantity: number;
  face: number;
}
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "bid" | "reveal" | "finished";
  players: string[];
  current: string;
  myDice: number[] | null;
  dice: Record<string, number[]> | null;
  totalDice: number;
  minOpening: number;
  bid: Bid | null;
  history: Bid[];
  onesWild: boolean;
  result: { opener: string; bid: Bid; count: number; loser: string } | null;
  losses: Record<string, number>;
  winners: string[];
  deadlineAt: number | null;
}

const PIPS = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const FACES = [2, 3, 4, 5, 6, 1];
const rank = (face: number) => (face === 1 ? 7 : face);
const raises = (prev: Bid | null, quantity: number, face: number, min: number) =>
  prev ? quantity > prev.quantity || (quantity === prev.quantity && rank(face) > rank(prev.face)) : quantity >= min;

function Dice({ values, hit }: { values: number[]; hit?(d: number): boolean }) {
  return (
    <span className="liar-dice">
      {values.map((d, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: dice in a fixed order
        <span key={i} className={hit?.(d) ? "hit" : ""} role="img" aria-label={`${d} 点`}>
          {PIPS[d]}
        </span>
      ))}
    </span>
  );
}

export function LiarGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.phase === "bid" && v.current === me && !paused;
  const floor = v.bid ? v.bid.quantity : v.minOpening;
  const [quantity, setQuantity] = useState(floor);
  // Start each decision from the lowest quantity that can still be bid.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset when the table moves on
  useEffect(() => setQuantity(floor), [v.step]);
  const counted = (d: number) =>
    !!v.result && (d === v.result.bid.face || (v.onesWild && v.result.bid.face !== 1 && d === 1));

  return (
    <div className="game wide liar">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "bid" ? v.deadlineAt : null}
        paused={paused}
      />
      <div className="liar-call">
        {v.bid ? (
          <>
            <span className="muted small">{name(v.bid.by)} 叫</span>
            <strong>
              {v.bid.quantity} 个 {PIPS[v.bid.face]}
            </strong>
          </>
        ) : (
          <span className="muted">还没人叫。起叫至少 {v.minOpening} 个。</span>
        )}
        <span className="tag">{v.onesWild ? "⚀ 是万能的" : "有人叫过 ⚀：这一轮 ⚀ 不再万能"}</span>
        <span className="muted small">全桌共 {v.totalDice} 颗骰子</span>
      </div>

      {v.myDice && v.phase === "bid" && (
        <p>
          你的骰子：
          <Dice values={v.myDice} />
        </p>
      )}

      {v.phase === "bid" &&
        (myTurn ? (
          <div className="liar-bid">
            <span className="host-row">
              <button type="button" disabled={quantity <= floor} onClick={() => setQuantity((q) => q - 1)}>
                −
              </button>
              <strong className="liar-qty">{quantity} 个</strong>
              <button type="button" disabled={quantity >= v.totalDice} onClick={() => setQuantity((q) => q + 1)}>
                +
              </button>
            </span>
            <span className="host-row">
              {FACES.map((face) => (
                <button
                  key={face}
                  type="button"
                  className="liar-face primary"
                  disabled={!raises(v.bid, quantity, face, v.minOpening)}
                  aria-label={`叫 ${quantity} 个 ${face}`}
                  onClick={() => go({ type: "bid", quantity, face })}
                >
                  {PIPS[face]}
                </button>
              ))}
            </span>
            {v.bid && (
              <button type="button" onClick={() => go({ type: "open" })}>
                不信，开 {name(v.bid.by)}！
              </button>
            )}
          </div>
        ) : (
          <p className="muted">等 {name(v.current)} 叫或者开…</p>
        ))}

      {v.result && v.phase !== "bid" && (
        <p className="answer">
          {name(v.result.opener)} 开了 {name(v.result.bid.by)} 的「{v.result.bid.quantity} 个 {PIPS[v.result.bid.face]}
          」：全桌一共 {v.result.count} 个，{v.result.count >= v.result.bid.quantity ? "够数" : "不够"}——
          {name(v.result.loser)} 输了这一轮。
        </p>
      )}

      <Seats
        room={room}
        ids={v.players}
        current={v.phase === "bid" ? v.current : null}
        out={v.result && v.phase !== "bid" ? [v.result.loser] : []}
        win={v.winners}
        note={(p) => <span className="tag">输 {v.losses[p] ?? 0} 轮</span>}
      >
        {(p) =>
          v.dice ? (
            <Dice values={v.dice[p] ?? []} hit={counted} />
          ) : (
            <span className="muted small">{p === me ? "杯子里是你的骰子" : "🥤 扣着"}</span>
          )
        }
      </Seats>
      {v.history.length > 0 && v.phase === "bid" && (
        <p className="muted small">
          这一轮叫过：{v.history.map((b) => `${name(b.by)} ${b.quantity}个${b.face}`).join(" → ")}
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "reveal" && (
          <>
            <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
              {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
            </button>
            {!lastRound(v.round, v.totalRounds) && (
              <button type="button" disabled={paused} onClick={() => go({ type: "end" })}>
                就玩到这
              </button>
            )}
          </>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
