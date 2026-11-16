/** Paper slips for the write-then-vote games: pick one, confirm, and a one-by-one reveal. */

import type { CSSProperties, ReactNode } from "react";
import { Avatar } from "../components/Avatar.tsx";
import type { GameProps } from "./registry.tsx";

export function Slips({ children, people }: { children: ReactNode; people?: boolean }) {
  return <div className={people ? "slips people" : "slips"}>{children}</div>;
}

/**
 * One answer on a slip of paper. With `onClick` it can be pressed to choose it; `order` makes
 * it appear in turn during a reveal (0 first), so the best one can be kept for last.
 */
export function Slip(props: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  selected?: boolean;
  tone?: "good" | "bad" | "plain";
  stamp?: string;
  order?: number;
  foot?: ReactNode;
}) {
  const cls = `slip${props.selected ? " selected" : ""}${props.tone ? ` ${props.tone}` : ""}${
    props.order !== undefined ? " reveal" : ""
  }`;
  const style = props.order !== undefined ? ({ animationDelay: `${props.order * 0.55}s` } as CSSProperties) : undefined;
  const body = (
    <>
      <span className="slip-text">{props.children}</span>
      {props.foot && <span className="slip-foot">{props.foot}</span>}
      {props.stamp && <span className="stamp">{props.stamp}</span>}
    </>
  );
  return props.onClick ? (
    <button type="button" className={cls} style={style} disabled={props.disabled} onClick={props.onClick}>
      {body}
    </button>
  ) : (
    <div className={cls} style={style}>
      {body}
    </div>
  );
}

/** The people who chose something, as a row of pictures. */
export function Stickers({ room, ids, label }: { room: GameProps["room"]; ids: string[]; label?: string }) {
  if (ids.length === 0) return <span className="muted small">{label ? `${label}：没有人` : "没有人选"}</span>;
  return (
    <span className="stickers">
      {label && <span className="small">{label}</span>}
      {ids.map((id) => (
        <Avatar key={id} room={room} id={id} size="s" />
      ))}
    </span>
  );
}
