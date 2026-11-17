import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, lastRound, Progress, roundLabel, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "talk" | "vote" | "final" | "roundOver" | "finished";
  players: string[];
  places: string[];
  place: string | null;
  iAmSpy: boolean;
  accused: string[];
  vote: { by: string; target: string; voted: string[]; myVote: boolean | null } | null;
  failed: { by: string; target: string; yes: number; no: number } | null;
  finalVoted: string[];
  myFinal: string | null;
  reveal: { spy: string; place: string; finalVotes: Record<string, string> } | null;
  result: { winner: "spy" | "team"; how: string; target?: string; by?: string; guess?: string } | null;
  deadlineAt: number | null;
}

export function SpyGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [mode, setMode] = useState<"accuse" | "guess" | null>(null);
  const seated = v.players.includes(me);
  const talking = v.phase === "talk" && !paused;
  const canAccuse = talking && seated && !v.accused.includes(me);
  const pickSeat = (mode === "accuse" && canAccuse) || (v.phase === "final" && seated && v.myFinal === null && !paused);
  const voters = v.vote ? v.players.filter((p) => p !== v.vote?.target) : [];

  const outcome = (() => {
    const r = v.result;
    if (!r || !v.reveal) return null;
    const spy = name(v.reveal.spy);
    switch (r.how) {
      case "accused":
        return `${name(r.by ?? "")} 指认 ${spy}，投票通过——抓对了！`;
      case "wrong-accused":
        return `大家投票翻开了 ${name(r.target ?? "")}，可外人其实是 ${spy}。外人赢。`;
      case "guessed":
        return `外人 ${spy} 猜出了地点「${r.guess}」。外人赢。`;
      case "wrong-guess":
        return `外人 ${spy} 猜「${r.guess}」，猜错了。大家赢。`;
      case "final":
        return `最终指认把票集中在了 ${spy} 身上——抓对了！`;
      default:
        return `最终指认没有抓到外人（外人是 ${spy}）。外人赢。`;
    }
  })();

  return (
    <div className="game wide spy">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "talk" || v.phase === "vote" ? v.deadlineAt : null}
        paused={paused}
      />
      {!v.reveal && (
        <div className={`spy-card${v.iAmSpy ? " outsider" : ""}`}>
          {v.iAmSpy ? (
            <>
              <strong>你是外人</strong>
              <span>你不知道这是哪。听大家的问答猜出地点，别被发现。</span>
            </>
          ) : v.place ? (
            <>
              <span className="muted small">你们现在在</span>
              <strong>{v.place}</strong>
              <span>有一个人不知道。问问题把他找出来，但别把地点说漏。</span>
            </>
          ) : (
            <span>这一轮已经开始了，下一轮加入。</span>
          )}
        </div>
      )}

      {v.phase === "talk" && (
        <>
          <p className="muted">
            在语音里互相提问：点名问一个人和这个地点有关的问题，被问的人答完再问别人。
            {v.failed &&
              ` 刚才 ${name(v.failed.by)} 指认 ${name(v.failed.target)} 没通过（${v.failed.yes} 同意，${v.failed.no} 反对）。`}
          </p>
          <div className="host-row">
            {seated && (
              <button type="button" disabled={!canAccuse} onClick={() => setMode(mode === "accuse" ? null : "accuse")}>
                {v.accused.includes(me) ? "这一轮你已经指认过了" : mode === "accuse" ? "取消指认" : "我要指认一个人"}
              </button>
            )}
            {v.iAmSpy && (
              <button type="button" disabled={!talking} onClick={() => setMode(mode === "guess" ? null : "guess")}>
                {mode === "guess" ? "先不猜" : "我猜到地点了"}
              </button>
            )}
          </div>
          {mode === "accuse" && canAccuse && <p className="answer">在下面点你要指认的人。其他人过半同意就翻开身份。</p>}
        </>
      )}

      {v.phase === "vote" && v.vote && (
        <div className="spy-vote">
          <p className="answer">
            {name(v.vote.by)} 指认 <b>{name(v.vote.target)}</b> 是外人。同意翻开身份吗？
          </p>
          {seated && me !== v.vote.target && v.vote.myVote === null && !paused ? (
            <div className="host-row">
              <button type="button" className="primary" onClick={() => go({ type: "vote", yes: true })}>
                同意，翻开
              </button>
              <button type="button" onClick={() => go({ type: "vote", yes: false })}>
                不同意，接着问
              </button>
            </div>
          ) : (
            <p className="muted">{me === v.vote.target ? "你被指认了，不参加投票。" : "等其他人投票…"}</p>
          )}
          <Progress ids={voters} done={v.vote.voted} name={name} />
        </div>
      )}

      {v.phase === "final" && (
        <>
          <p className="answer">
            提问结束。每人指一个你认为的外人：票数唯一最高的人被翻开，平票算外人逃脱。
            {v.myFinal ? ` 你指了 ${name(v.myFinal)}。` : seated ? " 在下面点一个人。" : ""}
          </p>
          <Progress ids={v.players} done={v.finalVoted} name={name} />
        </>
      )}

      {outcome && <p className="answer">{outcome}</p>}
      {v.reveal && (
        <p>
          地点是 <b>{v.reveal.place}</b>，外人是 <b>{name(v.reveal.spy)}</b>。
        </p>
      )}

      <Seats
        room={room}
        ids={v.players}
        win={
          v.reveal ? (v.result?.winner === "spy" ? [v.reveal.spy] : v.players.filter((p) => p !== v.reveal?.spy)) : []
        }
        pickable={(p) => pickSeat && p !== me}
        onPick={(p) => {
          if (v.phase === "final") void go({ type: "final", target: p });
          else {
            setMode(null);
            void go({ type: "accuse", target: p });
          }
        }}
        note={(p) =>
          v.reveal ? (
            <span className="tag">
              {p === v.reveal.spy ? "外人" : "知情"}
              {v.reveal.finalVotes[p] ? ` · 指了 ${name(v.reveal.finalVotes[p])}` : ""}
            </span>
          ) : null
        }
      />

      {(mode === "guess" || v.reveal) && (
        <div className="spy-places">
          {v.places.map((place) =>
            mode === "guess" && talking && v.iAmSpy ? (
              <button key={place} type="button" onClick={() => go({ type: "guess", place })}>
                {place}
              </button>
            ) : (
              <span key={place} className={`chip${place === v.reveal?.place ? " done" : ""}`}>
                {place}
              </span>
            ),
          )}
        </div>
      )}
      {!v.reveal && mode !== "guess" && (
        <details className="spy-list">
          <summary>所有可能的地点（{v.places.length} 个）</summary>
          <p className="muted small">{v.places.join("、")}</p>
        </details>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "roundOver" ? "等待房主继续…" : undefined}>
        {v.phase === "talk" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "endTalk" })}>
            不问了，开始最终指认
          </button>
        )}
        {v.phase === "roundOver" && (
          <>
            <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
              {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
            </button>
            {!lastRound(v.round, v.totalRounds) && (
              <button type="button" disabled={paused} onClick={() => go({ type: "end" })}>
                就玩到这
              </button>
            )}
          </>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
