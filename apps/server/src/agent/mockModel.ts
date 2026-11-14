import type { AgentModel, AgentRunInput, AgentRunResult } from "./model.ts";

/**
 * Development stand-in for a real model (AI_MOCK=true). It exercises the same path as a real
 * agent — triggers, queueing, limits, controlled tools, chat replies — with canned behaviour,
 * so the AI-facing UI can be tried without an API key. It is not a substitute for testing
 * against a real model.
 */
export class MockAgentModel implements AgentModel {
  private turn = 0;

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    await new Promise((resolve) => setTimeout(resolve, 800));
    const usage = { inputTokens: 0, outputTokens: 0 };
    const wantsRecommendation = /让 AI 推荐玩法|推荐|玩什么|玩啥/.test(
      input.prompt.split("## 本次需要你回应的请求")[1] ?? "",
    );
    const suggest = input.tools.find((t) => t.name === "suggest_game");
    if (wantsRecommendation && suggest) {
      const gameId = ["spectrum", "undercover"][this.turn++ % 2] as string;
      const outcome = await suggest.run({ gameId, reason: "（模拟 AI）换换口味，试试这个？" });
      return { text: `（模拟 AI）${outcome}`, ...usage };
    }
    return { text: "（模拟 AI）我是开发用的模拟主持人：现在只会推荐游戏。配置真实模型后我才会认真聊天。", ...usage };
  }
}
