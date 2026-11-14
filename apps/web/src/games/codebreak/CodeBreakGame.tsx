import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { TEAM, TeamBar } from "../teams.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

type Pair<T> = [T, T];
type Team = 0 | 1;
interface Round {
  round: number;
  teams: Pair<{ clues: string[]; code: number[]; decode: number[] | null; intercept: number[] | null }>;
}
interface View {
  round: number;
  step: number;
  phase: "clue" | "guess" | "reveal" | "finished";
  teams: Pair<string[]>;
  myTeam: Team | null;
  encoders: Pair<string>;
  keywords: Pair<string[] | null>;
  myCode: number[] | null;
  clues: Pair<string[] | null>;
  cluesDone: Pair<boolean>;
  myGuesses: Pair<number[] | null>;
  guessesDone: Pair<Pair<boolean>>;
  canIntercept: boolean;
  history: Round[];
  intercepts: Pair<number>;
  miscomms: Pair<number>;
  winner: Team | "draw" | null;
  deadlineAt: number | null;
}

const show = (code: number[] | null) => code?.join("-") ?? "未提交";

function CodeInput({
  label,
  disabled,
  onSubmit,
}: {
  label: string;
  disabled: boolean;
  onSubmit(code: number[]): void;
}) {
  const [code, setCode] = useState([1, 2, 3]);
  return (
    <div className="answer-row">
      <span>{label}</span>
      {[0, 1, 2].map((i) => (
        <select
          key={i}
          value={code[i]}
          onChange={(e) => setCode((c) => c.map((d, k) => (k === i ? Number(e.target.value) : d)))}
        >
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </select>
      ))}
      <button type="button" className="primary" disabled={disabled} onClick={() => onSubmit(code)}>
        提交
      </button>
    </div>
  );
}

export function CodeBreakGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [clues, setClues] = useState(["", "", ""]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fresh inputs every round
  useEffect(() => setClues(["", "", ""]), [v.round]);
  const team = v.myTeam;
  const encoding = team !== null && v.encoders[team] === me;

  return (
    <div className="game">
      <GameHead label={`第 ${v.round} 轮`} deadlineAt={v.deadlineAt} paused={paused} />
      <TeamBar
        teams={v.teams}
        name={name}
        note={[0, 1].map((t) => `拦截 ${v.intercepts[t as Team]} · 失误 ${v.miscomms[t as Team]}`) as Pair<string>}
        badge={(p) => (v.encoders.includes(p) ? "传令员" : null)}
      />
      {v.winner !== null && (
        <p className="notice">
          <strong>{v.winner === "draw" ? "平局！" : `${TEAM[v.winner]}获胜！`}</strong>
        </p>
      )}

      {([0, 1] as const).map((t) =>
        v.keywords[t] ? (
          <div key={t} className={`keywords team-${t}`}>
            <span className="muted small">{t === team ? "本队关键词（别让对面知道）" : `${TEAM[t]}的关键词`}</span>
            <ol>
              {v.keywords[t]?.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ol>
          </div>
        ) : null,
      )}

      {v.phase === "clue" &&
        (encoding && team !== null && !v.cluesDone[team] && v.myCode ? (
          <form
            className="card"
            onSubmit={(e) => {
              e.preventDefault();
              if (clues.every((c) => c.trim())) go({ type: "clues", clues: clues.map((c) => c.trim()) });
            }}
          >
            <p>
              你的密码是 <strong className="big-clue">{v.myCode.join("-")}</strong>，按顺序为每一位写一条提示：
            </p>
            {v.myCode.map((digit, i) => (
              <label key={digit} className="answer-row">
                <span>
                  {digit}（{team !== null && v.keywords[team]?.[digit - 1]}）
                </span>
                <input
                  value={clues[i]}
                  maxLength={20}
                  onChange={(e) => setClues((c) => c.map((x, k) => (k === i ? e.target.value : x)))}
                />
              </label>
            ))}
            <button type="submit" className="primary" disabled={paused}>
              提交提示
            </button>
          </form>
        ) : (
          <p className="muted">
            传令员正在写提示…（红队{v.cluesDone[0] ? "已完成" : "未完成"}，蓝队{v.cluesDone[1] ? "已完成" : "未完成"}）
          </p>
        ))}

      {v.phase === "guess" && (
        <div className="card">
          {([0, 1] as const).map((t) => (
            <div key={t}>
              <p>
                <strong>{TEAM[t]}的提示：</strong>
                {v.clues[t]?.join(" ／ ") ?? "（没有提交）"}
              </p>
              {team === null || (t !== team && !v.canIntercept) ? null : v.myGuesses[t] ? (
                <p className="muted">
                  {t === team ? "本队解读" : "本队破译"}：{show(v.myGuesses[t])}
                </p>
              ) : t === team && encoding ? (
                <p className="muted">等队友解读你的提示…（别出声）</p>
              ) : (
                <CodeInput
                  label={t === team ? "解读本队密码" : "破译对方密码"}
                  disabled={paused}
                  onSubmit={(code) => go({ type: "guess", target: t, code })}
                />
              )}
            </div>
          ))}
          {!v.canIntercept && <p className="muted small">第 1 轮只解读本队密码，第 2 轮起可以破译对方。</p>}
        </div>
      )}

      {v.history.length > 0 && (
        <table className="results">
          <thead>
            <tr>
              <th>轮</th>
              <th>队伍</th>
              <th>提示</th>
              <th>密码</th>
              <th>本队解读</th>
              <th>对方破译</th>
            </tr>
          </thead>
          <tbody>
            {[...v.history].reverse().flatMap((h) =>
              ([0, 1] as const).map((t) => (
                <tr key={`${h.round}-${t}`}>
                  <td>{h.round}</td>
                  <td>{TEAM[t]}</td>
                  <td>{h.teams[t].clues.join(" ／ ")}</td>
                  <td>{show(h.teams[t].code)}</td>
                  <td>{show(h.teams[t].decode)}</td>
                  <td>{h.round === 1 ? "—" : show(h.teams[t].intercept)}</td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "clue" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，公开提示
          </button>
        )}
        {v.phase === "guess" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            不等了，直接揭晓
          </button>
        )}
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "advance" })}>
            {v.winner !== null ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
