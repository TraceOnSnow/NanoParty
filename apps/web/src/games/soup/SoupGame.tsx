import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Qa, QaLog, type Tone } from "../talk.tsx";
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
  const [solving, setSolving] = useState(false);
  const [theory, setTheory] = useState("");
  const isMaster = v.master === me;
  const ai = v.mode === "ai";
  const playing = v.phase === "play";
  const pending = (e: Entry) => e.status === "queued" || e.status === "judging";
  const waiting = v.log.some((e) => e.by === me && pending(e));
  const canAsk = playing && !v.knowsSolution && v.participants.includes(me);
  const aiDown = ai && v.log.some((e) => e.status === "failed");

  const TONE: Record<Outcome, Tone> = {
    yes: "yes",
    no: "no",
    irrelevant: "off",
    partly: "mid",
    unknown: "off",
    clarify: "off",
    correct: "win",
    wrong: "no",
    hint: "off",
  };
  const short = (k: Outcome) => LABEL[k].split("，")[0] as string;
  const settled = v.log.filter((e) => e.kind === "question" && e.status === "answered");
  const clues = (k: Verdict) => settled.filter((e) => e.verdict === k);
  const todo = !ai && isMaster && playing ? v.log.filter(pending).length : 0;

  return (
    <div className="game soup">
      <GameHead
        label={`${roundLabel(v.round, v.totalRounds, "碗")} · ${ai ? "AI 主持" : `汤主：${name(v.master)}`}`}
        deadlineAt={playing ? v.deadlineAt : null}
        paused={paused}
      />
      <div className="soup-surface">
        <span className="soup-label">🍲 汤面</span>
        <h2 className="question">{v.surface}</h2>
      </div>
      {v.solution && (
        <div className="card soup-solution">
          <span className="soup-label">{playing ? "🤫 汤底（只有你能看到，别说出来）" : "🥄 汤底"}</span>
          <p>{v.solution}</p>
        </div>
      )}
      {todo > 0 && <p className="turn-line mine">有 {todo} 条等你回答，标黄的就是。</p>}

      {settled.length >= 4 && (
        <details className="clue-board" open>
          <summary>
            线索板：是 {clues("yes").length} · 不是 {clues("no").length} · 部分 {clues("partly").length}
          </summary>
          <div className="clue-cols">
            {(["yes", "partly", "no"] as const).map(
              (k) =>
                clues(k).length > 0 && (
                  <div key={k} className={`clue-col ${TONE[k]}`}>
                    <b>{short(k)}</b>
                    {clues(k).map((e) => (
                      <span key={e.id}>{e.text}</span>
                    ))}
                  </div>
                ),
            )}
          </div>
        </details>
      )}

      <QaLog className="soup-log">
        {v.log.length === 0 && <li className="muted">还没有人提问。在下面输入一个能用「是 / 不是」回答的问题。</li>}
        {v.log.map((e) => {
          const fix = e.corrections.at(-1);
          const fixRow = playing && e.status === "answered" && e.kind === "question" && (
            <span className="soup-fix">
              {e.flagged.length > 0 && <span className="tag">{e.flagged.length} 人觉得判错了</span>}
              {!e.flagged.includes(me) && v.participants.includes(me) && !v.knowsSolution && (
                <button type="button" className="link" disabled={paused} onClick={() => go({ type: "flag", id: e.id })}>
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
                      改为 {short(k)}
                    </button>
                  ))
                ) : (
                  <button type="button" className="link" onClick={() => setFixing(e.id)}>
                    更正
                  </button>
                ))}
            </span>
          );
          return (
            <Qa
              key={e.id}
              room={room}
              by={e.kind === "hint" ? undefined : e.by}
              label="提示"
              text={
                <>
                  {e.kind === "attempt" && <span className="tag">推理</span>}{" "}
                  {e.kind === "hint" ? (e.reply ?? "…") : e.text}
                </>
              }
              note={
                fix && (
                  <span className="muted small">
                    已更正：原为「{LABEL[fix.from ?? "unknown"]}」
                    {fix.by === "ai" ? "（AI 重判）" : `（${name(fix.by)}）`}
                    {fix.reason ? `：${fix.reason}` : ""}
                  </span>
                )
              }
              stamp={e.status === "answered" && e.kind !== "hint" && e.verdict ? short(e.verdict) : null}
              tone={e.status === "failed" ? "no" : e.status === "answered" && e.verdict ? TONE[e.verdict] : undefined}
              waiting={
                e.status === "queued" ? (ai ? "排队中…" : "等汤主…") : e.status === "judging" ? "AI 判定中…" : null
              }
              todo={playing && !ai && isMaster && pending(e)}
              aside={fixing !== e.id && fixRow}
            >
              {e.status === "failed" && (
                <>
                  <span className="error small">AI 没答上来</span>
                  {(e.by === me || room.me.isHost) && playing && (
                    <button type="button" disabled={paused} onClick={() => go({ type: "rejudge", id: e.id })}>
                      重试
                    </button>
                  )}
                </>
              )}

              {/* The soup master answers. */}
              {playing &&
                !ai &&
                isMaster &&
                pending(e) &&
                (e.kind === "question" ? (
                  ANSWERS.map((k) => (
                    <button
                      key={k}
                      type="button"
                      className={`verdict-btn ${TONE[k]}`}
                      disabled={paused}
                      onClick={() => go({ type: "answer", id: e.id, verdict: k })}
                    >
                      {short(k)}
                    </button>
                  ))
                ) : (
                  <>
                    <button
                      type="button"
                      className="verdict-btn win"
                      disabled={paused}
                      onClick={() => go({ type: "judge", id: e.id, correct: true })}
                    >
                      对了
                    </button>
                    <button
                      type="button"
                      className="verdict-btn no"
                      disabled={paused}
                      onClick={() => go({ type: "judge", id: e.id, correct: false })}
                    >
                      不对
                    </button>
                  </>
                ))}

              {fixing === e.id && fixRow}
            </Qa>
          );
        })}
      </QaLog>

      {canAsk &&
        (waiting ? (
          <p className="muted">{ai ? "AI 正在判定你上一条…" : "等汤主回答你上一条…"}</p>
        ) : solving ? (
          <form
            className="solve-form"
            onSubmit={async (ev) => {
              ev.preventDefault();
              if (theory.trim() && (await go({ type: "solve", text: theory.trim() }))) {
                setTheory("");
                setSolving(false);
              }
            }}
          >
            <textarea
              value={theory}
              maxLength={200}
              rows={3}
              placeholder={`把来龙去脉写完整：谁、做了什么、为什么（由${ai ? " AI " : "汤主"}判断）`}
              onChange={(ev) => setTheory(ev.target.value)}
            />
            <span className="host-row">
              <button type="submit" className="primary" disabled={paused || !theory.trim()}>
                提交推理
              </button>
              <button type="button" onClick={() => setSolving(false)}>
                再问问
              </button>
            </span>
          </form>
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
            <button type="button" className="solve-open" disabled={paused} onClick={() => setSolving(true)}>
              💡 我知道真相了，写推理
            </button>
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
            <div className="card soup-facts">
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
        <div className="host-row soup-tools">
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
