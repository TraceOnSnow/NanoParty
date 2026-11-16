import { type FormEvent, useEffect, useState } from "react";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Seats } from "../table.tsx";
import { GameHead, HostControls, roundLabel, useNames } from "../ui.tsx";

interface Answer {
  text: string;
  shown: boolean;
}
interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "write" | "play" | "lastCall" | "roundOver" | "finished";
  category: { name: string; hint?: string };
  setter: string;
  players: string[];
  written: string[];
  myAnswers: Answer[] | null;
  shown: Record<string, string[]>;
  hiddenCount: Record<string, number>;
  current: string;
  money: Record<string, number>;
  pot: number;
  bonus: number;
  groups: number;
  bets: { player: string; number: number }[];
  open: {
    by: string;
    text: string;
    joined: { player: string; text: string; exact: boolean }[];
    invalid: boolean;
  } | null;
  last: { by: string; text: string; kind: "match" | "miss" | "invalid"; with: string[]; amount: number } | null;
  payout: { winners: string[]; share: number; pool: number } | null;
  winners: string[];
  deadlineAt: number | null;
}

const COUNT = 6;
const BET_NUMBERS = Array.from({ length: 13 }, (_, i) => i);

function WriteForm({ onSubmit, done }: { onSubmit(answers: string[]): Promise<boolean>; done: boolean }) {
  const [texts, setTexts] = useState<string[]>(Array(COUNT).fill(""));
  const ready = texts.every((t) => t.trim());
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (ready) await onSubmit(texts.map((t) => t.trim()));
  }
  return (
    <form className="echo-write" onSubmit={submit}>
      {texts.map((text, i) => (
        <input
          // biome-ignore lint/suspicious/noArrayIndexKey: six fixed slots
          key={i}
          value={text}
          maxLength={20}
          placeholder={`答案 ${i + 1}`}
          aria-label={`答案 ${i + 1}`}
          onChange={(e) => setTexts((now) => now.map((t, k) => (k === i ? e.target.value : t)))}
        />
      ))}
      <button type="submit" className="primary" disabled={!ready}>
        {done ? "改好了，重新交" : "写好了，交上去"}
      </button>
    </form>
  );
}

export function EchoGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const [betting, setBetting] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the bet row when the table moves on
  useEffect(() => setBetting(false), [v.step]);

  const playing = v.phase === "play" || v.phase === "lastCall";
  const myTurn = v.phase === "play" && v.current === me && !paused;
  const canJoin =
    playing && !!v.open && v.open.by !== me && !v.open.joined.some((j) => j.player === me) && !!v.myAnswers && !paused;
  const myBets = v.bets.filter((b) => b.player === me).length;
  const betsOn = (n: number) => v.bets.filter((b) => b.number === n);

  return (
    <div className="game wide echo">
      <GameHead
        label={roundLabel(v.round, v.totalRounds)}
        deadlineAt={v.phase === "roundOver" ? null : v.deadlineAt}
        paused={paused}
      />
      <div className="echo-topic">
        <span className="muted small">{name(v.setter)} 出的题</span>
        <strong className="question">{v.category.name}</strong>
        {v.category.hint && <span className="muted">{v.category.hint}</span>}
      </div>

      {v.phase === "write" && (
        <>
          <p className="muted">
            写 {COUNT} 个不重复的答案，别人看不到。想和别人撞上，就写大家最容易想到的；想让别人撞不上，就写偏门的。
          </p>
          {v.players.includes(me) ? (
            <WriteForm done={v.written.includes(me)} onSubmit={(answers) => go({ type: "write", answers })} />
          ) : (
            <p className="muted">这一轮已经开始了，下一轮加入。</p>
          )}
          <p className="muted small">
            已交：{v.written.map(name).join("、") || "还没有人"}（{v.written.length}/{v.players.length}）
          </p>
        </>
      )}

      {playing && (
        <div className="echo-bank">
          <span>
            奖池 <b>{v.pot}</b>
          </span>
          <span>
            本轮奖金 <b>{v.bonus}</b>
          </span>
          <span>
            已撞出 <b>{v.groups}</b> 组
          </span>
        </div>
      )}

      {playing && v.open && (
        <div className={`echo-open${v.open.invalid ? " bad" : ""}`}>
          <span>
            {name(v.open.by)} 亮出 <strong>「{v.open.text}」</strong>
            {v.open.invalid
              ? "——房主判定不符合题目。"
              : v.open.joined.length > 0
                ? `——撞上了：${v.open.joined.map((j) => `${name(j.player)}「${j.text}」`).join("、")}。`
                : "——暂时没人撞上。"}
          </span>
          {canJoin && <span className="muted small">你有意思一样的答案？在下面点它旁边的「也算」。</span>}
          {room.me.isHost && (
            <span className="host-row">
              {v.open.joined
                .filter((j) => !j.exact)
                .map((j) => (
                  <button key={j.player} type="button" onClick={() => go({ type: "reject", player: j.player })}>
                    {name(j.player)} 的「{j.text}」不算
                  </button>
                ))}
              <button type="button" onClick={() => go({ type: "invalid" })}>
                {v.open.invalid ? "撤销：符合题目" : "这个答案不符合题目"}
              </button>
            </span>
          )}
        </div>
      )}
      {playing && !v.open && v.last && (
        <p className="muted">
          {v.last.kind === "match"
            ? `${name(v.last.by)} 的「${v.last.text}」撞上了 ${v.last.with.map(name).join("、")}，拿走奖池 ${v.last.amount}。`
            : v.last.kind === "miss"
              ? `${name(v.last.by)} 的「${v.last.text}」没人撞上，交 ${v.last.amount}。`
              : `${name(v.last.by)} 的「${v.last.text}」不符合题目，交 ${v.last.amount}。`}
        </p>
      )}

      {playing && v.myAnswers && (
        <div className="echo-hand">
          {v.myAnswers.map((a, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: six fixed slots
            <span key={i} className={`echo-answer${a.shown ? " shown" : ""}`}>
              <button type="button" disabled={a.shown || !myTurn} onClick={() => go({ type: "play", index: i })}>
                {a.text}
              </button>
              {canJoin && !a.shown && (
                <button type="button" className="link" onClick={() => go({ type: "join", index: i })}>
                  也算
                </button>
              )}
            </span>
          ))}
        </div>
      )}
      {v.phase === "play" && (
        <p className="muted">
          {myTurn ? "轮到你：点一个答案亮出来，或者" : `等 ${name(v.current)} 行动…`}
          {myTurn && (
            <button type="button" className="link" onClick={() => setBetting((b) => !b)}>
              花 10 押注这一轮最后会撞出几组（你已押 {myBets}/4）
            </button>
          )}
        </p>
      )}
      {v.phase === "lastCall" && (
        <p className="answer">
          有人把答案亮完了。还有意思一样的答案可以现在认领，然后由 {name(v.current)} 或房主结算。
          {(room.me.isHost || v.current === me) && (
            <>
              {" "}
              <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "settle" })}>
                结算这一轮
              </button>
            </>
          )}
        </p>
      )}
      {playing && (betting || v.bets.length > 0) && (
        <div className="echo-bets">
          <span className="muted small">押最后一共撞出几组：</span>
          {BET_NUMBERS.map((n) => {
            const here = betsOn(n);
            return (
              <button
                key={n}
                type="button"
                className={`echo-bet${here.length ? " taken" : ""}`}
                disabled={!betting || !myTurn || here.length >= 2 || myBets >= 4}
                title={here.map((b) => name(b.player)).join("、")}
                onClick={() => go({ type: "bet", number: n })}
              >
                <b>{n}</b>
                {here.length > 0 && <em>{here.map((b) => name(b.player)).join(" ")}</em>}
              </button>
            );
          })}
        </div>
      )}

      {v.phase !== "write" && (
        <Seats
          room={room}
          ids={v.players}
          current={v.phase === "play" ? v.current : null}
          win={v.payout?.winners ?? []}
          note={(p) => (
            <span className="tag">
              {v.money[p] ?? 0} 元{v.hiddenCount[p] !== undefined ? ` · 还盖着 ${v.hiddenCount[p]}` : " · 没参加"}
            </span>
          )}
        >
          {(p) =>
            (v.shown[p] ?? []).length === 0 ? (
              <span className="muted small">还没亮过</span>
            ) : (
              (v.shown[p] ?? []).map((text) => (
                <span key={text} className="chip done">
                  {text}
                </span>
              ))
            )
          }
        </Seats>
      )}

      {v.phase === "roundOver" && v.payout && (
        <p className="answer">
          这一轮撞出 {v.groups} 组。
          {v.payout.winners.length > 0
            ? `押中的 ${v.payout.winners.map(name).join("、")} 分走 ${v.payout.pool}。`
            : `没人押中，${v.payout.pool} 滚到下一轮的奖池。`}
        </p>
      )}
      {v.phase === "roundOver" && !v.payout && <p className="answer">这一轮没有结算。</p>}
      <HostControls
        isHost={room.me.isHost}
        waitNote={v.phase === "roundOver" ? "等待房主继续…" : v.phase === "write" ? "等大家写完…" : undefined}
      >
        {v.phase === "write" && v.written.length >= 2 && v.written.length < v.players.length && (
          <button type="button" disabled={paused} onClick={() => go({ type: "begin" })}>
            不等了，先开始（没交的人这一轮不参加）
          </button>
        )}
        {v.phase === "roundOver" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "next" })}>
            {v.round >= v.totalRounds ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
