import type { Ack, Command } from "@apr/shared";
import { useState } from "react";

/** "Adapt these soups to a theme" under the soup picker. The server checks who may use it. */
export function ThemeAdapt(props: { segmentId: string; disabled: boolean; command(c: Command): Promise<Ack> }) {
  const [theme, setTheme] = useState("");
  return (
    <form
      className="answer-row"
      onSubmit={(e) => {
        e.preventDefault();
        if (theme.trim()) void props.command({ type: "adaptContent", segmentId: props.segmentId, theme: theme.trim() });
      }}
    >
      <input
        value={theme}
        onChange={(e) => setTheme(e.target.value)}
        maxLength={40}
        placeholder="按主题改编候选汤，如 英雄联盟（只换人名地点，不改谜底逻辑）"
        aria-label="改编主题"
      />
      <button type="submit" disabled={props.disabled}>
        让 AI 改编
      </button>
    </form>
  );
}
