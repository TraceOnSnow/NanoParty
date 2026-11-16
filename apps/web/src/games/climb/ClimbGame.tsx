import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface View {
  game: number;
  totalGames: number;
  step: number;
  phase: "decide" | "move" | "gameOver" | "finished";
  players: string[];
  current: string;
  saved: Record<string, Record<string, number>>;
  climbers: Record<string, number>;
  claimed: Record<string, string>;
  dice: number[] | null;
  options: number[][];
  last: { by: string; kind: "bust" | "stop" | "roll" | "move"; dice?: number[]; columns?: number[] } | null;
  winners: string[];
  heights: Record<string, number>;
  deadlineAt: number | null;
}

const COLUMNS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const PIPS = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];
const optionText = (columns: number[]) =>
  columns.length === 2 && columns[0] === columns[1]
    ? `${columns[0]} 列走两步`
    : columns.map((c) => `${c} 列`).join(" 和 ");

export function ClimbGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const live = v.phase === "decide" || v.phase === "move";
  const myTurn = live && v.current === me && !paused;
  const climbing = Object.keys(v.climbers).length;
  const seat = (p: string) => v.players.indexOf(p);
  const owned = (p: string) => Object.values(v.claimed).filter((q) => q === p).length;

  const lastLine = (() => {
    const l = v.last;
    if (!l) return null;
    const dice = l.dice ? l.dice.map((d) => PIPS[d]).join(" ") : "";
    if (l.kind === "bust") return `${name(l.by)} 掷出 ${dice}，怎么分都走不了，这回合白爬了。`;
    if (l.kind === "stop")
      return l.columns?.length
        ? `${name(l.by)} 停下，拿下了 ${l.columns.join("、")} 列！`
        : `${name(l.by)} 见好就收，进度存下了。`;
    return null;
  })();

  return (
    <div className="game wide climb">
      <GameHead
        label={`第 ${v.game} 局 / 共 ${v.totalGames} 局`}
        deadlineAt={live ? v.deadlineAt : null}
        paused={paused}
      />
      <div className="climb-board">
        {COLUMNS.map((column) => {
          const height = v.heights[column] ?? 0;
          const owner = v.claimed[column];
          const climber = v.climbers[column];
          return (
            <div key={column} className={`climb-col${owner ? ` done p${seat(owner)}` : ""}`}>
              <div className="climb-cells">
                {Array.from({ length: height }, (_, k) => {
                  const level = height - k;
                  const here = v.players.filter((p) => (v.saved[p]?.[column] ?? 0) === level);
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: fixed track
                    <span key={k} className={`climb-cell${level === height ? " top" : ""}`}>
                      {!owner && here.map((p) => <i key={p} className={`climb-dot p${seat(p)}`} title={name(p)} />)}
                      {!owner && climber === level && <i className="climb-dot now" title="这回合爬到这里" />}
                    </span>
                  );
                })}
              </div>
              <strong>{column}</strong>
            </div>
          );
        })}
      </div>
      <p className="muted small">
        彩色圆点是存下来的进度，黑色圆点是这回合正在爬的（还没存）。越靠中间的列越长，也越容易掷到。
      </p>

      {live && (
        <div className="climb-turn">
          {v.dice && (
            <span className="climb-dice" role="img" aria-label={`骰子 ${v.dice.join(" ")}`}>
              {v.dice.map((d, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: four dice in roll order
                <span key={i}>{PIPS[d]}</span>
              ))}
            </span>
          )}
          {myTurn && v.phase === "move" && (
            <span className="host-row">
              <span>把骰子分成两对，前进：</span>
              {v.options.map((columns, index) => (
                <button
                  key={columns.join("+")}
                  type="button"
                  className="primary"
                  onClick={() => go({ type: "move", option: index })}
                >
                  {optionText(columns)}
                </button>
              ))}
            </span>
          )}
          {myTurn && v.phase === "decide" && (
            <span className="host-row">
              <button type="button" className="primary" onClick={() => go({ type: "roll" })}>
                {climbing > 0 ? "再掷一次" : "掷骰子"}
              </button>
              {climbing > 0 && (
                <button type="button" onClick={() => go({ type: "stop" })}>
                  见好就收（存下进度）
                </button>
              )}
            </span>
          )}
          {!myTurn && (
            <span className="muted">
              等 {name(v.current)} {v.phase === "move" ? "分骰子" : "决定"}…
            </span>
          )}
        </div>
      )}
      {lastLine && <p className="muted">{lastLine}</p>}

      <Seats
        room={room}
        ids={v.players}
        current={live ? v.current : null}
        win={v.winners}
        note={(p) => (
          <span className="tag">
            <i className={`climb-dot p${seat(p)}`} /> 已拿下 {owned(p)} 列
          </span>
        )}
      />
      {v.phase === "gameOver" && <p className="answer">{v.winners.map(name).join("、")} 先拿下三列，赢了这一局！</p>}
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
