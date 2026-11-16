import { useEffect, useState } from "react";
import { Slip, Slips, Stickers } from "../answers.tsx";
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
  const [chosen, setChosen] = useState<number | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step means new options
  useEffect(() => setChosen(null), [v.step]);
  const canPick = v.phase === "select" && playing && v.myPick == null && !paused;
  // Lies first (the ones that fooled fewest first), the truth last.
  const revealed = [...(v.reveal?.options ?? [])].sort(
    (a, b) => Number(a.truth) - Number(b.truth) || a.pickers.length - b.pickers.length,
  );

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
          <p className="muted">
            其中只有一个是真的。{v.myPick != null ? "你选好了，等其他人…" : "点一张你相信的，再确认。"}
          </p>
          <Slips>
            {v.options.map((o) => (
              <Slip
                key={o.index}
                selected={chosen === o.index || v.myPick === o.index}
                disabled={!canPick || o.mine}
                stamp={o.mine ? "我编的" : v.myPick === o.index ? "我信这个" : undefined}
                onClick={() => setChosen(o.index)}
              >
                {o.text}
              </Slip>
            ))}
          </Slips>
          {canPick && (
            <button
              type="button"
              className="primary wide"
              disabled={chosen === null}
              onClick={() => chosen !== null && go({ type: "pick", index: chosen })}
            >
              {chosen === null ? "点一张你相信的" : "就信这个"}
            </button>
          )}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <>
          <Slips>
            {revealed.map((o, i) => (
              <Slip
                key={o.text}
                order={i}
                tone={o.truth ? "good" : "plain"}
                stamp={o.truth ? "真的！" : o.pickers.length > 0 ? `骗到 ${o.pickers.length} 人` : undefined}
                foot={
                  <>
                    {!o.truth && <Stickers room={room} ids={o.authors} label="编的人" />}
                    <Stickers room={room} ids={o.pickers} label={o.truth ? "看穿的人" : "上当的人"} />
                  </>
                }
              >
                {o.text}
              </Slip>
            ))}
          </Slips>
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
