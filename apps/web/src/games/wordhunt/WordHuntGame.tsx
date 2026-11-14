import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
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
const ROLE: Record<Role | "mayor", string> = { mayor: "村长", wolf: "狼人", seer: "预言家", villager: "村民" };
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
  const isMayor = v.mayor === me;
  const playing = v.myRole !== null && !isMayor;
  const waiting = v.questions.some((q) => q.by === me && q.answer === null);
  const canAccuse = v.accusers.includes(me) && v.myAccusation === null;

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · 村长：${name(v.mayor)}`}
        deadlineAt={v.phase === "reveal" ? null : v.deadlineAt}
        paused={paused}
      />
      {v.myRole && (
        <div className="word-card static">
          <span className="muted">
            你的身份：{ROLE[v.myRole]}。{ROLE_HINT[v.myRole]}
            {v.fellowWolves.length > 0 && ` 同伴：${v.fellowWolves.map(name).join("、")}`}
          </span>
          {v.word && <strong>{v.word}</strong>}
        </div>
      )}
      {!v.myRole && v.phase !== "reveal" && <p className="muted">这一轮开始时你还没加入，下一轮参与。</p>}

      <ul className="describe-list">
        {v.questions.map((q) => (
          <li key={q.id} className={q.answer === "correct" ? "picked" : ""}>
            <span className="who">{name(q.by)}</span>
            <span className="text">{q.text}</span>
            {q.answer ? (
              <strong>{ANSWER[q.answer]}</strong>
            ) : isMayor && v.phase === "ask" ? (
              <span className="host-row">
                {(["yes", "no", "maybe", "close", "far"] as const).map((a) => (
                  <button
                    key={a}
                    type="button"
                    disabled={paused}
                    onClick={() => go({ type: "answer", id: q.id, answer: a })}
                  >
                    {ANSWER[a]}
                  </button>
                ))}
                <button
                  type="button"
                  className="primary"
                  disabled={paused}
                  onClick={() => go({ type: "correct", id: q.id })}
                >
                  就是它
                </button>
              </span>
            ) : (
              <span className="muted small">等村长…</span>
            )}
          </li>
        ))}
      </ul>

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
            placeholder="直接猜词"
            button="猜"
            maxLength={20}
            disabled={paused}
            resetKey={v.questions.length}
            onSubmit={(text) => go({ type: "guess", text })}
          />
        </>
      )}

      {(v.phase === "found" || v.phase === "timeUp") && (
        <div className="card">
          <strong>
            {v.phase === "found"
              ? `${name(v.finder ?? "")} 猜出了秘密词！狼人还有一次机会：指认谁是预言家。`
              : "时间到，词没被猜出。所有人投票找出狼人。"}
          </strong>
          {canAccuse ? (
            <div className="pick-grid">
              {v.participants
                .filter((p) => p !== me && (v.phase === "timeUp" || p !== v.mayor))
                .map((p) => (
                  <button
                    key={p}
                    type="button"
                    className="pick"
                    disabled={paused}
                    onClick={() => go({ type: "accuse", target: p })}
                  >
                    {name(p)}
                  </button>
                ))}
            </div>
          ) : (
            <p className="muted">
              {v.myAccusation
                ? `你指认了 ${name(v.myAccusation)}`
                : v.phase === "found"
                  ? "等狼人指认…"
                  : "等大家投票…"}
            </p>
          )}
        </div>
      )}

      {v.phase === "reveal" && v.reveal && (
        <div className="card">
          <h2>{v.reveal.winner === "wolves" ? "狼人获胜！" : "村民获胜！"}</h2>
          <p>
            秘密词：<strong>{v.word}</strong>
            {v.reveal.accused &&
              `　被指认：${name(v.reveal.accused)}（${ROLE[v.reveal.roles[v.reveal.accused] ?? "villager"]}）`}
          </p>
          <ul className="chips">
            <li className="chip">{name(v.mayor)}（村长）</li>
            {Object.entries(v.reveal.roles).map(([p, r]) => (
              <li key={p} className={`chip ${r === "wolf" ? "undercover" : ""}`}>
                {name(p)}（{ROLE[r]}）
              </li>
            ))}
          </ul>
        </div>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "ask" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            提前结束提问
          </button>
        )}
        {(v.phase === "found" || v.phase === "timeUp") && (
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
