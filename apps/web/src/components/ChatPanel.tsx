import { type Ack, CHAT_MAX, type ChatMessageView, type RoomView } from "@apr/shared";
import { type FormEvent, useEffect, useRef, useState } from "react";

interface Props {
  view: RoomView;
  chat: ChatMessageView[];
  say(text: string): Promise<Ack>;
}

const AI_LABEL: Record<RoomView["ai"]["state"], string> = {
  idle: "AI 主持在线 · @AI 找它",
  thinking: "AI 主持思考中…",
  unavailable: "AI 主持不可用",
};

export function ChatPanel({ view, chat, say }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message arrives
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [chat.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    setText("");
    const ack = await say(body);
    if (!ack.ok) {
      setError(ack.error);
      setText(body);
    } else setError(null);
  }

  return (
    <div className="chat">
      <div className={`ai-status ${view.ai.state}`}>
        {view.ai.enabled ? (view.ai.note ?? AI_LABEL[view.ai.state]) : "AI 主持未启用 · 游戏功能照常可用"}
      </div>
      <div className="chat-list" ref={listRef}>
        {chat.map((m) => (
          <div key={m.id} className={`msg ${m.sender.kind}`}>
            {m.sender.kind !== "system" && (
              <span className="who">{m.sender.kind === "player" ? m.sender.nickname : "AI 主持"}</span>
            )}
            <span className="text">{m.text}</span>
          </div>
        ))}
        {chat.length === 0 && <p className="muted">群聊只是聊天；答题请在左侧操作。</p>}
      </div>
      {error && <p className="error">{error}</p>}
      <form className="chat-input" onSubmit={submit}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={CHAT_MAX} placeholder="说点什么…" />
        <button type="submit">发送</button>
      </form>
    </div>
  );
}
