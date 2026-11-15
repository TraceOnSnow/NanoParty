import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, roundLabel, TextForm, useNames } from "../ui.tsx";

type Verdict = "yes" | "no" | "irrelevant" | "partly" | "unknown" | "clarify";
type Outcome = Verdict | "correct" | "wrong" | "hint";
interface Entry {
  id: number;
  by: string;
  kind: "question" | "attempt" | "hint";
  text: string;
  verdict: Outcome | null;
  status: "queued" | "judging" | "answered" | "failed";
  reply?: string;
  flagged: string[];
  corrections: { from: Outcome | null; to: Outcome | null; by: string; reason: string }[];
}
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "play" | "reveal" | "finished";
  mode: "human" | "ai";
  master: string;
  participants: string[];
  surface: string;
  solution: string | null;
  knowsSolution: boolean;
  log: Entry[];
  solver: string | null;
  spoiled: string[];
  facts: { text: string; by: string | null }[] | null;
  deadlineAt: number | null;
}

const LABEL: Record<Outcome, string> = {
  yes: "是",
  no: "不是",
  irrelevant: "无关",
  partly: "部分正确",
  unknown: "故事没说",
  clarify: "问得不清楚，换个问法",
  correct: "✔ 答对了",
  wrong: "✘ 不对",
  hint: "提示",
};
const ANSWERS: Verdict[] = ["yes", "no", "irrelevant", "partly", "unknown", "clarify"];

export function SoupGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [fixing, setFixing] = useState<number | null>(null);
  const isMaster = v.master === me;
  const ai = v.mode === "ai";
  const playing = v.phase === "play";
  const pending = (e: Entry) => e.status === "queued" || e.status === "judging";
  const waiting = v.log.some((e) => e.by === me && pending(e));
  const canAsk = playing && !v.knowsSolution && v.participants.includes(me);
  const aiDown = ai && v.log.some((e) => e.status === "failed");

  return (
    <div className="game">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds)} · ${ai ? "AI 主持" : `汤主：${name(v.master)}`}`}
        deadlineAt={playing ? v.deadlineAt : null}
        paused={paused}
      />
      <div className="card">
        <span className="muted small">汤面</span>
        <h2 className="question">{v.surface}</h2>
      </div>
      {v.solution && (
        <div className="card soup-solution">
          <span className="muted small">{playing ? "汤底（只有你能看到，别说出来）" : "汤底"}</span>
          <p>{v.solution}</p>
        </div>
      )}

      <ul className="describe-list soup-log">
        {v.log.length === 0 && <li className="muted">还没有人提问。在下面输入一个能用「是 / 不是」回答的问题。</li>}
        {v.log.map((e) => (
          <li key={e.id} className={e.verdict === "correct" ? "picked" : e.status === "failed" ? "wrong" : ""}>
            <span className="who">{e.kind === "hint" ? "提示" : name(e.by)}</span>
            <span className="text">
              {e.kind === "attempt" && <span className="tag">推理</span>}{" "}
              {e.kind === "hint" ? (e.reply ?? "…") : e.text}
              {e.corrections.length > 0 && (
                <span className="muted small">
                  <br />
                  已更正：原为「{LABEL[e.corrections.at(-1)?.from ?? "unknown"]}」
                  {e.corrections.at(-1)?.by === "ai" ? "（AI 重判）" : `（${name(e.corrections.at(-1)?.by ?? "")}）`}
                  {e.corrections.at(-1)?.reason ? `：${e.corrections.at(-1)?.reason}` : ""}
                </span>
              )}
            </span>

            {e.status === "answered" && e.kind !== "hint" && e.verdict && (
              <strong className={e.verdict === "yes" || e.verdict === "correct" ? "plus" : ""}>
                {LABEL[e.verdict]}
              </strong>
            )}
            {e.status === "queued" && <span className="muted small">{ai ? "排队中…" : "等汤主…"}</span>}
            {e.status === "judging" && <span className="muted small">AI 判定中…</span>}
            {e.status === "failed" && (
              <span className="host-row">
                <span className="error small">AI 没答上来</span>
                {(e.by === me || room.me.isHost) && playing && (
                  <button type="button" disabled={paused} onClick={() => go({ type: "rejudge", id: e.id })}>
                    重试
                  </button>
                )}
              </span>
            )}

            {/* The soup master answers. */}
            {playing && !ai && isMaster && pending(e) && (
              <span className="host-row">
                {e.kind === "question" ? (
                  ANSWERS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      disabled={paused}
                      onClick={() => go({ type: "answer", id: e.id, verdict: k })}
                    >
                      {LABEL[k].split("，")[0]}
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
            )}

            {/* Corrections: report, re-judge, or fix by someone who knows the story. */}
            {playing && e.status === "answered" && e.kind === "question" && (
              <span className="host-row soup-fix">
                {e.flagged.length > 0 && <span className="tag">{e.flagged.length} 人觉得判错了</span>}
                {!e.flagged.includes(me) && v.participants.includes(me) && !v.knowsSolution && (
                  <button
                    type="button"
                    className="link"
                    disabled={paused}
                    onClick={() => go({ type: "flag", id: e.id })}
                  >
                    判错了？
                  </button>
                )}
                {ai && room.me.isHost && (
                  <button
                    type="button"
                    className="link"
                    disabled={paused}
                    onClick={() => go({ type: "rejudge", id: e.id })}
                  >
                    让 AI 重判
                  </button>
                )}
                {v.knowsSolution &&
                  (fixing === e.id ? (
                    ANSWERS.filter((k) => k !== e.verdict).map((k) => (
                      <button
                        key={k}
                        type="button"
                        disabled={paused}
                        onClick={async () => {
                          if (await go({ type: "correct", id: e.id, verdict: k })) setFixing(null);
                        }}
                      >
                        改为 {LABEL[k].split("，")[0]}
                      </button>
                    ))
                  ) : (
                    <button type="button" className="link" onClick={() => setFixing(e.id)}>
                      更正
                    </button>
                  ))}
              </span>
            )}
          </li>
        ))}
      </ul>

      {canAsk &&
        (waiting ? (
          <p className="muted">{ai ? "AI 正在判定你上一条…" : "等汤主回答你上一条…"}</p>
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
              placeholder={`知道了？写下完整推理（由${ai ? " AI " : "汤主"}判断）`}
              button="提交推理"
              maxLength={200}
              disabled={paused}
              resetKey={v.log.length}
              onSubmit={(text) => go({ type: "solve", text })}
            />
          </>
        ))}
      {playing && v.knowsSolution && (
        <p className="muted">
          {isMaster
            ? "你是汤主：逐条回答大家的问题。"
            : "你看过汤底了，这一碗不能再提问或推理；可以帮忙更正判错的回答。"}
        </p>
      )}
      {playing && aiDown && (
        <p className="notice">
          AI 裁判有问题没答上来。可以点「重试」；一直不行的话，可以由一个人接管当汤主（TA 会看到汤底，不能再猜）。
        </p>
      )}

      {v.phase === "reveal" && (
        <>
          <p className="answer">
            {v.solver ? (
              <>
                汤被 <strong>{name(v.solver)}</strong> 喝出来了！
              </>
            ) : (
              "这碗汤没人喝出来。"
            )}
          </p>
          {v.facts && v.facts.length > 0 && (
            <div className="card">
              <span className="muted small">关键事实 · 谁最先问出来（仅供参考，不是评分）</span>
              <ul className="facts">
                {v.facts.map((f) => (
                  <li key={f.text}>
                    {f.text} <span className="muted">— {f.by ? name(f.by) : "没人问到"}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {playing && (
        <div className="host-row">
          {ai && room.me.isHost && (
            <button type="button" disabled={paused} onClick={() => go({ type: "hint" })}>
              要一条提示
            </button>
          )}
          {ai && v.participants.includes(me) && !v.knowsSolution && (
            <button
              type="button"
              disabled={paused}
              onClick={() =>
                confirm("接管后你会看到汤底，成为这一碗的汤主，不能再提问和推理。其他人不会看到汤底。继续？") &&
                go({ type: "takeover" })
              }
            >
              我来当汤主
            </button>
          )}
          {ai && room.me.isHost && !v.knowsSolution && (
            <button
              type="button"
              disabled={paused}
              onClick={() =>
                confirm("查看汤底会剧透：这一碗你不能再提问和推理，只能帮忙更正判定。继续？") && go({ type: "peek" })
              }
            >
              查看汤底（剧透）
            </button>
          )}
          {(isMaster || room.me.isHost) && (
            <button
              type="button"
              disabled={paused}
              onClick={() => confirm("公布汤底会结束这一碗，没人得分。继续？") && go({ type: "reveal" })}
            >
              放弃，公布汤底
            </button>
          )}
        </div>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {lastRound(v.round, v.totalRounds) ? "结束这局海龟汤" : "下一碗"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
