import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, useNames } from "../ui.tsx";

type Card = string;
interface View {
  mission: number;
  totalMissions: number;
  step: number;
  phase: "tasks" | "play" | "missionOver" | "finished";
  players: string[];
  commander: string;
  tasks: { card: Card; owner: string | null; done: boolean }[];
  current: string;
  trick: { playerId: string; card: Card }[];
  lastTrick: { winner: string; cards: { playerId: string; card: Card }[] } | null;
  tricksWon: Record<string, number>;
  signals: Record<string, { card: Card; kind: "highest" | "lowest" | "only" }>;
  result: "success" | "failure" | null;
  failedTask: Card | null;
  myHand: Card[];
  playable: Card[];
  handSizes: Record<string, number>;
  canSignal: boolean;
  deadlineAt: number | null;
}

const SUIT_NAME: Record<string, string> = { red: "红", blue: "蓝", green: "绿", yellow: "黄", trump: "王" };
const SIGNAL: Record<string, string> = { highest: "最大", lowest: "最小", only: "唯一" };
const label = (c: Card) => `${SUIT_NAME[c.split("-")[0] as string]}${c.split("-")[1]}`;

function CardFace({
  card,
  onClick,
  disabled,
  dim,
}: {
  card: Card;
  onClick?: () => void;
  disabled?: boolean;
  dim?: boolean;
}) {
  const suit = card.split("-")[0];
  const body = (
    <>
      <strong>{card.split("-")[1]}</strong>
      <span>{SUIT_NAME[suit as string]}</span>
    </>
  );
  const cls = `card-face suit-${suit}${dim ? " dim" : ""}`;
  return onClick ? (
    <button type="button" className={cls} onClick={onClick} disabled={disabled}>
      {body}
    </button>
  ) : (
    <span className={cls}>{body}</span>
  );
}

export function CrewGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.current === me;

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.mission} 次任务 / 共 ${v.totalMissions} 次 · 队长：${name(v.commander)}`}
        deadlineAt={v.phase === "tasks" || v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />

      <div className="card">
        <strong>任务</strong>
        <ul className="chips">
          {v.tasks.map((t) => (
            <li key={t.card} className={`chip ${t.done ? "done" : ""} ${v.failedTask === t.card ? "out" : ""}`}>
              {label(t.card)} → {t.owner ? name(t.owner) : "未认领"}
              {t.done ? " ✓" : ""}
              {v.phase === "tasks" && myTurn && !t.owner && (
                <button
                  type="button"
                  className="link ok"
                  disabled={paused}
                  onClick={() => go({ type: "takeTask", card: t.card })}
                >
                  认领
                </button>
              )}
            </li>
          ))}
        </ul>
        {v.phase === "tasks" && (
          <p className="muted small">{myTurn ? "轮到你认领一个任务。" : `等 ${name(v.current)} 认领任务…`}</p>
        )}
      </div>

      <table className="results">
        <tbody>
          {v.players.map((p) => (
            <tr key={p} className={p === v.current && v.phase === "play" ? "win" : ""}>
              <td>
                {name(p)}
                {p === v.current && v.phase === "play" ? "（出牌中）" : ""}
              </td>
              <td className="muted">
                手牌 {v.handSizes[p]} · 赢墩 {v.tricksWon[p] ?? 0}
              </td>
              <td>{v.signals[p] ? `公开：${label(v.signals[p].card)}（${SIGNAL[v.signals[p].kind]}）` : ""}</td>
              <td>
                {v.trick.find((t) => t.playerId === p) ? (
                  <CardFace card={(v.trick.find((t) => t.playerId === p) as { card: Card }).card} />
                ) : null}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {v.lastTrick && (
        <p className="muted small">
          上一墩由 {name(v.lastTrick.winner)} 赢下：
          {v.lastTrick.cards.map((c) => `${name(c.playerId)} ${label(c.card)}`).join("，")}
        </p>
      )}

      {v.myHand.length > 0 && (
        <>
          <p className="muted">
            {v.phase === "play"
              ? myTurn
                ? "轮到你出牌（灰色的牌现在不能出）。"
                : `等 ${name(v.current)} 出牌…`
              : "你的手牌"}
          </p>
          <div className="hand">
            {v.myHand.map((c) => (
              <CardFace
                key={c}
                card={c}
                dim={myTurn && v.phase === "play" && !v.playable.includes(c)}
                disabled={paused || !v.playable.includes(c)}
                onClick={() => go({ type: "play", card: c })}
              />
            ))}
          </div>
          {v.canSignal && (
            <details>
              <summary className="muted small">公开一张手牌（每次任务一次，只能在两墩之间）</summary>
              <div className="hand">
                {v.myHand
                  .filter((c) => !c.startsWith("trump"))
                  .map((c) => (
                    <CardFace key={c} card={c} disabled={paused} onClick={() => go({ type: "signal", card: c })} />
                  ))}
              </div>
            </details>
          )}
        </>
      )}

      {v.phase === "missionOver" && (
        <p className="answer">
          {v.result === "success" ? "任务成功！全员 +3" : `任务失败：${label(v.failedTask ?? "")} 被别人赢走了。`}
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "missionOver" ? "等待房主继续…" : undefined}>
        {v.phase === "missionOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.mission >= v.totalMissions ? "结束并回到大厅" : "下一次任务"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
