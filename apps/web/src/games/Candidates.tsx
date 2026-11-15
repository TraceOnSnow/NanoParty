import { type ReactNode, useEffect, useState } from "react";
import { draftForAi } from "../chatBus.ts";

export interface HistoryItem {
  contentId: string;
  label: string;
  status: "shown" | "used" | "skipped";
  origin: "library" | "ai" | "player";
}

type Selection = { from: "current"; index: number } | { from: "history"; contentId: string } | null;

const STATUS = { shown: "未使用", used: "已玩", skipped: "跳过了" };
const ORIGIN = { library: "题库", ai: "AI 出的", player: "玩家写的" };

/**
 * The topic-choice area shared by every game with a pick phase: current candidates, the party's
 * candidate history, refresh, write-your-own, ask the AI, and an explicit confirm step.
 * Selecting is local; nothing is used up until "确认使用".
 */
export function Candidates(props: {
  /** Null when this viewer must not see the candidates. */
  candidates: ReactNode[] | null;
  history: HistoryItem[] | null;
  pickerName: string;
  isPicker: boolean;
  isHost: boolean;
  paused: boolean;
  allowCustom: boolean;
  /** Text put into the chat box by "让 AI 出题". */
  aiDraft: string;
  /** Round/step the choice belongs to; a new one clears the local selection. */
  resetKey: unknown;
  send(action: object): Promise<boolean>;
  /** The write-your-own form; receives the override flag to attach to its action. */
  custom?: (extra: object) => ReactNode;
}) {
  const { candidates, history, isPicker, paused } = props;
  const [tab, setTab] = useState<"current" | "history">("current");
  const [selected, setSelected] = useState<Selection>(null);
  const [own, setOwn] = useState(false);
  const [onlyUnused, setOnlyUnused] = useState(true);
  const [override, setOverride] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new round or a new batch clears the selection
  useEffect(() => setSelected(null), [props.resetKey, candidates?.length]);

  const canAct = (isPicker || (props.isHost && override)) && !paused;
  const extra = !isPicker && override ? { asPicker: true } : {};
  const suggestions = (history ?? []).filter((h) => h.origin === "ai" && h.status === "shown");
  const listed = (history ?? []).filter((h) => !onlyUnused || h.status === "shown");

  async function confirm() {
    if (!selected) return;
    const ok = await props.send(
      selected.from === "current"
        ? { type: "choose", index: selected.index, ...extra }
        : { type: "chooseHistory", contentId: selected.contentId, ...extra },
    );
    if (ok) setSelected(null);
  }

  const historyCard = (h: HistoryItem) => (
    <button
      key={h.contentId}
      type="button"
      className={`pick scale-card${selected?.from === "history" && selected.contentId === h.contentId ? " selected" : ""}${h.status === "shown" ? "" : " played"}`}
      disabled={!canAct}
      onClick={() => setSelected({ from: "history", contentId: h.contentId })}
    >
      {h.label}
      <span className="card-tags">
        <span className={`tag ${h.status}`}>{STATUS[h.status]}</span>
        <span className="tag">{ORIGIN[h.origin]}</span>
      </span>
    </button>
  );

  return (
    <div className="topic-picker">
      <p className="notice">
        {isPicker
          ? `轮到你选这一轮的题。先点一张，再点「确认使用」；不满意可以一直换${props.allowCustom ? "、自己出" : ""}，也可以让 AI 按你的想法出。`
          : candidates === null
            ? `${props.pickerName} 正在选题，候选只有 TA 能看到。`
            : `${props.pickerName} 正在选这一轮的题。你可以在右侧提建议，或让 AI 出题给 TA 参考。`}
      </p>

      {candidates !== null && (
        <>
          <div className="tabs">
            <button type="button" className={tab === "current" ? "tab on" : "tab"} onClick={() => setTab("current")}>
              当前候选
            </button>
            <button
              type="button"
              className={tab === "history" ? "tab on" : "tab"}
              onClick={() => {
                setTab("history");
                if (canAct) void props.send({ type: "history", ...extra });
              }}
            >
              历史候选{history && history.length > 0 ? `（${history.length}）` : ""}
            </button>
          </div>

          {tab === "current" && (
            <>
              <div className="pick-grid">
                {candidates.map((label, i) => (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: candidates are positional
                    key={i}
                    type="button"
                    className={`pick scale-card${selected?.from === "current" && selected.index === i ? " selected" : ""}`}
                    disabled={!canAct}
                    onClick={() => setSelected({ from: "current", index: i })}
                  >
                    {label}
                  </button>
                ))}
                {candidates.length === 0 && (
                  <p className="muted">
                    题库里暂时没有新的候选。可以看看「历史候选」{props.allowCustom ? "、自己出一道" : ""}，或让 AI
                    出题。
                  </p>
                )}
              </div>
              {suggestions.length > 0 && (
                <>
                  <p className="muted small">AI 出的题（还没用过）：</p>
                  <div className="pick-grid">{suggestions.map(historyCard)}</div>
                </>
              )}
            </>
          )}

          {tab === "history" && (
            <>
              <label className="muted small">
                <input type="checkbox" checked={onlyUnused} onChange={(e) => setOnlyUnused(e.target.checked)} />{" "}
                只看未使用
              </label>
              <div className="pick-grid">
                {listed.map(historyCard)}
                {listed.length === 0 && (
                  <p className="muted">
                    {history && history.length > 0
                      ? "没有未使用的了；取消「只看未使用」可以重玩已玩过的题。"
                      : "这场派对还没有出现过别的候选。"}
                  </p>
                )}
              </div>
            </>
          )}
        </>
      )}

      {(isPicker || props.isHost) && (
        <div className="host-row">
          {canAct && (
            <>
              <button type="button" className="primary" disabled={!selected} onClick={confirm}>
                确认使用
              </button>
              <button type="button" onClick={() => props.send({ type: "refresh", ...extra })}>
                换一批
              </button>
              {props.allowCustom && props.custom && (
                <button type="button" onClick={() => setOwn((o) => !o)}>
                  {own ? "收起" : "自己出题"}
                </button>
              )}
            </>
          )}
          {!isPicker && props.isHost && (
            <label className="muted small" title="房主可以在题主不方便时代为选题">
              <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> 房主代选
            </label>
          )}
        </div>
      )}
      <div className="host-row">
        <button type="button" onClick={() => draftForAi(props.aiDraft)}>
          让 AI 出题…
        </button>
        <span className="muted small">在右侧说出想要的主题，点「发送并找 AI」。</span>
      </div>
      {canAct && own && props.custom?.(extra)}
    </div>
  );
}
