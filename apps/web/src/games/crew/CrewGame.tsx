import { useState } from "react";
import { Avatar } from "../../components/Avatar.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Felt, PlayHand, Seats } from "../table.tsx";
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

const SUIT_ORDER = ["trump", "red", "blue", "green", "yellow"];
const bySuit = (a: Card, b: Card) => {
  const [sa, na] = a.split("-") as [string, string];
  const [sb, nb] = b.split("-") as [string, string];
  return SUIT_ORDER.indexOf(sa) - SUIT_ORDER.indexOf(sb) || Number(nb) - Number(na);
};

function CardFace({ card, small }: { card: Card; small?: boolean }) {
  const suit = card.split("-")[0];
  return (
    <span className={`card-face suit-${suit}${small ? " small" : ""}`}>
      <strong>{card.split("-")[1]}</strong>
      <span>{SUIT_NAME[suit as string]}</span>
    </span>
  );
}

export function CrewGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.current === me && !paused;
  const [signalling, setSignalling] = useState(false);
  const led = v.trick[0]?.card.split("-")[0];
  const hand = [...v.myHand].sort(bySuit);
  const play = (c: Card) => {
    if (signalling) {
      setSignalling(false);
      void go({ type: "signal", card: c });
    } else void go({ type: "play", card: c });
  };

  return (
    <div className="game wide">
      <GameHead
        label={`第 ${v.mission} 次任务 / 共 ${v.totalMissions} 次 · 队长：${name(v.commander)}`}
        deadlineAt={v.phase === "tasks" || v.phase === "play" ? v.deadlineAt : null}
        paused={paused}
      />

      <div className="task-row">
        <strong>任务</strong>
        {v.tasks.map((t) => {
          const open = v.phase === "tasks" && myTurn && !t.owner;
          const body = (
            <>
              <CardFace card={t.card} small />
              {t.owner ? <Avatar room={room} id={t.owner} size="s" /> : <span className="muted small">没人领</span>}
              <span className="small">
                {t.done ? "✓ 完成" : v.failedTask === t.card ? "✕ 失败" : t.owner ? `${name(t.owner)} 要赢到` : ""}
              </span>
            </>
          );
          return open ? (
            <button
              key={t.card}
              type="button"
              className="task open"
              onClick={() => go({ type: "takeTask", card: t.card })}
            >
              {body}
              <span className="small">点我认领</span>
            </button>
          ) : (
            <span key={t.card} className={`task${t.done ? " done" : ""}${v.failedTask === t.card ? " failed" : ""}`}>
              {body}
            </span>
          );
        })}
      </div>
      {v.phase === "tasks" && (
        <p className="muted">
          {v.current === me
            ? "轮到你认领一个任务：这张牌必须由你赢下的那一墩拿到。"
            : `等 ${name(v.current)} 认领任务…`}
        </p>
      )}

      <Felt>
        <Seats
          room={room}
          ids={v.players}
          current={v.phase === "play" || v.phase === "tasks" ? v.current : null}
          note={(p) => (
            <span className="tag">
              赢 {v.tricksWon[p] ?? 0} 墩 · 手牌 {v.handSizes[p]}
            </span>
          )}
        >
          {(p) => {
            const played = v.trick.find((t) => t.playerId === p);
            const signal = v.signals[p];
            return (
              <>
                {played ? <CardFace card={played.card} /> : <span className="card-face empty" />}
                {signal && (
                  <span className="strength">
                    公开 {label(signal.card)}：这门里{SIGNAL[signal.kind]}的
                  </span>
                )}
              </>
            );
          }}
        </Seats>
        {v.lastTrick && (
          <p className="felt-note">
            <span>上一墩 {name(v.lastTrick.winner)} 赢：</span>
            {v.lastTrick.cards.map((c) => (
              <span key={c.playerId} className="trick-play">
                <Avatar room={room} id={c.playerId} size="s" />
                <b>{label(c.card)}</b>
              </span>
            ))}
          </p>
        )}
      </Felt>

      {v.myHand.length > 0 && (
        <>
          <p className="muted">
            {signalling
              ? "选一张要公开的牌（不能是王牌；必须是你这门里最大、最小或唯一的一张）。"
              : v.phase === "play"
                ? v.current === me
                  ? led
                    ? `轮到你：这墩出的是${SUIT_NAME[led]}，有就必须跟，变灰的不能出。`
                    : "轮到你领出这一墩。"
                  : `等 ${name(v.current)} 出牌…`
                : "你的手牌"}
          </p>
          <PlayHand
            cards={hand}
            face={(c) => <CardFace card={c} />}
            enabled={!paused && (signalling || (v.phase === "play" && v.current === me))}
            playable={(c) => (signalling ? !c.startsWith("trump") : v.playable.includes(c))}
            confirm={(c) => (signalling ? `公开 ${label(c)}` : `打出 ${label(c)}`)}
            onPlay={play}
            resetKey={`${v.step}-${signalling}`}
          />
          {v.canSignal && (
            <button type="button" disabled={paused} onClick={() => setSignalling((x) => !x)}>
              {signalling ? "算了，不公开" : "公开一张手牌给队友看（每次任务一次）"}
            </button>
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
