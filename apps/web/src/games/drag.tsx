import { type ReactNode, type PointerEvent as ReactPointerEvent, useState } from "react";

interface Dragging<T> {
  item: T;
  x: number;
  y: number;
  ghost: ReactNode;
}

/**
 * Press-and-move dragging that works the same with a mouse and a finger.
 * Things that can receive a drop carry `data-drop="<target>"`; `onDrop` gets that string.
 * A press released without moving is a tap, so tapping stays available as the fallback.
 */
export function useDragDrop<T>(onDrop: (item: T, target: string) => void) {
  const [dragging, setDragging] = useState<Dragging<T> | null>(null);

  const grab =
    (item: T, ghost: ReactNode, onTap?: () => void, enabled = true) =>
    (e: ReactPointerEvent) => {
      if (!enabled) return;
      e.preventDefault();
      const start = { x: e.clientX, y: e.clientY };
      let moved = false;
      const move = (ev: PointerEvent) => {
        if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return;
        moved = true;
        setDragging({ item, x: ev.clientX, y: ev.clientY, ghost });
      };
      const up = (ev: PointerEvent) => {
        window.removeEventListener("pointermove", move);
        setDragging(null);
        if (!moved) return onTap?.();
        const target = document
          .elementFromPoint(ev.clientX, ev.clientY)
          ?.closest("[data-drop]")
          ?.getAttribute("data-drop");
        if (target) onDrop(item, target);
      };
      window.addEventListener("pointermove", move);
      window.addEventListener("pointerup", up, { once: true });
    };

  /** Render once inside the panel: the thing being carried, following the pointer. */
  const ghost = dragging ? (
    <span className="drag-ghost" style={{ left: dragging.x, top: dragging.y }}>
      {dragging.ghost}
    </span>
  ) : null;

  return { dragging: dragging?.item ?? null, grab, ghost };
}

/**
 * A vertical list that is reordered by dragging a row (mouse or finger). The order changes
 * live while the row is carried; the arrow buttons stay as the fallback.
 */
export function SortList(props: {
  ids: string[];
  disabled?: boolean;
  onChange(ids: string[]): void;
  render(id: string, index: number): ReactNode;
}) {
  const { ids, disabled, onChange } = props;
  const [carried, setCarried] = useState<string | null>(null);
  const rows = new Map<string, HTMLLIElement>();
  const latest = { ids };

  const start = (id: string) => (e: ReactPointerEvent) => {
    if (disabled || (e.target as HTMLElement).closest("button")) return;
    e.preventDefault();
    setCarried(id);
    const move = (ev: PointerEvent) => {
      const others = latest.ids.filter((x) => x !== id);
      const before = others.filter((x) => {
        const box = rows.get(x)?.getBoundingClientRect();
        return box ? box.top + box.height / 2 < ev.clientY : false;
      }).length;
      const next = [...others.slice(0, before), id, ...others.slice(before)];
      if (next.join() !== latest.ids.join()) {
        latest.ids = next;
        onChange(next);
      }
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      setCarried(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up, { once: true });
  };
  const step = (index: number, delta: number) => {
    const next = [...ids];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target] as string, next[index] as string];
    onChange(next);
  };

  return (
    <ol className="sort-list">
      {ids.map((id, i) => (
        <li
          key={id}
          ref={(el) => {
            if (el) rows.set(id, el);
          }}
          className={carried === id ? "carried" : ""}
          onPointerDown={start(id)}
        >
          <span className="sort-grip" aria-hidden="true">
            ⋮⋮
          </span>
          <span className="sort-rank">{i + 1}</span>
          <span className="sort-body">{props.render(id, i)}</span>
          <button type="button" disabled={disabled || i === 0} onClick={() => step(i, -1)} aria-label="上移">
            ↑
          </button>
          <button
            type="button"
            disabled={disabled || i === ids.length - 1}
            onClick={() => step(i, 1)}
            aria-label="下移"
          >
            ↓
          </button>
        </li>
      ))}
    </ol>
  );
}
