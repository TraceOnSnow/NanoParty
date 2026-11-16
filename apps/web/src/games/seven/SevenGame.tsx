import { type ReactNode, useEffect, useState } from "react";
import { useDragDrop } from "../drag.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Felt, Seats } from "../table.tsx";
import { GameHead, useNames } from "../ui.tsx";

interface CardView {
  id: string;
  suit: number;
  name: string;
  base: number;
  text: string;
}
type Scored = CardView & { blank: boolean; value: number };

interface View {
  step: number;
  phase: "draw" | "discard" | "finished";
  players: string[];
  current: string;
  theme: { name: string; suits: { label: string }[] };
  deckLeft: number;
  discards: CardView[];
  endAt: number;
  hand: Scored[] | null;
  myTotal: number | null;
  ifDiscard: Record<string, number> | null;
  ifTake: Record<string, number> | null;
  handSizes: Record<string, number>;
  final: Record<string, { total: number; cards: Scored[] }> | null;
  winners: string[];
  deadlineAt: number | null;
}

/** What is being carried or chosen: the deck, an open card or one of my own. */
type Pick = { from: "deck" } | { from: "open" | "hand"; id: string };

function Face({ card, suit, hint }: { card: CardView | Scored; suit: string; hint?: ReactNode }) {
  const scored = "value" in card ? card : null;
  return (
    <>
      <span className="seven-top">
        <em>{suit}</em>
        <b>{scored ? (scored.blank ? "作废" : scored.value) : card.base}</b>
      </span>
      <strong>{card.name}</strong>
      <span className="seven-text">
        基础 {card.base} · {card.text}
      </span>
      {hint}
    </>
  );
}

export function SevenGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const suit = (k: number) => v.theme.suits[k]?.label ?? "?";
  const playing = v.phase !== "finished";
  const myTurn = playing && v.current === me && !paused;
  const drawing = myTurn && v.phase === "draw";
  const discarding = myTurn && v.phase === "discard";
  const [chosen, setChosen] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means the cards changed
  useEffect(() => setChosen(null), [v.step]);

  const { dragging, grab, ghost } = useDragDrop<Pick>((pick, target) => {
    if (pick.from === "hand" && target === "table" && discarding) void go({ type: "discard", cardId: pick.id });
    if (pick.from === "open" && target === "hand" && drawing) void go({ type: "take", cardId: pick.id });
    if (pick.from === "deck" && target === "hand" && drawing) void go({ type: "draw" });
  });
  const toggle = (id: string) => setChosen((now) => (now === id ? null : id));
  const total = v.myTotal ?? 0;
  const bestDiscard = v.ifDiscard ? Math.max(...Object.values(v.ifDiscard)) : null;
  const delta = (n: number) => (n === total ? "不变" : n > total ? `+${n - total}` : `${n - total}`);

  const open = v.discards.find((c) => c.id === chosen);
  const mine = v.hand?.find((c) => c.id === chosen);
  const order = [...v.players].sort((a, b) => (v.final?.[b]?.total ?? 0) - (v.final?.[a]?.total ?? 0));

  return (
    <div className="game wide seven">
      <GameHead
        label={`${v.theme.name} · 牌堆 ${v.deckLeft} 张`}
        deadlineAt={playing ? v.deadlineAt : null}
        paused={paused}
      />
      <Seats
        room={room}
        ids={v.players}
        current={playing ? v.current : null}
        win={v.winners}
        note={(p) => (
          <span className="tag">{v.final ? `${v.final[p]?.total ?? 0} 分` : `${v.handSizes[p] ?? 0} 张`}</span>
        )}
      />

      {playing && (
        <Felt hot={dragging?.from === "hand"}>
          <div className="felt-note">
            <span>弃牌区</span>
            <span className="seven-pips">
              {Array.from({ length: v.endAt }, (_, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: fixed positions
                <i key={i} className={i < v.discards.length ? "on" : ""} />
              ))}
            </span>
            <span>
              {v.discards.length}/{v.endAt}，摆满就结束
            </span>
          </div>
          <div className="seven-row">
            <button
              type="button"
              className="seven-card seven-deck"
              disabled={!drawing || v.deckLeft === 0}
              onPointerDown={grab(
                { from: "deck" },
                <span className="seven-card seven-deck ghost">牌堆</span>,
                () => void go({ type: "draw" }),
                drawing && v.deckLeft > 0,
              )}
            >
              <strong>牌堆</strong>
              <span className="seven-text">还有 {v.deckLeft} 张，摸到什么算什么</span>
              {drawing && v.deckLeft > 0 && <span className="seven-action">点一下摸一张</span>}
            </button>
            {v.discards.map((c) => {
              const after = v.ifTake?.[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`seven-card s${c.suit}${chosen === c.id ? " lifted" : ""}`}
                  disabled={!drawing}
                  onPointerDown={grab(
                    { from: "open", id: c.id },
                    <span className={`seven-card s${c.suit} ghost`}>
                      <strong>{c.name}</strong>
                    </span>,
                    () => toggle(c.id),
                    drawing,
                  )}
                >
                  <Face
                    card={c}
                    suit={suit(c.suit)}
                    hint={
                      after !== undefined && (
                        <span className={`seven-hint${after > total ? " up" : ""}`}>
                          拿它最多到 {after} 分（{delta(after)}）
                        </span>
                      )
                    }
                  />
                </button>
              );
            })}
            {v.discards.length === 0 && <span className="felt-note">还没有人弃牌</span>}
          </div>
        </Felt>
      )}

      {playing && (
        <p className={myTurn ? "turn-line mine" : "turn-line"}>
          {drawing
            ? "轮到你：摸牌堆，或者从弃牌区挑一张（点一下看清楚再确认，也可以直接拖进手牌）。"
            : discarding
              ? "现在手里八张，弃掉一张：点一张再确认，或者把它拖到桌上。"
              : `等 ${name(v.current)}${v.phase === "draw" ? "摸牌" : "弃牌"}…`}
        </p>
      )}
      {open && drawing && (
        <button type="button" className="primary wide" onClick={() => go({ type: "take", cardId: open.id })}>
          拿走「{open.name}」
        </button>
      )}

      {v.hand && playing && (
        <>
          <h3 className="seven-title">
            你的手牌 <span className="tag">现在 {v.myTotal} 分</span>
          </h3>
          <div
            className={`seven-row seven-hand${dragging && dragging.from !== "hand" ? " target" : ""}`}
            data-drop="hand"
          >
            {v.hand.map((c) => {
              const after = v.ifDiscard?.[c.id];
              return (
                <button
                  key={c.id}
                  type="button"
                  className={`seven-card s${c.suit}${c.blank ? " blank" : ""}${chosen === c.id ? " lifted" : ""}`}
                  disabled={!discarding}
                  onPointerDown={grab(
                    { from: "hand", id: c.id },
                    <span className={`seven-card s${c.suit} ghost`}>
                      <strong>{c.name}</strong>
                    </span>,
                    () => toggle(c.id),
                    discarding,
                  )}
                >
                  <Face
                    card={c}
                    suit={suit(c.suit)}
                    hint={
                      after !== undefined && (
                        <span className={`seven-hint${after === bestDiscard ? " up" : ""}`}>弃它剩 {after} 分</span>
                      )
                    }
                  />
                </button>
              );
            })}
          </div>
          {mine && discarding && (
            <button type="button" className="primary wide" onClick={() => go({ type: "discard", cardId: mine.id })}>
              弃掉「{mine.name}」{v.ifDiscard ? `，手牌变成 ${v.ifDiscard[mine.id]} 分` : ""}
            </button>
          )}
        </>
      )}

      {v.final && (
        <>
          <p className="answer">{v.winners.map(name).join("、")} 的手牌最强！</p>
          {order.map((p) => (
            <section key={p} className={v.winners.includes(p) ? "seven-final win" : "seven-final"}>
              <h3 className="seven-title">
                {name(p)} <span className="tag">{v.final?.[p]?.total} 分</span>
              </h3>
              <div className="seven-row">
                {(v.final?.[p]?.cards ?? []).map((c) => (
                  <span key={c.id} className={`seven-card s${c.suit}${c.blank ? " blank" : ""}`}>
                    <Face card={c} suit={suit(c.suit)} />
                  </span>
                ))}
              </div>
            </section>
          ))}
        </>
      )}
      {ghost}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
