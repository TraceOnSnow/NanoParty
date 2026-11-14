/**
 * Model boundary for the shared host agent.
 *
 * `AgentModel` is the only thing the rest of the agent code knows about an LLM.
 * The default implementation uses the official Anthropic SDK tool runner; another
 * provider can be added by implementing this interface (and tests use a fake).
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";

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
}

/** Upper bound of model<->tool round trips per trigger. Keeps cost and latency predictable. */
const MAX_ITERATIONS = 4;
const MAX_TOKENS = 4096;

export class AnthropicAgentModel implements AgentModel {
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicModelOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, baseURL: opts.baseUrl, maxRetries: 1 });
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const tools = input.tools.map((t) =>
      betaZodTool({
        name: t.name,
        description: t.description,
        // biome-ignore lint/suspicious/noExplicitAny: tool schemas are objects by convention; the SDK validates input at runtime
        inputSchema: t.inputSchema as any,
        run: (args: unknown) => t.run(args),
      }),
    );
    const final = await this.client.beta.messages.toolRunner(
      {
        model: this.opts.model,
        max_tokens: MAX_TOKENS,
        max_iterations: MAX_ITERATIONS,
        system: input.system,
        messages: [{ role: "user", content: input.prompt }],
        tools,
        output_config: { effort: this.opts.effort },
        // On a policy decline the API retries on a fallback model inside the same call.
        ...(this.opts.refusalFallback
          ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
          : {}),
      },
      { signal: input.signal },
    );
    if (final.stop_reason === "refusal") throw new Error("model declined the request");
    const text = final.content
      .filter((b) => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim();
    return { text, inputTokens: final.usage.input_tokens, outputTokens: final.usage.output_tokens };
  }
}
