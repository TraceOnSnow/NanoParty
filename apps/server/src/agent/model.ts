/**
 * Model boundary for the shared host agent.
 *
 * `AgentModel` is the only thing the rest of the agent code knows about an LLM.
 * The default implementation uses the official Anthropic SDK; another
 * provider can be added by implementing this interface (and tests use a fake).
 */
import Anthropic from "@anthropic-ai/sdk";
import type { BetaMessageParam, BetaToolResultBlockParam } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { z } from "zod";

export interface AgentTool<I = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  /** Executes the controlled operation and returns a truthful, human-readable result. */
  run(input: I): Promise<string>;
}

export function defineTool<I>(tool: AgentTool<I>): AgentTool {
  return tool as AgentTool;
}

export interface AgentRunInput {
  system: string;
  prompt: string;
  tools: AgentTool[];
  signal: AbortSignal;
}

export interface AgentRunResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AgentModel {
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface AnthropicModelOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  effort: "low" | "medium" | "high";
  refusalFallback: boolean;
  fetch?: typeof fetch;
}

/** Upper bound of model<->tool round trips per trigger. Keeps cost and latency predictable. */
const MAX_ITERATIONS = 4;
const MAX_TOKENS = 4096;

export class AnthropicAgentModel implements AgentModel {
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicModelOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 1, fetch: opts.fetch });
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const tools = input.tools.map((t) => ({
      name: t.name,
      description: t.description,
      // Omitted type means a client-defined tool in Anthropic-compatible APIs.
      input_schema: { ...z.toJSONSchema(t.inputSchema), type: "object" as const },
    }));
    const messages: BetaMessageParam[] = [{ role: "user", content: input.prompt }];
    const usage = { inputTokens: 0, outputTokens: 0 };
    for (let iteration = 0; iteration <= MAX_ITERATIONS; iteration++) {
      const lastTurn = iteration === MAX_ITERATIONS;
      const response = await this.client.beta.messages.create(
        {
          model: this.opts.model,
          max_tokens: MAX_TOKENS,
          system: input.system,
          // Send complete history: compatible providers do not retain SDK thread state.
          messages,
          ...(!lastTurn && tools.length ? { tools } : {}),
          output_config: { effort: this.opts.effort },
          ...(this.opts.refusalFallback
            ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
            : {}),
        },
        { signal: input.signal },
      );
      usage.inputTokens += response.usage.input_tokens;
      usage.outputTokens += response.usage.output_tokens;
      if (response.stop_reason === "refusal") throw new Error("model declined the request");
      const calls = response.content.filter((block) => block.type === "tool_use");
      if (calls.length === 0) {
        const text = response.content
          .filter((block) => block.type === "text")
          .map((block) => block.text)
          .join("")
          .trim();
        return { text, ...usage };
      }
      if (lastTurn) throw new Error("model exceeded the tool iteration limit");
      // Preserve the assistant's full response, including opaque reasoning signatures.
      messages.push({ role: "assistant", content: response.content });
      const results: BetaToolResultBlockParam[] = [];
      for (const call of calls) {
        const tool = input.tools.find((candidate) => candidate.name === call.name);
        let content: string;
        let isError = false;
        try {
          if (!tool) throw new Error(`没有名为 ${call.name} 的工具`);
          const args = tool.inputSchema.parse(call.input);
          content = await tool.run(args);
        } catch (error) {
          isError = true;
          content = `工具执行失败：${error instanceof Error ? error.message : "未知错误"}`;
        }
        results.push({ type: "tool_result", tool_use_id: call.id, content, ...(isError ? { is_error: true } : {}) });
      }
      messages.push({ role: "user", content: results });
    }
    throw new Error("model exceeded the tool iteration limit");
  }
}
