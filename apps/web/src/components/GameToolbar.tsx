import type { Ack, Command, FeedbackKind, SegmentView } from "@apr/shared";
import { useEffect, useState } from "react";

const FEEDBACK: { kind: FeedbackKind; label: string }[] = [
  { kind: "not-interested", label: "不感兴趣" },
  { kind: "too-hard", label: "太难" },
  { kind: "unclear", label: "题意不清" },
  { kind: "wrong-answer", label: "答案有误" },
];

/** Platform controls shown under every game: vote to skip the current item, optional feedback. */
export function GameToolbar({ segment, command }: { segment: SegmentView; command(c: Command): Promise<Ack> }) {
  const { skip, contentId } = segment;
  const [sent, setSent] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: a new item clears the "thanks" note
  useEffect(() => setSent(null), [contentId]);

  if (!skip && !contentId) return null;
  return (
    <div className="game-toolbar">
      {skip && (
        <button
          type="button"
          disabled={!skip.canVote || skip.voted}
          onClick={() => command({ type: "voteSkip", segmentId: segment.id, key: skip.key })}
        >
          {skip.voted ? "已投票跳过" : "投票跳过"}（{skip.votes}/{skip.needed}）
        </button>
      )}
      {contentId &&
        (sent ? (
          <span className="muted">已记录反馈：{sent}</span>
        ) : (
          <details>
            <summary>这题有问题？</summary>
            <div className="host-row">
              {FEEDBACK.map((f) => (
                <button
                  key={f.kind}
                  type="button"
                  onClick={async () => {
                    const ack = await command({
                      type: "contentFeedback",
                      segmentId: segment.id,
                      contentId,
                      kind: f.kind,
                    });
                    if (ack.ok) setSent(f.label);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </details>
        ))}
    </div>
  );
}
