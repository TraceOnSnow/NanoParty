import { useEffect, useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import { useDragDrop } from "../drag.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Felt } from "../table.tsx";
import { GameHead, useNames } from "../ui.tsx";

interface RuleView {
  id: string;
  kind: number;
  text: string;
  points: number;
}

interface View {
  step: number;
  phase: "play" | "finished";
  players: string[];
  current: string;
  theme: { name: string; kinds: { label: string; mark?: string }[] };
  piles: { left: number; top: { id: string; kind: number; text: string; worth: number | null } | null }[];
  market: ({ kind: number } | null)[][];
  rules: Record<string, RuleView[]>;
  items: Record<string, number[]>;
  totals: Record<string, number>;
  canFlip: boolean;
  mustTake: number;
  winners: string[];
  deadlineAt: number | null;
}

const signed = (n: number) => (n > 0 ? `+${n}` : `${n}`);

export function PlatterGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  /** Either one rule pile ("rule:<col>") or the ingredient slots ("<col>-<row>") chosen so far. */
  const [picked, setPicked] = useState<string[]>([]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means the table changed
  useEffect(() => setPicked([]), [v.step]);
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.phase === "play";
  const myTurn = playing && v.current === me && !paused;
  const kind = (k: number) => v.theme.kinds[k]?.label ?? "?";
  const mark = (k: number) => v.theme.kinds[k]?.mark ?? "";
  const left = v.piles.reduce((n, p) => n + p.left, 0) + v.market.flat().filter(Boolean).length;
  const rulePick = picked[0]?.startsWith("rule:") ? Number(picked[0].slice(5)) : null;
  const itemPicks = rulePick === null ? picked : [];

  const pickRule = (col: number) => setPicked((now) => (now[0] === `rule:${col}` ? [] : [`rule:${col}`]));
  const toggle = (key: string) =>
    setPicked((now) => {
      const items = now.filter((k) => !k.startsWith("rule:"));
      return items.includes(key) ? items.filter((k) => k !== key) : [...items, key].slice(-v.mustTake);
    });
  const takeRule = (col: number) => go({ type: "takeRule", pile: col });
  const takeItems = (keys: string[]) =>
    go({
      type: "takeItems",
      slots: keys.map((key) => {
        const [col, row] = key.split("-").map(Number);
        return { col, row };
      }),
    });
  // Dropping on your own plate: a rule is taken at once; an ingredient joins the chosen ones,
  // and the pair is taken as soon as it is complete.
  const { dragging, grab, ghost } = useDragDrop<string>((key, target) => {
    if (target !== "plate" || !myTurn) return;
    if (key.startsWith("rule:")) return void takeRule(Number(key.slice(5)));
    const next = itemPicks.includes(key) ? itemPicks : [...itemPicks, key].slice(-v.mustTake);
    if (next.length === v.mustTake) void takeItems(next);
    else setPicked(next);
  });
  const order = playing
    ? [...v.players].sort((a, b) => Number(b === me) - Number(a === me))
    : [...v.players].sort((a, b) => (v.totals[b] ?? 0) - (v.totals[a] ?? 0));

  return (
    <div className="game wide platter">
      <GameHead
        label={`${v.theme.name} · 还剩 ${left} 张`}
        deadlineAt={playing ? v.deadlineAt : null}
        paused={paused}
      />
      {playing && (
        <p className="muted">
          {myTurn
            ? `轮到你：拿一张规则牌，或者拿 ${v.mustTake || 0} 张材料。点选后确认，也可以直接拖到自己的盘子里。`
            : v.current === me
              ? "已暂停"
              : `等 ${name(v.current)} 拿牌…`}
        </p>
      )}
      {playing && (
        <Felt>
          <div className="platter-market">
            {v.piles.map((pile, col) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: the three columns are fixed positions
              <div key={col} className="platter-column">
                <button
                  type="button"
                  className={`platter-rule${rulePick === col ? " selected" : ""}${pile.top ? "" : " empty"}`}
                  disabled={!myTurn || !pile.top}
                  onPointerDown={grab(
                    `rule:${col}`,
                    <span className="platter-rule ghost">{pile.top?.text}</span>,
                    () => pickRule(col),
                    myTurn && !!pile.top,
                  )}
                >
                  {pile.top ? (
                    <>
                      <em className="platter-label">规则牌</em>
                      <strong>{pile.top.text}</strong>
                      {pile.top.worth !== null && (
                        <span
                          className={`platter-worth${pile.top.worth > 0 ? " up" : pile.top.worth < 0 ? " down" : ""}`}
                        >
                          你现在拿值 {signed(pile.top.worth)}
                        </span>
                      )}
                      <span>
                        背面是{mark(pile.top.kind)}
                        {kind(pile.top.kind)} · 这堆还有 {pile.left} 张
                      </span>
                    </>
                  ) : (
                    <span>这堆空了</span>
                  )}
                </button>
                {(v.market[col] ?? []).map((item, row) => {
                  const key = `${col}-${row}`;
                  return (
                    <button
                      // biome-ignore lint/suspicious/noArrayIndexKey: the two slots are fixed positions
                      key={row}
                      type="button"
                      className={`platter-item k${item?.kind ?? "x"}${itemPicks.includes(key) ? " selected" : ""}${item ? "" : " empty"}`}
                      disabled={!myTurn || !item}
                      onPointerDown={grab(
                        key,
                        <span className={`platter-item k${item?.kind ?? "x"} ghost`}>
                          {item ? kind(item.kind) : ""}
                        </span>,
                        () => toggle(key),
                        myTurn && !!item,
                      )}
                    >
                      {item ? (
                        <>
                          {mark(item.kind) && <span className="platter-mark">{mark(item.kind)}</span>}
                          {kind(item.kind)}
                        </>
                      ) : (
                        "—"
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </Felt>
      )}
      {myTurn && rulePick !== null && (
        <button type="button" className="primary wide" onClick={() => takeRule(rulePick)}>
          拿这张规则牌
        </button>
      )}
      {myTurn && rulePick === null && v.mustTake > 0 && (
        <button
          type="button"
          className="primary wide"
          disabled={itemPicks.length !== v.mustTake}
          onClick={() => takeItems(itemPicks)}
        >
          拿走选中的 {itemPicks.length}/{v.mustTake} 张材料
        </button>
      )}
      {v.phase === "finished" && <p className="answer">{v.winners.map(name).join("、")} 得分最高！</p>}

      <div className="platter-players">
        {order.map((p) => {
          const mine = p === me;
          return (
            <section
              key={p}
              data-drop={mine ? "plate" : undefined}
              className={`platter-player${mine ? " mine" : ""}${v.winners.includes(p) ? " win" : ""}${
                playing && p === v.current ? " turn" : ""
              }${mine && dragging !== null ? " target" : ""}`}
            >
              <header>
                <strong className="who-tag">
                  <Avatar room={room} id={p} size="s" />
                  {name(p)}
                  {mine ? "（你的盘子）" : ""}
                </strong>
                <span className="tag">{v.totals[p] ?? 0} 分</span>
              </header>
              <ul className="platter-tokens">
                {v.theme.kinds.map((k, i) => {
                  const n = v.items[p]?.[i] ?? 0;
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: the six kinds are fixed positions
                    <li key={i} className={`platter-count k${i}${n === 0 ? " zero" : ""}`}>
                      <span>
                        {k.mark ?? ""}
                        {k.label}
                      </span>
                      <b>{n}</b>
                    </li>
                  );
                })}
              </ul>
              {(v.rules[p] ?? []).length === 0 ? (
                <p className="muted small">还没有规则牌，材料现在不算分</p>
              ) : (
                <ul className="platter-rules">
                  {(v.rules[p] ?? []).map((r) => (
                    <li key={r.id}>
                      <span className={r.points < 0 ? "pts bad" : r.points === 0 ? "pts zero" : "pts"}>
                        {signed(r.points)}
                      </span>
                      <span className="text">{r.text}</span>
                      {mine && v.canFlip && (
                        <button type="button" disabled={paused} onClick={() => go({ type: "flip", cardId: r.id })}>
                          翻成{kind(r.kind)}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      {ghost}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
