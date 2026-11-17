import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, Progress, roundLabel, useNames } from "../ui.tsx";

type Card =
  | { kind: "gems"; value: number; left: number }
  | { kind: "hazard"; hazard: string }
  | { kind: "relic"; taken: boolean };
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "choose" | "roundOver" | "finished";
  players: string[];
  path: Card[];
  deckLeft: number;
  inside: string[];
  carried: Record<string, number>;
  myBanked: number | null;
  banked: Record<string, number> | null;
  chosen: string[];
  myChoice: boolean | null;
  lastLeft: { players: string[]; each: number; relics: number } | null;
  collapsed: string | null;
  removed: string[];
  winners: string[];
  deadlineAt: number | null;
}

export function DelveGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const inside = v.inside.includes(me);
  const deciding = v.phase === "choose" && inside && v.myChoice === null && !paused;
  const seen = v.path.filter((c): c is Extract<Card, { kind: "hazard" }> => c.kind === "hazard").map((c) => c.hazard);
  const onPath = v.path.reduce((sum, c) => sum + (c.kind === "gems" ? c.left : 0), 0);

  return (
    <div className="game wide delve">
      <GameHead
        label={roundLabel(v.round, v.totalRounds, "趟")}
        deadlineAt={v.phase === "choose" ? v.deadlineAt : null}
        paused={paused}
      />
      <div className="delve-path">
        {v.path.map((c, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: cards in the order they were turned over
          <span
            key={i}
            className={`delve-card ${c.kind}${c.kind === "hazard" && v.collapsed === c.hazard ? " boom" : ""}`}
          >
            {c.kind === "gems" ? (
              <>
                <strong>💎 {c.value}</strong>
                <em>路上剩 {c.left}</em>
              </>
            ) : c.kind === "hazard" ? (
              <>
                <strong>⚠ {c.hazard}</strong>
                <em>{seen.filter((h) => h === c.hazard).length >= 2 ? "第二次！" : "再来一次就塌"}</em>
              </>
            ) : (
              <>
                <strong>🏺 遗物</strong>
                <em>{c.taken ? "已被带走" : "独自离开才能带走"}</em>
              </>
            )}
          </span>
        ))}
        {v.phase === "choose" && <span className="delve-card back">？</span>}
      </div>
      <p className="muted small">
        路上还剩 {onPath} 颗宝石（回营地的人平分）。牌堆还有 {v.deckLeft} 张。
        {v.removed.length > 0 && ` 已经不会再出现的危险牌：${v.removed.join("、")}（各少一张）。`}
      </p>
      {v.lastLeft && (
        <p className="muted">
          {v.lastLeft.players.map(name).join("、")} 回营地了，每人从路上捡走 {v.lastLeft.each} 颗
          {v.lastLeft.relics > 0 ? `，还带走了遗物（值 ${v.lastLeft.relics}）` : ""}。
        </p>
      )}

      {v.phase === "choose" &&
        (deciding ? (
          <div className="host-row">
            <button type="button" className="primary" onClick={() => go({ type: "choose", stay: true })}>
              继续往里走
            </button>
            <button type="button" onClick={() => go({ type: "choose", stay: false })}>
              回营地（带走 {v.carried[me] ?? 0} 颗，再平分路上的 {onPath} 颗）
            </button>
          </div>
        ) : (
          <p className="muted">
            {inside ? `你选了「${v.myChoice ? "继续" : "回营地"}」，等其他人…` : "你已经回营地了，看他们还敢走多远。"}
          </p>
        ))}
      {v.phase === "choose" && <Progress ids={v.inside} done={v.chosen} name={name} />}
      {v.phase === "roundOver" && (
        <p className="answer">
          {v.collapsed ? `第二次${v.collapsed}！还在洞里的人这一趟的宝石全丢了。` : "所有人都回营地了，这一趟结束。"}
        </p>
      )}
      {v.phase === "finished" && <p className="answer">{v.winners.map(name).join("、")} 带出的宝石最多！</p>}

      <Seats
        room={room}
        ids={v.players}
        out={v.phase === "choose" ? v.players.filter((p) => !v.inside.includes(p)) : []}
        win={v.winners}
        note={(p) => (
          <span className="tag">
            {v.banked ? `帐篷 ${v.banked[p] ?? 0}` : v.inside.includes(p) ? `手里 ${v.carried[p] ?? 0}` : "已回营地"}
          </span>
        )}
      />
      {v.myBanked !== null && !v.banked && (
        <p className="muted small">
          你帐篷里有 <b>{v.myBanked}</b> 颗宝石（别人看不到）。
        </p>
      )}
      <HostControls isHost={room.me.isHost} waitNote={v.phase === "roundOver" ? "等待房主继续…" : undefined}>
        {v.phase === "roundOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.round >= v.totalRounds ? "结束并公布帐篷" : "下一趟"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
