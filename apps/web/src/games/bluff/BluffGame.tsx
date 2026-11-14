import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "write" | "select" | "reveal" | "finished";
  participants: string[];
  question: string;
  submitted: string[];
  myLie: string | null;
  options: { index: number; text: string; mine: boolean }[] | null;
  myPick: number | null;
  deadlineAt: number | null;
  reveal: { options: { text: string; authors: string[]; truth: boolean; pickers: string[] }[]; note?: string } | null;
}

export function BluffGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const playing = v.participants.includes(me);

  return (
    <div className="game">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      <h2 className="question">{v.question}</h2>
      {!playing && v.phase !== "reveal" && <p className="muted">你将从下一轮开始参与。</p>}

      {v.phase === "write" && (
        <>
          {playing &&
            (v.myLie ? (
              <p className="notice">
                你编的答案：<strong>{v.myLie}</strong>
              </p>
            ) : (
              <TextForm
                placeholder="编一个以假乱真的答案（最多 30 字）"
                button="提交"
                maxLength={30}
                disabled={paused}
                resetKey={v.step}
                onSubmit={(text) => go({ type: "lie", text })}
              />
            ))}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "select" && v.options && (
        <>
          <p className="muted">其中只有一个是真的。选出你相信的那个。</p>
          <div className="pick-grid">
            {v.options.map((o) => (
              <button
                key={o.index}
                type="button"
                className={v.myPick === o.index ? "pick picked" : "pick"}
                disabled={paused || !playing || o.mine || v.myPick != null}
                onClick={() => go({ type: "pick", index: o.index })}
              >
                {o.text}
                {o.mine ? "（我编的）" : ""}
              </button>
            ))}
          </div>
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <>
          <ul className="describe-list">
            {v.reveal.options.map((o) => (
              <li key={o.text} className={o.truth ? "picked" : ""}>
                <span className="text">
                  <strong>{o.text}</strong>
                  <br />
                  <span className="muted small">
                    {o.truth ? "✔ 真答案" : `${o.authors.map(name).join("、")} 编的`}
                    {o.pickers.length > 0 ? ` · ${o.pickers.map(name).join("、")} 选了它` : " · 没人选"}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          {v.reveal.note && <p className="muted">{v.reveal.note}</p>}
        </>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "write" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始选择
          </button>
        )}
        {v.phase === "select" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            提前揭晓
          </button>
        )}
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "advance" })}>
            {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
