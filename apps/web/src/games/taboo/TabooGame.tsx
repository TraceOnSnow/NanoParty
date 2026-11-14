import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  turn: number;
  totalTurns: number;
  step: number;
  phase: "describe" | "turnOver" | "finished";
  describer: string;
  referee: string;
  card: { word: string; taboo: string[] } | null;
  guesses: { by: string; text: string }[];
  played: { word: string; outcome: "guessed" | "passed" | "foul" | "timeout"; by: string | null }[];
  deadlineAt: number | null;
  endedBecause: "turns" | "no-content" | null;
}

const OUTCOME = { guessed: "猜中", passed: "跳过", foul: "犯规", timeout: "时间到" };

export function TabooGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const describing = me === v.describer;
  const judging = me === v.referee;

  return (
    <div className="game">
      <GameHead label={roundLabel(v.turn, v.totalTurns, "回合")} deadlineAt={v.deadlineAt} paused={paused} />
      <p className="muted">
        描述者：<strong>{name(v.describer)}</strong>　裁判：<strong>{name(v.referee)}</strong>
      </p>

      {v.phase === "describe" && v.card && (
        <div className="card taboo-card">
          <h2>{v.card.word}</h2>
          <p className="muted small">{describing ? "在语音里描述它，但不能说：" : "你是裁判，听到这些词就判犯规："}</p>
          <ul className="chips">
            {v.card.taboo.map((w) => (
              <li key={w} className="chip undercover">
                {w}
              </li>
            ))}
          </ul>
          <div className="host-row">
            {describing && (
              <button type="button" disabled={paused} onClick={() => go({ type: "pass" })}>
                跳过这个词
              </button>
            )}
            {judging && (
              <button type="button" disabled={paused} onClick={() => go({ type: "foul" })}>
                犯规！
              </button>
            )}
          </div>
        </div>
      )}
      {v.phase === "describe" && !v.card && (
        <TextForm
          placeholder={`听 ${name(v.describer)} 的描述，输入你的猜测`}
          button="猜"
          maxLength={20}
          disabled={paused}
          resetKey={v.step}
          onSubmit={(text) => go({ type: "guess", text })}
        />
      )}
      {v.phase === "describe" && v.guesses.length > 0 && (
        <p className="muted">猜过：{v.guesses.map((g) => `${name(g.by)}「${g.text}」`).join("　")}</p>
      )}

      {v.played.length > 0 && (
        <ul className="describe-list">
          {v.played.map((p) => (
            <li key={p.word} className={p.outcome === "guessed" ? "picked" : ""}>
              <span className="text">{p.word}</span>
              <span className="tag">
                {OUTCOME[p.outcome]}
                {p.by ? `：${name(p.by)}` : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
      {v.phase === "turnOver" && v.endedBecause === "no-content" && <p className="notice">词卡用完了。</p>}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "turnOver" ? "等待房主继续…" : undefined}>
        {v.phase === "turnOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.turn >= v.totalTurns || v.endedBecause ? "结束并回到大厅" : "下一位描述"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
