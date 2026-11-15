import type { Ack, Command, PlayFeedbackKind, SegmentView } from "@apr/shared";
import { useEffect, useState } from "react";

const FEEDBACK: { kind: PlayFeedbackKind; label: string }[] = [
  { kind: "unclear", label: "题意不清" },
  { kind: "wrong-answer", label: "答案疑似有误" },
  { kind: "not-interested", label: "不感兴趣" },
  { kind: "too-hard", label: "太难" },
  { kind: "ai-judgement", label: "AI 判定有误" },
  { kind: "ui-flow", label: "界面 / 流程异常" },
];

/** Platform controls shown under every game: vote to skip the current item, optional feedback. */
export function GameToolbar({ segment, command }: { segment: SegmentView; command(c: Command): Promise<Ack> }) {
  const { skip, contentId } = segment;
  const [sent, setSent] = useState<string | null>(null);
  const [note, setNote] = useState("");

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new item clears the "thanks" note
  useEffect(() => setSent(null), [contentId]);

  return (
    <div className="game-toolbar">
      {skip && (
        <button
          type="button"
          disabled={!skip.canVote || skip.voted}
          onClick={() => command({ type: "voteSkip", segmentId: segment.id, key: skip.key })}
        >
          {skip.voted ? "已投票跳过" : "投票跳过本题"}（{skip.votes}/{skip.needed}）
        </button>
      )}
      {sent ? (
        <span className="muted">已记录反馈：{sent}</span>
      ) : (
        <details>
          <summary>反馈问题</summary>
          <div className="host-row">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              maxLength={300}
              placeholder="补充说明（选填）"
              aria-label="反馈说明"
            />
          </div>
          <div className="host-row">
            {FEEDBACK.map((f) => (
              <button
                key={f.kind}
                type="button"
                onClick={async () => {
                  const ack = await command({
                    type: "feedback",
                    kind: f.kind,
                    ...(note.trim() ? { note: note.trim() } : {}),
                  });
                  if (ack.ok) {
                    setSent(f.label);
                    setNote("");
                  }
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
        </details>
      )}
    </div>
  );
}
