import type { AgentModel, AgentRunInput, AgentRunResult } from "./model.ts";

/**
 * Development stand-in for a real model (AI_MOCK=true). It drives the same tools and the same
 * Canvas machinery as a real agent, so the UI can be tried without an API key — but its
 * "planning" is a fixed script keyed on words in the request. It demonstrates the plumbing,
 * not the agent's ability to compose flows; that needs a real model.
 *
 * Script: "@AI ... 主题 ..." → collect a theme from everyone → vote → write 3 spectrum cards
 * for the winner and offer them to the game. "推荐" → suggest a game.
 */
export class MockAgentModel implements AgentModel {
  private turn = 0;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    await new Promise((resolve) => setTimeout(resolve, 600));
    const usage = { inputTokens: 0, outputTokens: 0 };
    const request = input.prompt.split("## 本次需要你处理的事")[1] ?? "";
    const tool = (name: string, args: unknown) => {
      const t = input.tools.find((x) => x.name === name);
      if (!t) return Promise.resolve(`（没有工具 ${name}）`);
      return t.run(t.inputSchema.parse(args));
    };
    const reply = (text: string) => ({ text: `（模拟 AI）${text}`, ...usage });

    // Results of interactions this script created.
    if (request.includes("「大家想要什么主题？」收到：")) {
      // Summary format: 「title」收到：昵称：内容；昵称：内容
      const received = request.split("收到：")[1]?.split("\n")[0] ?? "";
      const ideas = received
        .split("；")
        .map((entry) => entry.slice(entry.indexOf("：") + 1).trim())
        .filter(Boolean);
      const unique = [...new Set(ideas)].slice(0, 8);
      if (unique.length < 2) {
        await tool("note_plan", { text: `主题：${unique[0] ?? "随机"}` });
        return this.writeCards(unique[0] ?? "生活", tool, reply);
      }
      await tool("create_interaction", {
        interaction: {
          kind: "choose",
          title: "投票选主题",
          options: unique.map((label, i) => ({ id: `t${i}`, label })),
        },
      });
      return reply("主题收齐了，投个票吧。");
    }
    if (request.includes("「投票选主题」结果")) {
      const theme = /得票最高：([^、\n。]+)/.exec(request)?.[1]?.trim() ?? "生活";
      return this.writeCards(theme, tool, reply);
    }
    if (request.includes("你之前创建的互动结束了")) return reply("收到。");

    if (/主题|题卡|出题/.test(request)) {
      await tool("note_plan", { text: "收集主题 → 投票 → 写 3 张刻度卡交给提示者" });
      const out = await tool("create_interaction", {
        interaction: { kind: "collect", title: "大家想要什么主题？", placeholder: "例如：英雄联盟", maxLength: 20 },
      });
      return reply(`先请每人报一个主题。${out.includes("排队") ? "（等这一轮结束后显示）" : ""}`);
    }
    if (/推荐|玩什么|玩啥/.test(request)) {
      const gameId = ["spectrum", "undercover", "quip"][this.turn++ % 3] as string;
      const outcome = await tool("suggest_game", { gameId, reason: "（模拟 AI）换换口味，试试这个？" });
      return reply(outcome);
    }
    return reply(
      "我是开发用的模拟主持人：会推荐游戏，或者在猜刻度里帮你按主题出题（说「@AI 按主题出题」）。配置真实模型后才会真正理解你的话。",
    );
  }

  private async writeCards(
    theme: string,
    tool: (name: string, args: unknown) => Promise<string>,
    reply: (text: string) => AgentRunResult,
  ): Promise<AgentRunResult> {
    const saved = await tool("save_content", {
      contentType: "spectrum",
      theme,
      items: [
        { left: `${theme}新手`.slice(0, 12), right: `${theme}大神`.slice(0, 12) },
        { left: "冷门", right: `${theme}顶流`.slice(0, 12) },
        { left: "毫无关系", right: `最有${theme}味`.slice(0, 12) },
      ],
    });
    const ids = /id：([^。]+)/.exec(saved)?.[1]?.split(", ") ?? [];
    const offered = ids.length > 0 ? await tool("offer_content", { contentIds: ids }) : saved;
    await tool("note_plan", { text: "" });
    return reply(`按「${theme}」写了 ${ids.length} 张刻度卡：${offered}`);
  }
}
