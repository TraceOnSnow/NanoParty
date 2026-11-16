import type { PointerEvent as ReactPointerEvent } from "react";
import { type FormEvent, useEffect, useState } from "react";
import { Avatar, Who } from "../../components/Avatar.tsx";
import { Candidates, type HistoryItem } from "../Candidates.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct, useCountdown } from "../shared.ts";
import { Progress } from "../ui.tsx";

// Mirrors SpectrumView in @apr/games.
interface SpectrumView {
  round: number;
  totalRounds: number;
  phase: "pick" | "clue" | "guessing" | "reveal" | "finished";
  participants: string[];
  giver: string;
  candidates: { left: string; right: string }[];
  history: HistoryItem[];
  scale: { left: string; right: string };
  target: number | null;
  clue: string | null;
  submitted: string[];
  myGuess: number | null;
  deadlineAt: number | null;
  reveal: {
    results: { playerId: string; guess: number; distance: number; points: number }[];
    giverPoints: number;
  } | null;
}

interface Marker {
  at: number;
  label: string;
  kind: "target" | "guess" | "mine";
  /** A player whose picture stands on the marker. */
  playerId?: string;
}

/**
 * The two-pole scale with markers (target, guesses). With `onPick` the bar itself is the
 * control: press or drag anywhere on it to move your own pin.
 */
function Scale(props: {
  left: string;
  right: string;
  markers: Marker[];
  room: GameProps["room"];
  onPick?: (value: number) => void;
}) {
  const { left, right, markers, onPick } = props;
  const pick = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!onPick) return;
    const track = e.currentTarget;
    const at = (x: number) => {
      const box = track.getBoundingClientRect();
      onPick(Math.round(Math.min(100, Math.max(0, ((x - box.left) / box.width) * 100))));
    };
    at(e.clientX);
    const move = (ev: PointerEvent) => at(ev.clientX);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", () => window.removeEventListener("pointermove", move), { once: true });
  };
  return (
    <div className="scale">
      <div className={`scale-track${onPick ? " pickable" : ""}`} onPointerDown={pick}>
        {markers.map((m) => (
          <span key={`${m.kind}-${m.label}`} className={`scale-marker ${m.kind}`} style={{ left: `${m.at}%` }}>
            <span className="scale-marker-label">
              {m.playerId && <Avatar room={props.room} id={m.playerId} size="s" />}
              {m.label}
            </span>
          </span>
        ))}
      </div>
      <div className="scale-poles">
        <span>{left}</span>
        <span>{right}</span>
      </div>
    </div>
  );
}

function TopicPicker(props: {
  v: SpectrumView;
  isGiver: boolean;
  isHost: boolean;
  giverName: string;
  paused: boolean;
  send(action: object): Promise<boolean>;
}) {
  const { v, paused, send } = props;
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  return (
    <Candidates
      candidates={v.candidates.map((c) => (
        <>
          {c.left} <span className="muted">↔</span> {c.right}
        </>
      ))}
      history={v.history}
      pickerName={props.giverName}
      isPicker={props.isGiver}
      isHost={props.isHost}
      paused={paused}
      allowCustom
      aiDraft="给「猜刻度」出三条关于____的刻度"
      resetKey={v.round}
      send={send}
      custom={(extra) => (
        <form
          className="answer-row"
          onSubmit={(e) => {
            e.preventDefault();
            if (left.trim() && right.trim()) {
              void send({ type: "custom", left: left.trim(), right: right.trim(), ...extra });
            }
          }}
        >
          <input value={left} onChange={(e) => setLeft(e.target.value)} maxLength={12} placeholder="一端，如 冷" />
          <input value={right} onChange={(e) => setRight(e.target.value)} maxLength={12} placeholder="另一端，如 热" />
          <button type="submit" className="primary" disabled={paused}>
            用这条
          </button>
        </form>
      )}
    />
  );
}

export function SpectrumGame({ view, room, paused, act }: GameProps) {
  const v = view as SpectrumView;
  const me = room.me.playerId;
  const name = (id: string) => room.members.find((m) => m.id === id)?.nickname ?? "?";
  const { error, setError, send } = useAct(act);
  const [clue, setClue] = useState("");
  const [guess, setGuess] = useState(50);
  const seconds = useCountdown(paused ? null : v.deadlineAt);
  const isGiver = v.giver === me;
  const participating = v.participants.includes(me);
  const guessers = v.participants.filter((p) => p !== v.giver);

  // biome-ignore lint/correctness/useExhaustiveDependencies: reset inputs when a new round starts
  useEffect(() => {
    setClue("");
    setGuess(50);
    setError(null);
  }, [v.round]);

  const withRound = (action: object) => send({ ...action, round: v.round });

  function submitClue(e: FormEvent) {
    e.preventDefault();
    if (clue.trim()) void withRound({ type: "clue", text: clue.trim() });
  }

  const canGuess = v.phase === "guessing" && !isGiver && participating && v.myGuess == null && !paused;
  const markers: Marker[] = [];
  if (v.target != null) markers.push({ at: v.target, label: "目标", kind: "target" });
  if (v.reveal) {
    for (const r of v.reveal.results) {
      markers.push({ at: r.guess, label: name(r.playerId), kind: "guess", playerId: r.playerId });
    }
  } else if (v.myGuess != null) {
    markers.push({ at: v.myGuess, label: "我猜这里", kind: "mine", playerId: me });
  } else if (v.phase === "guessing" && !isGiver && participating) {
    markers.push({ at: guess, label: "拖我", kind: "mine", playerId: me });
  }

  return (
    <div className="game">
      <div className="game-head">
        <span className="tag">
          第 {v.round} 轮{v.totalRounds > 0 ? ` / 共 ${v.totalRounds} 轮` : ""} · 提示者：{name(v.giver)}
        </span>
        {seconds != null && v.phase !== "reveal" && <span className="tag timer">{seconds}s</span>}
      </div>

      {v.phase === "pick" ? (
        <TopicPicker
          v={v}
          isGiver={isGiver}
          isHost={room.me.isHost}
          giverName={name(v.giver)}
          paused={paused}
          send={withRound}
        />
      ) : (
        <Scale
          left={v.scale.left}
          right={v.scale.right}
          markers={markers}
          room={room}
          onPick={canGuess ? setGuess : undefined}
        />
      )}
      {v.clue && (
        <p className="clue">
          <span className="muted">{name(v.giver)} 的提示：</span>
          <strong>{v.clue}</strong>
        </p>
      )}

      {v.phase === "clue" &&
        (isGiver ? (
          <>
            <p className="notice">
              只有你能看到目标位置。写一句提示，让大家猜出它在「{v.scale.left} ↔ {v.scale.right}
              」之间的哪里。不能用数字。
            </p>
            <form className="answer-row" onSubmit={submitClue}>
              <input
                value={clue}
                onChange={(e) => setClue(e.target.value)}
                maxLength={30}
                placeholder="你的提示（最多 30 字）"
                disabled={paused}
              />
              <button type="submit" className="primary" disabled={paused}>
                提交提示
              </button>
            </form>
          </>
        ) : (
          <p className="muted">等待 {name(v.giver)} 写提示…</p>
        ))}

      {v.phase === "guessing" && (
        <>
          {isGiver ? (
            <p className="muted">提示已发出，等大家猜。语音里可别剧透。</p>
          ) : !participating ? (
            <p className="muted">你将从下一轮开始参与，本轮可以先围观。</p>
          ) : v.myGuess != null ? (
            <p className="notice">你的猜测已提交，等待其他人…</p>
          ) : (
            <>
              <p className="muted">直接在上面的刻度条上点或拖，把你的头像放到你认为的位置。</p>
              <button
                type="button"
                className="primary wide"
                disabled={paused}
                onClick={() => withRound({ type: "guess", value: guess })}
              >
                就猜这里
              </button>
            </>
          )}
          <Progress ids={guessers} done={v.submitted} name={name} />
        </>
      )}

      {v.phase === "reveal" && v.reveal && (
        <>
          <table className="results">
            <tbody>
              {v.reveal.results.map((r) => (
                <tr key={r.playerId} className={r.points > 0 ? "win" : ""}>
                  <td>
                    <Who room={room} id={r.playerId} />
                  </td>
                  <td className="muted">偏差 {r.distance}</td>
                  <td>{r.points > 0 ? `+${r.points}` : ""}</td>
                </tr>
              ))}
              <tr className={v.reveal.giverPoints > 0 ? "win" : ""}>
                <td>
                  <Who room={room} id={v.giver} />
                  （提示者）
                </td>
                <td className="muted">{v.reveal.results.length > 0 ? "猜测者平均分" : "没有人猜"}</td>
                <td>{v.reveal.giverPoints > 0 ? `+${v.reveal.giverPoints}` : ""}</td>
              </tr>
            </tbody>
          </table>
          {room.me.isHost ? (
            <button type="button" className="primary" disabled={paused} onClick={() => withRound({ type: "next" })}>
              {v.totalRounds > 0 && v.round >= v.totalRounds ? "结束并回到大厅" : "下一轮"}
            </button>
          ) : (
            <p className="muted">等待房主继续…</p>
          )}
        </>
      )}

      {room.me.isHost && (v.phase === "clue" || v.phase === "guessing") && (
        <div className="host-row">
          {v.phase === "guessing" && (
            <button type="button" disabled={paused} onClick={() => withRound({ type: "reveal" })}>
              提前揭晓
            </button>
          )}
          <button type="button" disabled={paused} onClick={() => withRound({ type: "skip" })}>
            跳过这轮
          </button>
        </div>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}
