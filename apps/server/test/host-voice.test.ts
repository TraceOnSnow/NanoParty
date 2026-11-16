import { describe, expect, it } from "vitest";
import { cleanReply } from "../src/agent/AgentService.ts";
import { type ChatLine, shapeChat } from "../src/agent/prompt.ts";

describe("what of the host's text reaches the chat", () => {
  it("posts nothing when the host stays silent or leaks tool-call markup", () => {
    expect(cleanReply("")).toEqual([]);
    expect(cleanReply("（不回）")).toEqual([]);
    expect(cleanReply("(不回)")).toEqual([]);
    expect(cleanReply('<｜｜DSML｜｜ calls>\n<｜｜DSML｜｜ invoke name="offer_content">')).toEqual([]);
  });

  it("sends a few short lines as separate messages and drops emphasis marks", () => {
    expect(cleanReply("不给\n**你先**把自己的扣了")).toEqual(["不给", "你先把自己的扣了"]);
  });

  it("keeps requested long content in one message and cuts a runaway reply at a sentence end", () => {
    const list = Array.from({ length: 8 }, (_, i) => `${i + 1}. 第${i + 1}条`).join("\n");
    expect(cleanReply(list)).toEqual([list]);
    const [cut] = cleanReply(`${"这是一句很长的话。".repeat(80)}`);
    expect(cut?.length).toBeLessThanOrEqual(400);
    expect(cut?.endsWith("。")).toBe(true);
  });
});

describe("the chat the host reads", () => {
  const line = (kind: ChatLine["kind"], speaker: string, text: string): ChatLine => ({ kind, speaker, text });

  it("keeps the players' lines whole and its own earlier replies to their opening words", () => {
    const own = "这是主持之前说过的一段很长很长的话，里面有比喻、有条件、还有三段。";
    const shaped = shapeChat([
      line("player", "甲", "给乙扣100分"),
      line("agent", "AI", own),
      line("player", "甲", "？"),
    ]);
    expect(shaped.map((m) => m.text)).toEqual(["给乙扣100分", `${own.slice(0, 24)}…`, "？"]);
  });

  it("drops the oldest lines first when the evening no longer fits, never the newest", () => {
    const lines = Array.from({ length: 50 }, (_, i) => line("player", "甲", `第${i}句${"啊".repeat(20)}`));
    const shaped = shapeChat(lines, 300);
    expect(shaped.length).toBeLessThan(50);
    expect(shaped.at(-1)?.text.startsWith("第49句")).toBe(true);
  });
});
