import { useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, useNames } from "../ui.tsx";

interface View {
  game: number;
  totalGames: number;
  step: number;
  phase: "offer" | "respond" | "relay" | "gameOver" | "finished";
  players: string[];
  kinds: string[];
  current: string;
  myHand: string[] | null;
  handCounts: Record<string, number>;
  table: Record<string, Record<string, number>>;
  pass: { claim: string; sender: string; holder: string; seen: string[]; card: string | null } | null;
  last: { card: string; claim: string; sender: string; caller: string; truth: boolean; taker: string } | null;
  loser: string | null;
  lostBy: "four" | "empty" | null;
  deadlineAt: number | null;
}

export function DishGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [kind, setKind] = useState<string | null>(null);
  const [claim, setClaim] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new step is a new decision
  useEffect(() => {
    setKind(null);
    setClaim(null);
    setTarget(null);
  }, [v.step]);

  const live = v.phase === "offer" || v.phase === "respond" || v.phase === "relay";
  const offering = v.phase === "offer" && v.current === me && !paused;
  const holding = v.pass?.holder === me && !paused;
  const relaying = v.phase === "relay" && holding;
  const choosing = offering || relaying;
  const unseen = v.players.filter((p) => p !== me && !(v.pass?.seen ?? []).includes(p));
  const targets = offering ? v.players.filter((p) => p !== me) : relaying ? unseen : [];
  const hand = v.myHand ?? [];
  const grouped = v.kinds.map((k) => ({ k, n: hand.filter((c) => c === k).length })).filter((g) => g.n > 0);
  const ready = !!claim && !!target && (relaying || !!kind);

  return (
    <div className="game wide dish">
      <GameHead
        label={`第 ${v.game} 局 / 共 ${v.totalGames} 局`}
        deadlineAt={live ? v.deadlineAt : null}
        paused={paused}
      />

      {v.pass && (
        <div className="dish-pass">
          <span className="dish-card back">{v.pass.card ?? "？"}</span>
          <span>
            {name(v.pass.sender)} 把这张牌推给 {name(v.pass.holder)}，说：
            <strong>「这是{v.pass.claim}」</strong>
            {v.pass.card && (
              <span className="muted small">
                {" "}
                （你看过，它其实是{v.pass.card}，{v.pass.card === v.pass.claim ? "说的是实话" : "在骗人"}）
              </span>
            )}
          </span>
        </div>
      )}
      {v.phase === "respond" &&
        (holding ? (
          <div className="host-row">
            <button type="button" className="primary" onClick={() => go({ type: "call", truth: true })}>
              是真的
            </button>
            <button type="button" className="primary" onClick={() => go({ type: "call", truth: false })}>
              在骗人
            </button>
            <button type="button" disabled={unseen.length === 0} onClick={() => go({ type: "peek" })}>
              {unseen.length === 0 ? "所有人都看过了，只能判断" : "偷看一眼，甩给别人"}
            </button>
          </div>
        ) : (
          <p className="muted">等 {name(v.pass?.holder ?? "")} 判断真假，或者偷看后甩给别人…</p>
        ))}
      {v.phase === "relay" && !holding && <p className="muted">{name(v.pass?.holder ?? "")} 偷看了，正在决定甩给谁…</p>}
      {v.phase === "offer" && !offering && <p className="muted">等 {name(v.current)} 选一张牌推出去…</p>}

      {choosing && (
        <div className="dish-form">
          {offering && (
            <div>
              <span className="muted small">① 选一张要推出去的牌</span>
              <div className="host-row">
                {grouped.map((g) => (
                  <button
                    key={g.k}
                    type="button"
                    className={`dish-card${kind === g.k ? " picked" : ""}`}
                    onClick={() => setKind(g.k)}
                  >
                    {g.k}
                    <em>×{g.n}</em>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div>
            <span className="muted small">{offering ? "②" : "①"} 你要说它是什么（可以说谎）</span>
            <div className="host-row">
              {v.kinds.map((k) => (
                <button key={k} type="button" className={claim === k ? "primary" : ""} onClick={() => setClaim(k)}>
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span className="muted small">{offering ? "③" : "②"} 推给谁</span>
            <div className="host-row">
              {targets.map((p) => (
                <button key={p} type="button" className={target === p ? "primary" : ""} onClick={() => setTarget(p)}>
                  {name(p)}
                </button>
              ))}
            </div>
          </div>
          <button
            type="button"
            className="primary wide"
            disabled={!ready}
            onClick={() => go(offering ? { type: "offer", kind, target, claim } : { type: "relay", target, claim })}
          >
            {ready ? `推给 ${name(target ?? "")}，说「这是${claim}」` : "三样都选好再推"}
          </button>
        </div>
      )}

      {v.last && (
        <p className={v.phase === "gameOver" ? "answer" : "muted"}>
          {name(v.last.caller)} 说 {name(v.last.sender)} {v.last.truth ? "说的是真的" : "在骗人"}。翻开是「{v.last.card}
          」（
          {name(v.last.sender)} 说的是「{v.last.claim}」）——{name(v.last.taker)} 收下这张牌。
        </p>
      )}
      {v.phase === "gameOver" && v.loser && (
        <p className="answer">
          {name(v.loser)} 输了：{v.lostBy === "four" ? "面前有四张一样的。" : "轮到开始却没有手牌了。"}
        </p>
      )}

      <Seats
        room={room}
        ids={v.players}
        current={live ? (v.pass?.holder ?? v.current) : null}
        out={v.loser ? [v.loser] : []}
        note={(p) => <span className="tag">手牌 {v.handCounts[p] ?? 0}</span>}
      >
        {(p) => {
          const pile = Object.entries(v.table[p] ?? {});
          return pile.length === 0 ? (
            <span className="muted small">面前还没有牌</span>
          ) : (
            pile.map(([k, n]) => (
              <span key={k} className={`dish-card small${n >= 3 ? " danger" : ""}`}>
                {k}
                <em>×{n}</em>
              </span>
            ))
          );
        }}
      </Seats>
      {!choosing && hand.length > 0 && live && (
        <p className="muted small">你的手牌：{grouped.map((g) => `${g.k}×${g.n}`).join("、")}</p>
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
