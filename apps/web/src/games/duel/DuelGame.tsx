import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { CardBack, Felt, PlayHand, Seats } from "../table.tsx";
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

const DuelCard = ({ value, small }: { value: number; small?: boolean }) =>
  small ? (
    <span className="mini-card" title={`${CARDS[value]?.name}：${CARDS[value]?.text}`}>
      {value} {CARDS[value]?.name}
    </span>
  ) : (
    <span className="card-face duel-card">
      <strong>{value}</strong>
      <span>{CARDS[value]?.name}</span>
      <em>{CARDS[value]?.text}</em>
    </span>
  );

export function DuelGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [card, setCard] = useState<number | null>(null);
  const [guess, setGuess] = useState(2);
  const myTurn = v.phase === "play" && v.current === me && !paused;
  const forced = v.myHand.includes(7) && (v.myHand.includes(5) || v.myHand.includes(6));
  const targetsFor = (c: number) =>
    NEEDS_TARGET.includes(c) ? v.alive.filter((p) => (c === 5 || p !== me) && !v.shielded.includes(p)) : [];
  const targets = card === null || !myTurn ? [] : targetsFor(card);
  const describe = (l: Log) =>
    `${name(l.by)} 打出 ${l.card}「${CARDS[l.card]?.name}」${l.target ? ` → ${name(l.target)}` : ""}${l.guess ? `（猜 ${l.guess}）` : ""}${l.discarded ? `，弃掉了 ${l.discarded}` : ""}${l.out.length ? `，${l.out.map(name).join("、")} 出局` : ""}`;

  const play = (c: number, target?: string) =>
    void go({ type: "play", card: c, target, guess: c === 1 ? guess : undefined });
  /** A card dropped on a seat goes at that player; dropped on the table it needs no target. */
  const dropped = (c: number, where: string) => {
    const options = targetsFor(c);
    if (where.startsWith("seat:")) {
      const p = where.slice(5);
      if (options.includes(p)) play(c, p);
      else if (options.length === 0) play(c);
    } else if (options.length === 0) play(c);
  };

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.round} 轮 · 先赢 ${v.tokensToWin} 轮的人获胜`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      <Felt>
        <Seats
          room={room}
          ids={v.players}
          current={v.phase === "play" ? v.current : null}
          out={v.players.filter((p) => !v.alive.includes(p))}
          win={v.phase === "roundOver" ? v.roundWinners : []}
          pickable={(p) => targets.includes(p)}
          onPick={(p) => card !== null && play(card, p)}
          note={(p) => (
            <span className="tag">
              赢 {v.tokens[p] ?? 0} 轮{v.shielded.includes(p) ? " · 🛡 护盾" : ""}
              {!v.alive.includes(p) ? " · 出局" : ""}
            </span>
          )}
        >
          {(p) => (
            <>
              <span className="run">
                {(v.discards[p] ?? []).map((c, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: discards are append-only
                  <DuelCard key={i} value={c} small />
                ))}
                {(v.discards[p] ?? []).length === 0 && <span className="muted small">还没打过牌</span>}
              </span>
              {v.showdown?.[p] != null && <span className="strength">最后手牌 {v.showdown[p]}</span>}
              {v.mySeen.some((s) => s.about === p) && (
                <span className="strength">你看过：{v.mySeen.find((s) => s.about === p)?.card}</span>
              )}
              {targets.includes(p) && <span className="strength">{p === me ? "对自己用" : "对 TA 用"}</span>}
            </>
          )}
        </Seats>
        <p className="felt-note">
          <CardBack count={v.deckLeft} label="牌堆" />
          <span>
            每人手里只有一张牌。轮到你时摸一张，再从两张里打出一张，按牌上写的生效。牌堆摸完时手牌最大的人赢这一轮。
          </span>
        </p>
      </Felt>

      {v.myHand.length > 0 && (
        <>
          <p className="muted">
            {v.phase !== "play"
              ? "你的手牌"
              : v.current !== me
                ? `等 ${name(v.current)}…`
                : card === null
                  ? forced
                    ? "轮到你：手里同时有顾问和 5 / 6，这回合只能打顾问。"
                    : "轮到你：点一张要打的牌；需要指定对象的可以直接拖到那个人身上。"
                  : NEEDS_TARGET.includes(card)
                    ? targets.length > 0
                      ? "点桌上亮起来的人，对 TA 打出。"
                      : "没有可以指定的人（都有护盾或出局），打出后没有效果。"
                    : "确认打出。"}
          </p>
          <PlayHand
            cards={v.myHand}
            face={(c) => <DuelCard value={c} />}
            enabled={myTurn}
            playable={(c) => !forced || c === 7}
            confirm={(c) => (targetsFor(c).length > 0 ? null : `打出 ${c}「${CARDS[c]?.name}」`)}
            onSelect={(c) => setCard(c)}
            onPlay={dropped}
            resetKey={v.step}
          />
          {myTurn && (card === 1 || v.myHand.includes(1)) && (
            <div className="guess-row">
              <span className="small">侦察要猜的点数：</span>
              {[2, 3, 4, 5, 6, 7, 8].map((n) => (
                <button key={n} type="button" className={guess === n ? "on" : ""} onClick={() => setGuess(n)}>
                  {n} {CARDS[n]?.name}
                </button>
              ))}
            </div>
          )}
        </>
      )}
      {v.myHand.length === 0 && v.phase === "play" && (
        <p className="muted">{v.alive.includes(me) ? `等 ${name(v.current)}…` : "你这一轮出局了，看戏。"}</p>
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
