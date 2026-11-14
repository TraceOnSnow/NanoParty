import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { GameHead, HostControls, lastRound, roundLabel, TextForm, useNames } from "../ui.tsx";

interface View {
  round: number;
  totalRounds: number;
  step: number;
  phase: "pick" | "describe" | "reveal" | "finished";
  participants: string[];
  describer: string;
  word: string | null;
  frames: { text: string; words: string[] }[] | null;
  sentences: string[];
  guesses: { by: string; text: string; close: boolean | null }[];
  winner: string | null;
  deadlineAt: number | null;
}

export function BlatherGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const describing = me === v.describer;

  return (
    <div className="game">
      <GameHead label={roundLabel(v.round, v.totalRounds)} deadlineAt={v.deadlineAt} paused={paused} />
      <p className="muted">
        描述者：<strong>{name(v.describer)}</strong>
        {describing && v.phase === "describe" && "　只能用下面的词块拼句子，不要在语音里补充。"}
      </p>
      {v.word && (
        <p className="notice">
          {v.phase === "reveal" ? "答案：" : "你要描述的词："}
          <strong className="big-clue">{v.word}</strong>
          {v.phase === "reveal" && (v.winner ? `　${name(v.winner)} 猜中了！` : "　没有人猜中。")}
        </p>
      )}

      <ul className="describe-list">
        {v.sentences.map((s) => (
          <li key={s}>
            <span className="text">{s}</span>
          </li>
        ))}
        {v.sentences.length === 0 && v.phase === "describe" && <li className="muted">还没有句子…</li>}
      </ul>

      {v.frames && (
        <div className="card">
          {v.frames.map((f, fi) => (
            <div key={f.text} className="frame">
              <span className="muted">{f.text.replace("____", "…")}</span>
              <span className="frame-words">
                {f.words.map((w, wi) => (
                  <button
                    key={w}
                    type="button"
                    disabled={paused || v.sentences.includes(f.text.replace("____", w))}
                    onClick={() => go({ type: "say", frame: fi, word: wi })}
                  >
                    {w}
                  </button>
                ))}
              </span>
            </div>
          ))}
        </div>
      )}

      {v.phase === "describe" && !describing && v.participants.includes(me) && (
        <TextForm
          placeholder="输入你的猜测"
          button="猜"
          maxLength={20}
          disabled={paused}
          resetKey={v.step}
          onSubmit={(text) => go({ type: "guess", text })}
        />
      )}
      {v.guesses.length > 0 && (
        <div className="word-log">
          {v.guesses.map((g, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: the log is append-only
            <div key={i} className={g.close === false ? "word invalid" : "word"}>
              <span className="who">{name(g.by)}</span>
              <span className="text">
                {g.text}
                {g.close === true && " 🔥 接近"}
                {g.close === false && " ✗"}
              </span>
              {describing && v.phase === "describe" && g.close === null && (
                <span className="host-row">
                  <button type="button" onClick={() => go({ type: "react", index: i, close: true })}>
                    接近
                  </button>
                  <button type="button" onClick={() => go({ type: "react", index: i, close: false })}>
                    不对
                  </button>
                </span>
              )}
            </div>
          ))}
        </div>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {v.phase === "describe" && (
          <button type="button" disabled={paused} onClick={() => go({ type: "advance" })}>
            没人猜得出，直接揭晓
          </button>
        )}
        {v.phase === "reveal" && (
          <button type="button" className="primary" disabled={paused} onClick={() => go({ type: "advance" })}>
            {lastRound(v.round, v.totalRounds) ? "结束并回到大厅" : "下一轮"}
          </button>
        )}
      </HostControls>
      {error && <p className="error">{error}</p>}
    </div>
  );
}
