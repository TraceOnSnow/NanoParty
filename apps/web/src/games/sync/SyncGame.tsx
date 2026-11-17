import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface View {
  level: number;
  totalLevels: number;
  round: number;
  step: number;
  phase: "play" | "levelOver" | "won" | "lost" | "finished";
  players: string[];
  myHand: number[] | null;
  counts: Record<string, number>;
  hands: Record<string, number[]> | null;
  pile: { card: number; by: string }[];
  lives: number;
  stars: number;
  starVotes: string[];
  shown: { kind: "mistake" | "star"; card?: number; by?: string; cards: { by: string; card: number }[] } | null;
  reward: "star" | "life" | null;
}

export function SyncGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const live = v.phase === "play";
  const hand = v.myHand ?? [];
  const lowest = hand[0];
  const top = v.pile.at(-1);
  const voted = v.starVotes.includes(me);
  const waitingFor = v.players.filter((p) => (v.counts[p] ?? 0) > 0 && !v.starVotes.includes(p));

  return (
    <div className="game wide sync">
      <GameHead label={`第 ${v.level} 关 / 共 ${v.totalLevels} 关`} deadlineAt={null} paused={paused} />
      <div className="sync-status">
        <span title="命">{"❤".repeat(Math.max(0, v.lives)) || "没命了"}</span>
        <span title="星">{"★".repeat(v.stars) || "没有星"}</span>
        <span className="muted small">不许说自己有什么牌。觉得该你了，就出。</span>
      </div>

      <div className="sync-pile">
        {top ? (
          <>
            <span className="sync-card top">{top.card}</span>
            <span className="muted">
              {name(top.by)} 出的。已经打出 {v.pile.length} 张：
              {v.pile
                .slice(-8)
                .map((c) => c.card)
                .join(" → ")}
            </span>
          </>
        ) : (
          <span className="muted">还没人出牌。谁手里的最小，谁先出。</span>
        )}
      </div>
      {v.shown && (
        <p className={v.shown.kind === "mistake" ? "error" : "muted"}>
          {v.shown.kind === "mistake"
            ? `${name(v.shown.by ?? "")} 出了 ${v.shown.card}，可是还有更小的：`
            : "用了一颗星，每人亮出并弃掉最小的一张："}
          {v.shown.cards.map((c) => `${name(c.by)} 的 ${c.card}`).join("、")}
          {v.shown.kind === "mistake" ? "。掉一条命。" : "。"}
        </p>
      )}

      {live && (
        <div className="sync-hand">
          {hand.length === 0 ? (
            <span className="muted">你的牌出完了，看队友的。</span>
          ) : (
            hand.map((card, i) => (
              <button
                key={card}
                type="button"
                className={`sync-card${i === 0 ? " primary" : ""}`}
                disabled={i !== 0 || paused}
                title={i === 0 ? "出这张" : "只能先出最小的"}
                onClick={() => send({ type: "play", card, round: v.round })}
              >
                {card}
              </button>
            ))
          )}
          {lowest !== undefined && <span className="muted small">点最小的那张（{lowest}）就是出牌，没有回合。</span>}
        </div>
      )}
      {live && v.stars > 0 && hand.length > 0 && (
        <p className="muted">
          <button type="button" disabled={paused} onClick={() => send({ type: "star", on: !voted, round: v.round })}>
            {voted ? "撤回：先不用星" : "提议用一颗星"}
          </button>{" "}
          {v.starVotes.length > 0 &&
            `${v.starVotes.map(name).join("、")} 想用星，还差 ${waitingFor.map(name).join("、")} 同意。`}
        </p>
      )}

      <Seats room={room} ids={v.players} note={(p) => <span className="tag">还有 {v.counts[p] ?? 0} 张</span>}>
        {(p) =>
          v.hands ? (
            (v.hands[p] ?? []).map((c) => (
              <span key={c} className="mini-card">
                {c}
              </span>
            ))
          ) : (
            <span className="muted small">{"🂠".repeat(Math.min(v.counts[p] ?? 0, 12))}</span>
          )
        }
      </Seats>

      {v.phase === "levelOver" && (
        <p className="answer">
          第 {v.level} 关通过！{v.reward === "star" ? "奖励一颗星。" : v.reward === "life" ? "奖励一条命。" : ""}
        </p>
      )}
      {v.phase === "won" && <p className="answer">全部通关！你们真的心照不宣。</p>}
      {v.phase === "lost" && <p className="answer">命用完了，停在第 {v.level} 关。</p>}
      <HostControls isHost={room.me.isHost} waitNote={live ? undefined : "等待房主继续…"}>
        {!live && v.phase !== "finished" && (
          <button
            type="button"
            className="primary"
            disabled={paused}
            onClick={() => send({ type: "next", step: v.step })}
          >
            {v.phase === "levelOver" ? `进入第 ${v.level + 1} 关` : "结束并回到大厅"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
