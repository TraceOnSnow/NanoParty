import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, lastRound, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "playing" | "roundOver" | "finished";
  participants: string[];
  alive: string[];
  current: string;
  category: { name: string; hint?: string };
  words: { playerId: string; text: string; invalid?: boolean }[];
  out: { playerId: string; reason: "timeout" | "gave-up" | "invalid" }[];
  winner: string | null;
  deadlineAt: number | null;
}

const OUT_LABEL = { timeout: "超时", "gave-up": "认输", invalid: "被判无效" } as const;

export function CategoriesGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const myTurn = v.phase === "playing" && v.current === me;

  return (
    <div className="game">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "playing" ? v.deadlineAt : null}
        paused={paused}
      />
      <h2 className="question">
        {v.category.name}
        {v.category.hint && <span className="muted small">　{v.category.hint}</span>}
      </h2>

      <Seats
        room={room}
        ids={v.participants}
        wide
        current={v.phase === "playing" ? v.current : null}
        out={v.out.map((o) => o.playerId)}
        win={v.phase === "roundOver" && v.winner ? [v.winner] : []}
        note={(id) => {
          const out = v.out.find((o) => o.playerId === id);
          return out ? <span className="tag">{OUT_LABEL[out.reason]}</span> : null;
        }}
      >
        {(id) => (
          <span className="said-words">
            {v.words
              .filter((w) => w.playerId === id)
              .map((w, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: the log is append-only
                <span key={i} className={w.invalid ? "mini-card free" : "mini-card"}>
                  {w.invalid ? <s>{w.text}</s> : w.text}
                </span>
              ))}
            {v.words.every((w) => w.playerId !== id) && <span className="muted small">还没说</span>}
          </span>
        )}
      </Seats>
      {v.words.length > 0 && (
        <p className="muted small">
          刚说的：<strong>{v.words.at(-1)?.text}</strong>（{name(v.words.at(-1)?.playerId ?? "")}）　已经有{" "}
          {v.words.length} 个词，不能重复。
        </p>
      )}

      {v.phase === "playing" &&
        (myTurn ? (
          <>
            <TextForm
              placeholder="轮到你了，快说一个！"
              button="说"
              maxLength={20}
              disabled={paused}
              resetKey={v.step}
              onSubmit={(text) => go({ type: "say", text })}
            />
            <div className="host-row">
              <button type="button" disabled={paused} onClick={() => go({ type: "giveUp" })}>
                想不出来，认输
              </button>
            </div>
          </>
        ) : (
          <p className="muted">
            {v.alive.includes(me)
              ? `等 ${name(v.current)} 说…`
              : v.participants.includes(me)
                ? "你已出局，看看谁撑到最后。"
                : "你将从下一轮开始参与。"}
          </p>
        ))}

      {v.phase === "roundOver" && (
        <p className="answer">
          {v.winner ? (
            <>
              本轮 <strong>{name(v.winner)}</strong> 撑到了最后！
            </>
          ) : (
            "本轮没有赢家。"
          )}
        </p>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "roundOver" ? "等待房主继续…" : undefined}>
        {v.phase === "playing" && v.words.length > 0 && !v.words.at(-1)?.invalid && (
          <button type="button" disabled={paused} onClick={() => go({ type: "invalidate" })}>
            判「{v.words.at(-1)?.text}」无效
          </button>
        )}
        {v.phase === "roundOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
