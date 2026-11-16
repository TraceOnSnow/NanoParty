import { Who } from "../../components/Avatar.tsx";
import { Slip, Slips } from "../answers.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, Progress, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "clue" | "guess" | "reveal" | "finished";
  participants: string[];
  guesser: string;
  word: string | null;
  submitted: string[];
  myClue: string | null;
  clues: { playerId: string; text: string | null; cancelled: boolean }[] | null;
  guess: string | null;
  correct: boolean | null;
  deadlineAt: number | null;
}

export function OneClueGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const isGuesser = v.guesser === me;
  const givers = v.participants.filter((p) => p !== v.guesser);
  const isGiver = givers.includes(me);

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · 猜词者：${name(v.guesser)}`}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />

      {v.word ? (
        <div className="word-card static">
          <span className="muted">目标词{v.phase !== "reveal" ? `（${name(v.guesser)} 看不到）` : ""}</span>
          <strong>{v.word}</strong>
        </div>
      ) : (
        <p className="notice">
          {!isGuesser
            ? "你将从下一轮开始参与。"
            : v.phase === "clue"
              ? "你是猜词者，看不到目标词。等大家写好线索。"
              : "你是猜词者。根据剩下的线索猜出目标词，只有一次机会。"}
        </p>
      )}

      {v.phase === "clue" && (
        <>
          {isGiver &&
            (v.myClue ? (
              <p className="notice">
                你的线索：<strong>{v.myClue}</strong>　和别人撞了就会作废。
              </p>
            ) : (
              <TextForm
                placeholder="写一个词作线索（最多 10 字）"
                button="提交"
                maxLength={10}
                disabled={paused}
                resetKey={v.step}
                onSubmit={(text) => go({ type: "clue", text })}
              />
            ))}
          <Progress ids={givers} done={v.submitted} name={name} />
        </>
      )}

      {(v.phase === "guess" || v.phase === "reveal") && v.clues && (
        <Slips>
          {v.clues.length === 0 && <p className="muted">没有人写线索。</p>}
          {v.clues.map((c, i) => (
            <Slip
              key={c.playerId}
              order={v.phase === "guess" ? i : undefined}
              tone={c.cancelled ? "bad" : "plain"}
              stamp={c.cancelled ? "撞词作废" : undefined}
              foot={<Who room={room} id={c.playerId} />}
            >
              {c.text ?? "？？？"}
            </Slip>
          ))}
        </Slips>
      )}

      {v.phase === "guess" &&
        (isGuesser ? (
          <>
            <TextForm
              placeholder="只有一次机会，猜目标词"
              button="猜"
              maxLength={20}
              disabled={paused}
              resetKey={v.step}
              onSubmit={(text) => go({ type: "guess", text })}
            />
            <div className="host-row">
              <button type="button" disabled={paused} onClick={() => go({ type: "pass" })}>
                放弃这个词
              </button>
            </div>
          </>
        ) : (
          <p className="muted">等 {name(v.guesser)} 猜词…</p>
        ))}

      {v.phase === "reveal" && (
        <p className="answer">
          {v.guess === null ? `${name(v.guesser)} 放弃了。` : `${name(v.guesser)} 猜的是「${v.guess}」：`}
          {v.guess !== null && <strong>{v.correct ? "猜中！全员 +1" : "没猜中"}</strong>}
        </p>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "clue" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，开始猜词
          </button>
        )}
        {v.phase === "guess" && !isGuesser && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            猜词者不在，直接揭晓
          </button>
        )}
        {v.phase === "reveal" && v.guess !== null && !v.correct && (
          <button type="button" disabled={paused} onClick={() => go({ type: "accept" })}>
            意思一样，判为猜中
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
