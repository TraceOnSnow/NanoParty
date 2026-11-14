/** Small building blocks shared by game panels. */
import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import type { GameProps } from "./registry.tsx";
import { useCountdown } from "./shared.ts";

export function useNames(room: GameProps["room"]) {
  return (id: string) => room.members.find((m) => m.id === id)?.nickname ?? "?";
}

/** Round label on the left, countdown on the right. */
export function GameHead({ label, deadlineAt, paused }: { label: string; deadlineAt: number | null; paused: boolean }) {
  const seconds = useCountdown(paused ? null : deadlineAt);
  return (
    <div className="game-head">
      <span className="tag">{label}</span>
      {seconds != null && <span className={seconds <= 5 ? "tag timer urgent" : "tag timer"}>{seconds}s</span>}
    </div>
  );
}

export const roundLabel = (round: number, total: number, unit = "轮") =>
  `第 ${round} ${unit}${total > 0 ? ` / 共 ${total} ${unit}` : ""}`;

/** Who has acted so far. */
export function Progress({ ids, done, name }: { ids: string[]; done: string[]; name(id: string): string }) {
  return (
    <ul className="chips">
      {ids.map((id) => (
        <li key={id} className={done.includes(id) ? "chip done" : "chip"}>
          {name(id)} {done.includes(id) ? "✓" : "…"}
        </li>
      ))}
    </ul>
  );
}

/** One-line text submission. Clears itself when `resetKey` changes. */
export function TextForm(props: {
  placeholder: string;
  button: string;
  maxLength: number;
  disabled?: boolean;
  resetKey: unknown;
  onSubmit(text: string): Promise<boolean> | undefined;
}) {
  const [text, setText] = useState("");
  // biome-ignore lint/correctness/useExhaustiveDependencies: clear the field when the phase moves on
  useEffect(() => setText(""), [props.resetKey]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    const value = text.trim();
    if (value && (await props.onSubmit(value))) setText("");
  }
  return (
    <form className="answer-row" onSubmit={submit}>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        maxLength={props.maxLength}
        placeholder={props.placeholder}
        disabled={props.disabled}
      />
      <button type="submit" className="primary" disabled={props.disabled}>
        {props.button}
      </button>
    </form>
  );
}

/** Host-only controls, or a waiting note for everyone else when `waitNote` is set. */
export function HostControls({
  isHost,
  waitNote,
  children,
}: {
  isHost: boolean;
  waitNote?: string;
  children: ReactNode;
}) {
  if (isHost) return <div className="host-row">{children}</div>;
  return waitNote ? <p className="muted">{waitNote}</p> : null;
}

export const lastRound = (round: number, total: number) => total > 0 && round >= total;
