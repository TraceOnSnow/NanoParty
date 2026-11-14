import type { Ack, Command, InteractionView, RoomView } from "@apr/shared";
import { type FormEvent, useState } from "react";

interface Props {
  view: RoomView;
  command(command: Command): Promise<Ack>;
}

/** Renders the Canvas interaction on screen. Every kind uses the same fixed, program-owned widgets. */
export function CanvasPanel({ view, command }: Props) {
  const it = view.canvas.current;
  if (!it)
    return view.canvas.queued > 0 ? (
      <p className="muted small canvas-queued">AI 主持准备了 {view.canvas.queued} 个互动，回合间隙显示。</p>
    ) : null;
  const name = (id: string) => view.members.find((m) => m.id === id)?.nickname ?? "?";
  const respond = (value: string | boolean) => command({ type: "respond", interactionId: it.id, value });
  const close = () => command({ type: "closeInteraction", interactionId: it.id });
  const waiting = it.responders.filter((p) => !it.responded.includes(p));

  return (
    <div className={`card canvas ${it.kind}`}>
      <div className="lobby-head">
        <strong>{it.title}</strong>
        <span className="tag">{it.kind === "confirm" ? "需要确认" : "AI 主持"}</span>
      </div>
      {it.description && <p>{it.description}</p>}
      {it.effectSummary && <p className="notice">{it.effectSummary}</p>}

      {it.status === "open" ? (
        <>
          <Body it={it} respond={respond} name={name} />
          {it.responders.length > 0 && (
            <p className="muted small">{waiting.length > 0 ? `还在等：${waiting.map(name).join("、")}` : "都回应了"}</p>
          )}
        </>
      ) : (
        <Result it={it} name={name} />
      )}

      {view.me.isHost && (
        <div className="host-row">
          <button type="button" onClick={close}>
            {it.status === "open" ? "不等了，就按现在的结果" : "关闭"}
          </button>
        </div>
      )}
    </div>
  );
}

function Body({
  it,
  respond,
  name,
}: {
  it: InteractionView;
  respond(v: string | boolean): Promise<Ack>;
  name(id: string): string;
}) {
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const send = async (v: string | boolean) => {
    const ack = await respond(v);
    setError(ack.ok ? null : ack.error);
    return ack.ok;
  };
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (text.trim() && (await send(text.trim()))) setText("");
  }

  let body: React.ReactNode = null;
  if (it.kind === "show") {
    body = <Items items={it.items ?? []} />;
  } else if (it.kind === "collect") {
    body = it.canRespond ? (
      <form className="answer-row" onSubmit={submit}>
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={it.maxLength}
          placeholder={it.placeholder ?? "写点什么"}
        />
        <button type="submit" className="primary">
          提交
        </button>
      </form>
    ) : it.myResponse != null ? (
      <p className="notice">
        你提交了：<strong>{String(it.myResponse)}</strong>
      </p>
    ) : null;
  } else if (it.kind === "choose") {
    body = (
      <div className="pick-grid">
        {it.options?.map((o) => (
          <button
            key={o.id}
            type="button"
            className={it.myResponse === o.id ? "pick picked" : "pick"}
            disabled={!it.canRespond}
            onClick={() => send(o.id)}
          >
            {o.label}
            {o.detail && <span className="muted small"> {o.detail}</span>}
          </button>
        ))}
      </div>
    );
  } else if (it.kind === "confirm") {
    body = it.canRespond ? (
      <div className="host-row">
        <button type="button" className="primary" onClick={() => send(true)}>
          批准
        </button>
        <button type="button" onClick={() => send(false)}>
          拒绝
        </button>
      </div>
    ) : (
      <p className="muted">等待 {it.responders.map(name).join("、")} 确认…</p>
    );
  }
  return (
    <>
      {body}
      {error && <p className="error">{error}</p>}
    </>
  );
}

function Items({ items }: { items: { label: string; detail?: string }[] }) {
  return (
    <ul className="describe-list">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: display-only list
        <li key={i}>
          <span className="text">
            <strong>{item.label}</strong>
            {item.detail && <span className="muted small"> {item.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Result({ it, name }: { it: InteractionView; name(id: string): string }) {
  const r = it.result;
  if (!r) return null;
  switch (r.kind) {
    case "show":
      return <Items items={it.items ?? []} />;
    case "collect":
      return (
        <ul className="describe-list">
          {r.entries.length === 0 && <li className="muted">没有人提交。</li>}
          {r.entries.map((e) => (
            <li key={e.playerId}>
              <span className="who">{name(e.playerId)}</span>
              <span className="text">{e.text}</span>
            </li>
          ))}
        </ul>
      );
    case "choose":
      return (
        <ul className="describe-list">
          {r.tally.map((t) => (
            <li key={t.id} className={r.winners.includes(t.id) ? "picked" : ""}>
              <span className="text">{t.label}</span>
              <span className="muted small">{t.voters.map(name).join("、") || "—"}</span>
              <strong>{t.voters.length}</strong>
            </li>
          ))}
        </ul>
      );
    case "confirm":
      return <p className="answer">{r.approved ? `已批准：${r.outcome}` : "未批准"}</p>;
  }
}
