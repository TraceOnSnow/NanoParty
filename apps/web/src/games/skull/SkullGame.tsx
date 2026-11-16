import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Felt, PlayHand, Seats, Stepper } from "../table.tsx";
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

const DiscFace = ({ disc, small }: { disc: Disc | "back"; small?: boolean }) => (
  <span className={`disc ${disc}${small ? " small" : ""}`}>{disc === "back" ? "" : ICON[disc]}</span>
);

export function SkullGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [bid, setBid] = useState(1);
  const total = Object.values(v.stackSizes).reduce((a, b) => a + b, 0);
  const myTurn = v.current === me && !paused;
  const out = (v.discCounts[me] ?? 0) === 0;
  const flowersLeft = Math.max(0, (v.myDiscs?.flowers ?? 0) - v.myStack.filter((d) => d === "flower").length);
  const skullLeft = !!v.myDiscs?.skull && !v.myStack.includes("skull");
  const inHand: Disc[] = [...Array<Disc>(flowersLeft).fill("flower"), ...(skullLeft ? (["skull"] as Disc[]) : [])];
  const canPlace =
    !out && !paused && ((v.phase === "setup" && !v.placed.includes(me)) || (v.phase === "turns" && myTurn));
  const minBid = (v.bid?.value ?? 0) + 1;
  const myBid = Math.min(Math.max(bid, minBid), Math.max(total, 1));
  const flipping = v.phase === "flipping" && myTurn;
  const hiddenOf = (p: string) => (v.stackSizes[p] ?? 0) - v.flipped.filter((f) => f.owner === p).length;

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.round} 轮 · 桌上 ${total} 张${v.bid ? ` · ${name(v.bid.player)} 喊 ${v.bid.value}` : ""}`}
        deadlineAt={v.deadlineAt}
        paused={paused}
      />
      <Felt>
        <Seats
          room={room}
          ids={v.players}
          current={v.phase === "roundOver" || v.phase === "setup" ? null : v.current}
          out={v.players.filter((p) => (v.discCounts[p] ?? 0) === 0)}
          win={v.winner ? [v.winner] : []}
          pickable={(p) => flipping && p !== me && hiddenOf(p) > 0}
          onPick={(p) => void go({ type: "flip", owner: p })}
          note={(p) => (
            <span className="tag">
              {"★".repeat(v.wins[p] ?? 0)} 剩 {v.discCounts[p]} 张{v.passed.includes(p) ? " · 不跟" : ""}
            </span>
          )}
        >
          {(p) => {
            const flipped = v.flipped.filter((f) => f.owner === p);
            const hidden = hiddenOf(p);
            return (
              <>
                <span className="disc-stack">
                  {Array.from({ length: Math.max(0, hidden) }, (_, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: identical face-down discs
                    <DiscFace key={`h${i}`} disc="back" />
                  ))}
                  {flipped.map((f, i) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: flips are positional
                    <DiscFace key={`f${i}`} disc={f.disc} />
                  ))}
                  {hidden + flipped.length === 0 && <span className="muted small">还没放</span>}
                </span>
                {flipping && p !== me && hidden > 0 && <span className="strength">点这里翻一张</span>}
              </>
            );
          }}
        </Seats>
        {v.phase === "flipping" && (
          <p className="felt-note">
            {name(v.current)} 要翻出 {v.bid?.value} 朵花，已经翻了 {v.flipped.length} 张。翻到 💀 就失败。
          </p>
        )}
      </Felt>

      {v.myStack.length > 0 && (
        <p className="notice my-stack">
          你盖下的（从下到上）：
          {v.myStack.map((d, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: stack order
            <DiscFace key={i} disc={d} small />
          ))}
          <span className="muted small">只有你看得到</span>
        </p>
      )}

      {!out && (v.phase === "setup" || v.phase === "turns") && (
        <>
          <p className="muted">
            {v.phase === "setup"
              ? v.placed.includes(me)
                ? "等其他人盖第一张…"
                : "每人先盖一张：点一张再确认，或者直接拖到桌上。"
              : v.current === me
                ? "轮到你：再盖一张，或者开始喊价（喊了之后大家就不能再盖了）。"
                : `等 ${name(v.current)}…`}
          </p>
          <PlayHand
            cards={inHand}
            face={(d) => <DiscFace disc={d} />}
            enabled={canPlace}
            confirm={(d) => `盖一张 ${ICON[d]}`}
            onPlay={(d) => void go({ type: "place", disc: d })}
            resetKey={v.step}
            empty="手里没有可以盖的了"
          />
        </>
      )}
      {!out && myTurn && (v.phase === "turns" || v.phase === "bidding") && (
        <div className="bid-row">
          <span>我能翻出</span>
          <Stepper value={myBid} min={minBid} max={Math.max(total, minBid)} unit=" 朵花" onChange={setBid} />
          <button
            type="button"
            className="primary"
            disabled={myBid > total}
            onClick={() => go({ type: "bid", value: myBid })}
          >
            喊 {myBid}
          </button>
          {v.phase === "bidding" && (
            <button type="button" onClick={() => go({ type: "pass" })}>
              不跟
            </button>
          )}
        </div>
      )}
      {v.phase === "bidding" && v.current !== me && <p className="muted">等 {name(v.current)} 喊价或不跟…</p>}
      {flipping && <p className="muted">你自己的已经先翻开了。接下来点别人的牌堆，一张一张翻。</p>}

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
