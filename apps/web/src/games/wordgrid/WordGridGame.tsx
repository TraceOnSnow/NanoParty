import { useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { TEAM, TeamBar } from "../teams.tsx";
import { GameHead, HostControls, roundLabel, useNames } from "../ui.tsx";

type Owner = 0 | 1 | "neutral" | "trap";
interface View {
  game: number;
  totalGames: number;
  step: number;
  phase: "clue" | "guess" | "gameOver" | "finished";
  teams: [string[], string[]];
  captains: [string, string];
  words: string[];
  owners: (Owner | null)[];
  revealed: boolean[];
  turn: 0 | 1;
  clue: { word: string; count: number } | null;
  guessesLeft: number;
  log: { team: 0 | 1; word: string; count: number; picks: number[] }[];
  winner: 0 | 1 | null;
  endedBy: "all-found" | "trap" | null;
  myTeam: 0 | 1 | null;
  isCaptain: boolean;
  remaining: [number, number];
  deadlineAt: number | null;
}

export function WordGridGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [word, setWord] = useState("");
  const [count, setCount] = useState(1);
  const myTurn = v.myTeam === v.turn;
  const canGuess = v.phase === "guess" && myTurn && !v.isCaptain;

  return (
    <div className="game">
      <GameHead label={roundLabel(v.game, v.totalGames, "局")} deadlineAt={v.deadlineAt} paused={paused} />
      <TeamBar
        teams={v.teams}
        name={name}
        note={[`还剩 ${v.remaining[0]}`, `还剩 ${v.remaining[1]}`]}
        badge={(p) => (v.captains.includes(p) ? "队长" : null)}
        active={v.phase === "gameOver" ? null : v.turn}
      />

      {v.phase === "gameOver" && v.winner !== null && (
        <p className="notice">
          <strong>{TEAM[v.winner]}获胜！</strong>
          {v.endedBy === "trap" ? "（对方踩中了陷阱词）" : "（找齐了全部的词）"}
        </p>
      )}
      {v.phase === "clue" && (
        <p className="muted">
          {myTurn && v.isCaptain ? "轮到你给提示：一个词 + 相关的词数。" : `等${TEAM[v.turn]}队长给提示…`}
        </p>
      )}
      {v.phase === "guess" && v.clue && (
        <p className="notice">
          {TEAM[v.turn]}的提示：<strong className="big-clue">{v.clue.word}</strong> × {v.clue.count}
          <span className="muted">
            （还能点 {v.guessesLeft} 个{canGuess ? "，和队友商量后点词" : ""}）
          </span>
        </p>
      )}

      <div className="word-grid">
        {v.words.map((w, i) => (
          <button
            key={w}
            type="button"
            className={`grid-word owner-${v.owners[i] ?? "unknown"}${v.revealed[i] ? " revealed" : ""}`}
            disabled={!canGuess || paused || v.revealed[i]}
            onClick={() => go({ type: "guess", index: i })}
          >
            {w}
          </button>
        ))}
      </div>
      {v.isCaptain && v.phase !== "gameOver" && (
        <p className="muted small">你是队长：红 / 蓝边框是两队的词，灰色是路人，黑底是陷阱。变暗的是已翻开的。</p>
      )}

      {v.phase === "clue" && myTurn && v.isCaptain && (
        <form
          className="answer-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (word.trim() && (await go({ type: "clue", word: word.trim(), count }))) setWord("");
          }}
        >
          <input value={word} onChange={(e) => setWord(e.target.value)} maxLength={12} placeholder="提示词" />
          <select value={count} onChange={(e) => setCount(Number(e.target.value))}>
            {[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => (
              <option key={n} value={n}>
                {n} 个
              </option>
            ))}
          </select>
          <button type="submit" className="primary" disabled={paused}>
            给出提示
          </button>
        </form>
      )}
      {canGuess && (
        <button type="button" disabled={paused} onClick={() => go({ type: "stop" })}>
          不点了，结束回合
        </button>
      )}

      {v.log.length > 0 && (
        <div className="word-log">
          {v.log.map((l, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the log is append-only
            <div key={i} className="word">
              <span className="who">{TEAM[l.team]}</span>
              <span className="text">
                {l.word} × {l.count} → {l.picks.map((p) => v.words[p]).join("、") || "…"}
              </span>
            </div>
          ))}
        </div>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "gameOver" ? "等待房主继续…" : undefined}>
        {v.phase === "gameOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.game >= v.totalGames ? "结束并回到大厅" : "下一局"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
