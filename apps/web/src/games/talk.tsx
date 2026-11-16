/** A question-and-answer log shared by the asking games: who said what, and the ruling as a stamp. */

import { Children, type ReactNode, useEffect, useRef } from "react";
import { Avatar } from "../components/Avatar.tsx";
import type { GameProps } from "./registry.tsx";

export type Tone = "yes" | "no" | "mid" | "off" | "win";

/**
 * The log keeps its own height and scrolls inside, so the input under it never moves away.
 * A new line brings the newest into view, or the first one still waiting for the viewer.
 */
export function QaLog({ children, className = "" }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLUListElement>(null);
  const lines = Children.count(children);
  // biome-ignore lint/correctness/useExhaustiveDependencies: follow the log as it grows
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const todo = el.querySelector<HTMLElement>(".qa.todo");
    el.scrollTop = todo ? todo.offsetTop - 8 : el.scrollHeight;
  }, [lines]);
  return (
    <ul ref={box} className={`qa-log ${className}`}>
      {children}
    </ul>
  );
}

/**
 * One line of the log. `stamp` is the ruling; without it `waiting` is shown instead.
 * `children` are the controls that belong to this line (answer buttons, corrections).
 */
export function Qa(props: {
  room: GameProps["room"];
  by?: string;
  /** Shown instead of a player, e.g. for a hint. */
  label?: string;
  text: ReactNode;
  stamp?: string | null;
  tone?: Tone;
  waiting?: ReactNode;
  todo?: boolean;
  note?: ReactNode;
  /** Small controls kept on the same line, next to the stamp. */
  aside?: ReactNode;
  children?: ReactNode;
}) {
  const name = props.by ? (props.room.members.find((m) => m.id === props.by)?.nickname ?? "?") : props.label;
  return (
    <li className={`qa${props.tone ? ` ${props.tone}` : ""}${props.todo ? " todo" : ""}`}>
      {props.by ? <Avatar room={props.room} id={props.by} size="s" /> : <span className="qa-mark">💡</span>}
      <span className="qa-body">
        <span className="qa-who">{name}</span>
        <span className="text">{props.text}</span>
        {props.note}
      </span>
      {props.aside && <span className="qa-aside">{props.aside}</span>}
      {props.stamp ? (
        <strong className="qa-stamp">{props.stamp}</strong>
      ) : (
        props.waiting && <span className="muted small qa-wait">{props.waiting}</span>
      )}
      {props.children && <span className="qa-actions">{props.children}</span>}
    </li>
  );
}
