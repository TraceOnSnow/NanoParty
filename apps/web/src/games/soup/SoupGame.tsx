import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, roundLabel, TextForm, useNames } from "../ui.tsx";

type Verdict = "yes" | "no" | "irrelevant" | "partly" | "correct" | "wrong";
interface Entry {
  id: number;
  by: string;
  kind: "question" | "attempt";
  text: string;
  verdict: Verdict | null;
}
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "play" | "reveal" | "finished";
  master: string;
  participants: string[];
  surface: string;
  solution: string | null;
  log: Entry[];
  solver: string | null;
  deadlineAt: number | null;
}

const LABEL: Record<Verdict, string> = {
  yes: "是",
  no: "不是",
  irrelevant: "无关",
  partly: "部分正确",
  correct: "✔ 答对了",
  wrong: "✘ 不对",
};

export function SoupGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const isMaster = v.master === me;
  const waiting = v.log.some((e) => e.by === me && e.verdict === null);

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · 汤主：${name(v.master)}`}
        deadlineAt={v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />
      <div className="card">
        <span className="muted small">汤面</span>
        <h2 className="question">{v.surface}</h2>
      </div>
      {v.solution && (
        <div className="card soup-solution">
          <span className="muted small">{v.phase === "play" ? "汤底（只有你能看到）" : "汤底"}</span>
          <p>{v.solution}</p>
        </div>
      )}

      <ul className="describe-list">
        {v.log.length === 0 && <li className="muted">还没有人提问。</li>}
        {v.log.map((e) => (
          <li key={e.id} className={e.verdict === "correct" ? "picked" : ""}>
            <span className="who">{name(e.by)}</span>
            <span className="text">
              {e.kind === "attempt" && <span className="tag">推理</span>} {e.text}
            </span>
            {e.verdict ? (
              <strong className={e.verdict === "yes" || e.verdict === "correct" ? "plus" : ""}>
                {LABEL[e.verdict]}
              </strong>
            ) : isMaster && v.phase === "play" ? (
              <span className="host-row">
                {e.kind === "question" ? (
                  (["yes", "no", "irrelevant", "partly"] as const).map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={paused}
                      onClick={() => go({ type: "answer", id: e.id, verdict: k })}
                    >
                      {LABEL[k]}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      type="button"
                      className="primary"
                      disabled={paused}
                      onClick={() => go({ type: "judge", id: e.id, correct: true })}
                    >
                      对了
                    </button>
                    <button
                      type="button"
                      disabled={paused}
                      onClick={() => go({ type: "judge", id: e.id, correct: false })}
                    >
                      不对
                    </button>
                  </>
                )}
              </span>
            ) : (
              <span className="muted small">等汤主…</span>
            )}
          </li>
        ))}
      </ul>

      {v.phase === "play" &&
        !isMaster &&
        v.participants.includes(me) &&
        (waiting ? (
          <p className="muted">等汤主回答你上一条…</p>
        ) : (
          <>
            <TextForm
              placeholder="问一个能用「是 / 不是」回答的问题"
              button="提问"
              maxLength={60}
              disabled={paused}
              resetKey={v.log.length}
              onSubmit={(text) => go({ type: "ask", text })}
            />
            <TextForm
              placeholder="知道了？写下完整推理（由汤主判断）"
              button="提交推理"
              maxLength={200}
              disabled={paused}
              resetKey={v.log.length}
              onSubmit={(text) => go({ type: "solve", text })}
            />
          </>
        ))}
      {v.phase === "play" && isMaster && (
        <p className="muted">你是汤主：逐条回答大家的问题。答得准，大家才喝得出来。</p>
      )}
      {v.phase === "reveal" && (
        <p className="answer">
          {v.solver ? (
            <>
              汤被 <strong>{name(v.solver)}</strong> 喝出来了！
            </>
          ) : (
            "这碗汤没人喝出来。"
          )}
        </p>
      )}

      {(isMaster || room.me.isHost) && v.phase === "play" && (
        <div className="host-row">
          <button type="button" disabled={paused} onClick={() => go({ type: "reveal" })}>
            放弃，公布汤底
          </button>
        </div>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一碗"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
