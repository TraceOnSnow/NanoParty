import { useEffect, useState } from "react";
import { Avatar, Who } from "../../components/Avatar.tsx";
import type { GameProps } from "../registry.tsx";
import { useAct } from "../shared.ts";
import { Qa, QaLog } from "../talk.tsx";
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

const BLANK = "____";

export function BlatherGame({ view, room, paused, act }: GameProps) {
  const v = view as View;
  const name = useNames(room);
  const me = room.me.playerId;
  const { error, send } = useAct(act);
  const go = (action: object) => send({ ...action, step: v.step });
  const describing = me === v.describer;
  const live = v.phase === "describe";
  /** The sentence being put together: which frame and which word. */
  const [draft, setDraft] = useState<{ frame: number; word: number } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: a new sentence or round clears the draft
  useEffect(() => setDraft(null), [v.sentences.length, v.round]);
  const said = (frame: { text: string }, word: string) => v.sentences.includes(frame.text.replace(BLANK, word));
  const draftFrame = draft ? v.frames?.[draft.frame] : undefined;
  const draftWord = draft && draftFrame ? draftFrame.words[draft.word] : undefined;

  return (
    <div className="game blather">
      <GameHead label={roundLabel(v.round, v.totalRounds)} deadlineAt={v.deadlineAt} paused={paused} />
      <p className="role-line">
        <span>
          描述 <Who room={room} id={v.describer} />
        </span>
        {live && <span className="muted small">只能用词块拼句子，语音里不许补充</span>}
      </p>

      {v.word && (
        <div className="taboo-card">
          <span className="muted small">{v.phase === "reveal" ? "答案" : "你要描述的词（别念出来）"}</span>
          <strong className="taboo-word">{v.word}</strong>
          {v.phase === "reveal" && (
            <span className="answer">
              {v.winner ? (
                <>
                  <Who room={room} id={v.winner} /> 猜中了！
                </>
              ) : (
                "没有人猜中。"
              )}
            </span>
          )}
        </div>
      )}

      <div className="speech">
        <Avatar room={room} id={v.describer} size="l" />
        <div className="speech-lines">
          {v.sentences.map((s, i) => (
            <span key={s} className={i === v.sentences.length - 1 && live ? "speech-line fresh" : "speech-line"}>
              {s}
            </span>
          ))}
          {v.sentences.length === 0 && (
            <span className="speech-line empty">
              {describing ? "在下面挑词块，拼出第一句。" : `${name(v.describer)} 还在憋第一句…`}
            </span>
          )}
        </div>
      </div>

      {v.frames && live && (
        <div className="frames">
          {v.frames.map((f, fi) => {
            const [before, after] = f.text.split(BLANK);
            const pickedHere = draft?.frame === fi ? f.words[draft.word] : null;
            return (
              <div key={f.text} className={pickedHere ? "frame-strip on" : "frame-strip"}>
                <span className="frame-text">
                  {before}
                  <b className={pickedHere ? "blank filled" : "blank"}>{pickedHere ?? "　？　"}</b>
                  {after}
                </span>
                <span className="frame-words">
                  {f.words.map((w, wi) => (
                    <button
                      key={w}
                      type="button"
                      className={draft?.frame === fi && draft.word === wi ? "word-block on" : "word-block"}
                      disabled={paused || said(f, w)}
                      onClick={() =>
                        setDraft(draft?.frame === fi && draft.word === wi ? null : { frame: fi, word: wi })
                      }
                    >
                      {w}
                    </button>
                  ))}
                </span>
              </div>
            );
          })}
          <button
            type="button"
            className="primary wide"
            disabled={paused || !draft}
            onClick={() => draft && go({ type: "say", frame: draft.frame, word: draft.word })}
          >
            {draftFrame && draftWord ? `说出：${draftFrame.text.replace(BLANK, draftWord)}` : "先挑一个词块"}
          </button>
        </div>
      )}

      {live && !describing && v.participants.includes(me) && (
        <TextForm
          placeholder="想到就猜，可以一直猜"
          button="猜"
          maxLength={20}
          disabled={paused}
          resetKey={v.step}
          onSubmit={(text) => go({ type: "guess", text })}
        />
      )}
      {v.guesses.length > 0 && (
        <QaLog>
          {v.guesses.map((g, i) => (
            <Qa
              // biome-ignore lint/suspicious/noArrayIndexKey: the log is append-only
              key={i}
              room={room}
              by={g.by}
              text={g.text}
              stamp={g.close === true ? "🔥 接近" : g.close === false ? "✗ 不对" : null}
              tone={g.close === true ? "mid" : g.close === false ? "no" : undefined}
              aside={
                describing &&
                live &&
                g.close === null && (
                  <>
                    <button
                      type="button"
                      className="verdict-btn mid"
                      title="接近"
                      onClick={() => go({ type: "react", index: i, close: true })}
                    >
                      🔥
                    </button>
                    <button
                      type="button"
                      className="verdict-btn no"
                      title="不对"
                      onClick={() => go({ type: "react", index: i, close: false })}
                    >
                      ✗
                    </button>
                  </>
                )
              }
            />
          ))}
        </QaLog>
      )}

      <HostControls isHost={room.me.isHost} waitNote={v.phase === "reveal" ? "等待房主继续…" : undefined}>
        {live && (
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
