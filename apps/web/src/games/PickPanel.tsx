import { type FormEvent, useState } from "react";
import type { GameProps } from "./registry.tsx";
import { useAct } from "./shared.ts";
import { GameHead, roundLabel, useNames } from "./ui.tsx";

/** Mirrors PickView in @apr/games. */
export interface PickInfo {
  picker: string;
  candidates: string[] | null;
  allowCustom: boolean;
}

export interface CustomField {
  key: string;
  label: string;
  placeholder: string;
  optional?: boolean;
}

interface PickableView {
  round: number;
  totalRounds: number;
  step: number;
  phase: string;
  deadlineAt: number | null;
  pick: PickInfo | null;
}

/** Returns the pick info when the game view is in its topic-pick phase. */
export const pickOf = (view: unknown): PickInfo | null => {
  const v = view as Partial<PickableView> | null;
  return v?.phase === "pick" && v.pick ? v.pick : null;
};

/** Shared "choose this round's topic" screen for every game with a pick phase. */
export function PickPanel({ view, room, paused, act, fields }: GameProps & { fields: CustomField[] }) {
  const v = view as PickableView;
  const pick = v.pick as PickInfo;
  const name = useNames(room);
  const { error, send } = useAct(act);
  const isPicker = pick.picker === room.me.playerId;
  const [own, setOwn] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const go = (action: object) => send({ ...action, step: v.step });

  function submit(e: FormEvent) {
    e.preventDefault();
    const entries = fields.map((f) => [f, (values[f.key] ?? "").trim()] as const);
    if (entries.some(([f, x]) => !x && !f.optional)) return;
    const payload = Object.fromEntries(entries.filter(([, x]) => x).map(([f, x]) => [f.key, x]));
    void go({ type: "custom", payload });
  }

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · 选题：${name(pick.picker)}`}
        deadlineAt={v.deadlineAt}
        paused={paused}
      />
      <p className="notice">
        {isPicker
          ? `轮到你出这一轮的题。挑一道，不满意可以一直换${pick.allowCustom ? "，也可以自己出" : ""}；想要特定主题可以在群聊里 @AI。`
          : pick.candidates === null
            ? `${name(pick.picker)} 正在选题。你是本轮猜词者，看不到候选。`
            : `${name(pick.picker)} 正在选这一轮的题…（想要特定主题可以在群聊里 @AI）`}
      </p>
      {pick.candidates !== null && (
        <div className="pick-grid">
          {pick.candidates.map((label, i) => (
            <button
              key={label}
              type="button"
              className="pick scale-card"
              disabled={!isPicker || paused}
              onClick={() => go({ type: "choose", index: i })}
            >
              {label}
            </button>
          ))}
          {pick.candidates.length === 0 && (
            <p className="muted">题库里暂时没有候选{pick.allowCustom ? "，自己出一道吧" : ""}。</p>
          )}
        </div>
      )}
      {isPicker && (
        <div className="host-row">
          <button type="button" disabled={paused} onClick={() => go({ type: "refresh" })}>
            换一批
          </button>
          {pick.allowCustom && fields.length > 0 && (
            <button type="button" disabled={paused} onClick={() => setOwn((o) => !o)}>
              {own ? "收起" : "自己出题"}
            </button>
          )}
        </div>
      )}
      {isPicker && own && (
        <form className="answer-row" onSubmit={submit}>
          {fields.map((f) => (
            <input
              key={f.key}
              aria-label={f.label}
              value={values[f.key] ?? ""}
              onChange={(e) => setValues((x) => ({ ...x, [f.key]: e.target.value }))}
              maxLength={60}
              placeholder={f.placeholder}
            />
          ))}
          <button type="submit" className="primary" disabled={paused}>
            用这道
          </button>
        </form>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
