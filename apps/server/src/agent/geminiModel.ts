/**
 * Google Gemini (AI Studio key) implementation of the model boundary.
 * Talks to the public REST API with fetch, so no extra dependency is needed.
 */
import { z } from "zod";
import type { AgentModel, AgentRunInput, AgentRunResult } from "./model.ts";

export interface GeminiModelOptions {
  apiKey: string;
  baseUrl?: string;
  model: string;
  /** Injected in tests. */
  fetch?: typeof fetch;
}

const DEFAULT_BASE = "https://generativelanguage.googleapis.com/v1beta";
/** Upper bound of model<->tool round trips per trigger (same budget as the Anthropic adapter). */
const MAX_ITERATIONS = 4;
const MAX_TOKENS = 4096;

interface Part {
  text?: string;
  thought?: boolean;
  functionCall?: { name: string; args?: unknown };
  functionResponse?: { name: string; response: { result: string } };
}
interface Content {
  role: string;
  parts?: Part[];
}
interface GenerateResponse {
  candidates?: { content?: Content; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  error?: { message?: string };
}

export class GeminiAgentModel implements AgentModel {
  private readonly fetch: typeof fetch;

  constructor(private readonly opts: GeminiModelOptions) {
    this.fetch = opts.fetch ?? fetch;
  }

  async run(input: AgentRunInput): Promise<AgentRunResult> {
    const declarations = input.tools.map((t) => {
      const { $schema: _, ...schema } = z.toJSONSchema(t.inputSchema) as Record<string, unknown>;
      return { name: t.name, description: t.description, parametersJsonSchema: schema };
    });
    const contents: Content[] = [{ role: "user", parts: [{ text: input.prompt }] }];
    const usage = { inputTokens: 0, outputTokens: 0 };

    for (let i = 0; ; i++) {
      const lastTurn = i >= MAX_ITERATIONS;
      const res = await this.generate(
        {
          systemInstruction: { parts: [{ text: input.system }] },
          contents,
          // On the last allowed turn the model must answer in words.
          ...(declarations.length > 0 && !lastTurn ? { tools: [{ functionDeclarations: declarations }] } : {}),
          generationConfig: { maxOutputTokens: MAX_TOKENS },
        },
        input.signal,
      );
      usage.inputTokens += res.usageMetadata?.promptTokenCount ?? 0;
      usage.outputTokens += res.usageMetadata?.candidatesTokenCount ?? 0;
      const candidate = res.candidates?.[0];
      if (!candidate?.content) {
        throw new Error(
          `model returned no content (${res.promptFeedback?.blockReason ?? candidate?.finishReason ?? "unknown"})`,
        );
      }
      const parts = candidate.content.parts ?? [];
      const calls = parts.filter((p) => p.functionCall);
      if (calls.length === 0) {
        const text = parts
          .filter((p) => p.text && !p.thought)
          .map((p) => p.text)
          .join("")
          .trim();
        return { text, ...usage };
      }
      // The model's turn goes back unchanged (it may carry opaque reasoning signatures).
      contents.push(candidate.content);
      const responses: Part[] = [];
      for (const { functionCall } of calls) {
        const call = functionCall as { name: string; args?: unknown };
        responses.push({
          functionResponse: { name: call.name, response: { result: await this.runTool(input, call) } },
        });
      }
      contents.push({ role: "user", parts: responses });
    }
  }

  /** Tool errors are reported to the model as text so it can correct itself or tell the players. */
  private async runTool(input: AgentRunInput, call: { name: string; args?: unknown }): Promise<string> {
    const tool = input.tools.find((t) => t.name === call.name);
    if (!tool) return `没有名为 ${call.name} 的工具`;
    const parsed = tool.inputSchema.safeParse(call.args ?? {});
    if (!parsed.success) {
      return `参数格式不对：${parsed.error.issues.map((x) => `${x.path.join(".")} ${x.message}`).join("；")}`;
    }
    try {
      return await tool.run(parsed.data);
    } catch (e) {
      return `工具执行失败：${e instanceof Error ? e.message : "未知错误"}`;
    }
  }

  private async generate(body: unknown, signal: AbortSignal): Promise<GenerateResponse> {
    const url = `${this.opts.baseUrl ?? DEFAULT_BASE}/models/${encodeURIComponent(this.opts.model)}:generateContent`;
    const res = await this.fetch(url, {
      method: "POST",
      // The key travels in a header, never in the URL, so it cannot end up in request logs.
      headers: { "content-type": "application/json", "x-goog-api-key": this.opts.apiKey },
      body: JSON.stringify(body),
      signal,
    });
    const json = (await res.json().catch(() => ({}))) as GenerateResponse;
    if (!res.ok) throw new Error(`Gemini API ${res.status}: ${json.error?.message ?? "request failed"}`);
    return json;
  }
}
