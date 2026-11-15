import { type Ack, CHAT_MAX, type ChatMessageView, type RoomView } from "@apr/shared";
import { type KeyboardEvent, useEffect, useRef, useState } from "react";
import { onChatDraft } from "../chatBus.ts";

interface Props {
  view: RoomView;
  chat: ChatMessageView[];
  say(text: string, askAi?: boolean): Promise<Ack>;
}

const AI_LABEL: Record<RoomView["ai"]["state"], string> = {
  idle: "AI 主持在线",
  thinking: "AI 主持处理中…",
  unavailable: "AI 主持不可用",
};

export function ChatPanel({ view, chat, say }: Props) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const pinned = useRef(true);

  // Follow new messages only while the reader is already at the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scroll when a message arrives
  useEffect(() => {
    const list = listRef.current;
    if (list && pinned.current) list.scrollTo({ top: list.scrollHeight });
  }, [chat.length]);

  // A left-panel button may hand over a draft; it never overwrites text the player is typing.
  useEffect(
    () =>
      onChatDraft((draft) => {
        setText((current) => (current.trim() ? current : draft));
        inputRef.current?.focus();
      }),
    [],
  );

  async function send(askAi: boolean) {
    const body = text.trim();
    if (!body) return;
    setText("");
    const ack = await say(body, askAi);
    if (!ack.ok) {
      setError(ack.error);
      setText((current) => current || body);
    } else setError(null);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key !== "Enter" || e.shiftKey || e.nativeEvent.isComposing) return;
    e.preventDefault();
    void send(e.ctrlKey || e.metaKey);
  }

  const aiOn = view.ai.enabled;
  return (
    <div className="chat">
      <div className={`ai-status ${view.ai.state}`}>
        {aiOn ? (view.ai.note ?? AI_LABEL[view.ai.state]) : "AI 主持未启用 · 游戏功能照常可用"}
      </div>
      <div
        className="chat-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
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
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send(false);
        }}
      >
        <textarea
          ref={inputRef}
          value={text}
          rows={2}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          maxLength={CHAT_MAX}
          placeholder="说点什么…（Enter 发送，Shift+Enter 换行）"
        />
        <div className="chat-buttons">
          <button type="submit">发送</button>
          <button
            type="button"
            className="ask-ai"
            disabled={!aiOn}
            title={aiOn ? "发到群里，并让 AI 主持处理（Ctrl+Enter）" : "AI 主持未启用"}
            onClick={() => void send(true)}
          >
            发送并找 AI
          </button>
        </div>
      </form>
    </div>
  );
}
