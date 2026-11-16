import { useEffect, useState } from "react";
import { Avatar, Who } from "../../components/Avatar.tsx";
import { Slip, Slips } from "../answers.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "write" | "vote" | "reveal" | "finished";
  participants: string[];
  dilemma: { text: string; yes: string; no: string };
  submitted: string[];
  myFill: string | null;
  versions: { author: string; fill: string }[] | null;
  myVotes: Record<string, boolean> | null;
  deadlineAt: number | null;
  results: { author: string; fill: string; yes: string[]; no: string[]; points: number }[] | null;
}

const BLANK = "____";
const fillIn = (text: string, fill: string) => text.replace(BLANK, `【${fill}】`);
/** Only the clause that holds the blank: the full question is already the heading. */
const clause = (text: string, fill: string) => {
  const [before = "", after = ""] = text.split(BLANK);
  const head = before.slice(Math.max(before.lastIndexOf("，"), before.lastIndexOf("。")) + 1);
  return (
    <>
      <span className="muted">…{head}</span>
      <b>{fill}</b>
      <span className="muted">{after.split(/[。？！]/)[0]}</span>
    </>
  );
};

export function SplitGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [answers, setAnswers] = useState<Record<string, boolean>>({});
  // biome-ignore lint/correctness/useExhaustiveDependencies: new choices each phase
  useEffect(() => setAnswers({}), [v.step]);
  const others = (v.versions ?? []).filter((x) => x.author !== me);
  const voting = v.phase === "vote" && v.myVotes === null && others.length > 0;

  return (
    <div className="game">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      <h2 className="question">{v.dilemma.text}</h2>

      {v.phase === "write" && (
        <>
          <p className="muted">填上空格，让大家刚好分成两派。</p>
          {v.myFill ? (
            <p className="notice">你的版本：{fillIn(v.dilemma.text, v.myFill)}</p>
          ) : v.participants.includes(me) ? (
            <TextForm
              placeholder="填空（最多 30 字）"
              button="提交"
              maxLength={30}
              disabled={paused}
              resetKey={v.step}
              onSubmit={(text) => go({ type: "fill", text })}
            />
          ) : (
            <p className="muted">你将从下一轮开始参与。</p>
          )}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "vote" && v.versions && (
        <>
          <p className="muted">
            {voting ? "每个版本都表个态（自己写的不用）。" : v.myVotes ? "表态完了，等其他人…" : "等大家表态…"}
          </p>
          <Slips>
            {v.versions.map((x) => (
              <Slip
                key={x.author}
                stamp={
                  x.author === me
                    ? "我写的"
                    : v.myVotes
                      ? v.myVotes[x.author]
                        ? v.dilemma.yes
                        : v.dilemma.no
                      : undefined
                }
                foot={
                  x.author !== me && voting ? (
                    <span className="split-choice">
                      {[true, false].map((yes) => (
                        <button
                          key={String(yes)}
                          type="button"
                          className={answers[x.author] === yes ? (yes ? "on yes" : "on no") : ""}
                          onClick={() => setAnswers((a) => ({ ...a, [x.author]: yes }))}
                        >
                          {yes ? v.dilemma.yes : v.dilemma.no}
                        </button>
                      ))}
                    </span>
                  ) : undefined
                }
              >
                {clause(v.dilemma.text, x.fill)}
              </Slip>
            ))}
          </Slips>
          {voting && (
            <button
              type="button"
              className="primary"
              disabled={paused || Object.keys(answers).length !== others.length}
              onClick={() => go({ type: "vote", answers })}
            >
              提交表态（{Object.keys(answers).length}/{others.length}）
            </button>
          )}
          <Progress ids={v.participants} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.results && (
        <Slips>
          {[...v.results]
            .sort((x, y) => x.points - y.points)
            .map((r, i) => (
              <Slip
                key={r.author}
                order={i}
                tone={r.points > 0 ? "good" : "plain"}
                stamp={r.points > 0 ? `+${r.points}` : undefined}
                foot={
                  <>
                    <Who room={room} id={r.author} />
                    <span className="split-bar">
                      <span className="yes" style={{ flexGrow: r.yes.length || 0.3 }}>
                        <b>
                          {v.dilemma.yes} {r.yes.length}
                        </b>
                        {r.yes.map((id) => (
                          <Avatar key={id} room={room} id={id} size="s" />
                        ))}
                      </span>
                      <span className="no" style={{ flexGrow: r.no.length || 0.3 }}>
                        {r.no.map((id) => (
                          <Avatar key={id} room={room} id={id} size="s" />
                        ))}
                        <b>
                          {r.no.length} {v.dilemma.no}
                        </b>
                      </span>
                    </span>
                  </>
                }
              >
                {clause(v.dilemma.text, r.fill)}
              </Slip>
            ))}
        </Slips>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "write" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始表态
          </button>
        )}
        {v.phase === "vote" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            结束表态
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
