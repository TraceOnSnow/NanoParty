/** A card table shared by the card games: the felt, the seats around it and a hand you play from. */

import { type ReactNode, useEffect, useState } from "react";
import { Avatar } from "../components/Avatar.tsx";
import { useDragDrop } from "./drag.tsx";
import type { GameProps } from "./registry.tsx";

/** The table surface. Cards dragged from the hand can be dropped anywhere on it. */
export function Felt({ hot, children, className = "" }: { hot?: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`felt${hot ? " hot" : ""} ${className}`} data-drop="table">
      {children}
    </div>
  );
}

/**
 * One box per player: picture, name and whatever the game shows in front of them.
 * A seat can be picked (pressed, or have a card dropped on it) when `onPick` allows it.
 */
export function Seats(props: {
  room: GameProps["room"];
  ids: string[];
  current?: string | null;
  /** The seat the viewer has chosen but not confirmed yet. */
  chosen?: string | null;
  wide?: boolean;
  out?: string[];
  win?: string[];
  pickable?(id: string): boolean;
  onPick?(id: string): void;
  note?(id: string): ReactNode;
  children?(id: string): ReactNode;
}) {
  const { room } = props;
  const me = room.me.playerId;
  return (
    <div className={props.wide ? "seats wide" : "seats"}>
      {props.ids.map((id) => {
        const pick = props.pickable?.(id) ?? false;
        const cls = `pseat${id === props.current ? " turn" : ""}${props.out?.includes(id) ? " out" : ""}${
          props.win?.includes(id) ? " win" : ""
        }${pick ? " pick" : ""}${id === me ? " mine" : ""}${id === props.chosen ? " chosen" : ""}`;
        const body = (
          <>
            <span className="seat-head">
              <Avatar room={room} id={id} size="s" />
              <span className="seat-name">{room.members.find((m) => m.id === id)?.nickname ?? "?"}</span>
              {props.note?.(id)}
            </span>
            {props.children && <span className="seat-body">{props.children(id)}</span>}
          </>
        );
        return pick ? (
          <button key={id} type="button" className={cls} data-drop={`seat:${id}`} onClick={() => props.onPick?.(id)}>
            {body}
          </button>
        ) : (
          <div key={id} className={cls} data-drop={`seat:${id}`}>
            {body}
          </div>
        );
      })}
    </div>
  );
}

/**
 * The cards in your hand. Press one to lift it, then confirm; or drag it straight onto the
 * table (or onto a seat). `onPlay` receives where it was dropped: "table" or "seat:<id>".
 */
export function PlayHand<T>(props: {
  cards: T[];
  face(card: T): ReactNode;
  enabled: boolean;
  playable?(card: T): boolean;
  /** Text of the confirm button; return null to hide it (the game then handles the choice). */
  confirm?(card: T): string | null;
  onPlay(card: T, target: string): void;
  onSelect?(card: T | null): void;
  resetKey: unknown;
  empty?: string;
}) {
  const [lifted, setLifted] = useState<number | null>(null);
  const select = (i: number | null) => {
    setLifted(i);
    props.onSelect?.(i === null ? null : (props.cards[i] as T));
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means the hand changed
  useEffect(() => select(null), [props.resetKey]);
  const { dragging, grab, ghost } = useDragDrop<number>((i, target) => {
    const card = props.cards[i];
    if (card !== undefined) props.onPlay(card, target);
  });
  const can = (card: T) => props.enabled && (props.playable?.(card) ?? true);
  const chosen = lifted !== null ? props.cards[lifted] : undefined;
  const label = chosen !== undefined && can(chosen) ? (props.confirm ? props.confirm(chosen) : "打出这张") : null;

  return (
    <div className="play-hand">
      <div className="hand">
        {props.cards.map((card, i) => (
          <button
            // biome-ignore lint/suspicious/noArrayIndexKey: equal cards can sit in one hand
            key={i}
            type="button"
            className={`hand-slot${lifted === i ? " lifted" : ""}${dragging === i ? " carried" : ""}${
              props.enabled && !can(card) ? " dim" : ""
            }`}
            disabled={!can(card)}
            onPointerDown={grab(i, props.face(card), () => select(lifted === i ? null : i), can(card))}
          >
            {props.face(card)}
          </button>
        ))}
        {props.cards.length === 0 && props.empty && <span className="muted">{props.empty}</span>}
      </div>
      {label && chosen !== undefined && (
        <button type="button" className="primary wide" onClick={() => props.onPlay(chosen, "table")}>
          {label}
        </button>
      )}
      {ghost}
    </div>
  );
}

/** A face-down card or pile. */
export function CardBack({ count, label }: { count?: number; label?: string }) {
  return (
    <span className="card-face back">
      {count !== undefined && <strong>{count}</strong>}
      {label && <span>{label}</span>}
    </span>
  );
}

/** A minus / plus number picker. */
export function Stepper(props: { value: number; min: number; max: number; unit?: string; onChange(n: number): void }) {
  const { value, min, max } = props;
  return (
    <span className="stepper">
      <button type="button" disabled={value <= min} onClick={() => props.onChange(Math.max(min, value - 1))}>
        −
      </button>
      <strong>
        {value}
        {props.unit ?? ""}
      </strong>
      <button type="button" disabled={value >= max} onClick={() => props.onChange(Math.min(max, value + 1))}>
        ＋
      </button>
    </span>
  );
}
