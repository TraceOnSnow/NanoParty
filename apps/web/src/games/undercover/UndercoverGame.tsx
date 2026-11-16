import { type FormEvent, useEffect, useState } from "react";
import { Stickers } from "../answers.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct, useCountdown } from "../shared.ts";
import { Seats } from "../table.tsx";

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
  const [chosen, setChosen] = useState<string | null>(null);
  const seconds = useCountdown(paused ? null : v.deadlineAt);
  const inGame = v.players.includes(me);
  const amAlive = v.alive.includes(me);
  const lastTurn = v.history.at(-1);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset the input whenever the phase moves on
  useEffect(() => {
    setText("");
    setChosen(null);
    setError(null);
  }, [v.step]);

  const withStep = (action: object) => send({ ...action, step: v.step });

  function submitDescription(e: FormEvent) {
    e.preventDefault();
    if (text.trim()) void withStep({ type: "describe", text: text.trim() });
  }

  const voting = v.phase === "vote" && amAlive && v.myVote == null && !paused;
  const shown = v.phase === "result" || v.phase === "gameOver";
  const votersOf = (target: string) =>
    Object.entries(lastTurn?.votes ?? {})
      .filter(([, t]) => t === target)
      .map(([voter]) => voter);

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

      <Seats
        room={room}
        ids={v.players}
        wide
        out={v.players.filter((id) => !v.alive.includes(id))}
        chosen={chosen ?? v.myVote}
        pickable={(id) => voting && id !== me && v.alive.includes(id)}
        onPick={setChosen}
        note={(id) => {
          const role = v.revealedRoles[id];
          const out = !v.alive.includes(id);
          if (role)
            return (
              <span className={`tag role ${role}`}>
                {ROLE_LABEL[role]}
                {out ? " · 出局" : ""}
              </span>
            );
          if (out) return <span className="tag">出局</span>;
          if (v.phase === "describe")
            return <span className="tag">{v.submitted.includes(id) ? "写好了 ✓" : "在写…"}</span>;
          if (v.phase === "vote") return <span className="tag">{v.submitted.includes(id) ? "投好了 ✓" : "在想…"}</span>;
          return null;
        }}
      >
        {(id) => (
          <>
            {v.history.map((t) =>
              t.descriptions[id] ? (
                <span key={t.turn} className={shown && t === lastTurn ? "said" : "said old"}>
                  <i>{t.turn}</i>
                  {t.descriptions[id]}
                </span>
              ) : null,
            )}
            {v.phase === "vote" && v.alive.includes(id) && (
              <span className="said">
                <i>{v.turn}</i>
                {v.descriptions?.[id] ?? <span className="muted">（没写）</span>}
              </span>
            )}
            {shown && lastTurn && (votersOf(id).length > 0 || lastTurn.eliminated === id) && (
              <Stickers room={room} ids={votersOf(id)} label={`${votersOf(id).length} 票`} />
            )}
            {v.myVote === id && v.phase === "vote" && <span className="strength">你投了 TA</span>}
          </>
        )}
      </Seats>

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

      {v.phase === "vote" && (
        <>
          <p className="muted">
            {voting
              ? "每个人说过的话都在自己名下。语音聊完，点你怀疑的人，再确认。票最多的出局，平票没人出局。"
              : amAlive
                ? "投好了，等其他人…"
                : "你已出局，看他们投。"}
          </p>
          {voting && (
            <button
              type="button"
              className="primary wide"
              disabled={chosen === null}
              onClick={() => chosen !== null && withStep({ type: "vote", target: chosen })}
            >
              {chosen === null ? "点一个你怀疑的人" : `投 ${name(chosen)}`}
            </button>
          )}
        </>
      )}

      {(v.phase === "result" || v.phase === "gameOver") && lastTurn && (
        <div className={`verdict${v.outcome ? ` ${v.outcome.winner}` : ""}`}>
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
          {lastTurn && Object.keys(lastTurn.votes).length === 0 && <p className="muted">本轮没有人投票。</p>}
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

      {error && <p className="error">{error}</p>}
    </div>
  );
}
