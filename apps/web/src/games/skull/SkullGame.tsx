import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, useNames } from "../ui.tsx";

type Disc = "flower" | "skull";
interface View {
  round: number;
  step: number;
  phase: "setup" | "turns" | "bidding" | "flipping" | "roundOver" | "finished";
  players: string[];
  discCounts: Record<string, number>;
  stackSizes: Record<string, number>;
  myDiscs: { flowers: number; skull: boolean } | null;
  myStack: Disc[];
  placed: string[];
  current: string;
  bid: { player: string; value: number } | null;
  passed: string[];
  flipped: { owner: string; disc: Disc }[];
  result: { challenger: string; success: boolean; lostDisc: Disc | null; eliminated: boolean } | null;
  wins: Record<string, number>;
  winner: string | null;
  deadlineAt: number | null;
}

const ICON: Record<Disc, string> = { flower: "🌸", skull: "💀" };

export function SkullGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [bid, setBid] = useState(1);
  const total = Object.values(v.stackSizes).reduce((a, b) => a + b, 0);
  const myTurn = v.current === me;
  const out = (v.discCounts[me] ?? 0) === 0;
  const flowersLeft = (v.myDiscs?.flowers ?? 0) - v.myStack.filter((d) => d === "flower").length;
  const skullLeft = !!v.myDiscs?.skull && !v.myStack.includes("skull");
  const placeButtons = (
    <div className="host-row">
      <button type="button" disabled={paused || flowersLeft <= 0} onClick={() => go({ type: "place", disc: "flower" })}>
        放 {ICON.flower}（剩 {Math.max(0, flowersLeft)}）
      </button>
      <button type="button" disabled={paused || !skullLeft} onClick={() => go({ type: "place", disc: "skull" })}>
        放 {ICON.skull}
      </button>
    </div>
  );
  const minBid = (v.bid?.value ?? 0) + 1;

  return (
    <div className="game">
      <GameHead
        label={`第 ${v.round} 轮 · 桌上 ${total} 张${v.bid ? ` · 当前喊价 ${v.bid.value}（${name(v.bid.player)}）` : ""}`}
        deadlineAt={v.deadlineAt}
        paused={paused}
      />
      <table className="results">
        <tbody>
          {v.players.map((p) => {
            const flipped = v.flipped.filter((f) => f.owner === p);
            const hidden = (v.stackSizes[p] ?? 0) - flipped.length;
            return (
              <tr
                key={p}
                className={
                  p === v.current && v.phase !== "roundOver"
                    ? "turn-row"
                    : (v.discCounts[p] ?? 0) === 0
                      ? "out-row"
                      : ""
                }
              >
                <td>
                  {name(p)} {"★".repeat(v.wins[p] ?? 0)}
                </td>
                <td className="muted">
                  剩 {v.discCounts[p]} 张{v.passed.includes(p) ? " · 放弃" : ""}
                </td>
                <td className="stack">
                  {"🂠".repeat(Math.max(0, hidden))}
                  {flipped.map((f, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: flips are positional
                    <span key={i}>{ICON[f.disc]}</span>
                  ))}
                </td>
                <td>
                  {v.phase === "flipping" && myTurn && p !== me && hidden > 0 && (
                    <button type="button" disabled={paused} onClick={() => go({ type: "flip", owner: p })}>
                      翻这堆
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {v.myStack.length > 0 && (
        <p className="notice">你的牌堆（从下到上）：{v.myStack.map((d) => ICON[d]).join(" ")}</p>
      )}

      {!out &&
        v.phase === "setup" &&
        (v.placed.includes(me) ? <p className="muted">等其他人放第一张…</p> : placeButtons)}
      {!out && v.phase === "turns" && myTurn && (
        <>
          <p className="muted">再放一张，或者喊价：</p>
          {placeButtons}
          <BidRow
            min={1}
            max={total}
            value={bid}
            setValue={setBid}
            onBid={() => go({ type: "bid", value: bid })}
            paused={paused}
          />
        </>
      )}
      {v.phase === "bidding" && myTurn && (
        <>
          <BidRow
            min={minBid}
            max={total}
            value={Math.max(bid, minBid)}
            setValue={setBid}
            onBid={() => go({ type: "bid", value: Math.max(bid, minBid) })}
            paused={paused}
          />
          <button type="button" disabled={paused} onClick={() => go({ type: "pass" })}>
            放弃
          </button>
        </>
      )}
      {v.phase === "flipping" && (
        <p className="muted">
          {myTurn
            ? `你要翻出 ${v.bid?.value} 朵花：已翻 ${v.flipped.length}。挑别人的牌堆翻。`
            : `${name(v.current)} 在翻牌…`}
        </p>
      )}
      {(v.phase === "turns" || v.phase === "bidding") && !myTurn && <p className="muted">等 {name(v.current)}…</p>}

      {v.result && (
        <p className="answer">
          {v.result.success
            ? `${name(v.result.challenger)} 挑战成功！`
            : `${name(v.result.challenger)} 翻到了骷髅，失去一张${v.result.challenger === me && v.result.lostDisc ? ICON[v.result.lostDisc] : "牌"}${v.result.eliminated ? "，出局" : ""}。`}
          {v.winner && <strong>　{name(v.winner)} 获胜！</strong>}
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "roundOver" ? "等待房主继续…" : undefined}>
        {v.phase === "roundOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.winner ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function BidRow(props: {
  min: number;
  max: number;
  value: number;
  setValue(n: number): void;
  onBid(): void;
  paused: boolean;
}) {
  return (
    <div className="answer-row">
      <input
        type="number"
        min={props.min}
        max={props.max}
        value={props.value}
        onChange={(e) => props.setValue(Number(e.target.value))}
      />
      <button
        type="button"
        className="primary"
        disabled={props.paused || props.value < props.min || props.value > props.max}
        onClick={props.onBid}
      >
        喊价 {props.value}
      </button>
    </div>
  );
}
