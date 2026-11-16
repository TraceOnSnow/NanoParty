import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

type ActionKind = "onemore" | "flipfour" | "swap" | "steal" | "discard";
type Card =
  | { id: string; kind: "num"; value: number; special?: "zero" | "unlucky" | "lucky" }
  | { id: string; kind: "mod"; minus?: number; half?: true }
  | { id: string; kind: "act"; act: ActionKind };
interface Event {
  kind: "draw" | "bust" | "stay" | "flip7" | "give" | "steal" | "swap" | "discard" | "wipe" | "fizzle";
  by: string;
  target?: string;
  card?: Card;
  other?: Card;
}
interface View {
  round: number;
  step: number;
  phase: "turn" | "assign" | "use" | "roundOver" | "gameOver" | "finished";
  target: number;
  players: string[];
  dealer: string;
  current: string;
  status: Record<string, "active" | "stayed" | "bust">;
  cards: Record<string, Card[]>;
  totals: Record<string, number>;
  preview: Record<string, number>;
  roundScores: Record<string, number> | null;
  flip7: string | null;
  deckLeft: number;
  pending: { by: string; card: Card } | null;
  log: Event[];
  winners: string[];
  deadlineAt: number | null;
}

const ACT_NAME: Record<ActionKind, string> = {
  onemore: "再来一张",
  flipfour: "连翻四张",
  swap: "换",
  steal: "偷",
  discard: "弃",
};
const ACT_HELP: Record<ActionKind, string> = {
  onemore: "指定一个人：TA 再翻一张，然后必须停。",
  flipfour: "指定一个人：TA 连翻四张，中途翻重就爆。",
  swap: "选两位玩家面前各一张牌，互换。",
  steal: "从别人面前拿走一张牌，放到你面前。",
  discard: "选任何人面前的一张牌，弃掉（可以弃自己的减分牌）。",
};
export const cardLabel = (c: Card) =>
  c.kind === "num"
    ? c.special === "unlucky"
      ? "厄运 7"
      : c.special === "lucky"
        ? "幸运 13"
        : String(c.value)
    : c.kind === "mod"
      ? c.half
        ? "÷2"
        : `−${c.minus}`
      : ACT_NAME[c.act];

function CardChip({ card, picked, onPick }: { card: Card; picked?: boolean; onPick?: () => void }) {
  const cls = `flip-card ${card.kind}${card.kind === "num" && card.special ? ` ${card.special}` : ""}${picked ? " picked" : ""}`;
  return onPick ? (
    <button type="button" className={cls} onClick={onPick}>
      {cardLabel(card)}
    </button>
  ) : (
    <span className={cls}>{cardLabel(card)}</span>
  );
}

export function FlipoutGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [picks, setPicks] = useState<{ player: string; cardId: string }[]>([]);
  // A new step means a new decision: drop any half-made selection.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset on step change only
  useEffect(() => setPicks([]), [v.step]);

  const over = v.phase === "roundOver" || v.phase === "gameOver";
  const live = !over && v.phase !== "finished";
  const mine = v.pending?.by === me && !paused;
  const pendingAct = v.pending?.card.kind === "act" ? v.pending.card.act : null;
  const need = pendingAct === "swap" ? 2 : 1;
  const inPlay = v.players.filter((p) => v.status[p] !== "bust");
  const myTurn = v.phase === "turn" && v.current === me && !paused;
  const holdsZero = (v.cards[me] ?? []).some((c) => c.kind === "num" && c.special === "zero");

  const canPick = (p: string) => {
    if (v.phase !== "use" || !mine || v.status[p] === "bust") return false;
    if (pendingAct === "steal" && p === me) return false;
    return true;
  };
  const toggle = (player: string, cardId: string) =>
    setPicks((now) => {
      if (now.some((x) => x.cardId === cardId)) return now.filter((x) => x.cardId !== cardId);
      const others = now.filter((x) => x.player !== player);
      return [...others, { player, cardId }].slice(-need);
    });

  const line = (e: Event): string | null => {
    const c = e.card ? `「${cardLabel(e.card)}」` : "";
    switch (e.kind) {
      case "draw":
        return `${name(e.by)} 翻到 ${c}`;
      case "bust":
        return `${name(e.by)} 翻重了，爆掉！`;
      case "stay":
        return `${name(e.by)} 停了`;
      case "flip7":
        return `${name(e.by)} 集齐七张不同的数字！`;
      case "give":
        return `${name(e.by)} 把 ${c} 给了 ${e.target === e.by ? "自己" : name(e.target ?? "")}`;
      case "steal":
        return `${name(e.by)} 偷走了 ${name(e.target ?? "")} 的 ${c}`;
      case "discard":
        return `${name(e.by)} 弃掉了 ${name(e.target ?? "")} 的 ${c}`;
      case "swap":
        return `${name(e.by)} 让 ${c} 和「${e.other ? cardLabel(e.other) : ""}」换了位置`;
      case "wipe":
        return `${name(e.by)} 拿到厄运 7，面前其它牌全没了`;
      case "fizzle":
        return `${name(e.by)} 的 ${c} 没有可用的对象，作废`;
    }
  };

  return (
    <div className="game wide flipout">
      <GameHead
        label={`第 ${v.round} 轮 · 目标 ${v.target} 分`}
        deadlineAt={live ? v.deadlineAt : null}
        paused={paused}
      />

      {v.pending && live && (
        <div className="flip-pending">
          <CardChip card={v.pending.card} />
          <span>
            {mine ? "你" : name(v.pending.by)}翻到了这张牌。
            {pendingAct ? ACT_HELP[pendingAct] : "减分牌：留给自己，或者塞给任何还没爆的人。"}
          </span>
          {mine && v.phase === "assign" && (
            <span className="host-row">
              {inPlay.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={p === me ? "" : "primary"}
                  onClick={() => go({ type: "give", target: p })}
                >
                  给{p === me ? "自己" : name(p)}
                </button>
              ))}
            </span>
          )}
          {mine && v.phase === "use" && (
            <span className="host-row">
              <span className="muted small">
                在下面点{need === 2 ? "两位玩家各一张牌" : "一张牌"}（已选 {picks.length}/{need}）
              </span>
              <button
                type="button"
                className="primary"
                disabled={picks.length !== need}
                onClick={() => go({ type: "use", cards: picks })}
              >
                确定
              </button>
            </span>
          )}
          {!mine && <span className="muted">等 {name(v.pending.by)} 决定…</span>}
        </div>
      )}

      {v.phase === "turn" && (
        <div className="flip-turn">
          {myTurn ? (
            <span className="host-row">
              <button type="button" className="primary" onClick={() => go({ type: "hit" })}>
                再翻一张
              </button>
              <button type="button" disabled={holdsZero} onClick={() => go({ type: "stay" })}>
                {holdsZero ? "有 0 不能停" : `停（这轮拿 ${v.preview[me] ?? 0} 分）`}
              </button>
            </span>
          ) : (
            <span className="muted">等 {name(v.current)} 决定翻不翻…</span>
          )}
          <span className="muted small">牌堆还有 {v.deckLeft} 张</span>
        </div>
      )}

      <Seats
        room={room}
        ids={v.players}
        wide
        current={v.phase === "turn" ? v.current : (v.pending?.by ?? null)}
        out={v.players.filter((p) => v.status[p] === "bust")}
        win={v.winners.length ? v.winners : v.flip7 ? [v.flip7] : []}
        note={(p) => (
          <span className="tag">
            {v.status[p] === "bust" ? "爆了 · " : v.status[p] === "stayed" ? "已停 · " : ""}
            {over ? `这轮 +${v.roundScores?.[p] ?? 0}` : `这轮 ${v.preview[p] ?? 0}`} · 总 {v.totals[p] ?? 0}
          </span>
        )}
      >
        {(p) =>
          (v.cards[p] ?? []).length === 0 ? (
            <span className="muted small">面前没有牌</span>
          ) : (
            (v.cards[p] ?? []).map((c) => (
              <CardChip
                key={c.id}
                card={c}
                picked={picks.some((x) => x.cardId === c.id)}
                onPick={canPick(p) ? () => toggle(p, c.id) : undefined}
              />
            ))
          )
        }
      </Seats>

      <ul className="flip-log">
        {[...v.log]
          .reverse()
          .slice(0, 5)
          .map((e, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: a short rolling log
            <li key={i} className={i === 0 ? "" : "muted small"}>
              {line(e)}
            </li>
          ))}
      </ul>
      <p className="muted small">
        翻到面前已有的数字就爆，这轮 0 分。集齐 7 张不同的数字，这轮立刻结束并 +15。算分顺序：数字相加 → ÷2 →
        减分牌，最低 0 分。
      </p>
      {v.phase === "roundOver" && (
        <p className="answer">这一轮结束{v.flip7 ? `：${name(v.flip7)} 集齐了七张！` : "。"}</p>
      )}
      {v.phase === "gameOver" && <p className="answer">{v.winners.map(name).join("、")} 总分最高，赢了！</p>}
      <HostControls isHost={room.me.isHost} waitNote={over ? "等待房主继续…" : undefined}>
        {over && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.phase === "gameOver" ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
