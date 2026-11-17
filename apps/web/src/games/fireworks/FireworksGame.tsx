import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface Card {
  id: string;
  color: string | null;
  number: number | null;
  notColors: string[];
  notNumbers: number[];
  knownColor?: boolean;
  knownNumber?: boolean;
}
type Event =
  | { kind: "hint"; by: string; target: string; color?: string; number?: number; count: number }
  | { kind: "play"; by: string; color: string; number: number; ok: boolean }
  | { kind: "discard"; by: string; color: string; number: number };
interface View {
  step: number;
  phase: "play" | "gameOver" | "finished";
  players: string[];
  current: string;
  colors: string[];
  hands: Record<string, Card[]>;
  myHand: Card[] | null;
  deckLeft: number;
  stacks: Record<string, number>;
  discard: { color: string; number: number }[];
  hints: number;
  fuses: number;
  finalTurns: number | null;
  score: number;
  log: Event[];
  ended: "exploded" | "complete" | "deck" | null;
  deadlineAt: number | null;
}

const TONE: Record<string, string> = { 红: "red", 黄: "yellow", 绿: "green", 蓝: "blue", 白: "white" };

function Face({ card, picked, onPick }: { card: Card; picked?: boolean; onPick?: () => void }) {
  const cls = `fw-card ${card.color ? TONE[card.color] : "unknown"}${picked ? " picked" : ""}`;
  const told = [card.knownColor ? "颜色" : "", card.knownNumber ? "数字" : ""].filter(Boolean).join("、");
  const body = (
    <>
      <strong>{card.number ?? "?"}</strong>
      <em>{card.color ?? "?"}</em>
    </>
  );
  return onPick ? (
    <button type="button" className={cls} onClick={onPick}>
      {body}
    </button>
  ) : (
    <span className={cls} title={told ? `他已经知道：${told}` : undefined}>
      {body}
      {told && (
        <i>
          知{card.knownColor ? "色" : ""}
          {card.knownNumber ? "数" : ""}
        </i>
      )}
    </span>
  );
}

export function FireworksGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [mine, setMine] = useState<string | null>(null);
  const [hintFor, setHintFor] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step is a new decision
  useEffect(() => {
    setMine(null);
    setHintFor(null);
  }, [v.step]);
  const live = v.phase === "play";
  const myTurn = live && v.current === me && !paused;
  const targetHand = hintFor ? (v.hands[hintFor] ?? []) : [];

  const line = (e: Event) =>
    e.kind === "hint"
      ? `${name(e.by)} 提示 ${name(e.target)}：有 ${e.count} 张${e.color ? `${e.color}色` : `数字 ${e.number}`}`
      : e.kind === "play"
        ? `${name(e.by)} 打出 ${e.color}${e.number}——${e.ok ? "接上了！" : "接不上，烧掉一条引线"}`
        : `${name(e.by)} 弃掉 ${e.color}${e.number}，拿回一个提示`;

  return (
    <div className="game wide fireworks">
      <GameHead label={`烟花 ${v.score} / 25`} deadlineAt={live ? v.deadlineAt : null} paused={paused} />
      <div className="fw-table">
        {v.colors.map((color) => (
          <span key={color} className={`fw-card stack ${TONE[color]}`}>
            <strong>{v.stacks[color] || "–"}</strong>
            <em>{color}</em>
          </span>
        ))}
        <span className="fw-status">
          <span>
            提示 {"●".repeat(v.hints)}
            {"○".repeat(8 - v.hints)}
          </span>
          <span>引线 {"✸".repeat(Math.max(0, v.fuses)) || "烧完了"}</span>
          <span className="muted small">
            牌堆 {v.deckLeft} 张{v.finalTurns !== null ? ` · 最后 ${v.finalTurns} 个回合` : ""}
          </span>
        </span>
      </div>

      {v.myHand && live && (
        <div className="fw-mine">
          <span className="muted small">你的牌（你看不到，只显示队友告诉过你的）：</span>
          <div className="host-row">
            {v.myHand.map((c) => (
              <span key={c.id} className="fw-slot">
                <Face
                  card={c}
                  picked={mine === c.id}
                  onPick={myTurn ? () => setMine(mine === c.id ? null : c.id) : undefined}
                />
                {(c.notColors.length > 0 || c.notNumbers.length > 0) && (
                  <span className="muted small">不是 {[...c.notColors, ...c.notNumbers].join(" ")}</span>
                )}
              </span>
            ))}
          </div>
          {myTurn && mine && (
            <div className="host-row">
              <button type="button" className="primary" onClick={() => go({ type: "play", cardId: mine })}>
                打出这张
              </button>
              <button type="button" disabled={v.hints >= 8} onClick={() => go({ type: "discard", cardId: mine })}>
                {v.hints >= 8 ? "提示是满的，不能弃" : "弃掉这张（+1 提示）"}
              </button>
            </div>
          )}
        </div>
      )}
      {live && (
        <p className="muted">
          {myTurn ? "轮到你：点一张自己的牌打出或弃掉；或者点一位队友给提示。" : `等 ${name(v.current)} 行动…`}
        </p>
      )}
      {myTurn && hintFor && (
        <div className="fw-hint">
          <span>
            提示 {name(hintFor)}（花 1 个提示{v.hints <= 0 ? "，现在没有了" : ""}）：
          </span>
          {v.colors
            .filter((color) => targetHand.some((c) => c.color === color))
            .map((color) => (
              <button
                key={color}
                type="button"
                disabled={v.hints <= 0}
                onClick={() => go({ type: "hint", target: hintFor, color })}
              >
                哪些是{color}色
              </button>
            ))}
          {[1, 2, 3, 4, 5]
            .filter((n) => targetHand.some((c) => c.number === n))
            .map((n) => (
              <button
                key={n}
                type="button"
                disabled={v.hints <= 0}
                onClick={() => go({ type: "hint", target: hintFor, number: n })}
              >
                哪些是 {n}
              </button>
            ))}
        </div>
      )}

      <Seats
        room={room}
        ids={v.players}
        current={live ? v.current : null}
        chosen={hintFor}
        pickable={(p) => myTurn && p !== me}
        onPick={(p) => setHintFor(hintFor === p ? null : p)}
      >
        {(p) =>
          v.hands[p] ? (
            v.hands[p].map((c) => <Face key={c.id} card={c} />)
          ) : (
            <span className="muted small">你自己的牌在上面</span>
          )
        }
      </Seats>

      {v.discard.length > 0 && (
        <p className="muted small">
          弃牌和打错的牌：
          {v.colors
            .map((color) => {
              const numbers = v.discard.filter((d) => d.color === color).map((d) => d.number);
              return numbers.length ? `${color} ${numbers.sort().join(" ")}` : "";
            })
            .filter(Boolean)
            .join("　")}
        </p>
      )}
      <ul className="flip-log">
        {[...v.log]
          .reverse()
          .slice(0, 4)
          .map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a short rolling log
            <li key={i} className={i === 0 ? "" : "muted small"}>
              {line(e)}
            </li>
          ))}
      </ul>
      {v.phase === "gameOver" && (
        <p className="answer">
          {v.ended === "exploded"
            ? "三条引线都烧完了，烟花炸了：0 分。"
            : v.ended === "complete"
              ? "五种颜色全部接到 5，满分 25！"
              : `牌打完了：一共 ${v.score} 分。`}
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "gameOver" ? "等待房主结束…" : undefined}>
        {v.phase === "gameOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            结束并回到大厅
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
