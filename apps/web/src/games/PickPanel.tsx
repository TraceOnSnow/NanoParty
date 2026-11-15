import { type FormEvent, useState } from "react";
import { Candidates, type HistoryItem } from "./Candidates.tsx";
import type { GameProps } from "./registry.tsx";
import { useAct } from "./shared.ts";
import { GameHead, roundLabel, useNames } from "./ui.tsx";

/** Mirrors PickView in @apr/games. */
export interface PickInfo {
  picker: string;
  candidates: string[] | null;
  allowCustom: boolean;
  history: HistoryItem[] | null;
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
  const [values, setValues] = useState<Record<string, string>>({});
  const go = (action: object) => send({ ...action, step: v.step });
  const gameName = room.games.find((g) => g.id === room.segment?.gameId)?.name ?? "这个游戏";

  const custom = (extra: object) => (
    <form
      className="answer-row"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const entries = fields.map((f) => [f, (values[f.key] ?? "").trim()] as const);
        if (entries.some(([f, x]) => !x && !f.optional)) return;
        const payload = Object.fromEntries(entries.filter(([, x]) => x).map(([f, x]) => [f.key, x]));
        void go({ type: "custom", payload, ...extra });
      }}
    >
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
  );

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · 选题：${name(pick.picker)}`}
        deadlineAt={v.deadlineAt}
        paused={paused}
      />
      <Candidates
        candidates={pick.candidates}
        history={pick.history}
        pickerName={name(pick.picker)}
        isPicker={isPicker}
        isHost={room.me.isHost}
        paused={paused}
        allowCustom={pick.allowCustom && fields.length > 0}
        aiDraft={`给「${gameName}」出三道关于____的题`}
        resetKey={v.step}
        send={go}
        custom={custom}
      />
      {error && <p className="error">{error}</p>}
    </div>
  );
}
