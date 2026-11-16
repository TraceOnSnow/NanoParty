import { useEffect, useState } from "react";
import { useDragDrop } from "../drag.tsx";
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

const NUMBERS = [1, 2, 3, 4];
const ORDER = ["①", "②", "③"];
const TOKENS = 2;
const same = (a: number[] | null, b: number[]) => a !== null && a.join() === b.join();

function Tokens({ got, kind }: { got: number; kind: "good" | "bad" }) {
  return (
    <span className={`tokens ${kind}`} title={kind === "good" ? "拦截成功" : "本队解错"}>
      {kind === "good" ? "拦截" : "失误"}
      {Array.from({ length: TOKENS }, (_, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: fixed token slots
        <i key={i} className={i < got ? "on" : ""} />
      ))}
    </span>
  );
}

export function CodeBreakGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [clues, setClues] = useState(["", "", ""]);
  /** For each team's sheet: which column each of this round's three clues was put in. */
  const [picks, setPicks] = useState<Pair<(number | null)[]>>([
    [null, null, null],
    [null, null, null],
  ]);
  const [held, setHeld] = useState<{ team: Team; clue: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: fresh inputs every round and phase
  useEffect(() => {
    setClues(["", "", ""]);
    setPicks([
      [null, null, null],
      [null, null, null],
    ]);
    setHeld(null);
  }, [v.round, v.phase]);
  const team = v.myTeam;
  const encoding = team !== null && v.encoders[team] === me;

  const put = (t: Team, clue: number, column: number | null) =>
    setPicks((p) => {
      const mine = p[t].map((c, i) => (i === clue ? column : c === column ? null : c));
      return (t === 0 ? [mine, p[1]] : [p[0], mine]) as Pair<(number | null)[]>;
    });
  const { dragging, grab, ghost } = useDragDrop<{ team: Team; clue: number }>((item, target) => {
    const [kind, t, column] = target.split(":");
    if (Number(t) !== item.team) return;
    put(item.team, item.clue, kind === "col" ? Number(column) : null);
  });

  /** Whether I still have to work out this team's code this round. */
  const mayGuess = (t: Team) =>
    v.phase === "guess" &&
    team !== null &&
    !paused &&
    v.clues[t] !== null &&
    v.myGuesses[t] === null &&
    (t === team ? !encoding : v.canIntercept);

  const last = v.history.at(-1);
  const sheet = (t: Team) => {
    const mine = t === team;
    const words = v.keywords[t];
    const guessing = mayGuess(t);
    const current = v.clues[t];
    const pick = picks[t];
    const done = pick.every((c) => c !== null);
    const encodeHere = v.phase === "clue" && mine && encoding && !v.cluesDone[t] && v.myCode;
    return (
      <section key={t} className={`code-sheet team-${t}${mine ? " mine" : ""}`}>
        <header>
          <strong>
            {TEAM[t]}的密码本{mine ? "（本队）" : ""}
          </strong>
          <span className="muted small">
            {mine ? "关键词只有本队看得到" : words ? "关键词已公开" : "对方的关键词，靠提示猜"}
          </span>
        </header>
        <div className="code-columns">
          {NUMBERS.map((n) => {
            const past = v.history.map((h) => ({ round: h.round, clue: h.teams[t].clues[h.teams[t].code.indexOf(n)] }));
            const pending = pick.flatMap((c, i) => (c === n ? [i] : []));
            const myDigit = encodeHere ? v.myCode?.indexOf(n) : -1;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: a drop target; tapping it is the fallback for dragging
              // biome-ignore lint/a11y/useKeyWithClickEvents: the chips inside are the keyboard-reachable controls
              <div
                key={n}
                data-drop={`col:${t}:${n}`}
                className={`code-column${guessing && (dragging?.team === t || held?.team === t) ? " target" : ""}${myDigit !== undefined && myDigit >= 0 ? " wanted" : ""}`}
                onClick={() => {
                  if (guessing && held?.team === t) {
                    put(t, held.clue, n);
                    setHeld(null);
                  }
                }}
              >
                <div className="code-number">{n}</div>
                <div className="code-word">{words?.[n - 1] ?? "？"}</div>
                {myDigit !== undefined && myDigit >= 0 && <span className="code-order">{ORDER[myDigit]}</span>}
                <ul>
                  {past.map(
                    (p) =>
                      p.clue !== undefined && (
                        <li key={p.round} className={last?.round === p.round && v.phase === "reveal" ? "fresh" : ""}>
                          {p.clue}
                        </li>
                      ),
                  )}
                  {pending.map((i) => (
                    <li key={`p${i}`} className="pending">
                      <button
                        type="button"
                        className="clue-chip"
                        onPointerDown={grab(
                          { team: t, clue: i },
                          <span className="clue-chip">{current?.[i]}</span>,
                          () => put(t, i, null),
                        )}
                      >
                        <b>{ORDER[i]}</b>
                        {current?.[i]}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>

        {encodeHere && (
          <form
            className="code-write"
            onSubmit={(e) => {
              e.preventDefault();
              if (clues.every((c) => c.trim())) go({ type: "clues", clues: clues.map((c) => c.trim()) });
            }}
          >
            <p>
              你是传令员。这一轮的密码是 <strong className="big-clue">{v.myCode?.join(" - ")}</strong>
              ，按顺序给每一位写一条提示，让队友猜出是哪个词，又别让对面看穿。
            </p>
            {v.myCode?.map((digit, i) => (
              <label key={digit} className="answer-row">
                <span className="code-target">
                  <b>{ORDER[i]}</b> {digit} · {words?.[digit - 1]}
                </span>
                <input
                  value={clues[i]}
                  maxLength={20}
                  placeholder="提示"
                  onChange={(e) => setClues((c) => c.map((x, k) => (k === i ? e.target.value : x)))}
                />
              </label>
            ))}
            <button type="submit" className="primary wide" disabled={paused || !clues.every((c) => c.trim())}>
              提交三条提示
            </button>
          </form>
        )}

        {v.phase === "guess" && current && (
          <div className="code-current">
            <span className="muted small">这一轮的三条提示（按顺序）</span>
            <div className="clue-tray" data-drop={`tray:${t}`}>
              {current.map((c, i) =>
                guessing && pick[i] === null ? (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: the three clues are positions
                    key={i}
                    type="button"
                    className={`clue-chip${held?.team === t && held.clue === i ? " held" : ""}`}
                    onPointerDown={grab({ team: t, clue: i }, <span className="clue-chip">{c}</span>, () =>
                      setHeld(held?.team === t && held.clue === i ? null : { team: t, clue: i }),
                    )}
                  >
                    <b>{ORDER[i]}</b>
                    {c}
                  </button>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: the three clues are positions
                  <span key={i} className={`clue-chip static${guessing ? " placed" : ""}`}>
                    <b>{ORDER[i]}</b>
                    {c}
                  </span>
                ),
              )}
            </div>
            {guessing ? (
              <>
                <p className="muted small">把每条提示拖到上面你认为对应的那一列（也可以先点提示再点列）。</p>
                <button
                  type="button"
                  className="primary wide"
                  disabled={!done}
                  onClick={() => go({ type: "guess", target: t, code: pick })}
                >
                  {done ? `提交${mine ? "解读" : "破译"}：${pick.join(" - ")}` : "三条提示都要放进列里"}
                </button>
              </>
            ) : v.myGuesses[t] ? (
              <p className="notice">
                本队已提交{mine ? "解读" : "破译"}：<strong>{v.myGuesses[t]?.join(" - ")}</strong>
              </p>
            ) : mine && encoding ? (
              <p className="muted">等队友解读你的提示…（别出声）</p>
            ) : !mine && !v.canIntercept && team !== null ? (
              <p className="muted small">第 1 轮不破译对方，从第 2 轮开始。</p>
            ) : null}
          </div>
        )}

        {(v.phase === "reveal" || v.phase === "finished") && last && (
          <div className="code-result">
            <span>
              密码 <strong className="big-clue">{last.teams[t].code.join(" - ")}</strong>
            </span>
            <span className={same(last.teams[t].decode, last.teams[t].code) ? "stamp ok" : "stamp bad"}>
              {TEAM[t]}自己{same(last.teams[t].decode, last.teams[t].code) ? "读对了" : "读错了，记 1 次失误"}
            </span>
            {last.round > 1 && (
              <span className={same(last.teams[t].intercept, last.teams[t].code) ? "stamp bad" : "stamp ok"}>
                {same(last.teams[t].intercept, last.teams[t].code)
                  ? `被${TEAM[1 - t]}破译了！`
                  : `${TEAM[1 - t]}没破译出来`}
              </span>
            )}
          </div>
        )}
      </section>
    );
  };

  const order: Team[] = team === 1 ? [1, 0] : [0, 1];
  return (
    <div className="game codebreak">
      <GameHead label={`第 ${v.round} 轮`} deadlineAt={v.deadlineAt} paused={paused} />
      <TeamBar
        teams={v.teams}
        name={name}
        room={room}
        me={me}
        badge={(p) => (v.encoders.includes(p) ? "传令员" : null)}
      />
      <div className="token-row">
        {([0, 1] as const).map((t) => (
          <div key={t} className={`team-${t}`}>
            <Tokens got={v.intercepts[t]} kind="good" />
            <Tokens got={v.miscomms[t]} kind="bad" />
          </div>
        ))}
      </div>
      {v.winner !== null && <h2 className="question">{v.winner === "draw" ? "平局！" : `${TEAM[v.winner]}获胜！`}</h2>}
      {v.phase === "clue" && !(encoding && team !== null && !v.cluesDone[team]) && (
        <p className="notice">
          传令员正在写提示…　{TEAM[0]}
          {v.cluesDone[0] ? " ✓" : " …"}　{TEAM[1]}
          {v.cluesDone[1] ? " ✓" : " …"}
        </p>
      )}
      {order.map(sheet)}
      {ghost}

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
