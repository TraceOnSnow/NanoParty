import { useEffect, useState } from "react";
import { Who } from "../../components/Avatar.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { Qa, QaLog, type Tone } from "../talk.tsx";
import { GameHead, HostControls, lastRound, roundLabel, TextForm, useNames } from "../ui.tsx";

type Answer = "yes" | "no" | "maybe" | "close" | "far" | "correct";
type Role = "wolf" | "seer" | "villager";
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "ask" | "found" | "timeUp" | "reveal" | "finished";
  mayor: string;
  participants: string[];
  myRole: Role | "mayor" | null;
  word: string | null;
  fellowWolves: string[];
  questions: { id: number; by: string; text: string; answer: Answer | null }[];
  finder: string | null;
  accusers: string[];
  submitted: string[];
  myAccusation: string | null;
  deadlineAt: number | null;
  reveal: { roles: Record<string, Role>; accused: string | null; winner: "village" | "wolves" } | null;
}

const ANSWER: Record<Answer, string> = {
  yes: "是",
  no: "不是",
  maybe: "也许",
  close: "很接近",
  far: "差得远",
  correct: "✔ 就是它",
};
const TONE: Record<Answer, Tone> = { yes: "yes", no: "no", maybe: "off", close: "mid", far: "no", correct: "win" };
const ROLE: Record<Role | "mayor", string> = { mayor: "村长", wolf: "狼人", seer: "预言家", villager: "村民" };
const FACE: Record<Role | "mayor", string> = { mayor: "👑", wolf: "🐺", seer: "🔮", villager: "🧑‍🌾" };
const ROLE_HINT: Record<Role | "mayor", string> = {
  mayor: "你知道秘密词，负责如实回答问题。",
  wolf: "你知道秘密词。暗中把大家带偏；词被猜出后，找出预言家就能翻盘。",
  seer: "你知道秘密词。悄悄引导大家猜出来，但别让狼人看出你是预言家。",
  villager: "你不知道秘密词，靠提问把它问出来。",
};

export function WordHuntGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [target, setTarget] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new phase clears the choice
  useEffect(() => setTarget(null), [v.phase, v.round]);
  const isMayor = v.mayor === me;
  const playing = v.myRole !== null && !isMayor;
  const waiting = v.questions.some((q) => q.by === me && q.answer === null);
  const accusing = v.phase === "found" || v.phase === "timeUp";
  const canAccuse = accusing && v.accusers.includes(me) && v.myAccusation === null && !paused;
  const suspects = v.participants.filter((p) => p !== me && (v.phase === "timeUp" || p !== v.mayor));
  const todo = v.questions.filter((q) => q.answer === null).length;
  const roleOf = (p: string): Role | "mayor" => (p === v.mayor ? "mayor" : (v.reveal?.roles[p] ?? "villager"));

  return (
    <div className="game wordhunt">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      <p className="role-line">
        <span>
          村长 <Who room={room} id={v.mayor} />
        </span>
        {isMayor && v.phase === "ask" && todo > 0 && <span className="tag warn">{todo} 个问题等你回答</span>}
      </p>
      {v.myRole && v.phase !== "reveal" && (
        <div className={`role-card ${v.myRole}`}>
          <span className="role-face">{FACE[v.myRole]}</span>
          <span className="role-text">
            <strong>你是{ROLE[v.myRole]}</strong>
            <span className="muted small">
              {ROLE_HINT[v.myRole]}
              {v.fellowWolves.length > 0 && ` 同伴：${v.fellowWolves.map(name).join("、")}`}
            </span>
          </span>
          {v.word ? <span className="role-word">{v.word}</span> : <span className="role-word unknown">？？？</span>}
        </div>
      )}
      {!v.myRole && v.phase !== "reveal" && <p className="muted">这一轮开始时你还没加入，下一轮参与。</p>}

      <QaLog>
        {v.questions.length === 0 && v.phase === "ask" && (
          <li className="muted">还没有人提问。问一个村长能用「是 / 不是」回答的问题。</li>
        )}
        {v.questions.map((q) => (
          <Qa
            key={q.id}
            room={room}
            by={q.by}
            text={q.text}
            stamp={q.answer ? ANSWER[q.answer] : null}
            tone={q.answer ? TONE[q.answer] : undefined}
            waiting="等村长…"
            todo={isMayor && v.phase === "ask" && q.answer === null}
          >
            {isMayor && v.phase === "ask" && q.answer === null && (
              <>
                {(["yes", "no", "maybe", "close", "far"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    className={`verdict-btn ${TONE[a]}`}
                    disabled={paused}
                    onClick={() => go({ type: "answer", id: q.id, answer: a })}
                  >
                    {ANSWER[a]}
                  </button>
                ))}
                <button
                  type="button"
                  className="verdict-btn win"
                  disabled={paused}
                  onClick={() => go({ type: "correct", id: q.id })}
                >
                  就是它
                </button>
              </>
            )}
          </Qa>
        ))}
      </QaLog>

      {v.phase === "ask" && playing && (
        <>
          {waiting ? (
            <p className="muted">等村长回答你上一条…</p>
          ) : (
            <TextForm
              placeholder="问一个是非问题"
              button="提问"
              maxLength={60}
              disabled={paused}
              resetKey={v.questions.length}
              onSubmit={(text) => go({ type: "ask", text })}
            />
          )}
          <TextForm
            placeholder="有把握了？直接猜词"
            button="猜"
            maxLength={20}
            disabled={paused}
            resetKey={v.questions.length}
            onSubmit={(text) => go({ type: "guess", text })}
          />
        </>
      )}

      {accusing && (
        <>
          <p className={canAccuse ? "turn-line mine" : "turn-line"}>
            {v.phase === "found" ? (
              <>
                <Who room={room} id={v.finder ?? ""} /> 猜出了秘密词！狼人还有一次机会：指认谁是预言家。
              </>
            ) : (
              "时间到，词没被猜出。所有人投票找出狼人。"
            )}
          </p>
          <Seats
            room={room}
            ids={v.participants}
            chosen={target ?? v.myAccusation}
            pickable={(p) => canAccuse && suspects.includes(p)}
            onPick={(p) => setTarget(target === p ? null : p)}
            note={(p) => (
              <>
                {p === v.mayor && <span className="tag">村长</span>}
                {v.accusers.includes(p) && <span className="tag">{v.submitted.includes(p) ? "已指认" : "在想…"}</span>}
              </>
            )}
          />
          {canAccuse ? (
            <button
              type="button"
              className="primary wide"
              disabled={!target}
              onClick={() => target && go({ type: "accuse", target })}
            >
              {target ? `指认 ${name(target)}` : "点一个人"}
            </button>
          ) : (
            <p className="muted">
              {v.myAccusation
                ? `你指认了 ${name(v.myAccusation)}`
                : v.phase === "found"
                  ? "等狼人指认…"
                  : "等大家投票…"}
            </p>
          )}
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <>
          <div className={`verdict ${v.reveal.winner === "wolves" ? "bad" : "good"}`}>
            <h2>{v.reveal.winner === "wolves" ? "🐺 狼人获胜！" : "🎉 村民获胜！"}</h2>
            <p>
              秘密词：<strong>{v.word}</strong>
              {v.reveal.accused &&
                `　被指认的是 ${name(v.reveal.accused)}（${ROLE[v.reveal.roles[v.reveal.accused] ?? "villager"]}）`}
            </p>
          </div>
          <Seats
            room={room}
            ids={v.participants}
            chosen={v.reveal.accused}
            note={(p) => (
              <span className={`tag role-${roleOf(p)}`}>
                {FACE[roleOf(p)]} {ROLE[roleOf(p)]}
              </span>
            )}
          />
        </>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "ask" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            提前结束提问
          </button>
        )}
        {accusing && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            结束指认
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
