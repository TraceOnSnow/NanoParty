import { type FormEvent, useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct, useCountdown } from "../shared.ts";

type Role = "civilian" | "undercover";
const ROLE_LABEL: Record<Role, string> = { civilian: "平民", undercover: "卧底" };

interface TurnRecord {
  turn: number;
  descriptions: Record<string, string>;
  votes: Record<string, string>;
  eliminated: string | null;
}

// Mirrors UndercoverView in @apr/games.
interface UndercoverView {
  game: number;
  totalGames: number;
  turn: number;
  step: number;
  phase: "describe" | "vote" | "result" | "gameOver" | "finished";
  players: string[];
  alive: string[];
  undercoverCount: number;
  myWord: string | null;
  submitted: string[];
  myDescription: string | null;
  myVote: string | null;
  descriptions: Record<string, string> | null;
  history: TurnRecord[];
  revealedRoles: Record<string, Role>;
  outcome: { winner: Role; words: { civilian: string; undercover: string } } | null;
  deadlineAt: number | null;
}

export function UndercoverGame({ view, room, paused, act }: GameProps) {
  const v = view as UndercoverView;
  const me = room.me.playerId;
  const name = (id: string) => room.members.find((m) => m.id === id)?.nickname ?? "?";
  const { error, setError, send } = useAct(act);
  const [text, setText] = useState("");
  const [wordShown, setWordShown] = useState(true);
  const seconds = useCountdown(paused ? null : v.deadlineAt);
  const inGame = v.players.includes(me);
  const amAlive = v.alive.includes(me);
  const lastTurn = v.history.at(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the input whenever the phase moves on
  useEffect(() => {
    setText("");
    setError(null);
  }, [v.step]);

  const withStep = (action: object) => send({ ...action, step: v.step });

  function submitDescription(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) void withStep({ type: "describe", text: text.trim() });
  }

  const votesFor = (turn: TurnRecord, target: string) =>
    Object.entries(turn.votes)
      .filter(([, t]) => t === target)
      .map(([voter]) => name(voter));

  return (
    <div className="game">
      <div className="game-head">
        <span className="tag">
          第 {v.game} 局{v.totalGames > 0 ? ` / 共 ${v.totalGames} 局` : ""} · 第 {v.turn} 轮 · 卧底 {v.undercoverCount}{" "}
          人
        </span>
        {seconds != null && (v.phase === "describe" || v.phase === "vote") && (
          <span className="tag timer">{seconds}s</span>
        )}
      </div>

      {inGame ? (
        <button type="button" className="word-card" onClick={() => setWordShown((s) => !s)} title="点击显示或隐藏">
          <span className="muted">你的词（只有你能看到，点击{wordShown ? "隐藏" : "显示"}）</span>
          <strong>{wordShown ? v.myWord : "＊＊＊"}</strong>
        </button>
      ) : (
        <p className="notice">这一局开始时你还没加入，下一局会给你发词。现在可以先围观。</p>
      )}

      <ul className="chips">
        {v.players.map((id) => {
          const out = !v.alive.includes(id);
          const role = v.revealedRoles[id];
          const acted = v.submitted.includes(id);
          return (
            <li
              key={id}
              className={`chip ${out ? "out" : acted ? "done" : ""} ${role === "undercover" ? "undercover" : ""}`}
            >
              {name(id)}
              {role ? `（${ROLE_LABEL[role]}）` : ""}
              {out ? " 出局" : (v.phase === "describe" || v.phase === "vote") && acted ? " ✓" : ""}
            </li>
          );
        })}
      </ul>

      {v.phase === "describe" &&
        (amAlive ? (
          v.myDescription ? (
            <p className="notice">
              你的描述：<strong>{v.myDescription}</strong>　等所有人写完后一起公开。
            </p>
          ) : (
            <form className="answer-row" onSubmit={submitDescription}>
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                maxLength={40}
                placeholder="用一句话描述你的词（不能直接写出它）"
                disabled={paused}
              />
              <button type="submit" className="primary" disabled={paused}>
                提交描述
              </button>
            </form>
          )
        ) : (
          <p className="muted">等待在场玩家写描述…</p>
        ))}

      {v.phase === "vote" && v.descriptions && (
        <>
          <p className="muted">描述已公开。语音讨论后，投出你认为是卧底的人。得票最高者出局，平票无人出局。</p>
          <ul className="describe-list">
            {v.alive.map((id) => (
              <li key={id} className={v.myVote === id ? "picked" : ""}>
                <span className="who">{name(id)}</span>
                <span className="text">{v.descriptions?.[id] ?? <span className="muted">（没有提交描述）</span>}</span>
                {amAlive && id !== me && v.myVote == null && (
                  <button type="button" disabled={paused} onClick={() => withStep({ type: "vote", target: id })}>
                    投 TA
                  </button>
                )}
                {v.myVote === id && <span className="tag">你投了 TA</span>}
              </li>
            ))}
          </ul>
        </>
      )}

      {(v.phase === "result" || v.phase === "gameOver") && lastTurn && (
        <div className="card">
          {v.outcome ? (
            <>
              <h2>{v.outcome.winner === "civilian" ? "平民获胜！" : "卧底获胜！"}</h2>
              <p>
                平民词：<strong>{v.outcome.words.civilian}</strong>　卧底词：
                <strong>{v.outcome.words.undercover}</strong>
              </p>
            </>
          ) : (
            <h2>
              {lastTurn.eliminated
                ? `${name(lastTurn.eliminated)} 出局，身份是${ROLE_LABEL[v.revealedRoles[lastTurn.eliminated] ?? "civilian"]}。游戏继续。`
                : "平票，没有人出局。游戏继续。"}
            </h2>
          )}
          <ul className="vote-list">
            {v.players
              .filter((id) => votesFor(lastTurn, id).length > 0)
              .map((id) => (
                <li key={id}>
                  <strong>{name(id)}</strong> {votesFor(lastTurn, id).length} 票
                  <span className="muted">（{votesFor(lastTurn, id).join("、")}）</span>
                </li>
              ))}
            {Object.keys(lastTurn.votes).length === 0 && <li className="muted">本轮没有人投票。</li>}
          </ul>
        </div>
      )}

      {room.me.isHost ? (
        <div className="host-row">
          {v.phase === "describe" && (
            <button type="button" disabled={paused} onClick={() => withStep({ type: "advance" })}>
              不等了，公开描述
            </button>
          )}
          {v.phase === "vote" && (
            <button type="button" disabled={paused} onClick={() => withStep({ type: "advance" })}>
              结束投票并计票
            </button>
          )}
          {v.phase === "result" && (
            <button type="button" className="primary" disabled={paused} onClick={() => withStep({ type: "advance" })}>
              下一轮描述
            </button>
          )}
          {v.phase === "gameOver" && (
            <button type="button" className="primary" disabled={paused} onClick={() => withStep({ type: "advance" })}>
              {v.totalGames > 0 && v.game >= v.totalGames ? "结束并回到大厅" : "下一局"}
            </button>
          )}
          {(v.phase === "describe" || v.phase === "vote") && (
            <button type="button" disabled={paused} onClick={() => withStep({ type: "skip" })}>
              换一组词
            </button>
          )}
        </div>
      ) : (
        (v.phase === "result" || v.phase === "gameOver") && <p className="muted">等待房主继续…</p>
      )}

      {v.history.length > 0 && (
        <details className="history">
          <summary>本局已公开的描述</summary>
          {v.history.map((t) => (
            <div key={t.turn}>
              <h3>第 {t.turn} 轮</h3>
              <ul>
                {Object.entries(t.descriptions).map(([id, d]) => (
                  <li key={id}>
                    <span className="muted">{name(id)}：</span>
                    {d}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </details>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
