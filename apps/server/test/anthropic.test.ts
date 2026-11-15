import { expect, it } from "vitest";
import { z } from "zod";
import { AnthropicAgentModel, defineTool } from "../src/agent/model.ts";

it("preserves full tool history through the Anthropic-compatible API without an explicit custom type", async () => {
  const requests: Record<string, unknown>[] = [];
  let calls = 0;
  const model = new AnthropicAgentModel({
    apiKey: "test-key",
    baseUrl: "https://example.test/anthropic",
    model: "deepseek-v4-flash",
    effort: "low",
    refusalFallback: false,
    fetch: async (_url, init) => {
      requests.push(JSON.parse(String(init?.body)));
      const first = requests.length === 1;
      return new Response(
        JSON.stringify({
          id: `msg-${requests.length}`,
          type: "message",
          role: "assistant",
          model: "deepseek-v4-flash",
          content: first
            ? [{ type: "tool_use", id: "call-1", name: "check", input: { value: 7 } }]
            : [{ type: "text", text: "OK" }],
          stop_reason: first ? "tool_use" : "end_turn",
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 5 },
        }),
        { headers: { "content-type": "application/json" } },
      );
    },
  });
  const result = await model.run({
    system: "Test",
    prompt: "Check",
    signal: AbortSignal.timeout(5000),
    tools: [
      defineTool({
        name: "check",
        description: "Check a value",
        inputSchema: z.object({ value: z.number() }),
        run: async ({ value }) => {
          calls++;
          expect(value).toBe(7);
          return "verified";
        },
      }),
    ],
  });
  expect(result.text).toBe("OK");
  expect(result.inputTokens).toBe(20);
  expect(result.outputTokens).toBe(10);
  expect(calls).toBe(1);
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request.tools).toEqual([expect.objectContaining({ name: "check", input_schema: expect.any(Object) })]);
    expect((request.tools as Record<string, unknown>[])[0]).not.toHaveProperty("type");
    expect(request).not.toHaveProperty("fallbacks");
  }
  expect(JSON.stringify(requests[1]?.messages)).toContain("verified");
  expect(requests[1]?.messages).toEqual([
    { role: "user", content: "Check" },
    {
      role: "assistant",
      content: [{ type: "tool_use", id: "call-1", name: "check", input: { value: 7 } }],
    },
    {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "call-1", content: "verified" }],
    },
  ]);
});
